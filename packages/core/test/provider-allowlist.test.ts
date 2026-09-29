import { describe, expect, test } from "bun:test"
import { ProviderAllowlist } from "@crewcode/core/provider-allowlist"

describe("ProviderAllowlist", () => {
  test("accepts exactly the three v0 providers", () => {
    expect(ProviderAllowlist.ids).toEqual(["openrouter", "openai", "openai-codex"])
    expect(ProviderAllowlist.ids.every((id) => ProviderAllowlist.isAllowed(id))).toBe(true)
  })

  test.each(["anthropic", "google", "github-copilot", "crewcode", "crewcode-go", "amazon-bedrock", "azure", ""])(
    "rejects %p",
    (id) => {
      expect(ProviderAllowlist.isAllowed(id)).toBe(false)
    },
  )

  test("matches ids exactly, without prefixes, case folding or trimming", () => {
    expect(ProviderAllowlist.isAllowed("OpenAI")).toBe(false)
    expect(ProviderAllowlist.isAllowed(" openai")).toBe(false)
    expect(ProviderAllowlist.isAllowed("openai-codex-extra")).toBe(false)
    expect(ProviderAllowlist.isAllowed("openrouter/anthropic")).toBe(false)
  })

  test("does not treat inherited object keys as allowed providers", () => {
    expect(ProviderAllowlist.isAllowed("constructor")).toBe(false)
    expect(ProviderAllowlist.isAllowed("__proto__")).toBe(false)
    expect(ProviderAllowlist.isAllowed("toString")).toBe(false)
  })

  test("filter keeps only allowed keys and does not mutate its input", () => {
    const input = { openai: 1, anthropic: 2, "openai-codex": 3, google: 4 }
    expect(ProviderAllowlist.filter(input)).toEqual({ openai: 1, "openai-codex": 3 })
    expect(input).toEqual({ openai: 1, anthropic: 2, "openai-codex": 3, google: 4 })
  })

  test("unsupported provider message names the provider and lists what is supported", () => {
    const message = ProviderAllowlist.message("anthropic")
    expect(message).toContain('"anthropic"')
    expect(message).toContain("openrouter, openai, openai-codex")
  })

  test("assertAllowed passes for allowed ids and throws a typed error for the rest", () => {
    expect(() => ProviderAllowlist.assertAllowed("openrouter")).not.toThrow()
    const error = (() => {
      try {
        ProviderAllowlist.assertAllowed("anthropic")
      } catch (error) {
        return error
      }
    })()
    expect(error).toBeInstanceOf(ProviderAllowlist.UnsupportedProviderError)
    expect((error as ProviderAllowlist.UnsupportedProviderError).providerID).toBe("anthropic")
    expect((error as ProviderAllowlist.UnsupportedProviderError).message).toBe(ProviderAllowlist.message("anthropic"))
  })
})
