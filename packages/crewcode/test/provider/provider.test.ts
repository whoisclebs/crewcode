import { afterEach, expect, test } from "bun:test"
import { mkdir } from "fs/promises"
import path from "path"
import { LayerNode } from "@crewcode/core/effect/layer-node"
import { AppNodeBuilder } from "@crewcode/core/effect/app-node-builder"
import { Effect, Layer } from "effect"
import { ModelsDev } from "@crewcode/core/models-dev"
import { FSUtil } from "@crewcode/core/fs-util"
import { CrossSpawnSpawner } from "@crewcode/core/cross-spawn-spawner"
import { Global } from "@crewcode/core/global"
import { disposeAllInstances, provideInstanceEffect, tmpdirScoped, TestInstance } from "../fixture/fixture"
import { markPluginDependenciesReady } from "../fixture/plugin"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { Env } from "../../src/env"
import { Plugin } from "../../src/plugin/index"
import { Provider } from "@/provider/provider"

import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceStore } from "@/project/instance-store"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@crewcode/core/provider"
import { ModelV2 } from "@crewcode/core/model"

const originalEnv = new Map<string, string | undefined>()

const rememberEnv = (k: string) => {
  if (!originalEnv.has(k)) originalEnv.set(k, process.env[k])
}

const setProcessEnv = (k: string, v: string) =>
  Effect.sync(() => {
    rememberEnv(k)
    process.env[k] = v
  })

const set = (k: string, v: string) =>
  Effect.gen(function* () {
    rememberEnv(k)
    process.env[k] = v
    yield* Env.use.set(k, v)
  })

const remove = (k: string) =>
  Effect.gen(function* () {
    rememberEnv(k)
    delete process.env[k]
    yield* Env.use.remove(k)
  })

afterEach(async () => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  originalEnv.clear()
  await disposeAllInstances()
})

const providerLayer = (flags: Partial<RuntimeFlags.Info> = {}) =>
  LayerNode.compile(
    LayerNode.group([
      Provider.node,
      FSUtil.node,
      Env.node,
      Config.node,
      Auth.node,
      Plugin.node,
      ModelsDev.node,
      RuntimeFlags.node,
    ]),
    [[RuntimeFlags.node, RuntimeFlags.layer(flags)]],
  )

const list = Provider.use.list()

const it = testEffect(LayerNode.compile(LayerNode.group([Provider.node, Env.node, Plugin.node])))
const experimentalModels = testEffect(providerLayer({ enableExperimentalModels: true }))

const alphaProviderConfig = {
  provider: {
    openrouter: {
      models: {
        "active-model": {
          name: "Active Model",
        },
        "alpha-model": {
          name: "Alpha Model",
          status: "alpha" as const,
        },
      },
      options: {
        apiKey: "custom-key",
      },
    },
  },
}

it.instance("provider loaded from env variable", () =>
  Effect.gen(function* () {
    yield* setProcessEnv("OPENROUTER_API_KEY", "test-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter]).toBeDefined()
    // Provider should retain its connection source even if custom loaders
    // merge additional options.
    expect(providers[ProviderV2.ID.openrouter].source).toBe("env")
    expect(providers[ProviderV2.ID.openrouter].options.headers["X-Title"]).toBeDefined()
  }),
)

it.instance(
  "provider loaded from config with apiKey option",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter]).toBeDefined()
  }),
  { config: { provider: { openrouter: { options: { apiKey: "config-api-key" } } } } },
)

it.instance(
  "disabled_providers excludes provider",
  Effect.gen(function* () {
    yield* setProcessEnv("OPENROUTER_API_KEY", "test-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter]).toBeUndefined()
  }),
  { config: { disabled_providers: ["openrouter"] } },
)

it.instance(
  "enabled_providers restricts to only listed providers",
  Effect.gen(function* () {
    yield* setProcessEnv("OPENROUTER_API_KEY", "test-api-key")
    yield* setProcessEnv("OPENAI_API_KEY", "test-openai-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter]).toBeDefined()
    expect(providers[ProviderV2.ID.openai]).toBeUndefined()
  }),
  { config: { enabled_providers: ["openrouter"] } },
)

it.instance(
  "model whitelist filters models for provider",
  Effect.gen(function* () {
    yield* setProcessEnv("OPENROUTER_API_KEY", "test-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter]).toBeDefined()
    const models = Object.keys(providers[ProviderV2.ID.openrouter].models)
    expect(models).toContain("anthropic/claude-sonnet-4.6")
    expect(models.length).toBe(1)
  }),
  { config: { provider: { openrouter: { whitelist: ["anthropic/claude-sonnet-4.6"] } } } },
)

it.instance(
  "model blacklist excludes specific models",
  Effect.gen(function* () {
    yield* setProcessEnv("OPENROUTER_API_KEY", "test-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter]).toBeDefined()
    const models = Object.keys(providers[ProviderV2.ID.openrouter].models)
    expect(models).not.toContain("anthropic/claude-sonnet-4")
  }),
  { config: { provider: { openrouter: { blacklist: ["anthropic/claude-sonnet-4"] } } } },
)

it.instance(
  "custom model alias via config",
  Effect.gen(function* () {
    yield* setProcessEnv("OPENROUTER_API_KEY", "test-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter]).toBeDefined()
    expect(providers[ProviderV2.ID.openrouter].models["my-alias"]).toBeDefined()
    expect(providers[ProviderV2.ID.openrouter].models["my-alias"].name).toBe("My Custom Alias")
  }),
  {
    config: {
      provider: {
        openrouter: { models: { "my-alias": { id: "anthropic/claude-sonnet-4", name: "My Custom Alias" } } },
      },
    },
  },
)

it.instance(
  "custom model with provider name override",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter]).toBeDefined()
    expect(providers[ProviderV2.ID.openrouter].name).toBe("Custom Provider")
    expect(providers[ProviderV2.ID.openrouter].models["custom-model"]).toBeDefined()
  }),
  {
    config: {
      provider: {
        openrouter: {
          name: "Custom Provider",
          models: {
            "custom-model": {
              name: "Custom Model",
              tool_call: true,
              limit: { context: 128000, output: 4096 },
            },
          },
          options: { apiKey: "custom-key" },
        },
      },
    },
  },
)

it.instance(
  "custom DeepSeek openai-compatible model defaults interleaved reasoning field",
  Effect.gen(function* () {
    const providers = yield* list
    const provider = providers[ProviderV2.ID.openrouter]
    expect(provider.models["deepseek-r1"].capabilities.interleaved).toEqual({ field: "reasoning_content" })
    expect(provider.models["deepseek-details"].capabilities.interleaved).toEqual({ field: "reasoning_details" })
    expect(provider.models["deepseek-text"].capabilities.interleaved).toEqual({ field: "reasoning_text" })
    expect(provider.models["custom-reasoning"].capabilities.interleaved).toEqual({ field: "vendor_reasoning" })
    expect(provider.models["custom-model"].capabilities.interleaved).toBe(false)
    // Its SDK (@ai-sdk/anthropic) is not bundled, so the model is not offered at all.
    expect(provider.models["deepseek-anthropic"]).toBeUndefined()
  }),
  {
    config: {
      provider: {
        openrouter: {
          models: {
            "deepseek-r1": {
              name: "DeepSeek R1",
              provider: { npm: "@ai-sdk/openai-compatible", api: "https://api.custom.com/v1" },
            },
            "deepseek-details": {
              name: "DeepSeek Details",
              interleaved: { field: "reasoning_details" },
              provider: { npm: "@ai-sdk/openai-compatible", api: "https://api.custom.com/v1" },
            },
            "deepseek-text": {
              name: "DeepSeek Text",
              interleaved: "reasoning_text",
              provider: { npm: "@ai-sdk/openai-compatible", api: "https://api.custom.com/v1" },
            },
            "custom-reasoning": {
              name: "Custom Reasoning",
              interleaved: { field: "vendor_reasoning" },
              provider: { npm: "@ai-sdk/openai-compatible", api: "https://api.custom.com/v1" },
            },
            "custom-model": {
              name: "Custom Model",
              provider: { npm: "@ai-sdk/openai-compatible", api: "https://api.custom.com/v1" },
            },
            "deepseek-anthropic": {
              name: "DeepSeek Anthropic",
              provider: { npm: "@ai-sdk/anthropic", api: "https://api.custom.com/v1" },
            },
          },
          options: { apiKey: "custom-key" },
        },
      },
    },
  },
)

it.instance(
  "env variable takes precedence, config merges options",
  Effect.gen(function* () {
    yield* setProcessEnv("OPENROUTER_API_KEY", "env-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter]).toBeDefined()
    // Config options should be merged
    expect(providers[ProviderV2.ID.openrouter].options.timeout).toBe(60000)
    expect(providers[ProviderV2.ID.openrouter].options.headerTimeout).toBe(10000)
    expect(providers[ProviderV2.ID.openrouter].options.chunkTimeout).toBe(15000)
  }),
  { config: { provider: { openrouter: { options: { timeout: 60000, headerTimeout: 10000, chunkTimeout: 15000 } } } } },
)

it.instance("getModel returns model for valid provider/model", () =>
  Effect.gen(function* () {
    yield* setProcessEnv("OPENROUTER_API_KEY", "test-api-key")
    const provider = yield* Provider.Service
    const model = yield* provider.getModel(ProviderV2.ID.openrouter, ModelV2.ID.make("anthropic/claude-sonnet-4.6"))
    expect(model).toBeDefined()
    expect(String(model.providerID)).toBe("openrouter")
    expect(String(model.id)).toBe("anthropic/claude-sonnet-4.6")
    const language = yield* provider.getLanguage(model)
    expect(language).toBeDefined()
  }),
)

it.instance("getModel throws ModelNotFoundError for invalid model", () =>
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const exit = yield* Provider.use
      .getModel(ProviderV2.ID.openrouter, ModelV2.ID.make("nonexistent-model"))
      .pipe(Effect.exit)
    expect(exit._tag).toBe("Failure")
  }),
)

it.instance("getModel throws ModelNotFoundError for invalid provider", () =>
  Effect.gen(function* () {
    const exit = yield* Provider.use
      .getModel(ProviderV2.ID.make("nonexistent-provider"), ModelV2.ID.make("some-model"))
      .pipe(Effect.exit)
    expect(exit._tag).toBe("Failure")
  }),
)

// Pure synchronous unit tests — no Effect runtime needed.

test("parseModel correctly parses provider/model string", () => {
  const result = Provider.parseModel("openai/gpt-5")
  expect(String(result.providerID)).toBe("openai")
  expect(String(result.modelID)).toBe("gpt-5")
})

test("parseModel handles model IDs with slashes", () => {
  const result = Provider.parseModel("openrouter/anthropic/claude-3-opus")
  expect(String(result.providerID)).toBe("openrouter")
  expect(String(result.modelID)).toBe("anthropic/claude-3-opus")
})

it.instance("defaultModel returns first available model when no config set", () =>
  Effect.gen(function* () {
    yield* setProcessEnv("OPENROUTER_API_KEY", "test-api-key")
    const model = yield* Provider.use.defaultModel()
    expect(model.providerID).toBeDefined()
    expect(model.modelID).toBeDefined()
  }),
)

it.instance(
  "defaultModel respects config model setting",
  Effect.gen(function* () {
    yield* setProcessEnv("OPENROUTER_API_KEY", "test-api-key")
    const model = yield* Provider.use.defaultModel()
    expect(String(model.providerID)).toBe("openrouter")
    expect(String(model.modelID)).toBe("anthropic/claude-sonnet-4")
  }),
  { config: { model: "openrouter/anthropic/claude-sonnet-4" } },
)

it.instance(
  "defaultModel treats empty provider config as no allowlist",
  Effect.gen(function* () {
    yield* setProcessEnv("OPENROUTER_API_KEY", "test-api-key")
    const model = yield* Provider.use.defaultModel()
    expect(model.providerID).toBeDefined()
    expect(model.modelID).toBeDefined()
  }),
  { config: { provider: {} } },
)

it.instance(
  "defaultModel returns a typed error when config excludes every provider",
  Effect.gen(function* () {
    const error = yield* Provider.use.defaultModel().pipe(Effect.flip)
    expect(error).toBeInstanceOf(Provider.NoProvidersError)
    expect(error._tag).toBe("ProviderNoProvidersError")
  }),
  { config: { enabled_providers: [] } },
)

it.instance(
  "provider with baseURL from config",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter]).toBeDefined()
    expect(providers[ProviderV2.ID.openrouter].options.baseURL).toBe("https://custom.openai.com/v1")
  }),
  {
    config: {
      provider: {
        openrouter: {
          options: { apiKey: "test-key", baseURL: "https://custom.openai.com/v1" },
        },
      },
    },
  },
)

it.instance(
  "model cost defaults to zero when not specified",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.openrouter].models["test-model"]
    expect(model.cost.input).toBe(0)
    expect(model.cost.output).toBe(0)
    expect(model.cost.cache.read).toBe(0)
    expect(model.cost.cache.write).toBe(0)
  }),
  {
    config: {
      provider: {
        openrouter: {
          models: { "test-model": { name: "Test Model", tool_call: true, limit: { context: 128000, output: 4096 } } },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "model options are merged from existing model",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.openrouter].models["anthropic/claude-sonnet-4.6"]
    expect(model.options.customOption).toBe("custom-value")
  }),
  {
    config: {
      provider: {
        openrouter: {
          options: { apiKey: "test-api-key" },
          models: { "anthropic/claude-sonnet-4.6": { options: { customOption: "custom-value" } } },
        },
      },
    },
  },
)

it.instance(
  "provider removed when all models filtered out",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter]).toBeUndefined()
  }),
  { config: { provider: { openrouter: { options: { apiKey: "test-api-key" }, whitelist: ["nonexistent-model"] } } } },
)

it.instance("closest finds model by partial match", () =>
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const result = yield* Provider.use.closest(ProviderV2.ID.openrouter, ["sonnet-4"])
    expect(result).toBeDefined()
    expect(String(result?.providerID)).toBe("openrouter")
    expect(String(result?.modelID)).toContain("sonnet-4")
  }),
)

it.instance("closest returns undefined for nonexistent provider", () =>
  Effect.gen(function* () {
    const result = yield* Provider.use.closest(ProviderV2.ID.make("nonexistent"), ["model"])
    expect(result).toBeUndefined()
  }),
)

it.instance(
  "getModel uses realIdByKey for aliased models",
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter].models["my-sonnet"]).toBeDefined()

    const model = yield* Provider.use.getModel(ProviderV2.ID.openrouter, ModelV2.ID.make("my-sonnet"))
    expect(model).toBeDefined()
    expect(String(model.id)).toBe("my-sonnet")
    expect(model.name).toBe("My Sonnet Alias")
  }),
  {
    config: {
      provider: {
        openrouter: {
          models: { "my-sonnet": { id: "anthropic/claude-sonnet-4", name: "My Sonnet Alias" } },
        },
      },
    },
  },
)

it.instance(
  "provider api field sets model api.url",
  Effect.gen(function* () {
    const providers = yield* list
    // api field is stored on model.api.url, used by getSDK to set baseURL
    expect(providers[ProviderV2.ID.openrouter].models["model-1"].api.url).toBe("https://api.example.com/v1")
  }),
  {
    config: {
      provider: {
        openrouter: {
          api: "https://api.example.com/v1",
          models: { "model-1": { name: "Model 1", tool_call: true, limit: { context: 8000, output: 2000 } } },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "explicit baseURL overrides api field",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter].options.baseURL).toBe("https://custom.override.com/v1")
  }),
  {
    config: {
      provider: {
        openrouter: {
          api: "https://api.example.com/v1",
          models: { "model-1": { name: "Model 1", tool_call: true, limit: { context: 8000, output: 2000 } } },
          options: { apiKey: "test-key", baseURL: "https://custom.override.com/v1" },
        },
      },
    },
  },
)

it.instance(
  "model inherits properties from existing database model",
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const providers = yield* list
    const model = providers[ProviderV2.ID.openrouter].models["anthropic/claude-sonnet-4.6"]
    expect(model.name).toBe("Custom Name for Sonnet")
    expect(model.capabilities.toolcall).toBe(true)
    expect(model.capabilities.attachment).toBe(true)
    expect(model.limit.context).toBeGreaterThan(0)
  }),
  {
    config: {
      provider: { openrouter: { models: { "anthropic/claude-sonnet-4.6": { name: "Custom Name for Sonnet" } } } },
    },
  },
)

it.instance(
  "model config preserves explicitly empty models.dev variants",
  Effect.gen(function* () {
    yield* set("OPENAI_API_KEY", "test-api-key")
    const providers = yield* list
    const model = providers[ProviderV2.ID.openai].models["custom-gpt-chat"]
    expect(model.name).toBe("Custom GPT Chat")
    expect(model.variants).toEqual({})
  }),
  {
    config: {
      provider: {
        openai: { models: { "custom-gpt-chat": { id: "gpt-5-chat-latest", name: "Custom GPT Chat" } } },
      },
    },
  },
)

it.instance(
  "model config regenerates variants when overriding the provider package",
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const providers = yield* list
    const model = providers[ProviderV2.ID.openrouter].models["anthropic/claude-sonnet-4.6"]
    expect(model.variants?.low).toEqual({ reasoningEffort: "low" })
    expect(model.variants?.max).toBeUndefined()
  }),
  {
    config: {
      provider: {
        openrouter: {
          npm: "@ai-sdk/openai-compatible",
          models: { "anthropic/claude-sonnet-4.6": { name: "Claude via OpenAI" } },
        },
      },
    },
  },
)

it.instance(
  "disabled_providers prevents loading even with env var",
  Effect.gen(function* () {
    yield* set("OPENAI_API_KEY", "test-openai-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.openai]).toBeUndefined()
  }),
  { config: { disabled_providers: ["openai"] } },
)

it.instance(
  "enabled_providers with empty array allows no providers",
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    yield* set("OPENAI_API_KEY", "test-openai-key")
    const providers = yield* list
    expect(Object.keys(providers).length).toBe(0)
  }),
  { config: { enabled_providers: [] } },
)

it.instance(
  "whitelist and blacklist can be combined",
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter]).toBeDefined()
    const models = Object.keys(providers[ProviderV2.ID.openrouter].models)
    expect(models).toContain("anthropic/claude-sonnet-4.6")
    expect(models).not.toContain("anthropic/claude-opus-4.6")
    expect(models.length).toBe(1)
  }),
  {
    config: {
      provider: {
        openrouter: {
          whitelist: ["anthropic/claude-sonnet-4.6", "anthropic/claude-opus-4.6"],
          blacklist: ["anthropic/claude-opus-4.6"],
        },
      },
    },
  },
)

it.instance(
  "model modalities default correctly",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.openrouter].models["test-model"]
    expect(model.capabilities.input.text).toBe(true)
    expect(model.capabilities.output.text).toBe(true)
  }),
  {
    config: {
      provider: {
        openrouter: {
          models: { "test-model": { name: "Test Model", tool_call: true, limit: { context: 8000, output: 2000 } } },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "model with custom cost values",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.openrouter].models["test-model"]
    expect(model.cost.input).toBe(5)
    expect(model.cost.output).toBe(15)
    expect(model.cost.cache.read).toBe(2.5)
    expect(model.cost.cache.write).toBe(7.5)
  }),
  {
    config: {
      provider: {
        openrouter: {
          models: {
            "test-model": {
              name: "Test Model",
              tool_call: true,
              limit: { context: 8000, output: 2000 },
              cost: { input: 5, output: 15, cache_read: 2.5, cache_write: 7.5 },
            },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance("getSmallModel returns appropriate small model", () =>
  Effect.gen(function* () {
    yield* set("OPENAI_API_KEY", "test-api-key")
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.openai)
    expect(model).toBeDefined()
    expect(model?.id).toContain("nano")
  }),
)

it.instance(
  "getSmallModel selects the latest model in the preferred family",
  Effect.gen(function* () {
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.openrouter)
    expect(model?.id).toBe(ModelV2.ID.make("new-flash"))
  }),
  {
    config: {
      provider: {
        openrouter: {
          whitelist: ["old-flash", "new-flash", "newer-haiku"],
          models: {
            "old-flash": { family: "gemini-flash", release_date: "2025-01-01" },
            "new-flash": { family: "gemini-flash", release_date: "2026-01-01" },
            "newer-haiku": { family: "claude-haiku", release_date: "2026-06-01" },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "getSmallModel matches exact model families",
  Effect.gen(function* () {
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.openrouter)
    expect(model?.id).toBe(ModelV2.ID.make("claude-haiku"))
  }),
  {
    config: {
      provider: {
        openrouter: {
          whitelist: ["glm-flash", "claude-haiku"],
          models: {
            "glm-flash": { family: "glm-flash", release_date: "2026-06-01" },
            "claude-haiku": { family: "claude-haiku", release_date: "2026-01-01" },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "getSmallModel ignores model IDs without family metadata",
  Effect.gen(function* () {
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.openrouter)
    expect(model).toBeUndefined()
  }),
  {
    config: {
      provider: {
        openrouter: {
          whitelist: ["gpt-5-nano"],
          models: {
            "gpt-5-nano": { release_date: "2026-01-01" },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "getSmallModel respects config small_model override",
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.openrouter)
    expect(model).toBeDefined()
    expect(String(model?.providerID)).toBe("openrouter")
    expect(String(model?.id)).toBe("anthropic/claude-sonnet-4.6")
  }),
  { config: { small_model: "openrouter/anthropic/claude-sonnet-4.6" } },
)

it.instance(
  "getSmallModel ignores invalid config small_model",
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.openrouter)
    expect(model).toBeUndefined()
  }),
  { config: { small_model: "openrouter/not-a-real-model" } },
)

test("provider.sort prioritizes preferred models", () => {
  const models = [
    { id: "random-model", name: "Random" },
    { id: "claude-sonnet-4-latest", name: "Claude Sonnet 4" },
    { id: "gpt-5-turbo", name: "GPT-5 Turbo" },
    { id: "other-model", name: "Other" },
  ] as any[]

  const sorted = Provider.sort(models)
  expect(sorted[0].id).toContain("sonnet-4")
  expect(sorted[0].id).toContain("latest")
  expect(sorted[sorted.length - 1].id).not.toContain("gpt-5")
  expect(sorted[sorted.length - 1].id).not.toContain("sonnet-4")
})

it.instance(
  "multiple providers can be configured simultaneously",
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-anthropic-key")
    yield* set("OPENAI_API_KEY", "test-openai-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter]).toBeDefined()
    expect(providers[ProviderV2.ID.openai]).toBeDefined()
    expect(providers[ProviderV2.ID.openrouter].options.timeout).toBe(30000)
    expect(providers[ProviderV2.ID.openai].options.timeout).toBe(60000)
  }),
  {
    config: {
      provider: {
        openrouter: { options: { timeout: 30000 } },
        openai: { options: { timeout: 60000 } },
      },
    },
  },
)

it.instance(
  "provider with custom npm package",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter].models["llama-3"].api.npm).toBe("@ai-sdk/openai-compatible")
    expect(providers[ProviderV2.ID.openrouter].options.baseURL).toBe("http://localhost:11434/v1")
  }),
  {
    config: {
      provider: {
        openrouter: {
          npm: "@ai-sdk/openai-compatible",
          models: { "llama-3": { name: "Llama 3", tool_call: true, limit: { context: 8192, output: 2048 } } },
          options: { apiKey: "not-needed", baseURL: "http://localhost:11434/v1" },
        },
      },
    },
  },
)

it.instance(
  "model alias name defaults to alias key when id differs",
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter].models["sonnet"].name).toBe("sonnet")
  }),
  {
    config: {
      provider: {
        openrouter: {
          models: { sonnet: { id: "anthropic/claude-sonnet-4" } },
        },
      },
    },
  },
)

it.instance(
  "provider with multiple env var options only includes apiKey when single env",
  Effect.gen(function* () {
    yield* set("MULTI_ENV_KEY_1", "test-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter]).toBeDefined()
    // When multiple env options exist, key should NOT be auto-set
    expect(providers[ProviderV2.ID.openrouter].key).toBeUndefined()
  }),
  {
    config: {
      provider: {
        openrouter: {
          env: ["MULTI_ENV_KEY_1", "MULTI_ENV_KEY_2"],
          options: { baseURL: "https://api.example.com/v1" },
        },
      },
    },
  },
)

it.instance(
  "provider with single env var includes apiKey automatically",
  Effect.gen(function* () {
    yield* set("SINGLE_ENV_KEY", "my-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter]).toBeDefined()
    // Single env option should auto-set key
    expect(providers[ProviderV2.ID.openrouter].key).toBe("my-api-key")
  }),
  {
    config: {
      provider: {
        openrouter: {
          env: ["SINGLE_ENV_KEY"],
          options: { baseURL: "https://api.example.com/v1" },
        },
      },
    },
  },
)

it.instance(
  "model cost overrides existing cost values",
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const providers = yield* list
    const model = providers[ProviderV2.ID.openrouter].models["anthropic/claude-sonnet-4"]
    expect(model.cost.input).toBe(999)
    expect(model.cost.output).toBe(888)
  }),
  {
    config: {
      provider: {
        openrouter: {
          models: { "anthropic/claude-sonnet-4": { cost: { input: 999, output: 888 } } },
        },
      },
    },
  },
)

it.instance(
  "new model not in database can be configured",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.openrouter].models["new-model"]
    expect(model.name).toBe("New Model")
    expect(model.capabilities.reasoning).toBe(true)
    expect(model.capabilities.attachment).toBe(true)
    expect(model.capabilities.input.image).toBe(true)
  }),
  {
    config: {
      provider: {
        openrouter: {
          models: {
            "new-model": {
              name: "New Model",
              tool_call: true,
              reasoning: true,
              attachment: true,
              temperature: true,
              limit: { context: 32000, output: 8000 },
              modalities: { input: ["text", "image"], output: ["text"] },
            },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "disabled_providers and enabled_providers interaction",
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-openrouter")
    yield* set("OPENAI_API_KEY", "test-openai")
    const providers = yield* list
    // openrouter: in enabled, not in disabled = allowed
    expect(providers[ProviderV2.ID.openrouter]).toBeDefined()
    // openai: in enabled, but also in disabled = NOT allowed
    expect(providers[ProviderV2.ID.openai]).toBeUndefined()
  }),
  {
    // enabled_providers takes precedence — only these are considered
    // Then disabled_providers filters from the enabled set
    config: { enabled_providers: ["openrouter", "openai"], disabled_providers: ["openai"] },
  },
)

it.instance(
  "model with tool_call false",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter].models["basic-model"].capabilities.toolcall).toBe(false)
  }),
  {
    config: {
      provider: {
        openrouter: {
          models: { "basic-model": { name: "Basic Model", tool_call: false, limit: { context: 4000, output: 1000 } } },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "model defaults tool_call to true when not specified",
  Effect.gen(function* () {
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter].models["model"].capabilities.toolcall).toBe(true)
  }),
  {
    config: {
      provider: {
        openrouter: {
          models: { model: { name: "Model", limit: { context: 4000, output: 1000 } } },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "model headers are preserved",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.openrouter].models["model"]
    expect(model.headers).toEqual({
      "X-Custom-Header": "custom-value",
      Authorization: "Bearer special-token",
    })
  }),
  {
    config: {
      provider: {
        openrouter: {
          models: {
            model: {
              name: "Model",
              tool_call: true,
              limit: { context: 4000, output: 1000 },
              headers: { "X-Custom-Header": "custom-value", Authorization: "Bearer special-token" },
            },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "provider env fallback - second env var used if first missing",
  Effect.gen(function* () {
    // Only set fallback, not primary
    yield* set("FALLBACK_KEY", "fallback-api-key")
    const providers = yield* list
    // Provider should load because fallback env var is set
    expect(providers[ProviderV2.ID.openrouter]).toBeDefined()
  }),
  {
    config: {
      provider: {
        openrouter: {
          env: ["PRIMARY_KEY", "FALLBACK_KEY"],
          options: { baseURL: "https://api.example.com" },
        },
      },
    },
  },
)

it.instance("getModel returns consistent results", () =>
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const model1 = yield* Provider.use.getModel(
      ProviderV2.ID.openrouter,
      ModelV2.ID.make("anthropic/claude-sonnet-4.6"),
    )
    const model2 = yield* Provider.use.getModel(
      ProviderV2.ID.openrouter,
      ModelV2.ID.make("anthropic/claude-sonnet-4.6"),
    )
    expect(model1.providerID).toEqual(model2.providerID)
    expect(model1.id).toEqual(model2.id)
    expect(model1).toEqual(model2)
  }),
)

it.instance("ModelNotFoundError includes suggestions for typos", () =>
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const error = yield* Provider.use
      .getModel(ProviderV2.ID.openrouter, ModelV2.ID.make("anthropic/claude-sonet-4"))
      .pipe(Effect.flip)
    expect(error.suggestions).toBeDefined()
    expect((error.suggestions ?? []).length).toBeGreaterThan(0)
    expect(error.message).toContain("Model not found: openrouter/anthropic/claude-sonet-4")
    expect(error.message).toContain("Did you mean:")
  }),
)

it.instance("ModelNotFoundError for provider includes suggestions", () =>
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const error = yield* Provider.use
      .getModel(ProviderV2.ID.make("openroute"), ModelV2.ID.make("anthropic/claude-sonnet-4"))
      .pipe(Effect.flip)
    expect(error.suggestions).toBeDefined()
    expect(error.suggestions).toContain("openrouter")
  }),
)

it.instance("ModelNotFoundError suggests catalog models for unloaded providers", () =>
  Effect.gen(function* () {
    yield* remove("OPENROUTER_API_KEY")
    const error = yield* Provider.use
      .getModel(ProviderV2.ID.openrouter, ModelV2.ID.make("anthropic/claude-haiku-fake-model"))
      .pipe(Effect.flip)
    if (!Provider.ModelNotFoundError.isInstance(error)) throw error
    expect(error.suggestions ?? []).toContain("anthropic/claude-haiku-4.5")
  }),
)

it.instance("getProvider returns undefined for nonexistent provider", () =>
  Effect.gen(function* () {
    const provider = yield* Provider.Service.use((svc) => svc.getProvider(ProviderV2.ID.make("nonexistent")))
    expect(provider).toBeUndefined()
  }),
)

it.instance("getProvider returns provider info", () =>
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const provider = yield* Provider.use.getProvider(ProviderV2.ID.openrouter)
    expect(provider).toBeDefined()
    expect(String(provider?.id)).toBe("openrouter")
  }),
)

it.instance("closest returns undefined when no partial match found", () =>
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const result = yield* Provider.use.closest(ProviderV2.ID.openrouter, ["nonexistent-xyz-model"])
    expect(result).toBeUndefined()
  }),
)

it.instance("closest checks multiple query terms in order", () =>
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    // First term won't match, second will
    const result = yield* Provider.use.closest(ProviderV2.ID.openrouter, ["nonexistent", "haiku"])
    expect(result).toBeDefined()
    expect(result?.modelID).toContain("haiku")
  }),
)

it.instance(
  "model limit defaults to zero when not specified",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.openrouter].models["model"]
    expect(model.limit.context).toBe(0)
    expect(model.limit.output).toBe(0)
  }),
  {
    config: {
      provider: {
        openrouter: {
          models: { model: { name: "Model", tool_call: true } },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "provider options are deeply merged",
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const providers = yield* list
    // Custom options should be merged
    expect(providers[ProviderV2.ID.openrouter].options.timeout).toBe(30000)
    expect(providers[ProviderV2.ID.openrouter].options.headers["X-Custom"]).toBe("custom-value")
    // openrouter custom loader adds its own headers, they should coexist
    expect(providers[ProviderV2.ID.openrouter].options.headers["X-Title"]).toBe("CrewCode")
  }),
  {
    config: {
      provider: { openrouter: { options: { headers: { "X-Custom": "custom-value" }, timeout: 30000 } } },
    },
  },
)

it.instance(
  "custom model inherits npm package from models.dev provider config",
  Effect.gen(function* () {
    yield* set("OPENAI_API_KEY", "test-api-key")
    const providers = yield* list
    const model = providers[ProviderV2.ID.openai].models["my-custom-model"]
    expect(model).toBeDefined()
    expect(model.api.npm).toBe("@ai-sdk/openai")
  }),
  {
    config: {
      provider: {
        openai: {
          models: {
            "my-custom-model": {
              name: "My Custom Model",
              tool_call: true,
              limit: { context: 8000, output: 2000 },
            },
          },
        },
      },
    },
  },
)

it.instance(
  "custom model inherits api.url from models.dev provider",
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter]).toBeDefined()

    // New model not in database should inherit api.url from provider
    const intellect = providers[ProviderV2.ID.openrouter].models["prime-intellect/intellect-3"]
    expect(intellect).toBeDefined()
    expect(intellect.api.url).toBe("https://openrouter.ai/api/v1")

    // Another new model should also inherit api.url
    const deepseek = providers[ProviderV2.ID.openrouter].models["deepseek/deepseek-r1-0528"]
    expect(deepseek).toBeDefined()
    expect(deepseek.api.url).toBe("https://openrouter.ai/api/v1")
    expect(deepseek.name).toBe("DeepSeek R1")
  }),
  {
    config: {
      provider: {
        openrouter: {
          models: {
            "prime-intellect/intellect-3": {},
            "deepseek/deepseek-r1-0528": { name: "DeepSeek R1" },
          },
        },
      },
    },
  },
)

test("mode options and cost are derived from the base model", () => {
  const provider = {
    id: "openai",
    name: "OpenAI",
    env: [],
    npm: "@ai-sdk/openai",
    api: "https://api.openai.com/v1",
    models: {
      "gpt-5.6-sol": {
        id: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        family: "gpt",
        release_date: "2026-03-05",
        attachment: true,
        reasoning: true,
        temperature: false,
        tool_call: true,
        cost: {
          input: 2.5,
          output: 15,
          cache_read: 0.25,
          context_over_200k: {
            input: 5,
            output: 22.5,
            cache_read: 0.5,
          },
        },
        limit: {
          context: 1_050_000,
          input: 922_000,
          output: 128_000,
        },
        experimental: {
          modes: {
            fast: {
              cost: {
                input: 5,
                output: 30,
                cache_read: 0.5,
              },
              provider: {
                body: {
                  service_tier: "priority",
                },
              },
            },
            pro: {
              provider: {
                body: {
                  reasoning: { mode: "pro" },
                  service_tier: "priority",
                },
              },
            },
          },
        },
      },
    },
  } as unknown as ModelsDev.Provider

  const model = Provider.fromModelsDevProvider(provider).models["gpt-5.6-sol-fast"]
  expect(model.cost.input).toEqual(5)
  expect(model.cost.output).toEqual(30)
  expect(model.cost.cache.read).toEqual(0.5)
  expect(model.cost.cache.write).toEqual(0)
  expect(model.options["serviceTier"]).toEqual("priority")
  const pro = Provider.fromModelsDevProvider(provider).models["gpt-5.6-sol-pro"]
  expect(pro.api.id).toEqual("gpt-5.6-sol")
  expect(pro.options).toEqual({ reasoningMode: "pro", serviceTier: "priority" })
  expect(model.cost.experimentalOver200K).toEqual({
    input: 5,
    output: 22.5,
    cache: { read: 0.5, write: 0 },
  })
})

test("models.dev normalization fills required response fields", () => {
  const provider = {
    id: "gateway",
    name: "Gateway",
    env: [],
    models: {
      "gpt-5.4": {
        id: "gpt-5.4",
        name: "GPT-5.4",
        family: "gpt",
        interleaved: "reasoning_text",
        cost: { input: 2.5, output: 15 },
        limit: { context: 1_050_000, input: 922_000, output: 128_000 },
      },
    },
  } as unknown as ModelsDev.Provider

  const model = Provider.fromModelsDevProvider(provider).models["gpt-5.4"]
  expect(model.api.url).toBe("")
  expect(model.capabilities.temperature).toBe(false)
  expect(model.capabilities.reasoning).toBe(false)
  expect(model.capabilities.attachment).toBe(false)
  expect(model.capabilities.toolcall).toBe(true)
  expect(model.capabilities.interleaved).toEqual({ field: "reasoning_text" })
  expect(model.release_date).toBe("")
})

test("models.dev reasoning options replace generated variants and unsupported toggles fall back", () => {
  const provider = {
    id: "reasoning",
    name: "Reasoning",
    env: [],
    npm: "@ai-sdk/openai",
    models: {
      explicit: {
        id: "gpt-5.4",
        name: "Explicit",
        reasoning: true,
        reasoning_options: [{ type: "effort", values: ["low"] }],
        limit: { context: 128_000, output: 64_000 },
      },
      empty: {
        id: "gpt-5.4",
        name: "Empty",
        reasoning: true,
        reasoning_options: [],
        limit: { context: 128_000, output: 64_000 },
      },
      fallback: {
        id: "gpt-5.4",
        name: "Fallback",
        reasoning: true,
        reasoning_options: [{ type: "toggle" }],
        limit: { context: 128_000, output: 64_000 },
      },
    },
  } as unknown as ModelsDev.Provider

  const models = Provider.fromModelsDevProvider(provider).models
  expect(models.explicit.variants).toEqual({
    low: {
      reasoningEffort: "low",
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    },
  })
  expect(models.empty.variants).toEqual({})
  expect(Object.keys(models.fallback.variants ?? {})).toEqual(["none", "low", "medium", "high", "xhigh"])
})

test("public provider info omits invalid models", () => {
  const provider = Provider.fromModelsDevProvider({
    id: "test",
    name: "Test",
    env: [],
    models: {
      valid: {
        id: "valid",
        name: "Valid",
        cost: { input: 1, output: 1 },
        limit: { context: 128_000, output: 16_000 },
      },
    },
  } as unknown as ModelsDev.Provider)
  provider.models.invalid = {
    ...provider.models.valid,
    id: ModelV2.ID.make("invalid"),
    cost: { ...provider.models.valid.cost, input: Number.NaN },
  }

  const result = Provider.toPublicInfo(provider)

  expect(result.models.valid).toBeDefined()
  expect(result.models.invalid).toBeUndefined()
})

it.instance("model variants are generated for reasoning models", () =>
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const providers = yield* list
    // Claude sonnet 4 has reasoning capability
    const model = providers[ProviderV2.ID.openrouter].models["anthropic/claude-sonnet-4.6"]
    expect(model.capabilities.reasoning).toBe(true)
    expect(model.variants).toBeDefined()
    expect(Object.keys(model.variants!).length).toBeGreaterThan(0)
  }),
)

it.instance(
  "model variants can be disabled via config",
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const providers = yield* list
    const model = providers[ProviderV2.ID.openrouter].models["anthropic/claude-sonnet-4.6"]
    expect(model.variants).toBeDefined()
    expect(model.variants!["high"]).toBeUndefined()
    // max variant should still exist
    expect(model.variants!["max"]).toBeDefined()
  }),
  {
    config: {
      provider: {
        openrouter: {
          models: { "anthropic/claude-sonnet-4.6": { variants: { high: { disabled: true } } } },
        },
      },
    },
  },
)

it.instance(
  "model variants can be customized via config",
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const providers = yield* list
    const model = providers[ProviderV2.ID.openrouter].models["anthropic/claude-sonnet-4.6"]
    expect(model.variants!["high"]).toBeDefined()
    expect(model.variants!["high"].thinking.budgetTokens).toBe(20000)
  }),
  {
    config: {
      provider: {
        openrouter: {
          models: {
            "anthropic/claude-sonnet-4.6": {
              variants: { high: { thinking: { type: "enabled", budgetTokens: 20000 } } },
            },
          },
        },
      },
    },
  },
)

it.instance(
  "disabled key is stripped from variant config",
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const providers = yield* list
    const model = providers[ProviderV2.ID.openrouter].models["anthropic/claude-sonnet-4.6"]
    expect(model.variants!["max"]).toBeDefined()
    expect(model.variants!["max"].disabled).toBeUndefined()
    expect(model.variants!["max"].customField).toBe("test")
  }),
  {
    config: {
      provider: {
        openrouter: {
          models: {
            "anthropic/claude-sonnet-4.6": {
              variants: { max: { disabled: false, customField: "test" } },
            },
          },
        },
      },
    },
  },
)

it.instance(
  "all variants can be disabled via config",
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const providers = yield* list
    const model = providers[ProviderV2.ID.openrouter].models["anthropic/claude-sonnet-4.6"]
    expect(model.variants).toBeDefined()
    expect(Object.keys(model.variants!).length).toBe(0)
  }),
  {
    config: {
      provider: {
        openrouter: {
          models: {
            "anthropic/claude-sonnet-4.6": {
              variants: {
                low: { disabled: true },
                medium: { disabled: true },
                high: { disabled: true },
                max: { disabled: true },
              },
            },
          },
        },
      },
    },
  },
)

it.instance(
  "variant config merges with generated variants",
  Effect.gen(function* () {
    yield* set("OPENROUTER_API_KEY", "test-api-key")
    const providers = yield* list
    const model = providers[ProviderV2.ID.openrouter].models["anthropic/claude-sonnet-4.6"]
    expect(model.variants!["high"]).toBeDefined()
    // Should have both the generated reasoning config and the custom option
    expect(model.variants!["high"].reasoning).toBeDefined()
    expect(model.variants!["high"].extraOption).toBe("custom-value")
  }),
  {
    config: {
      provider: {
        openrouter: {
          models: {
            "anthropic/claude-sonnet-4.6": { variants: { high: { extraOption: "custom-value" } } },
          },
        },
      },
    },
  },
)

it.instance(
  "variants filtered in second pass for database models",
  Effect.gen(function* () {
    yield* set("OPENAI_API_KEY", "test-api-key")
    const providers = yield* list
    const model = providers[ProviderV2.ID.openai].models["gpt-5"]
    expect(model.variants).toBeDefined()
    expect(model.variants!["high"]).toBeUndefined()
    // Other variants should still exist
    expect(model.variants!["medium"]).toBeDefined()
  }),
  {
    config: {
      provider: { openai: { models: { "gpt-5": { variants: { high: { disabled: true } } } } } },
    },
  },
)

it.instance(
  "custom model with variants enabled and disabled",
  Effect.gen(function* () {
    const providers = yield* list
    const model = providers[ProviderV2.ID.openrouter].models["reasoning-model"]
    expect(model.variants).toBeDefined()
    // Enabled variants should exist
    expect(model.variants!["low"]).toBeDefined()
    expect(model.variants!["low"].reasoningEffort).toBe("low")
    expect(model.variants!["medium"]).toBeDefined()
    expect(model.variants!["medium"].reasoningEffort).toBe("medium")
    expect(model.variants!["custom"]).toBeDefined()
    expect(model.variants!["custom"].reasoningEffort).toBe("custom")
    expect(model.variants!["custom"].budgetTokens).toBe(5000)
    // Disabled variant should not exist
    expect(model.variants!["high"]).toBeUndefined()
    // disabled key should be stripped from all variants
    expect(model.variants!["low"].disabled).toBeUndefined()
    expect(model.variants!["medium"].disabled).toBeUndefined()
    expect(model.variants!["custom"].disabled).toBeUndefined()
  }),
  {
    config: {
      provider: {
        openrouter: {
          models: {
            "reasoning-model": {
              name: "Reasoning Model",
              tool_call: true,
              reasoning: true,
              limit: { context: 128000, output: 16000 },
              variants: {
                low: { reasoningEffort: "low" },
                medium: { reasoningEffort: "medium" },
                high: { reasoningEffort: "high", disabled: true },
                custom: { reasoningEffort: "custom", budgetTokens: 5000 },
              },
            },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

// Tests that need plugin file setup or multi-instance flows fall back to a
// scoped tmpdir + provideInstance pattern via it.effect.

const instanceStoreLayer = LayerNode.compile(InstanceStore.node, [
  [InstanceStore.bootstrapNode, InstanceBootstrap.node],
])
const provideMultiInstance = <A, E, R>(eff: Effect.Effect<A, E, R>) =>
  eff.pipe(Effect.provide(instanceStoreLayer), Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node)))

it.effect("plugin config providers persist after instance dispose", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const configDir = path.join(dir, ".crewcode")
    const root = path.join(configDir, "plugin")
    yield* Effect.promise(() => mkdir(root, { recursive: true }))
    yield* Effect.promise(() => markPluginDependenciesReady(configDir))
    yield* Effect.promise(() => markPluginDependenciesReady(Global.Path.config))
    yield* Effect.promise(() =>
      Bun.write(
        path.join(root, "demo-provider.ts"),
        [
          "export default {",
          '  id: "demo.plugin-provider",',
          "  server: async () => ({",
          "    async config(cfg) {",
          "      cfg.provider ??= {}",
          "      cfg.provider.openrouter = {",
          '        options: { apiKey: "demo-key" },',
          "        models: {",
          "          chat: {",
          '            name: "Demo Chat",',
          "            tool_call: true,",
          "            limit: { context: 128000, output: 4096 },",
          "          },",
          "        },",
          "      }",
          "    },",
          "  }),",
          "}",
          "",
        ].join("\n"),
      ),
    )

    const loadAndList = Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const provider = yield* Provider.Service
      yield* plugin.init()
      return yield* provider.list()
    }).pipe(provideInstanceEffect(dir))

    const first = yield* loadAndList
    expect(first[ProviderV2.ID.openrouter]).toBeDefined()
    expect(first[ProviderV2.ID.openrouter].models[ModelV2.ID.make("chat")]).toBeDefined()

    yield* Effect.promise(() => disposeAllInstances())

    const second = yield* loadAndList
    expect(second[ProviderV2.ID.openrouter]).toBeDefined()
    expect(second[ProviderV2.ID.openrouter].models[ModelV2.ID.make("chat")]).toBeDefined()
  }).pipe(provideMultiInstance),
)

it.instance(
  "plugin config enabled and disabled providers are honored",
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const configDir = path.join(instance.directory, ".crewcode")
    const root = path.join(configDir, "plugin")
    yield* Effect.promise(() => mkdir(root, { recursive: true }))
    yield* Effect.promise(() => markPluginDependenciesReady(configDir))
    yield* Effect.promise(() =>
      Bun.write(
        path.join(root, "provider-filter.ts"),
        [
          "export default {",
          '  id: "demo.provider-filter",',
          "  server: async () => ({",
          "    async config(cfg) {",
          '      cfg.enabled_providers = ["openrouter", "openai"]',
          '      cfg.disabled_providers = ["openai"]',
          "    },",
          "  }),",
          "}",
          "",
        ].join("\n"),
      ),
    )

    yield* set("OPENROUTER_API_KEY", "test-anthropic-key")
    yield* set("OPENAI_API_KEY", "test-openai-key")
    const providers = yield* list
    expect(providers[ProviderV2.ID.openrouter]).toBeDefined()
    expect(providers[ProviderV2.ID.openai]).toBeUndefined()
  }),
)
