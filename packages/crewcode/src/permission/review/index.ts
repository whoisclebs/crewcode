// Decides what happens to a permission request that a rule marked as `ask`.
//
//   1. deterministic policy: high impact goes to a human, plain read-only commands are approved
//   2. everything else goes to the reviewer model, whose answer is checked before it is believed
//   3. any failure, timeout or unexpected answer becomes a question for the user, never an approval
//
// `deny` rules are settled before this service is called and can never be overridden here. This service only ever
// produces an approval for one call (`allow_once`); it never writes an "always" rule.

import os from "os"
import path from "path"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@crewcode/core/effect/layer-node"
import { serviceUse } from "@crewcode/core/effect/service-use"
import { Global } from "@crewcode/core/global"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import * as Audit from "./audit"
import { PermissionReviewConversation } from "./conversation"
import { ModelError, PermissionReviewModel } from "./model"
import { classify } from "./policy"
import { buildPrompt, interpret, type Decision } from "./reviewer"
import { redact, truncate } from "./redact"

export type Mode = Audit.Mode
export type { Decision } from "./reviewer"

export interface DecideInput {
  readonly id: string
  readonly sessionID: string
  readonly permission: string
  readonly patterns: readonly string[]
  readonly metadata: Record<string, unknown>
  readonly cwd: string
}

export interface Interface {
  /** How requests are answered right now: the command line flag, then the config, then manual. */
  readonly mode: () => Effect.Effect<Mode>
  /** Never fails. A problem in here is reported as a decision that asks the user. */
  readonly decide: (input: DecideInput) => Effect.Effect<Decision>
  /** Records that everything was approved without review. */
  readonly unguarded: (input: DecideInput) => Effect.Effect<void>
  /** Records the user's answer to a question and lets the reviewer resume after a pause. */
  readonly answered: (input: {
    sessionID: string
    requestID: string
    reply: "once" | "always" | "reject"
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@crewcode/PermissionReview") {}
export const use = serviceUse(Service)

const DEFAULT_TIMEOUT_MS = 15_000
const PAUSE_AFTER_FAILURES = 3
const MAX_ERROR = 120

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const flags = yield* RuntimeFlags.Service
    const model = yield* PermissionReviewModel.Service
    const conversation = yield* PermissionReviewConversation.Service
    const auditDir = path.join(Global.Path.data, "audit")
    const home = os.homedir()
    const failures = new Map<string, number>()

    const mode = Effect.fn("PermissionReview.mode")(function* () {
      if (flags.approvalMode) return flags.approvalMode
      return (yield* config.get()).approval?.mode ?? "manual"
    })

    const record = (entry: Audit.AuditRecord) =>
      Effect.tryPromise(() => Audit.write(auditDir, entry)).pipe(
        Effect.flatMap((written) => (written ? Effect.void : Effect.logWarning("could not write the permission audit log"))),
        Effect.catchCause(() => Effect.void),
      )

    const finish = Effect.fnUntraced(function* (
      input: DecideInput,
      decision: Decision,
      started: number,
      reviewerModel?: string,
    ) {
      yield* record(
        Audit.decisionRecord({
          mode: yield* mode(),
          session: input.sessionID,
          request: input.id,
          permission: input.permission,
          patterns: input.patterns,
          metadata: input.metadata,
          decision: decision.action,
          reason: decision.reason,
          source: decision.source,
          durationMs: Date.now() - started,
          reviewerModel,
          categories: decision.categories,
        }),
      )
      return decision
    })

    const review = Effect.fnUntraced(function* (input: DecideInput, started: number) {
      if ((failures.get(input.sessionID) ?? 0) >= PAUSE_AFTER_FAILURES) {
        return yield* finish(
          input,
          {
            action: "ask_user",
            reason: "the reviewer is paused after repeated failures; answer this request to resume it",
            source: "failure",
          },
          started,
        )
      }

      const userMessages = yield* conversation.userMessages(input.sessionID)
      if (userMessages.length === 0) {
        return yield* finish(
          input,
          { action: "ask_user", reason: "there is no user request to compare this action with", source: "failure" },
          started,
        )
      }

      const cfg = yield* config.get()
      const timeout = cfg.approval?.reviewer?.timeout ?? DEFAULT_TIMEOUT_MS
      const prompt = buildPrompt({
        permission: input.permission,
        patterns: input.patterns,
        metadata: input.metadata,
        cwd: input.cwd,
        userMessages,
        recent: yield* conversation.recent(input.sessionID),
      })

      const outcome = yield* model.complete(prompt).pipe(
        Effect.timeoutOption(timeout),
        Effect.map((result) => ({ tag: "answer" as const, result })),
        Effect.catchTag("PermissionReview.ModelError", (error: ModelError) => Effect.succeed({ tag: "error" as const, error })),
        Effect.catchCause(() => Effect.succeed({ tag: "error" as const, error: new ModelError({ message: "unexpected error" }) })),
      )

      if (outcome.tag === "error") {
        failures.set(input.sessionID, (failures.get(input.sessionID) ?? 0) + 1)
        return yield* finish(
          input,
          {
            action: "ask_user",
            reason: `the reviewer could not answer: ${truncate(redact(outcome.error.message), MAX_ERROR)}`,
            source: "failure",
          },
          started,
        )
      }
      if (outcome.result._tag === "None") {
        failures.set(input.sessionID, (failures.get(input.sessionID) ?? 0) + 1)
        return yield* finish(
          input,
          { action: "ask_user", reason: `the reviewer took too long (over ${timeout} ms)`, source: "failure" },
          started,
        )
      }

      const completion = outcome.result.value
      const decision = interpret(completion.text, userMessages)
      failures.set(input.sessionID, decision.source === "failure" ? (failures.get(input.sessionID) ?? 0) + 1 : 0)
      return yield* finish(input, decision, started, completion.model)
    })

    const decide = Effect.fn("PermissionReview.decide")(function* (input: DecideInput) {
      const started = Date.now()
      const verdict = classify({
        permission: input.permission,
        patterns: input.patterns,
        metadata: input.metadata,
        cwd: input.cwd,
        home,
      })
      if (verdict.kind === "high_impact") {
        return yield* finish(
          input,
          { action: "ask_user", reason: verdict.reason, source: "rule", categories: verdict.categories },
          started,
        )
      }
      if (verdict.kind === "routine") {
        return yield* finish(input, { action: "allow_once", reason: verdict.reason, source: "rule" }, started)
      }
      return yield* review(input, started)
    })

    const safeDecide = (input: DecideInput) =>
      decide(input).pipe(
        Effect.catchCause(() =>
          Effect.succeed<Decision>({ action: "ask_user", reason: "the reviewer failed unexpectedly", source: "failure" }),
        ),
      )

    const unguarded = Effect.fn("PermissionReview.unguarded")(function* (input: DecideInput) {
      yield* record(
        Audit.decisionRecord({
          mode: "unguarded",
          session: input.sessionID,
          request: input.id,
          permission: input.permission,
          patterns: input.patterns,
          metadata: input.metadata,
          decision: "allow_once",
          reason: "approved without review (--unguarded)",
          source: "unguarded",
          durationMs: 0,
        }),
      )
    })

    const answered = Effect.fn("PermissionReview.answered")(function* (input: {
      sessionID: string
      requestID: string
      reply: "once" | "always" | "reject"
    }) {
      failures.delete(input.sessionID)
      yield* record(
        Audit.humanRecord({
          mode: yield* mode(),
          session: input.sessionID,
          request: input.requestID,
          reply: input.reply,
        }),
      )
    })

    return Service.of({ mode, decide: safeDecide, unguarded, answered })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node, RuntimeFlags.node, PermissionReviewModel.node, PermissionReviewConversation.node],
})

export * as PermissionReview from "."
