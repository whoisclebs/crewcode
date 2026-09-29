import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ProviderTransform } from "@/provider/transform"
import { LLMRequestPrep } from "@/session/llm/request"
import { ProviderV2 } from "@crewcode/core/provider"
import { ModelV2 } from "@crewcode/core/model"
import { ModelsDev } from "@crewcode/core/models-dev"
import { generateText, jsonSchema, type ModelMessage } from "ai"

describe("ProviderTransform.options - setCacheKey", () => {
  const sessionID = "test-session-123"

  const mockModel = {
    id: "custom/test-model",
    providerID: "custom",
    api: {
      id: "test-model",
      url: "https://api.example.com/v1",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0.003,
      output: 0.015,
      cache: { read: 0.0003, write: 0.00375 },
    },
    limit: {
      context: 200000,
      output: 8192,
    },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("should set promptCacheKey when providerOptions.setCacheKey is true", () => {
    const result = ProviderTransform.options({
      model: mockModel,
      sessionID,
      providerOptions: { setCacheKey: true },
    })
    expect(result.promptCacheKey).toBe(sessionID)
  })

  test("should not set promptCacheKey when providerOptions.setCacheKey is false", () => {
    const result = ProviderTransform.options({
      model: mockModel,
      sessionID,
      providerOptions: { setCacheKey: false },
    })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("should not set promptCacheKey when providerOptions is undefined", () => {
    const result = ProviderTransform.options({
      model: mockModel,
      sessionID,
      providerOptions: undefined,
    })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("should not set promptCacheKey when providerOptions does not have setCacheKey", () => {
    const result = ProviderTransform.options({ model: mockModel, sessionID, providerOptions: {} })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("should set promptCacheKey for openai provider by default", () => {
    const openaiModel = {
      ...mockModel,
      providerID: "openai",
      api: {
        id: "gpt-4",
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
    }
    const result = ProviderTransform.options({ model: openaiModel, sessionID, providerOptions: {} })
    expect(result.promptCacheKey).toBe(sessionID)
  })

  test("should set promptCacheKey for the OpenAI SDK regardless of provider ID", () => {
    const result = ProviderTransform.options({
      model: {
        ...mockModel,
        providerID: "custom-openai",
        api: { id: "gpt-5", url: "https://example.com", npm: "@ai-sdk/openai" },
      },
      sessionID,
      providerOptions: {},
    })
    expect(result.promptCacheKey).toBe(sessionID)
  })

  test("should not set promptCacheKey for the OpenAI-compatible SDK by provider name", () => {
    const result = ProviderTransform.options({
      model: {
        ...mockModel,
        providerID: "openai",
        api: { id: "gpt-5", url: "https://example.com", npm: "@ai-sdk/openai-compatible" },
      },
      sessionID,
      providerOptions: {},
    })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("should not set promptCacheKey for openai when explicitly disabled", () => {
    const openaiModel = {
      ...mockModel,
      providerID: "openai",
      api: {
        id: "gpt-4",
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
    }
    const result = ProviderTransform.options({
      model: openaiModel,
      sessionID,
      providerOptions: { setCacheKey: false },
    })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("should set store=false for openai provider", () => {
    const openaiModel = {
      ...mockModel,
      providerID: "openai",
      api: {
        id: "gpt-4",
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
    }
    const result = ProviderTransform.options({
      model: openaiModel,
      sessionID,
      providerOptions: {},
    })
    expect(result.store).toBe(false)
  })

  test("should not send an undocumented OpenRouter prompt_cache_key", () => {
    const result = ProviderTransform.options({
      model: {
        ...mockModel,
        providerID: "openrouter",
        api: { ...mockModel.api, npm: "@openrouter/ai-sdk-provider" },
      },
      sessionID,
      providerOptions: {},
    })
    expect(result.prompt_cache_key).toBeUndefined()
  })
})

describe("ProviderTransform.options - zai/zhipuai thinking", () => {
  const sessionID = "test-session-123"

  const createModel = (providerID: string) =>
    ({
      id: `${providerID}/glm-4.6`,
      providerID,
      api: {
        id: "glm-4.6",
        url: "https://open.bigmodel.cn/api/paas/v4",
        npm: "@ai-sdk/openai-compatible",
      },
      name: "GLM 4.6",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0.001,
        output: 0.002,
        cache: { read: 0.0001, write: 0.0002 },
      },
      limit: {
        context: 128000,
        output: 8192,
      },
      status: "active",
      options: {},
      headers: {},
    }) as any

  for (const providerID of ["zai-coding-plan", "zai", "zhipuai-coding-plan", "zhipuai"]) {
    test(`${providerID} should set thinking cfg`, () => {
      const result = ProviderTransform.options({
        model: createModel(providerID),
        sessionID,
        providerOptions: {},
      })

      expect(result.thinking).toEqual({
        type: "enabled",
        clear_thinking: false,
      })
    })
  }
})

describe("ProviderTransform.options - minimax m3 thinking", () => {
  const createModel = (npm: string) =>
    ({
      id: "minimax/minimax-m3",
      providerID: "minimax",
      api: {
        id: "minimax-m3",
        url: "https://api.minimax.com",
        npm,
      },
      capabilities: { reasoning: true },
      limit: { output: 64_000 },
    }) as any

  test("uses the native default with the openai-compatible SDK", () => {
    expect(
      ProviderTransform.options({
        model: createModel("@ai-sdk/openai-compatible"),
        sessionID: "test-session-123",
      }).thinking,
    ).toBeUndefined()
  })
})

describe("ProviderTransform.options - Gemini through OpenRouter", () => {
  const sessionID = "test-session-123"

  const createOpenRouterGemini = (apiId: string) =>
    ({
      id: `openrouter/google/${apiId}`,
      providerID: "openrouter",
      api: {
        id: `google/${apiId}`,
        url: "https://openrouter.ai/api/v1",
        npm: "@openrouter/ai-sdk-provider",
      },
      name: apiId,
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0.001,
        output: 0.002,
        cache: { read: 0.0001, write: 0.0002 },
      },
      limit: {
        context: 1_000_000,
        output: 8192,
      },
      status: "active",
      options: {},
      headers: {},
    }) as any

  test.each(["gemini-1.5-pro", "gemini-2.0-flash", "gemini-2.5-pro", "gemini-2.5-flash"])(
    "omits default reasoning effort for legacy model %s",
    (apiId) => {
      const result = ProviderTransform.options({
        model: createOpenRouterGemini(apiId),
        sessionID,
        providerOptions: {},
      })
      expect(result.reasoning).toBeUndefined()
    },
  )

  test.each([
    "gemini-3-pro-preview",
    "gemini-3-flash-preview",
    "gemini-9-pro",
    "gemini-9-flash",
    "gemini-pro-latest",
    "gemini-flash-latest",
  ])("sets default reasoning effort=high for %s", (apiId) => {
    const result = ProviderTransform.options({
      model: createOpenRouterGemini(apiId),
      sessionID,
      providerOptions: {},
    })
    expect(result.reasoning).toEqual({ effort: "high" })
  })
})

describe("ProviderTransform.options - gpt-5 textVerbosity", () => {
  const sessionID = "test-session-123"

  const createGpt5Model = (apiId: string) =>
    ({
      id: `openai/${apiId}`,
      providerID: "openai",
      api: {
        id: apiId,
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
      name: apiId,
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0.03, output: 0.06, cache: { read: 0.001, write: 0.002 } },
      limit: { context: 128000, output: 4096 },
      status: "active",
      options: {},
      headers: {},
    }) as any

  test("gpt-5.2 should have textVerbosity set to low", () => {
    const model = createGpt5Model("gpt-5.2")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBe("low")
    expect(result.include).toEqual(["reasoning.encrypted_content"])
  })

  test("openai-compatible gpt-5 models omit Responses-only reasoningSummary", () => {
    const model = {
      ...createGpt5Model("gpt-5.4"),
      id: "cortecs/gpt-5.4",
      providerID: "cortecs",
      api: {
        id: "gpt-5.4",
        url: "https://api.cortecs.ai/v1",
        npm: "@ai-sdk/openai-compatible",
      },
    }
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.reasoningEffort).toBe("medium")
    expect(result.reasoningSummary).toBeUndefined()
    expect(result.include).toBeUndefined()
    expect(result.textVerbosity).toBeUndefined()
  })

  test("gpt-5.1 should have textVerbosity set to low", () => {
    const model = createGpt5Model("gpt-5.1")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBe("low")
  })

  test("gpt-5.2-chat-latest should NOT have textVerbosity set (only supports medium)", () => {
    const model = createGpt5Model("gpt-5.2-chat-latest")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBeUndefined()
  })

  test("gpt-5.1-chat-latest should NOT have textVerbosity set (only supports medium)", () => {
    const model = createGpt5Model("gpt-5.1-chat-latest")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBeUndefined()
  })

  test("gpt-5.2-chat should NOT have textVerbosity set", () => {
    const model = createGpt5Model("gpt-5.2-chat")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBeUndefined()
  })

  test("gpt-5-chat should NOT have textVerbosity set", () => {
    const model = createGpt5Model("gpt-5-chat")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBeUndefined()
  })

  test("gpt-5.2-codex should NOT have textVerbosity set (codex models excluded)", () => {
    const model = createGpt5Model("gpt-5.2-codex")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBeUndefined()
  })
})

describe("ProviderTransform.options - gpt-5 reasoningEffort", () => {
  const sessionID = "test-session-123"

  const createModel = (apiId: string) =>
    ({
      id: `custom/${apiId}`,
      providerID: "custom",
      api: {
        id: apiId,
        url: "https://api.example.com/v1",
        npm: "@ai-sdk/openai-compatible",
      },
      name: apiId,
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: true,
          video: false,
          pdf: false,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        interleaved: false,
      },
      cost: {
        input: 0.03,
        output: 0.06,
        cache: { read: 0.001, write: 0.002 },
      },
      limit: {
        context: 128000,
        output: 4096,
      },
      status: "active",
      options: {},
      headers: {},
    }) as any

  test("gpt-5-chat should NOT set reasoningEffort", () => {
    const result = ProviderTransform.options({
      model: createModel("gpt-5-chat"),
      sessionID,
      providerOptions: {},
    })

    expect(result.reasoningEffort).toBeUndefined()
  })

  test("gpt-5.6 should set reasoningEffort for the responses API", () => {
    const result = ProviderTransform.options({
      model: createModel("gpt-5.6"),
      sessionID,
      providerOptions: {},
    })

    expect(result.reasoningEffort).toBe("medium")
  })
})

describe("ProviderTransform.providerOptions", () => {
  const createModel = (overrides: Partial<any> = {}) =>
    ({
      id: "test/test-model",
      providerID: "test",
      api: {
        id: "test-model",
        url: "https://api.test.com",
        npm: "@ai-sdk/openai",
      },
      name: "Test Model",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0.001,
        output: 0.002,
        cache: { read: 0.0001, write: 0.0002 },
      },
      limit: {
        context: 200_000,
        output: 64_000,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2024-01-01",
      ...overrides,
    }) as any

  test("forces reasoning for custom OpenAI package models with explicit effort", () => {
    const model = createModel({
      providerID: "meta",
      api: {
        id: "muse-spark",
        url: "https://api.ai.meta.com/v1",
        npm: "@ai-sdk/openai",
      },
    })

    expect(ProviderTransform.providerOptions(model, { reasoningEffort: "xhigh", reasoningSummary: "auto" })).toEqual({
      openai: { forceReasoning: true, reasoningEffort: "xhigh", reasoningSummary: "auto" },
    })
  })

  test("forces reasoning for OpenAI package models marked reasoning-capable", () => {
    expect(ProviderTransform.providerOptions(createModel(), { store: false })).toEqual({
      openai: { forceReasoning: true, store: false },
    })
  })

  test("forces reasoning for explicit effort even when model is not marked reasoning-capable", () => {
    const model = createModel({
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
    })

    expect(ProviderTransform.providerOptions(model, { reasoningEffort: "xhigh" })).toEqual({
      openai: { forceReasoning: true, reasoningEffort: "xhigh" },
    })
  })

  test("overrides forceReasoning false when reasoning should be forced", () => {
    expect(
      ProviderTransform.providerOptions(createModel(), { forceReasoning: false, reasoningEffort: "xhigh" }),
    ).toEqual({
      openai: { forceReasoning: true, reasoningEffort: "xhigh" },
    })
  })
})

describe("ProviderTransform.schema - gemini array items", () => {
  test("adds missing items for array properties", () => {
    const geminiModel = {
      providerID: "google",
      api: {
        id: "gemini-3-pro",
      },
    } as any

    const schema = {
      type: "object",
      properties: {
        nodes: { type: "array" },
        edges: { type: "array", items: { type: "string" } },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.nodes.items).toBeDefined()
    expect(result.properties.edges.items.type).toBe("string")
  })
})

describe("ProviderTransform.schema - gemini nested array items", () => {
  const geminiModel = {
    providerID: "google",
    api: {
      id: "gemini-3-pro",
    },
  } as any

  test("adds type to 2D array with empty inner items", () => {
    const schema = {
      type: "object",
      properties: {
        values: {
          type: "array",
          items: {
            type: "array",
            items: {}, // Empty items object
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    // Inner items should have a default type
    expect(result.properties.values.items.items.type).toBe("string")
  })

  test("adds items and type to 2D array with missing inner items", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "array",
          items: { type: "array" }, // No items at all
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.data.items.items).toBeDefined()
    expect(result.properties.data.items.items.type).toBe("string")
  })

  test("handles deeply nested arrays (3D)", () => {
    const schema = {
      type: "object",
      properties: {
        matrix: {
          type: "array",
          items: {
            type: "array",
            items: {
              type: "array",
              // No items
            },
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.matrix.items.items.items).toBeDefined()
    expect(result.properties.matrix.items.items.items.type).toBe("string")
  })

  test("preserves existing item types in nested arrays", () => {
    const schema = {
      type: "object",
      properties: {
        numbers: {
          type: "array",
          items: {
            type: "array",
            items: { type: "number" }, // Has explicit type
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    // Should preserve the explicit type
    expect(result.properties.numbers.items.items.type).toBe("number")
  })

  test("handles mixed nested structures with objects and arrays", () => {
    const schema = {
      type: "object",
      properties: {
        spreadsheetData: {
          type: "object",
          properties: {
            rows: {
              type: "array",
              items: {
                type: "array",
                items: {}, // Empty items
              },
            },
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.spreadsheetData.properties.rows.items.items.type).toBe("string")
  })
})

describe("ProviderTransform.schema - gemini type arrays", () => {
  // Mirrors @ai-sdk/google's convertJSONSchemaToOpenAPISchema: JSON Schema type
  // arrays (e.g. `["number","string"]`, common in MCP tool schemas) become an
  // `anyOf` of single-type schemas, with `null` lifted into `nullable`. Plain
  // @ai-sdk/google rewrites these, but OpenAI-compatible transports such as
  // GitHub Copilot (proxying to Gemini) forward them verbatim and the backend
  // rejects the array form.
  const geminiModel = {
    providerID: "google",
    api: {
      id: "gemini-3-pro",
    },
  } as any

  test("splits a multi-type array into anyOf and drops the type array", () => {
    const schema = {
      type: "object",
      properties: {
        status: { type: ["number", "string"], description: "status filter" },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.status.type).toBeUndefined()
    expect(result.properties.status.anyOf).toEqual([{ type: "number" }, { type: "string" }])
    expect(result.properties.status.nullable).toBeUndefined()
    // Sibling keywords stay alongside the generated anyOf.
    expect(result.properties.status.description).toBe("status filter")
  })

  test("lifts null into nullable for a nullable type array", () => {
    const schema = {
      type: "object",
      properties: {
        maybe: { type: ["string", "null"], description: "nullable string" },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.maybe.type).toBeUndefined()
    expect(result.properties.maybe.anyOf).toEqual([{ type: "string" }])
    expect(result.properties.maybe.nullable).toBe(true)
  })

  test("collapses an all-null type array to type null", () => {
    const schema = {
      type: "object",
      properties: {
        nothing: { type: ["null"] },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.nothing.type).toBe("null")
    expect(result.properties.nothing.anyOf).toBeUndefined()
  })

  test("rewrites type arrays for gemini served through an OpenAI-compatible endpoint", () => {
    const compatibleGeminiModel = {
      providerID: "custom",
      api: {
        id: "gemini-3.5-flash",
        npm: "@ai-sdk/openai-compatible",
      },
    } as any

    const schema = {
      type: "object",
      properties: {
        hook_id: { type: "number", description: "ID of the webhook" },
        status: { type: ["number", "string"], description: "Filter by response status code" },
      },
      required: ["hook_id"],
      additionalProperties: false,
    } as any

    const result = ProviderTransform.schema(compatibleGeminiModel, schema) as any

    expect(result.properties.status.anyOf).toEqual([{ type: "number" }, { type: "string" }])
    expect(result.properties.status.type).toBeUndefined()
    expect(result.properties.hook_id.type).toBe("number")
  })
})

describe("ProviderTransform.schema - gemini combiner nodes", () => {
  const geminiModel = {
    providerID: "google",
    api: {
      id: "gemini-3-pro",
    },
  } as any

  const walk = (node: any, cb: (node: any, path: (string | number)[]) => void, path: (string | number)[] = []) => {
    if (node === null || typeof node !== "object") {
      return
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, cb, [...path, i]))
      return
    }
    cb(node, path)
    Object.entries(node).forEach(([key, value]) => walk(value, cb, [...path, key]))
  }

  test("keeps edits.items.anyOf without adding type", () => {
    const schema = {
      type: "object",
      properties: {
        edits: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "object",
                properties: {
                  old_string: { type: "string" },
                  new_string: { type: "string" },
                },
                required: ["old_string", "new_string"],
              },
              {
                type: "object",
                properties: {
                  old_string: { type: "string" },
                  new_string: { type: "string" },
                  replace_all: { type: "boolean" },
                },
                required: ["old_string", "new_string"],
              },
            ],
          },
        },
      },
      required: ["edits"],
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(Array.isArray(result.properties.edits.items.anyOf)).toBe(true)
    expect(result.properties.edits.items.type).toBeUndefined()
  })

  test("does not add sibling keys to combiner nodes during sanitize", () => {
    const schema = {
      type: "object",
      properties: {
        edits: {
          type: "array",
          items: {
            anyOf: [{ type: "string" }, { type: "number" }],
          },
        },
        value: {
          oneOf: [{ type: "string" }, { type: "boolean" }],
        },
        meta: {
          allOf: [
            {
              type: "object",
              properties: { a: { type: "string" } },
            },
            {
              type: "object",
              properties: { b: { type: "string" } },
            },
          ],
        },
      },
    } as any
    const input = JSON.parse(JSON.stringify(schema))
    const result = ProviderTransform.schema(geminiModel, schema) as any

    walk(result, (node, path) => {
      const hasCombiner = Array.isArray(node.anyOf) || Array.isArray(node.oneOf) || Array.isArray(node.allOf)
      if (!hasCombiner) {
        return
      }
      const before = path.reduce((acc: any, key) => acc?.[key], input)
      const added = Object.keys(node).filter((key) => !(key in before))
      expect(added).toEqual([])
    })
  })
})

describe("ProviderTransform.schema - gemini non-object properties removal", () => {
  const geminiModel = {
    providerID: "google",
    api: {
      id: "gemini-3-pro",
    },
  } as any

  test("removes properties from non-object types", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "string",
          properties: { invalid: { type: "string" } },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.data.type).toBe("string")
    expect(result.properties.data.properties).toBeUndefined()
  })

  test("removes required from non-object types", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "array",
          items: { type: "string" },
          required: ["invalid"],
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.data.type).toBe("array")
    expect(result.properties.data.required).toBeUndefined()
  })

  test("removes properties and required from nested non-object types", () => {
    const schema = {
      type: "object",
      properties: {
        outer: {
          type: "object",
          properties: {
            inner: {
              type: "number",
              properties: { bad: { type: "string" } },
              required: ["bad"],
            },
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.outer.properties.inner.type).toBe("number")
    expect(result.properties.outer.properties.inner.properties).toBeUndefined()
    expect(result.properties.outer.properties.inner.required).toBeUndefined()
  })

  test("keeps properties and required on object types", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.data.type).toBe("object")
    expect(result.properties.data.properties).toBeDefined()
    expect(result.properties.data.required).toEqual(["name"])
  })

  test("does not affect non-gemini providers", () => {
    const openaiModel = {
      providerID: "openai",
      api: {
        id: "gpt-4",
      },
    } as any

    const schema = {
      type: "object",
      properties: {
        data: {
          type: "string",
          properties: { invalid: { type: "string" } },
        },
      },
    } as any

    const result = ProviderTransform.schema(openaiModel, schema) as any

    expect(result.properties.data.properties).toBeDefined()
  })
})

describe("ProviderTransform.schema - openai supported schema subset", () => {
  const openaiModel = {
    providerID: "openai",
    api: {
      id: "gpt-4.1",
      npm: "@ai-sdk/openai",
    },
  } as any

  test("removes unsupported JSON Schema keywords recursively", () => {
    const result = ProviderTransform.schema(openaiModel, {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "Search",
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
          format: "uri",
          pattern: "^https://",
          minLength: 1,
          maxLength: 100,
          default: "https://example.com",
        },
        count: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          multipleOf: 1,
        },
        createdAt: {
          format: "date-time",
        },
        mode: {
          const: "fast",
        },
        tags: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
        },
        tuple: {
          type: "array",
          items: [
            { type: "number", minimum: 0 },
            { type: "string", pattern: "^ok$" },
          ],
        },
        metadata: {
          type: "object",
          patternProperties: {
            "^x-": { type: "string" },
          },
          additionalProperties: {
            type: "string",
            pattern: "^safe$",
          },
        },
      },
      patternProperties: {
        "^extra": { type: "string" },
      },
      required: ["query"],
      additionalProperties: false,
    } as any) as any

    expect(result).toEqual({
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        count: {
          type: "integer",
        },
        createdAt: {
          type: "string",
        },
        mode: {
          enum: ["fast"],
          type: "string",
        },
        tags: {
          type: "array",
          items: { type: "string" },
        },
        tuple: {
          type: "array",
          items: [{ type: "number" }, { type: "string" }],
        },
        metadata: {
          type: "object",
          properties: {},
          additionalProperties: {
            type: "string",
          },
        },
      },
      required: ["query"],
      additionalProperties: false,
    })
  })

  test("keeps local references and sanitizes definitions", () => {
    const result = ProviderTransform.schema(openaiModel, {
      type: "object",
      properties: {
        value: {
          $ref: "#/$defs/Value",
          description: "Referenced value",
          examples: ["ignored"],
        },
      },
      $defs: {
        Value: {
          type: "string",
          pattern: "^value$",
          description: "Definition description",
        },
        Unused: {
          type: "number",
          minimum: 0,
        },
      },
    } as any) as any

    expect(result.properties.value).toEqual({
      $ref: "#/$defs/Value",
      description: "Referenced value",
    })
    expect(result.$defs).toEqual({
      Value: {
        type: "string",
        description: "Definition description",
      },
      Unused: {
        type: "number",
      },
    })
  })

  test("does not sanitize non-openai providers", () => {
    const result = ProviderTransform.schema(
      {
        providerID: "custom",
        api: {
          id: "test-model",
          npm: "@ai-sdk/openai-compatible",
        },
      } as any,
      {
        type: "object",
        properties: {
          query: {
            type: "string",
            pattern: "^https://",
          },
        },
      } as any,
    ) as any

    expect(result.properties.query.pattern).toBe("^https://")
  })

  test.each([
    ["crewcode", "@ai-sdk/openai"],
    ["custom-openai-compatible", "@ai-sdk/openai"],
  ])("sanitizes %s models using %s", (providerID, npm) => {
    expect(
      ProviderTransform.schema(
        {
          providerID,
          api: {
            id: "custom-model",
            npm,
          },
        } as any,
        {
          type: "object",
          properties: {
            query: {
              type: "string",
              pattern: "^https://",
            },
          },
        } as any,
      ),
    ).toEqual({
      type: "object",
      properties: {
        query: {
          type: "string",
        },
      },
    })
  })
})

describe("ProviderTransform.schema - moonshot $ref siblings", () => {
  const moonshotModel = {
    providerID: "moonshotai",
    api: {
      id: "kimi-k2",
    },
  } as any

  test("removes sibling descriptions from referenced tool parameter schemas", () => {
    const schema = {
      type: "object",
      properties: {
        deviceType: {
          description: "Optional. The type of device that captured the screenshot, e.g. mobile or desktop.",
          enum: ["DEVICE_TYPE_UNSPECIFIED", "MOBILE", "DESKTOP", "TABLET", "AGNOSTIC"],
          type: "string",
        },
        modelId: {
          description: "Optional. The model to use for generation.",
          enum: ["MODEL_ID_UNSPECIFIED", "GEMINI_3_PRO", "GEMINI_3_FLASH", "GEMINI_3_1_PRO"],
          type: "string",
        },
        projectId: {
          description: "Required. The project ID of screens to generate variants for.",
          type: "string",
        },
        prompt: {
          description: "Required. The input text used to generate the variants.",
          type: "string",
        },
        selectedScreenIds: {
          description: "Required. The screen ids of screen to generate variants for.",
          items: {
            type: "string",
          },
          type: "array",
        },
        variantOptions: {
          $ref: "#/$defs/VariantOptions",
          description:
            "Required. The variant options for generation, including the number of variants, creative range, and aspects to focus on.",
        },
      },
      required: ["projectId", "selectedScreenIds", "prompt", "variantOptions"],
      $defs: {
        VariantOptions: {
          description:
            "Configuration options for design variant generation. This message captures all parameters used to generate variants, allowing the configuration to be stored, replayed, or analyzed.",
          properties: {
            aspects: {
              description: "Optional. Specific aspects to focus on. If empty, all aspects may be varied.",
              items: {
                enum: ["VARIANT_ASPECT_UNSPECIFIED", "LAYOUT", "COLOR_SCHEME", "IMAGES", "TEXT_FONT", "TEXT_CONTENT"],
                type: "string",
              },
              type: "array",
            },
            creativeRange: {
              description: "Optional. Creative range for variations. Default: EXPLORE",
              enum: ["CREATIVE_RANGE_UNSPECIFIED", "REFINE", "EXPLORE", "REIMAGINE"],
              type: "string",
            },
            variantCount: {
              description: "Optional. Number of variants to generate (1-5). Default: 3",
              format: "int32",
              type: "integer",
            },
          },
          type: "object",
        },
      },
      description: "Request message for GenerateVariants.",
      additionalProperties: false,
    } as any

    const result = ProviderTransform.schema(moonshotModel, schema) as any

    expect(result.properties.variantOptions).toEqual({
      $ref: "#/$defs/VariantOptions",
    })
    expect(result.$defs.VariantOptions.description).toBe(schema.$defs.VariantOptions.description)
  })

  test("also runs for kimi models outside the moonshot provider", () => {
    const result = ProviderTransform.schema(
      {
        providerID: "openrouter",
        name: "Kimi K2",
        api: {
          id: "moonshotai/kimi-k2",
        },
      } as any,
      {
        type: "object",
        properties: {
          value: {
            $ref: "#/$defs/Value",
            description: "Moonshot rejects this sibling after ref expansion.",
          },
        },
        $defs: {
          Value: {
            description: "Referenced schema description stays here.",
            type: "object",
          },
        },
      } as any,
    ) as any

    expect(result.properties.value).toEqual({
      $ref: "#/$defs/Value",
    })
  })

  test("converts tuple-style array items to a single item schema", () => {
    const result = ProviderTransform.schema(moonshotModel, {
      type: "object",
      properties: {
        codeSpec: {
          type: "object",
          properties: {
            accessibility: {
              type: "object",
              properties: {
                renderedSize: {
                  description: "Rendered size [width, height] in px",
                  type: "array",
                  items: [{ type: "number" }, { type: "number" }],
                  minItems: 2,
                  maxItems: 2,
                },
              },
            },
          },
        },
      },
    } as any) as any

    expect(result.properties.codeSpec.properties.accessibility.properties.renderedSize.items).toEqual({
      type: "number",
    })
  })
})

describe("ProviderTransform.message - Mistral tool call IDs", () => {
  test.each(["codestral-latest", "pixtral-large-latest", "open-mixtral-8x22b"])(
    "normalizes IDs for custom OpenAI-compatible %s models",
    (id) => {
      const result = ProviderTransform.message(
        [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "toolu_01CBhTTz95qkd9LJMdC9sf8t",
                toolName: "read",
                input: { filePath: "/tmp/test" },
              },
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "toolu_01CBhTTz95qkd9LJMdC9sf8t",
                toolName: "read",
                output: { type: "text", value: "test" },
              },
            ],
          },
        ] as any,
        {
          id: `custom/${id}`,
          providerID: "custom",
          api: {
            id,
            url: "https://example.com/v1",
            npm: "@ai-sdk/openai-compatible",
          },
        } as any,
        {},
      )

      expect(result).toMatchObject([
        { role: "assistant", content: [{ type: "tool-call", toolCallId: "toolu01CB" }] },
        { role: "tool", content: [{ type: "tool-result", toolCallId: "toolu01CB" }] },
      ])
    },
  )
})

describe("ProviderTransform.message - DeepSeek reasoning content", () => {
  test("DeepSeek with tool calls includes reasoning_content in providerOptions", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Let me think about this..." },
          {
            type: "tool-call",
            toolCallId: "test",
            toolName: "bash",
            input: { command: "echo hello" },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(
      msgs,
      {
        id: ModelV2.ID.make("deepseek/deepseek-chat"),
        providerID: ProviderV2.ID.make("deepseek"),
        api: {
          id: "deepseek-chat",
          url: "https://api.deepseek.com",
          npm: "@ai-sdk/openai-compatible",
        },
        name: "DeepSeek Chat",
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: false,
          toolcall: true,
          input: { text: true, audio: false, image: false, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: {
            field: "reasoning_content",
          },
        },
        cost: {
          input: 0.001,
          output: 0.002,
          cache: { read: 0.0001, write: 0.0002 },
        },
        limit: {
          context: 128000,
          output: 8192,
        },
        status: "active",
        options: {},
        headers: {},
        release_date: "2023-04-01",
      },
      {},
    )

    expect(result).toHaveLength(1)
    expect(result[0].content).toEqual([
      {
        type: "tool-call",
        toolCallId: "test",
        toolName: "bash",
        input: { command: "echo hello" },
      },
    ])
    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBe("Let me think about this...")
  })

  test("Non-DeepSeek providers leave reasoning content unchanged", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Should not be processed" },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(
      msgs,
      {
        id: ModelV2.ID.make("openai/gpt-4"),
        providerID: ProviderV2.ID.make("openai"),
        api: {
          id: "gpt-4",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        name: "GPT-4",
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: true,
          toolcall: true,
          input: { text: true, audio: false, image: true, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        cost: {
          input: 0.03,
          output: 0.06,
          cache: { read: 0.001, write: 0.002 },
        },
        limit: {
          context: 128000,
          output: 4096,
        },
        status: "active",
        options: {},
        headers: {},
        release_date: "2023-04-01",
      },
      {},
    )

    expect(result[0].content).toEqual([
      { type: "reasoning", text: "Should not be processed" },
      { type: "text", text: "Answer" },
    ])
    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBeUndefined()
  })
})

describe("ProviderTransform.message - surrogate sanitization", () => {
  const model = {
    id: "test/test-model",
    providerID: "test",
    api: {
      id: "test-model",
      url: "https://api.test.com",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
    limit: { context: 128000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("replaces lone surrogates in model-visible text", () => {
    const lone = "\uD83D"
    const valid = "🚀"
    const sanitized = "�"
    const text = (label: string) => `${label} ${lone} and ${valid}`
    const expected = (label: string) => `${label} ${sanitized} and ${valid}`
    const msgs = [
      { role: "system", content: text("system") },
      { role: "user", content: text("user string") },
      {
        role: "user",
        content: [
          { type: "text", text: text("user text") },
          { type: "image", image: "data:image/png;base64,abcd" },
        ],
      },
      { role: "assistant", content: text("assistant string") },
      {
        role: "assistant",
        content: [
          { type: "text", text: text("assistant text") },
          { type: "reasoning", text: text("assistant reasoning") },
          { type: "tool-call", toolCallId: "call-1", toolName: "Read", input: { filePath: ".crewcode/tool/emoji.ts" } },
          {
            type: "tool-result",
            toolCallId: "call-2",
            toolName: "Read",
            output: { type: "text", value: text("assistant tool text") },
          },
          {
            type: "tool-result",
            toolCallId: "call-3",
            toolName: "Read",
            output: { type: "error-text", value: text("assistant tool error") },
          },
          {
            type: "tool-result",
            toolCallId: "call-4",
            toolName: "Read",
            output: { type: "content", value: [{ type: "text", text: text("assistant tool content") }] },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-5",
            toolName: "Read",
            output: { type: "text", value: text("tool text") },
          },
          {
            type: "tool-result",
            toolCallId: "call-6",
            toolName: "Read",
            output: { type: "error-text", value: text("tool error") },
          },
          {
            type: "tool-result",
            toolCallId: "call-7",
            toolName: "Read",
            output: { type: "content", value: [{ type: "text", text: text("tool content") }] },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    expect(result[0].content).toBe(expected("system"))
    expect(result[1].content).toBe(expected("user string"))
    expect(result[2].content[0].text).toBe(expected("user text"))
    expect(result[3].content).toBe(expected("assistant string"))
    expect(result[4].content[0].text).toBe(expected("assistant text"))
    expect(result[4].content[1].text).toBe(expected("assistant reasoning"))
    expect(result[4].content[3].output.value).toBe(expected("assistant tool text"))
    expect(result[4].content[4].output.value).toBe(expected("assistant tool error"))
    expect(result[4].content[5].output.value[0].text).toBe(expected("assistant tool content"))
    expect(result[5].content[0].output.value).toBe(expected("tool text"))
    expect(result[5].content[1].output.value).toBe(expected("tool error"))
    expect(result[5].content[2].output.value[0].text).toBe(expected("tool content"))
    expect(result[2].content[1]).toEqual({ type: "image", image: "data:image/png;base64,abcd" })
  })
})

describe("ProviderTransform.message - strip openai metadata when store=false", () => {
  const openaiModel = {
    id: "openai/gpt-5",
    providerID: "openai",
    api: {
      id: "gpt-5",
      url: "https://api.openai.com",
      npm: "@ai-sdk/openai",
    },
    name: "GPT-5",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.03, output: 0.06, cache: { read: 0.001, write: 0.002 } },
    limit: { context: 128000, output: 4096 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("strips OpenAI itemId and preserves reasoningEncryptedContent when store=false", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "thinking...",
            providerOptions: {
              openai: {
                itemId: "rs_123",
                reasoningEncryptedContent: "encrypted",
              },
            },
          },
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_456",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, openaiModel, { store: false }) as any[]

    expect(result).toHaveLength(1)
    expect(result[0].content[0].providerOptions?.openai?.itemId).toBeUndefined()
    expect(result[0].content[0].providerOptions?.openai?.reasoningEncryptedContent).toBe("encrypted")
    expect(result[0].content[1].providerOptions?.openai?.itemId).toBeUndefined()
  })

  test("uses the SDK package namespace rather than provider ID", () => {
    const zenModel = {
      ...openaiModel,
      providerID: "zen",
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "thinking...",
            providerOptions: {
              openai: {
                itemId: "rs_123",
                reasoningEncryptedContent: "encrypted",
              },
            },
          },
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_456",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, zenModel, { store: false }) as any[]

    expect(result).toHaveLength(1)
    expect(result[0].content[0].providerOptions?.openai?.itemId).toBeUndefined()
    expect(result[0].content[0].providerOptions?.openai?.reasoningEncryptedContent).toBe("encrypted")
    expect(result[0].content[1].providerOptions?.openai?.itemId).toBeUndefined()
  })

  test("preserves other OpenAI options", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_123",
                otherOption: "value",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, openaiModel, { store: false }) as any[]

    expect(result[0].content[0].providerOptions?.openai?.itemId).toBeUndefined()
    expect(result[0].content[0].providerOptions?.openai?.otherOption).toBe("value")
  })

  test("preserves metadata for openai package when store is true", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_123",
              },
            },
          },
        ],
      },
    ] as any[]

    // openai package preserves itemId regardless of store value
    const result = ProviderTransform.message(msgs, openaiModel, { store: true }) as any[]

    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_123")
  })

  test("preserves metadata for non-openai packages when store is false", () => {
    const compatibleModel = {
      ...openaiModel,
      providerID: "custom",
      api: {
        id: "test-model",
        url: "https://api.example.com/v1",
        npm: "@ai-sdk/openai-compatible",
      },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_123",
              },
            },
          },
        ],
      },
    ] as any[]

    // store=false preserves metadata for non-openai packages
    const result = ProviderTransform.message(msgs, compatibleModel, { store: false }) as any[]

    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_123")
  })

  test("preserves metadata using providerID key when store is false", () => {
    const crewcodeModel = {
      ...openaiModel,
      providerID: "crewcode",
      api: {
        id: "crewcode-test",
        url: "https://api.crewcode.ai",
        npm: "@ai-sdk/openai-compatible",
      },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              crewcode: {
                itemId: "msg_123",
                otherOption: "value",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, crewcodeModel, { store: false }) as any[]

    expect(result[0].content[0].providerOptions?.crewcode?.itemId).toBe("msg_123")
    expect(result[0].content[0].providerOptions?.crewcode?.otherOption).toBe("value")
  })

  test("preserves itemId across all providerOptions keys", () => {
    const crewcodeModel = {
      ...openaiModel,
      providerID: "crewcode",
      api: {
        id: "crewcode-test",
        url: "https://api.crewcode.ai",
        npm: "@ai-sdk/openai-compatible",
      },
    }
    const msgs = [
      {
        role: "assistant",
        providerOptions: {
          openai: { itemId: "msg_root" },
          crewcode: { itemId: "msg_crewcode" },
          extra: { itemId: "msg_extra" },
        },
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: { itemId: "msg_openai_part" },
              crewcode: { itemId: "msg_crewcode_part" },
              extra: { itemId: "msg_extra_part" },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, crewcodeModel, { store: false }) as any[]

    expect(result[0].providerOptions?.openai?.itemId).toBe("msg_root")
    expect(result[0].providerOptions?.crewcode?.itemId).toBe("msg_crewcode")
    expect(result[0].providerOptions?.extra?.itemId).toBe("msg_extra")
    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_openai_part")
    expect(result[0].content[0].providerOptions?.crewcode?.itemId).toBe("msg_crewcode_part")
    expect(result[0].content[0].providerOptions?.extra?.itemId).toBe("msg_extra_part")
  })

  test("does not strip metadata for non-openai packages when store is not false", () => {
    const compatibleModel = {
      ...openaiModel,
      providerID: "custom",
      api: {
        id: "test-model",
        url: "https://api.example.com/v1",
        npm: "@ai-sdk/openai-compatible",
      },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_123",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, compatibleModel, {}) as any[]

    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_123")
  })
})

describe("ProviderTransform.message - providerOptions key remapping", () => {
  const createModel = (providerID: string, npm: string) =>
    ({
      id: `${providerID}/test-model`,
      providerID,
      api: {
        id: "test-model",
        url: "https://api.test.com",
        npm,
      },
      name: "Test Model",
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
      limit: { context: 128000, output: 8192 },
      status: "active",
      options: {},
      headers: {},
    }) as any
})

describe("ProviderTransform.temperature - Cohere North", () => {
  test("defaults north-mini-code models to 1.0", () => {
    expect(
      ProviderTransform.temperature({
        id: "cohere/North-Mini-Code-1-0-latest",
        api: { id: "North-Mini-Code-1-0-latest" },
      } as any),
    ).toBe(1.0)
  })
})

describe("ProviderTransform sampling defaults - Qwen", () => {
  test.each(["Qwen3.8-27B", "qwen3-coder-30b-a3b-instruct"])('leaves sampling unset for "%s"', (id) => {
    const model = {
      id: `custom/${id}`,
      api: { id },
    } as any

    expect(ProviderTransform.temperature(model)).toBeUndefined()
    expect(ProviderTransform.topP(model)).toBeUndefined()
    expect(ProviderTransform.topK(model)).toBeUndefined()
  })
})

describe("ProviderTransform sampling defaults - Gemini", () => {
  const model = (id: string) =>
    ({
      id: `google/${id}`,
      api: { id },
    }) as any

  const alias = (id: string, apiID: string) =>
    ({
      id,
      api: { id: apiID },
    }) as any

  test.each([
    "gemini-3.5-flash-lite",
    "gemini-3-5-flash-lite",
    "gemini-3.6-flash",
    "gemini-3-6-flash",
    "gemini-4-pro",
    "gemini-future",
  ])("omits deprecated sampling controls for %s", (id) => {
    expect(ProviderTransform.temperature(model(id))).toBeUndefined()
    expect(ProviderTransform.topP(model(id))).toBeUndefined()
    expect(ProviderTransform.topK(model(id))).toBeUndefined()
  })

  test.each([
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash-lite",
    "gemini-2-5-flash-lite",
    "gemini-3-flash-preview",
    "gemini-3-pro-image",
    "gemini-3.1-flash-lite",
    "gemini-3.1-pro-preview",
    "gemini-3-1-pro-preview",
    "gemini-3.5-flash",
    "gemini-3-5-flash",
  ])("preserves sampling defaults for %s", (id) => {
    expect(ProviderTransform.temperature(model(id))).toBe(1)
    expect(ProviderTransform.topP(model(id))).toBe(0.95)
    expect(ProviderTransform.topK(model(id))).toBe(64)
  })

  test("uses the API model ID for configured aliases", () => {
    const deprecated = alias("google/gemini-3.5-flash", "google/gemini-3.6-flash")
    expect(ProviderTransform.temperature(deprecated)).toBeUndefined()
    expect(ProviderTransform.topP(deprecated)).toBeUndefined()
    expect(ProviderTransform.topK(deprecated)).toBeUndefined()

    const supported = alias("my-gemini", "google/gemini-2.5-flash")
    expect(ProviderTransform.temperature(supported)).toBe(1)
    expect(ProviderTransform.topP(supported)).toBe(0.95)
    expect(ProviderTransform.topK(supported)).toBe(64)
  })
})

describe("ProviderTransform sampling defaults - DeepSeek", () => {
  const model = (providerID: string, id: string) =>
    ({
      id: `${providerID}/${id}`,
      providerID,
      api: { id },
    }) as any

  test.each([
    ["deepseek", "deepseek-v4-flash"],
    ["crewcode", "deepseek-v4-flash"],
    ["crewcode-go", "deepseek-v4-flash"],
    ["openrouter", "deepseek/deepseek-v4-flash-0731"],
    ["ollama-cloud", "deepseek-v4-flash:0731"],
  ])("defaults top_p for %s/%s", (providerID, id) => {
    expect(ProviderTransform.temperature(model(providerID, id))).toBeUndefined()
    expect(ProviderTransform.topP(model(providerID, id))).toBe(0.95)
    expect(ProviderTransform.topK(model(providerID, id))).toBeUndefined()
  })

  test.each([
    ["openrouter", "deepseek/deepseek-v4-flash"],
    ["vercel", "deepseek/deepseek-v4-flash"],
    ["custom", "deepseek-ai/DeepSeek-V4-Flash"],
  ])("preserves legacy defaults for %s/%s", (providerID, id) => {
    expect(ProviderTransform.temperature(model(providerID, id))).toBeUndefined()
    expect(ProviderTransform.topP(model(providerID, id))).toBeUndefined()
    expect(ProviderTransform.topK(model(providerID, id))).toBeUndefined()
  })
})

describe("ProviderTransform.reasoningVariants", () => {
  const model = (reasoning_options: ModelsDev.Model["reasoning_options"]) => ({ reasoning_options }) as ModelsDev.Model
  const target = (npm: string, id = "test-model", family = "") =>
    ({
      id,
      providerID: "test",
      family,
      api: { id, npm, url: "" },
      capabilities: { reasoning: true },
      limit: { output: 64_000 },
    }) as any

  test("respects explicitly empty reasoning options", () => {
    expect(ProviderTransform.reasoningVariants(model([]), target("@ai-sdk/openai"))).toEqual({})
  })

  test.each([
    ["@openrouter/ai-sdk-provider", { reasoning: { effort: "high" } }],
    [
      "@ai-sdk/openai",
      {
        reasoningEffort: "high",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    ],
    ["@ai-sdk/openai-compatible", { reasoningEffort: "high" }],
  ])("converts effort for %s", (npm, expected) => {
    expect(ProviderTransform.reasoningVariants(model([{ type: "effort", values: ["high"] }]), target(npm))).toEqual({
      high: expected,
    })
  })

  test("converts token budgets for @openrouter/ai-sdk-provider", () => {
    const variants = ProviderTransform.reasoningVariants(
      model([{ type: "budget_tokens", min: 1_024 }]),
      target("@openrouter/ai-sdk-provider"),
    )
    expect(variants?.high).toEqual({ reasoning: { max_tokens: 16_000 } })
    expect(Object.keys(variants ?? {})).toEqual(["high", "max"])
  })

  test("generates bounded high and max token budgets", () => {
    expect(
      ProviderTransform.reasoningVariants(
        model([{ type: "budget_tokens", min: 1_024, max: 64_000 }]),
        target("@openrouter/ai-sdk-provider"),
      ),
    ).toEqual({
      high: { reasoning: { max_tokens: 16_000 } },
      max: { reasoning: { max_tokens: 31_999 } },
    })
  })

  test("caps token budgets below the model output limit", () => {
    const openrouter = target("@openrouter/ai-sdk-provider")
    openrouter.limit.output = 5_000
    expect(
      ProviderTransform.reasoningVariants(model([{ type: "budget_tokens", min: 1_024, max: 64_000 }]), openrouter),
    ).toEqual({
      high: { reasoning: { max_tokens: 2_500 } },
      max: { reasoning: { max_tokens: 4_999 } },
    })
  })

  test("preserves explicit inclusive budget maxima", () => {
    expect(
      ProviderTransform.reasoningVariants(
        model([{ type: "budget_tokens", min: 1_024, max: 24_576 }]),
        target("@openrouter/ai-sdk-provider", "google/gemini-2.5-pro"),
      ),
    ).toEqual({
      high: { reasoning: { max_tokens: 12_288 } },
      max: { reasoning: { max_tokens: 24_576 } },
    })
  })

  test("maps null effort to none", () => {
    expect(
      ProviderTransform.reasoningVariants(model([{ type: "effort", values: [null] }]), target("@ai-sdk/openai")),
    ).toEqual({
      none: {
        reasoningEffort: "none",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    })
  })

  test("prefers effort options over token budgets", () => {
    expect(
      ProviderTransform.reasoningVariants(
        model([
          { type: "budget_tokens", min: 1_024, max: 64_000 },
          { type: "effort", values: ["low"] },
        ]),
        target("@ai-sdk/openai"),
      ),
    ).toEqual({
      low: {
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    })
  })

  test("leaves unsupported toggle options for heuristic fallback", () => {
    expect(ProviderTransform.reasoningVariants(model([{ type: "toggle" }]), target("@ai-sdk/openai"))).toBeUndefined()
  })
})

describe("ProviderTransform.variants", () => {
  const createMockModel = (overrides: Partial<any> = {}): any => ({
    id: "test/test-model",
    providerID: "test",
    api: {
      id: "test-model",
      url: "https://api.test.com",
      npm: "@ai-sdk/openai",
    },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0.001,
      output: 0.002,
      cache: { read: 0.0001, write: 0.0002 },
    },
    limit: {
      context: 200_000,
      output: 64_000,
    },
    status: "active",
    options: {},
    headers: {},
    release_date: "2024-01-01",
    ...overrides,
  })

  test("returns empty object when model has no reasoning capabilities", () => {
    const model = createMockModel({
      capabilities: { reasoning: false },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("deepseek returns empty object", () => {
    const model = createMockModel({
      id: "deepseek/deepseek-chat",
      providerID: "deepseek",
      api: {
        id: "deepseek-chat",
        url: "https://api.deepseek.com",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("minimax returns empty object", () => {
    const model = createMockModel({
      id: "minimax/minimax-model",
      providerID: "minimax",
      api: {
        id: "minimax-model",
        url: "https://api.minimax.com",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("minimax m3 using openai-compatible returns thinking toggles", () => {
    const model = createMockModel({
      id: "minimax/minimax-m3",
      providerID: "minimax",
      api: {
        id: "minimax-m3",
        url: "https://api.minimax.com/v1",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    expect(ProviderTransform.variants(model)).toEqual({
      none: { thinking: { type: "disabled" } },
      thinking: { thinking: { type: "adaptive" } },
    })
  })

  test.each(["nvidia", "lilac"])("%s minimax m3 returns chat template thinking toggles", (providerID) => {
    const model = createMockModel({
      id: `${providerID}/minimaxai/minimax-m3`,
      providerID,
      api: {
        id: "minimaxai/minimax-m3",
        url: "https://api.example.com/v1",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    expect(ProviderTransform.variants(model)).toEqual({
      none: { chat_template_kwargs: { thinking_mode: "disabled" } },
      thinking: { chat_template_kwargs: { thinking_mode: "enabled" } },
    })
  })

  test("glm returns empty object", () => {
    const model = createMockModel({
      id: "glm/glm-4",
      providerID: "glm",
      api: {
        id: "glm-4",
        url: "https://api.glm.com",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("glm-5.2 returns native effort variants for openai-compatible providers", () => {
    const model = createMockModel({
      id: "zhipuai/glm-5.2",
      providerID: "zhipuai",
      api: {
        id: "glm-5.2",
        url: "https://open.bigmodel.cn/api/paas/v4",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    expect(ProviderTransform.variants(model)).toEqual({
      high: { reasoningEffort: "high" },
      max: { reasoningEffort: "max" },
    })
  })

  test("recognizes GLM-5.2 provider model IDs", () => {
    for (const id of ["accounts/fireworks/models/glm-5p2", "zai-org-glm-5-2", "umans-glm-5.2"]) {
      const model = createMockModel({
        id: `test/${id}`,
        api: {
          id,
          url: "https://api.test.com",
          npm: "@ai-sdk/openai-compatible",
        },
      })
      expect(ProviderTransform.variants(model)).toEqual({
        high: { reasoningEffort: "high" },
        max: { reasoningEffort: "max" },
      })
    }
  })

  test("recognizes GLM-5.2 from the API ID when the configured model ID is an alias", () => {
    const model = createMockModel({
      id: "custom/my-glm",
      api: {
        id: "accounts/fireworks/models/glm-5p2",
        url: "https://api.fireworks.ai/inference/v1",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    expect(ProviderTransform.variants(model)).toEqual({
      high: { reasoningEffort: "high" },
      max: { reasoningEffort: "max" },
    })
  })

  test("glm-5.2 returns openrouter effort variants for openrouter", () => {
    const model = createMockModel({
      id: "openrouter/z-ai/glm-5.2",
      providerID: "openrouter",
      api: {
        id: "z-ai/glm-5.2",
        url: "https://openrouter.ai/api/v1",
        npm: "@openrouter/ai-sdk-provider",
      },
    })
    expect(ProviderTransform.variants(model)).toEqual({
      high: { reasoning: { effort: "high" } },
      xhigh: { reasoning: { effort: "xhigh" } },
    })
  })

  describe("@openrouter/ai-sdk-provider", () => {
    test("returns widely supported efforts for other reasoning models", () => {
      const model = createMockModel({
        id: "openrouter/test-model",
        providerID: "openrouter",
        api: {
          id: "test-model",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.medium).toEqual({ reasoning: { effort: "medium" } })
    })

    test("gpt models return OPENAI_EFFORTS with reasoning", () => {
      const model = createMockModel({
        id: "openrouter/gpt-4",
        providerID: "openrouter",
        api: {
          id: "gpt-4",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
      expect(result.low).toEqual({ reasoning: { effort: "low" } })
      expect(result.high).toEqual({ reasoning: { effort: "high" } })
    })

    for (const testCase of [
      { id: "openai/o3-mini", efforts: ["none", "minimal", "low", "medium", "high", "xhigh"] },
      { id: "openai/gpt-5.4", efforts: ["none", "low", "medium", "high", "xhigh"] },
      { id: "openai/gpt-5-pro", efforts: ["high"] },
      { id: "openai/gpt-5.5-pro", efforts: ["medium", "high", "xhigh"] },
      { id: "openai/gpt-5.2-codex", efforts: ["low", "medium", "high", "xhigh"] },
      { id: "openai/gpt-5.3-codex", efforts: ["none", "low", "medium", "high", "xhigh"] },
      { id: "openai/gpt-5.3-codex-max", efforts: ["none", "low", "medium", "high", "xhigh"] },
      { id: "openai/gpt-5-chat-latest", efforts: [] },
      { id: "openai/gpt-5.2-chat-latest", efforts: ["medium"] },
    ]) {
      test(`${testCase.id} returns supported OpenAI reasoning efforts`, () => {
        const result = ProviderTransform.variants(
          createMockModel({
            id: testCase.id,
            providerID: "openrouter",
            api: {
              id: testCase.id,
              url: "https://openrouter.ai",
              npm: "@openrouter/ai-sdk-provider",
            },
          }),
        )
        expect(Object.keys(result)).toEqual(testCase.efforts)
      })
    }

    test("gemini-3 returns widely supported efforts with reasoning", () => {
      const model = createMockModel({
        id: "openrouter/gemini-3-5-pro",
        providerID: "openrouter",
        api: {
          id: "gemini-3-5-pro",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
    })

    test("grok-4 uses the provider's standard efforts", () => {
      const model = createMockModel({
        id: "openrouter/grok-4",
        providerID: "openrouter",
        api: {
          id: "grok-4",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.medium).toEqual({ reasoning: { effort: "medium" } })
    })

    test("grok-3-mini returns low and high with reasoning", () => {
      const model = createMockModel({
        id: "openrouter/grok-3-mini",
        providerID: "openrouter",
        api: {
          id: "grok-3-mini",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "high"])
      expect(result.low).toEqual({ reasoning: { effort: "low" } })
      expect(result.high).toEqual({ reasoning: { effort: "high" } })
    })
  })

  describe("grok-3-mini on @ai-sdk/openai-compatible", () => {
    test("grok-3-mini returns low and high with reasoningEffort", () => {
      const model = createMockModel({
        id: "xai/grok-3-mini",
        providerID: "xai",
        api: {
          id: "grok-3-mini",
          url: "https://api.x.ai",
          npm: "@ai-sdk/openai-compatible",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/openai-compatible", () => {
    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "custom-provider/custom-model",
        providerID: "custom-provider",
        api: {
          id: "custom-model",
          url: "https://api.custom.com",
          npm: "@ai-sdk/openai-compatible",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })

    test("north-mini-code-1-0 returns only none and high", () => {
      const model = createMockModel({
        id: "cohere/north-mini-code-1-0",
        providerID: "cohere",
        api: {
          id: "North-Mini-Code-1-0-latest",
          url: "https://api.cohere.com/compatibility/v1",
          npm: "@ai-sdk/openai-compatible",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({
        none: { reasoningEffort: "none" },
        high: { reasoningEffort: "high" },
      })
    })
  })

  describe("@ai-sdk/openai", () => {
    test("gpt-5-pro returns only high effort", () => {
      const model = createMockModel({
        id: "gpt-5-pro",
        providerID: "openai",
        api: {
          id: "gpt-5-pro",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["high"])
    })

    test("standard openai models return custom efforts with reasoningSummary", () => {
      const model = createMockModel({
        id: "gpt-5",
        providerID: "openai",
        api: {
          id: "gpt-5",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        release_date: "2024-06-01",
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["minimal", "low", "medium", "high"])
      expect(result.low).toEqual({
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      })
    })

    test("models after 2025-11-13 include 'none' effort", () => {
      const model = createMockModel({
        id: "gpt-5-nano",
        providerID: "openai",
        api: {
          id: "gpt-5-nano",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        release_date: "2025-11-14",
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high"])
    })

    test("models after 2025-12-04 include 'xhigh' effort", () => {
      const model = createMockModel({
        id: "openai/gpt-5-reasoning",
        providerID: "openai",
        api: {
          id: "gpt-5-reasoning",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        release_date: "2025-12-05",
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
    })

    for (const testCase of [
      { id: "o1", releaseDate: "2024-12-17", efforts: ["low", "medium", "high"] },
      { id: "o1-pro", releaseDate: "2025-03-19", efforts: ["low", "medium", "high"] },
      { id: "o3", releaseDate: "2025-04-16", efforts: ["low", "medium", "high"] },
      { id: "o3-mini", releaseDate: "2025-01-31", efforts: ["low", "medium", "high"] },
      { id: "o3-pro", releaseDate: "2025-06-10", efforts: ["low", "medium", "high"] },
      { id: "o4-mini", releaseDate: "2025-04-16", efforts: ["low", "medium", "high"] },
      { id: "o3-deep-research", releaseDate: "2025-06-26", efforts: ["medium"] },
      { id: "o4-mini-deep-research", releaseDate: "2025-06-26", efforts: ["medium"] },
      { id: "gpt-5.1", releaseDate: "2025-11-13", efforts: ["none", "low", "medium", "high"] },
      { id: "gpt-5.4", releaseDate: "2026-03-05", efforts: ["none", "low", "medium", "high", "xhigh"] },
      {
        id: "gpt-5.5",
        modelID: "gpt-5-5",
        releaseDate: "2026-04-23",
        efforts: ["none", "low", "medium", "high", "xhigh"],
      },
      { id: "gpt-5.4-pro", releaseDate: "2026-03-05", efforts: ["medium", "high", "xhigh"] },
      { id: "gpt-5.5-pro", releaseDate: "2026-04-23", efforts: ["medium", "high", "xhigh"] },
      { id: "gpt-5-codex", releaseDate: "2025-09-23", efforts: ["low", "medium", "high"] },
      { id: "gpt-5.1-codex", releaseDate: "2025-11-13", efforts: ["low", "medium", "high"] },
      { id: "gpt-5.1-codex-max", releaseDate: "2025-11-13", efforts: ["low", "medium", "high", "xhigh"] },
      { id: "gpt-5.2-codex", releaseDate: "2025-12-11", efforts: ["low", "medium", "high", "xhigh"] },
      { id: "gpt-5.3-codex", releaseDate: "2026-01-22", efforts: ["none", "low", "medium", "high", "xhigh"] },
      { id: "gpt-5.3-codex-max", releaseDate: "2026-01-22", efforts: ["none", "low", "medium", "high", "xhigh"] },
      { id: "gpt-5-chat-latest", releaseDate: "2025-08-07", efforts: [] },
      { id: "gpt-5.1-chat-latest", releaseDate: "2025-11-13", efforts: ["medium"] },
      { id: "gpt-5.2-chat-latest", releaseDate: "2025-12-11", efforts: ["medium"] },
    ]) {
      test(`${testCase.id} returns supported reasoning efforts`, () => {
        const result = ProviderTransform.variants(
          createMockModel({
            id: testCase.modelID ?? testCase.id,
            providerID: "openai",
            api: {
              id: testCase.id,
              url: "https://api.openai.com",
              npm: "@ai-sdk/openai",
            },
            release_date: testCase.releaseDate,
          }),
        )
        expect(Object.keys(result)).toEqual(testCase.efforts)
      })
    }

    test("gpt-50 (lookalike) does not get gpt-5 family treatment", () => {
      const model = createMockModel({
        id: "gpt-50",
        providerID: "openai",
        api: {
          id: "gpt-50",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        release_date: "2024-01-01",
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
    })
  })
})

describe("ProviderTransform.smallOptions - gpt-5 chat/search", () => {
  const createModel = (apiId: string) => {
    const model = {
      id: `openai/${apiId}`,
      providerID: "openai",
      api: {
        id: apiId,
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
      capabilities: { reasoning: true },
      limit: { output: 64_000 },
      release_date: "2026-01-01",
    } as any
    model.variants = ProviderTransform.variants(model)
    return model
  }

  for (const testCase of [
    { id: "gpt-5-chat-latest", options: { store: false } },
    {
      id: "gpt-5.1-chat-latest",
      options: {
        store: false,
        reasoningEffort: "medium",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    },
    {
      id: "gpt-5.2-chat-latest",
      options: {
        store: false,
        reasoningEffort: "medium",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    },
    {
      id: "gpt-5-search-api",
      options: {
        store: false,
        reasoningEffort: "none",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    },
  ]) {
    test(`${testCase.id} returns only supported small options`, () => {
      expect(ProviderTransform.smallOptions(createModel(testCase.id))).toEqual(testCase.options)
    })
  }
})

test("ProviderTransform.smallOptions preserves the weakest OpenRouter reasoning effort", () => {
  expect(
    ProviderTransform.smallOptions({
      providerID: "openrouter",
      api: {
        id: "google/gemini-3.5-flash",
        npm: "@openrouter/ai-sdk-provider",
      },
      variants: {
        low: { reasoning: { effort: "low" } },
        medium: { reasoning: { effort: "medium" } },
        high: { reasoning: { effort: "high" } },
      },
    } as any),
  ).toEqual({ reasoning: { effort: "low" } })
})

describe("ProviderTransform.message - cache control for Claude models", () => {
  const cacheOptions = {
    openrouter: { cacheControl: { type: "ephemeral" } },
    openaiCompatible: { cache_control: { type: "ephemeral" } },
  }

  const createModel = (npm: string, providerID: string, apiId: string) =>
    ({
      id: `${providerID}/${apiId}`,
      providerID,
      api: { id: apiId, url: "https://example.com/v1", npm },
      name: apiId,
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
      limit: { context: 200_000, output: 8192 },
      status: "active",
      options: {},
      headers: {},
    }) as any

  test("marks string messages of a Claude model routed through OpenRouter", () => {
    const model = createModel("@openrouter/ai-sdk-provider", "openrouter", "anthropic/claude-sonnet-4")
    const msgs = [
      { role: "system", content: "You are a helpful assistant" },
      { role: "user", content: "Hello" },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    expect(result[0].providerOptions).toEqual(cacheOptions)
    expect(result[1].providerOptions).toEqual(cacheOptions)
  })

  test("marks the last content part of array messages on an OpenAI-compatible endpoint", () => {
    const model = createModel("@ai-sdk/openai-compatible", "custom", "claude-sonnet-4")
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "First" },
          { type: "text", text: "Second" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    expect(result[0].content[0].providerOptions).toBeUndefined()
    expect(result[0].content[1].providerOptions).toEqual(cacheOptions)
  })

  test("does not mark messages of non-Claude models", () => {
    const model = createModel("@ai-sdk/openai-compatible", "custom", "llama-3.3-70b")
    const msgs = [{ role: "user", content: "Hello" }] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    expect(result[0].providerOptions).toBeUndefined()
  })

  test("marks Gemini and Qwen on OpenRouter, where they need explicit breakpoints", () => {
    for (const apiId of ["google/gemini-2.5-pro", "qwen/qwen3-coder"]) {
      const model = createModel("@openrouter/ai-sdk-provider", "openrouter", apiId)
      const result = ProviderTransform.message([{ role: "user", content: "Hello" }] as any[], model, {}) as any[]
      expect(result[0].providerOptions).toEqual(cacheOptions)
    }
  })

  test("leaves alone the models that cache on their own", () => {
    for (const apiId of ["openai/gpt-5.4", "deepseek/deepseek-v4", "x-ai/grok-4"]) {
      const model = createModel("@openrouter/ai-sdk-provider", "openrouter", apiId)
      const result = ProviderTransform.message([{ role: "user", content: "Hello" }] as any[], model, {}) as any[]
      expect(result[0].providerOptions).toBeUndefined()
    }
  })

  test("Gemini on a generic OpenAI-compatible endpoint is not marked unless the provider asks", () => {
    const model = createModel("@ai-sdk/openai-compatible", "custom", "gemini-2.5-pro")
    const msgs = () => [{ role: "user", content: "Hello" }] as any[]
    expect((ProviderTransform.message(msgs(), model, {}) as any[])[0].providerOptions).toBeUndefined()
    expect((ProviderTransform.message(msgs(), model, {}, { setCacheControl: true }) as any[])[0].providerOptions).toEqual(
      cacheOptions,
    )
  })

  test("setCacheControl lets a custom endpoint that serves Claude under another name opt in", () => {
    const model = createModel("@ai-sdk/openai-compatible", "gateway", "my-sonnet")
    const result = ProviderTransform.message([{ role: "user", content: "Hello" }] as any[], model, {}, {
      setCacheControl: true,
    }) as any[]
    expect(result[0].providerOptions).toEqual(cacheOptions)
  })

  test("setCacheControl false turns it off for a Claude model", () => {
    const model = createModel("@ai-sdk/openai-compatible", "gateway", "claude-sonnet-4")
    const result = ProviderTransform.message([{ role: "user", content: "Hello" }] as any[], model, {}, {
      setCacheControl: false,
    }) as any[]
    expect(result[0].providerOptions).toBeUndefined()
  })
})
