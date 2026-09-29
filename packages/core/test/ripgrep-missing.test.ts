import { describe, expect } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { LayerNode } from "@crewcode/core/effect/layer-node"
import { Ripgrep } from "@crewcode/core/ripgrep"
import { RipgrepBinary } from "@crewcode/core/ripgrep/binary"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(Ripgrep.node))

describe("Ripgrep without rg installed", () => {
  it.live("fails with an install hint instead of downloading", () =>
    Effect.gen(function* () {
      const emptyPath = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "rg-missing-")))
      const original = process.env.PATH
      process.env.PATH = emptyPath
      const error = yield* Effect.flip((yield* Ripgrep.Service).find({ cwd: emptyPath, pattern: "*", limit: 1 })).pipe(
        Effect.ensuring(
          Effect.promise(async () => {
            process.env.PATH = original
            await fs.rm(emptyPath, { recursive: true, force: true })
          }),
        ),
      )
      expect(error).toBeInstanceOf(Ripgrep.Error)
      expect(error.message).toBe(RipgrepBinary.INSTALL_HINT)
      expect(error.message).toContain("apt install ripgrep / brew install ripgrep")
    }),
  )
})
