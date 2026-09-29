import { afterEach, expect } from "bun:test"
import { mkdir, rm, writeFile } from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { LayerNode } from "@crewcode/core/effect/layer-node"
import { Global } from "@crewcode/core/global"
import { ModelV2 } from "@crewcode/core/model"
import { ProviderAllowlist } from "@crewcode/core/provider-allowlist"
import { ProviderV2 } from "@crewcode/core/provider"
import { Auth } from "@/auth"
import { Env } from "../../src/env"
import { Plugin } from "../../src/plugin/index"
import { Provider } from "@/provider/provider"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Provider.node, Auth.node, Env.node, Plugin.node])))

const authFile = path.join(Global.Path.data, "auth.json")
const touched = new Map<string, string | undefined>()

const setProcessEnv = (key: string, value: string) =>
  Effect.sync(() => {
    if (!touched.has(key)) touched.set(key, process.env[key])
    process.env[key] = value
  })

const clearProviderEnv = Effect.sync(() => {
  for (const key of ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CREWCODE_API_KEY"]) {
    if (!touched.has(key)) touched.set(key, process.env[key])
    delete process.env[key]
  }
})

afterEach(async () => {
  for (const [key, value] of touched) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  touched.clear()
  await rm(authFile, { force: true })
  await disposeAllInstances()
})

const writeAuthFile = (data: unknown) =>
  Effect.promise(async () => {
    await mkdir(path.dirname(authFile), { recursive: true })
    await writeFile(authFile, JSON.stringify(data))
  })

const oauth = { type: "oauth", refresh: "r", access: "a", expires: 4_102_444_800_000 } as const
const outsideAllowlist = (ids: string[]) => ids.filter((id) => !ProviderAllowlist.isAllowed(id))

it.instance("only allowed providers are enabled by their environment variables", () =>
  Effect.gen(function* () {
    yield* clearProviderEnv
    yield* setProcessEnv("ANTHROPIC_API_KEY", "key")
    yield* setProcessEnv("CREWCODE_API_KEY", "key")
    yield* setProcessEnv("OPENROUTER_API_KEY", "key")
    yield* setProcessEnv("OPENAI_API_KEY", "key")
    const ids = Object.keys(yield* Provider.use.list())
    expect(outsideAllowlist(ids)).toEqual([])
    expect(ids).toContain("openrouter")
    expect(ids).toContain("openai")
  }),
)

it.instance(
  "a provider outside the allowlist cannot be introduced through config",
  () =>
    Effect.gen(function* () {
      yield* clearProviderEnv
      const ids = Object.keys(yield* Provider.use.list())
      expect(outsideAllowlist(ids)).toEqual([])
    }),
  {
    config: {
      provider: {
        anthropic: { options: { apiKey: "config-key" } },
        "custom-provider": {
          name: "Custom",
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.custom.test/v1",
          options: { apiKey: "config-key" },
          models: { "custom-model": { name: "Custom" } },
        },
      },
    },
  },
)

it.instance(
  "enabled_providers cannot re-enable a provider outside the allowlist",
  () =>
    Effect.gen(function* () {
      yield* clearProviderEnv
      yield* setProcessEnv("ANTHROPIC_API_KEY", "key")
      expect(yield* Provider.use.list()).toEqual({})
    }),
  { config: { enabled_providers: ["anthropic"] } },
)

it.instance(
  "allowed providers can still be customized through config",
  () =>
    Effect.gen(function* () {
      yield* clearProviderEnv
      const providers = yield* Provider.use.list()
      expect(providers[ProviderV2.ID.openrouter].options.baseURL).toBe("http://127.0.0.1:9/v1")
      expect(providers[ProviderV2.ID.openrouter].source).toBe("config")
    }),
  { config: { provider: { openrouter: { options: { apiKey: "key", baseURL: "http://127.0.0.1:9/v1" } } } } },
)

it.instance("selecting a model of an unsupported provider explains what is supported", () =>
  Effect.gen(function* () {
    const error = yield* Provider.use
      .getModel(ProviderV2.ID.make("anthropic"), ModelV2.ID.make("claude-sonnet-4-6"))
      .pipe(Effect.flip)
    expect(error.message).toContain('Provider "anthropic" is not supported in CrewCode v0')
    expect(error.message).toContain("openrouter, openai, openai-codex")
  }),
)

it.instance("a supported provider that is not connected keeps the regular not-found message", () =>
  Effect.gen(function* () {
    yield* clearProviderEnv
    const error = yield* Provider.use
      .getModel(ProviderV2.ID.openrouter, ModelV2.ID.make("acme/does-not-exist"))
      .pipe(Effect.flip)
    expect(error.message).toContain("Model not found: openrouter/acme/does-not-exist")
    expect(error.message).not.toContain("not supported")
  }),
)

it.instance("credentials cannot be stored for a provider outside the allowlist", () =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const error = yield* auth.set("anthropic", { type: "api", key: "key" }).pipe(Effect.flip)
    expect(error.message).toContain('Provider "anthropic" is not supported in CrewCode v0')
    expect(yield* auth.all()).toEqual({})
  }),
)

it.instance("stored credentials of an unsupported provider are ignored and left on disk untouched", () =>
  Effect.gen(function* () {
    yield* clearProviderEnv
    yield* writeAuthFile({ anthropic: { type: "api", key: "old-key" }, openrouter: { type: "api", key: "or-key" } })
    const auth = yield* Auth.Service
    expect(Object.keys(yield* auth.all())).toEqual(["openrouter"])
    expect(Object.keys(yield* Provider.use.list())).toEqual(["openrouter"])
    const onDisk = yield* Effect.promise(() => Bun.file(authFile).json())
    expect(onDisk.anthropic).toEqual({ type: "api", key: "old-key" })
  }),
)

it.instance("an OAuth credential saved under openai by a previous setup moves to the Codex flow", () =>
  Effect.gen(function* () {
    yield* clearProviderEnv
    yield* writeAuthFile({ openai: oauth })
    const auth = yield* Auth.Service
    const all = yield* auth.all()
    expect(all["openai-codex"]).toMatchObject({ type: "oauth", refresh: "r" })
    expect(all["openai"]).toBeUndefined()
  }),
)

it.instance("an API key saved under openai stays in the OpenAI API flow and never enables Codex", () =>
  Effect.gen(function* () {
    yield* clearProviderEnv
    yield* writeAuthFile({ openai: { type: "api", key: "sk-test" } })
    const auth = yield* Auth.Service
    const all = yield* auth.all()
    expect(all["openai"]).toMatchObject({ type: "api", key: "sk-test" })
    expect(all["openai-codex"]).toBeUndefined()
    const ids = Object.keys(yield* Provider.use.list())
    expect(ids).toContain("openai")
    expect(ids).not.toContain("openai-codex")
  }),
)

it.instance("an OpenAI API key in the environment does not connect the Codex flow", () =>
  Effect.gen(function* () {
    yield* clearProviderEnv
    yield* setProcessEnv("OPENAI_API_KEY", "sk-test")
    const ids = Object.keys(yield* Provider.use.list())
    expect(ids).toContain("openai")
    expect(ids).not.toContain("openai-codex")
  }),
)

it.instance("a Codex OAuth credential connects openai-codex and not openai", () =>
  Effect.gen(function* () {
    yield* clearProviderEnv
    yield* writeAuthFile({ "openai-codex": oauth })
    const ids = Object.keys(yield* Provider.use.list())
    expect(ids).toContain("openai-codex")
    expect(ids).not.toContain("openai")
  }),
)
