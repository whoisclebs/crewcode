import { afterEach, beforeEach, describe, expect } from "bun:test"
import { readdir, readFile, rm } from "fs/promises"
import path from "path"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@crewcode/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@crewcode/core/cross-spawn-spawner"
import { Global } from "@crewcode/core/global"
import { LayerNode } from "@crewcode/core/effect/layer-node"
import { PermissionV1 } from "@crewcode/core/v1/permission"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Permission } from "../../src/permission"
import { parseRecords } from "../../src/permission/review/audit"
import { PermissionReviewConversation } from "../../src/permission/review/conversation"
import { ModelError, PermissionReviewModel, type Completion } from "../../src/permission/review/model"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { SessionID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

const auditDir = path.join(Global.Path.data, "audit")

let script: () => Effect.Effect<Completion, ModelError>
let calls: number
let userMessages: string[]

const fakeModel = Layer.succeed(
  PermissionReviewModel.Service,
  PermissionReviewModel.Service.of({
    complete: () => {
      calls++
      return script()
    },
  }),
)
const fakeConversation = Layer.succeed(
  PermissionReviewConversation.Service,
  PermissionReviewConversation.Service.of({ userMessages: () => Effect.succeed(userMessages), recent: () => Effect.succeed([]) }),
)
const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))

const environment = (approvalMode?: RuntimeFlags.Info["approvalMode"]) =>
  AppNodeBuilder.build(
    LayerNode.group([Permission.node, EventV2Bridge.node, CrossSpawnSpawner.node, InstanceStore.node]),
    [
      [InstanceStore.bootstrapNode, noopBootstrap],
      [PermissionReviewModel.node, fakeModel],
      [PermissionReviewConversation.node, fakeConversation],
      [RuntimeFlags.node, RuntimeFlags.layer({ approvalMode })],
    ],
  )

const it = testEffect(environment(undefined))
const itUnguarded = testEffect(environment("unguarded"))

const answer = (fields: Record<string, unknown>): Effect.Effect<Completion, ModelError> =>
  Effect.succeed({
    model: "openai/test-model",
    text: JSON.stringify({ version: 1, reason: "fine", basis: "none", quote: null, ...fields }),
  })

const session = SessionID.make("ses_review")

const ask = (command: string, ruleset: PermissionV1.Ruleset = [], permission = "bash") =>
  Effect.gen(function* () {
    const service = yield* Permission.Service
    return yield* service.ask({
      sessionID: session,
      permission,
      patterns: [command],
      metadata: { command },
      always: [command],
      ruleset,
    })
  })

const pending = Effect.gen(function* () {
  const service = yield* Permission.Service
  return yield* service.list()
})

const waitForPending = Effect.gen(function* () {
  while (true) {
    const list = yield* pending
    if (list.length > 0) return list
    yield* Effect.sleep("10 millis")
  }
}).pipe(Effect.timeout("2 seconds"))

const answerPending = (reply: "once" | "always" | "reject") =>
  Effect.gen(function* () {
    const service = yield* Permission.Service
    const [request] = yield* waitForPending
    yield* service.reply({ requestID: request.id, reply })
    return request
  })

const failure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect)
    if (Exit.isFailure(exit)) return Cause.squash(exit.cause)
    throw new Error("expected the effect to fail")
  })

const records = async () => {
  const files = await readdir(auditDir).catch(() => [])
  return (await Promise.all(files.map((file) => readFile(path.join(auditDir, file), "utf8")))).flatMap((text) => parseRecords(text))
}

beforeEach(async () => {
  calls = 0
  userMessages = ["Please run the unit tests and fix the failing one."]
  script = () => answer({ decision: "ask_user" })
  await rm(auditDir, { recursive: true, force: true })
})
afterEach(async () => {
  await rm(auditDir, { recursive: true, force: true })
})

const auto = { config: { approval: { mode: "auto" as const } } }
const observe = { config: { approval: { mode: "observe" as const } } }

describe("manual mode is unchanged", () => {
  it.instance("a request that needs an answer waits for the user and carries no review", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkScoped(ask("npm test"))
      const [request] = yield* waitForPending
      expect(request.metadata.review).toBeUndefined()
      const service = yield* Permission.Service
      yield* service.reply({ requestID: request.id, reply: "once" })
      yield* Fiber.await(fiber)
      expect(calls).toBe(0)
    }),
  )
})

describe("auto mode", () => {
  it.instance(
    "approves a plain read-only command without waiting and without the model",
    () =>
      Effect.gen(function* () {
        yield* ask("git status")
        expect((yield* pending).length).toBe(0)
        expect(calls).toBe(0)
      }),
    auto,
  )

  it.instance(
    "approves what the reviewer approves with a real quote",
    () =>
      Effect.gen(function* () {
        script = () => answer({ decision: "allow_once", basis: "user_request", quote: "run the unit tests" })
        yield* ask("npm test")
        expect((yield* pending).length).toBe(0)
        expect(calls).toBe(1)
      }),
    auto,
  )

  it.instance(
    "waits for the user when the reviewer is not sure, and tells the client why",
    () =>
      Effect.gen(function* () {
        script = () => answer({ decision: "ask_user", reason: "this goes beyond what was asked" })
        const fiber = yield* Effect.forkScoped(ask("npm test"))
        const request = yield* answerPending("once")
        expect(request.metadata.review).toMatchObject({
          mode: "auto",
          action: "ask_user",
          source: "reviewer",
          reason: "this goes beyond what was asked",
        })
        expect(Exit.isSuccess(yield* Fiber.await(fiber))).toBe(true)
      }),
    auto,
  )

  it.instance(
    "refuses, with the reason, what the reviewer denies, so the agent can try something else",
    () =>
      Effect.gen(function* () {
        script = () => answer({ decision: "deny", reason: "the user said not to touch the tests" })
        const error = yield* failure(ask("npm test"))
        expect(error).toBeInstanceOf(PermissionV1.ReviewDeniedError)
        expect((error as PermissionV1.ReviewDeniedError).message).toContain("the user said not to touch the tests")
        expect((yield* pending).length).toBe(0)
      }),
    auto,
  )

  it.instance(
    "sends high-impact actions to the user without asking the model",
    () =>
      Effect.gen(function* () {
        script = () => answer({ decision: "allow_once", basis: "user_request", quote: "run the unit tests" })
        const fiber = yield* Effect.forkScoped(ask("git push origin main"))
        const request = yield* answerPending("reject")
        expect(request.metadata.review).toMatchObject({ action: "ask_user", source: "rule" })
        expect(calls).toBe(0)
        expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true)
      }),
    auto,
  )

  it.instance(
    "falls back to the user when the reviewer fails",
    () =>
      Effect.gen(function* () {
        script = () => Effect.fail(new ModelError({ message: "connection refused" }))
        const fiber = yield* Effect.forkScoped(ask("npm test"))
        const request = yield* answerPending("once")
        expect(request.metadata.review).toMatchObject({ action: "ask_user", source: "failure" })
        expect(Exit.isSuccess(yield* Fiber.await(fiber))).toBe(true)
      }),
    auto,
  )

  it.instance(
    "a deny rule wins and the reviewer is never consulted",
    () =>
      Effect.gen(function* () {
        script = () => answer({ decision: "allow_once", basis: "user_request", quote: "run the unit tests" })
        const error = yield* failure(ask("npm test", [{ permission: "bash", pattern: "npm *", action: "deny" }]))
        expect(error).toBeInstanceOf(PermissionV1.DeniedError)
        expect(calls).toBe(0)
      }),
    auto,
  )

  it.instance(
    "an allow rule runs without the reviewer",
    () =>
      Effect.gen(function* () {
        yield* ask("npm test", [{ permission: "bash", pattern: "npm *", action: "allow" }])
        expect(calls).toBe(0)
      }),
    auto,
  )

  it.instance(
    "the reviewer's approval is for one call only: the next call is reviewed again",
    () =>
      Effect.gen(function* () {
        script = () => answer({ decision: "allow_once", basis: "user_request", quote: "run the unit tests" })
        yield* ask("npm test")
        yield* ask("npm test")
        expect(calls).toBe(2)
      }),
    auto,
  )

  it.instance(
    "an answer of always from the user still works as before",
    () =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(ask("git push origin main"))
        yield* answerPending("always")
        yield* Fiber.await(fiber)
        const before = calls
        yield* ask("git push origin main")
        expect(calls).toBe(before)
      }),
    auto,
  )

  it.instance(
    "records the decision and the user's answer in the audit log",
    () =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(ask("git push origin main"))
        yield* answerPending("reject")
        yield* Fiber.await(fiber)
        const written = yield* Effect.promise(records)
        expect(written.map((record) => [record.type, record.source ?? record.human])).toEqual([
          ["decision", "rule"],
          ["human", "human"],
        ])
      }),
    auto,
  )

  it.instance(
    "sessions started by a subagent are reviewed the same way",
    () =>
      Effect.gen(function* () {
        const service = yield* Permission.Service
        script = () => answer({ decision: "deny", reason: "outside the request" })
        const error = yield* failure(
          service.ask({
            sessionID: SessionID.make("ses_child"),
            permission: "bash",
            patterns: ["npm test"],
            metadata: { command: "npm test" },
            always: [],
            ruleset: [],
          }),
        )
        expect(error).toBeInstanceOf(PermissionV1.ReviewDeniedError)
      }),
    auto,
  )
})

describe("observe mode measures without deciding", () => {
  it.instance(
    "the user is still asked, the reviewer's opinion is attached, and the answer is recorded next to it",
    () =>
      Effect.gen(function* () {
        script = () => answer({ decision: "allow_once", basis: "user_request", quote: "run the unit tests", reason: "asked for tests" })
        const fiber = yield* Effect.forkScoped(ask("npm test"))
        const request = yield* answerPending("reject")
        expect(request.metadata.review).toMatchObject({ mode: "observe", action: "allow_once", source: "reviewer" })
        expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true)
        const written = yield* Effect.promise(records)
        expect(written.map((record) => [record.type, record.decision ?? record.human])).toEqual([
          ["decision", "allow_once"],
          ["human", "reject"],
        ])
      }),
    observe,
  )

  it.instance(
    "even a routine command waits for the user",
    () =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(ask("git status"))
        yield* answerPending("once")
        expect(Exit.isSuccess(yield* Fiber.await(fiber))).toBe(true)
      }),
    observe,
  )
})

describe("unguarded mode", () => {
  itUnguarded.instance("approves everything that would have been asked, and records it", () =>
    Effect.gen(function* () {
      yield* ask("git push --force origin main")
      expect((yield* pending).length).toBe(0)
      expect(calls).toBe(0)
      const written = yield* Effect.promise(records)
      expect(written[0]).toMatchObject({ mode: "unguarded", source: "unguarded", decision: "allow_once" })
    }),
  )

  itUnguarded.instance("still respects a deny rule", () =>
    Effect.gen(function* () {
      const error = yield* failure(ask("rm -rf /", [{ permission: "bash", pattern: "rm *", action: "deny" }]))
      expect(error).toBeInstanceOf(PermissionV1.DeniedError)
    }),
  )
})
