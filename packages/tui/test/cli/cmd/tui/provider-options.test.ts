import { describe, expect, test } from "bun:test"
import { providerOptions } from "../../../../src/component/dialog-provider"

describe("providerOptions", () => {
  test("orders the supported providers with their descriptions", () => {
    const options = providerOptions([
      { id: "openrouter", name: "OpenRouter" },
      { id: "openai", name: "OpenAI" },
      { id: "openai-codex", name: "OpenAI Codex" },
    ])
    expect(options.map((option) => [option.value, option.description])).toEqual([
      ["openai-codex", "(ChatGPT Plus/Pro account)"],
      ["openai", "(API key)"],
      ["openrouter", "(API key)"],
    ])
    expect(options.every((option) => option.category === "Popular")).toBe(true)
  })

  test("lists providers unknown to the priority table after the supported ones", () => {
    const options = providerOptions([
      { id: "zeta", name: "Zeta" },
      { id: "openai", name: "OpenAI" },
      { id: "alpha", name: "Alpha" },
    ])
    expect(options.map((option) => option.value)).toEqual(["openai", "alpha", "zeta"])
    expect(options.at(-1)?.category).toBe("Providers")
  })
})
