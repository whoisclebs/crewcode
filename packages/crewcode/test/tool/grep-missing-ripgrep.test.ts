import { describe, expect } from "bun:test"
import os from "os"
import path from "path"
import fs from "fs/promises"
import { LayerNode } from "@crewcode/core/effect/layer-node"
import { CrossSpawnSpawner } from "@crewcode/core/cross-spawn-spawner"
import { FSUtil } from "@crewcode/core/fs-util"
import { Ripgrep } from "@crewcode/core/ripgrep"
import { RipgrepBinary } from "@crewcode/core/ripgrep/binary"
import { Cause, Effect, Exit } from "effect"
import { Agent } from "../../src/agent/agent"
import { MessageID, SessionID } from "../../src/session/schema"
import { GrepTool } from "../../src/tool/grep"
import { Truncate } from "@/tool/truncate"
import { Git } from "@/git"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([CrossSpawnSpawner.node, FSUtil.node, Ripgrep.node, Truncate.node, Agent.node, Git.node]),
  ),
)

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("tool.grep without ripgrep installed", () => {
  it.instance("surfaces the install hint to the model instead of downloading", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const emptyPath = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "rg-missing-")))
      const original = process.env.PATH
      process.env.PATH = emptyPath
      const grep = yield* (yield* GrepTool).init()
      const exit = yield* grep.execute({ pattern: "needle", path: test.directory }, ctx).pipe(
        Effect.exit,
        Effect.ensuring(
          Effect.promise(async () => {
            process.env.PATH = original
            await fs.rm(emptyPath, { recursive: true, force: true })
          }),
        ),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(String(Cause.squash(exit.cause))).toContain(RipgrepBinary.INSTALL_HINT)
      }
    }),
  )
})
