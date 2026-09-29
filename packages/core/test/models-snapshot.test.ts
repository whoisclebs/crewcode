import { describe, expect, test } from "bun:test"
import { buildSnapshot } from "../script/models-snapshot"

const model = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  release_date: "2026-01-01",
  attachment: false,
  reasoning: true,
  temperature: false,
  tool_call: true,
  cost: { input: 5, output: 15 },
  limit: { context: 1_000_000, output: 64_000 },
  description: "dropped by the schema",
  ...extra,
})

const source = () => ({
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    env: ["OPENROUTER_API_KEY"],
    npm: "@openrouter/ai-sdk-provider",
    api: "https://openrouter.ai/api/v1",
    models: { "acme/one": model("acme/one") },
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    env: ["OPENAI_API_KEY"],
    npm: "@ai-sdk/openai",
    models: Object.fromEntries(
      [
        "gpt-4o",
        "gpt-5.2",
        "gpt-5.3-codex",
        "gpt-5.3-codex-spark",
        "gpt-5.4",
        "gpt-5.4-mini",
        "gpt-5.4-nano",
        "gpt-5.5",
        "gpt-5.5-pro",
        "gpt-5.6",
        "gpt-5.6-luna",
        "gpt-6-sol",
        "o3",
      ].map((id) => [id, model(id)]),
    ),
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    env: ["ANTHROPIC_API_KEY"],
    models: { "claude-x": model("claude-x") },
  },
  crewcode: {
    id: "crewcode",
    name: "CrewCode Zen",
    env: ["CREWCODE_API_KEY"],
    api: "https://crewcode.ai/zen/v1",
    models: { "big-pickle": model("big-pickle") },
  },
})

describe("buildSnapshot", () => {
  test("keeps the providers whose SDK is bundled and leaves out the rest", () => {
    const input = {
      ...source(),
      groq: { id: "groq", name: "Groq", env: ["GROQ_API_KEY"], npm: "@ai-sdk/openai-compatible", api: "https://api.groq.com/openai/v1", models: { "llama": model("llama") } },
      anthropic: { id: "anthropic", name: "Anthropic", env: ["ANTHROPIC_API_KEY"], npm: "@ai-sdk/anthropic", models: { "claude-x": model("claude-x") } },
    }
    expect(Object.keys(buildSnapshot(input)).sort()).toEqual(["groq", "openai", "openai-codex", "openrouter"])
  })

  test("derives the Codex flow from OpenAI models with the same eligibility rule as before", () => {
    const codex = Object.keys(buildSnapshot(source())["openai-codex"].models).sort()
    expect(codex).toEqual([
      "gpt-5.3-codex-spark",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.5",
      "gpt-5.6-luna",
      "gpt-6-sol",
    ])
  })

  test("the Codex provider is a separate flow: no API key env, same SDK, zero cost, 400k context for gpt-5.5", () => {
    const codex = buildSnapshot(source())["openai-codex"]
    expect(codex.id).toBe("openai-codex")
    expect(codex.env).toEqual([])
    expect(codex.npm).toBe("@ai-sdk/openai")
    expect(codex.models["gpt-5.4"].cost).toEqual({ input: 0, output: 0, cache_read: 0, cache_write: 0 })
    expect(codex.models["gpt-5.5"].limit).toEqual({ context: 400_000, input: 272_000, output: 128_000 })
    expect(codex.models["gpt-5.4"].limit).toEqual({ context: 1_000_000, output: 64_000 })
  })

  test("Codex never receives pro reasoning-mode variants", () => {
    const withModes = source()
    withModes.openai.models["gpt-5.5"] = model("gpt-5.5", {
      experimental: {
        modes: {
          pro: { provider: { body: { reasoning: { mode: "pro" } } } },
          fast: { provider: { body: { service_tier: "priority" } } },
        },
      },
    })
    const codex = buildSnapshot(withModes)["openai-codex"].models["gpt-5.5"]
    expect(Object.keys(codex.experimental?.modes ?? {})).toEqual(["fast"])
  })

  test("leaves the OpenAI API key flow untouched", () => {
    const snapshot = buildSnapshot(source())
    expect(Object.keys(snapshot.openai.models)).toContain("gpt-4o")
    expect(snapshot.openai.models["gpt-5.5"].cost?.input).toBe(5)
  })

  test("drops fields the catalog schema does not know", () => {
    expect(JSON.stringify(buildSnapshot(source()))).not.toContain("dropped by the schema")
  })

  test("is deterministic regardless of input key order and idempotent", () => {
    const shuffled = Object.fromEntries(Object.entries(source()).reverse())
    expect(JSON.stringify(buildSnapshot(shuffled))).toBe(JSON.stringify(buildSnapshot(source())))
  })

  test("fails instead of producing a partial snapshot when a required provider is missing", () => {
    const { openai: _, ...missing } = source()
    expect(() => buildSnapshot(missing)).toThrow(/openai/)
  })

  test("drops a model that violates the catalog schema and keeps the rest", () => {
    const broken = source()
    ;(broken.openrouter.models["acme/one"] as Record<string, unknown>).limit = "not a limit"
    const result = buildSnapshot(broken)
    // openrouter had only that model, so the provider is left out instead of being listed empty.
    expect(result.openrouter).toBeUndefined()
    expect(Object.keys(result.openai.models).length).toBeGreaterThan(0)
  })

  test("fails when the Codex rule leaves no eligible model", () => {
    const only = source()
    only.openai.models = { "gpt-4o": model("gpt-4o") } as typeof only.openai.models
    expect(() => buildSnapshot(only)).toThrow(/openai-codex/)
  })
})
