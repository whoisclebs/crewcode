import { describe, expect, beforeAll, afterAll } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@crewcode/core/effect/app-node-builder"
import { Flag } from "@crewcode/core/flag/flag"
import { ModelsDev } from "@crewcode/core/models-dev"
import { it } from "./lib/effect"
import { mkdtemp, rm, writeFile } from "fs/promises"
import os from "os"
import path from "path"

// test/preload.ts pins CREWCODE_MODELS_PATH to a fixture so other tests can resolve providers offline.
// These tests drive the catalog source themselves, so save and restore around the suite.
const ORIGINAL_MODELS_PATH = Flag.CREWCODE_MODELS_PATH
afterAll(() => {
  Flag.CREWCODE_MODELS_PATH = ORIGINAL_MODELS_PATH
})

const model = (id: string, name: string): ModelsDev.Model => ({
  id,
  name,
  release_date: "2026-01-01",
  attachment: false,
  reasoning: false,
  temperature: true,
  tool_call: true,
  limit: { context: 128000, output: 8192 },
})

const provider = (id: string, env: string[]): ModelsDev.Provider => ({
  id,
  name: id,
  env,
  models: { [`${id}-1`]: model(`${id}-1`, `${id} one`) },
})

const catalogFile = async (data: Record<string, ModelsDev.Provider>) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "crewcode-models-"))
  const file = path.join(dir, "models.json")
  await writeFile(file, JSON.stringify(data))
  return { dir, file }
}

// Layer.fresh is required because the ModelsDev implementation is a module-level Layer constant and Effect.provide
// uses a process-global MemoMap by default; without fresh every test would reuse the cached catalog of the first run.
const get = () => ModelsDev.Service.use((service) => service.get()).pipe(Effect.provide(Layer.fresh(AppNodeBuilder.build(ModelsDev.node))))

describe("ModelsDev Service", () => {
  it.live("get() reads the local catalog file", () =>
    Effect.gen(function* () {
      const { dir, file } = yield* Effect.promise(() =>
        catalogFile({
          openrouter: provider("openrouter", ["OPENROUTER_API_KEY"]),
          openai: provider("openai", ["OPENAI_API_KEY"]),
          anthropic: provider("anthropic", ["ANTHROPIC_API_KEY"]),
          crewcode: provider("crewcode", ["CREWCODE_API_KEY"]),
        }),
      )
      Flag.CREWCODE_MODELS_PATH = file
      const result = yield* get().pipe(Effect.ensuring(Effect.promise(() => rm(dir, { recursive: true, force: true }))))
      expect(Object.keys(result).sort()).toEqual(["anthropic", "crewcode", "openai", "openrouter"])
      expect(result.openai.models["openai-1"].name).toBe("openai one")
    }),
  )

  it.live("get() falls back to the bundled snapshot", () =>
    Effect.gen(function* () {
      Flag.CREWCODE_MODELS_PATH = undefined
      const result = yield* get()
      for (const id of ["openrouter", "openai", "openai-codex"]) {
        expect(Object.keys(result[id].models).length).toBeGreaterThan(0)
      }
    }),
  )

  it.live("bundled snapshot models the OAuth Codex flow separately from the API key flow", () =>
    Effect.gen(function* () {
      Flag.CREWCODE_MODELS_PATH = undefined
      const result = yield* get()
      expect(result["openai"].env).toEqual(["OPENAI_API_KEY"])
      expect(result["openai-codex"].env).toEqual([])
      expect(result["openai-codex"].id).toBe("openai-codex")
    }),
  )

  it.live("get() is single-flight and cached under concurrent calls", () =>
    Effect.gen(function* () {
      Flag.CREWCODE_MODELS_PATH = undefined
      const results = yield* Effect.gen(function* () {
        const service = yield* ModelsDev.Service
        return yield* Effect.all([service.get(), service.get(), service.get()], { concurrency: "unbounded" })
      }).pipe(Effect.provide(Layer.fresh(AppNodeBuilder.build(ModelsDev.node))))
      expect(results[1]).toBe(results[0])
      expect(results[2]).toBe(results[0])
    }),
  )

  it.live("get() returns an empty catalog when the local file is missing or invalid, without touching the network", () =>
    Effect.gen(function* () {
      const { dir, file } = yield* Effect.promise(() => catalogFile({}))
      yield* Effect.promise(() => writeFile(file, "{"))
      Flag.CREWCODE_MODELS_PATH = file
      const result = yield* get().pipe(Effect.ensuring(Effect.promise(() => rm(dir, { recursive: true, force: true }))))
      expect(result).toEqual({})
    }),
  )
})
