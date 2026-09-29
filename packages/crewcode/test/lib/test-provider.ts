// Shared provider config for tests that need crewcode to talk to a fake LLM
// over a real HTTP endpoint. Registers a single provider `test` with a single
// model `test-model` (i.e. `--model test/test-model`), pointed at the URL the
// caller supplies (typically a TestLLMServer instance).
//
// CrewCode only accepts openrouter, openai and openai-codex, so the fake endpoint is registered as a customized
// `openrouter` provider (openai-compatible package, custom baseURL): `--model openrouter/test-model`.
//
// Used by:
//   - test/lib/run-process.ts          (subprocess CLI tests)
//   - test/server/httpapi-sdk.test.ts  (in-process SDK tests)
export const testProviderID = "openrouter"
export const testModelID = "test-model"
export const testModelRef = `${testProviderID}/${testModelID}`

export function testProviderConfig(llmUrl: string) {
  return {
    formatter: false,
    lsp: false,
    provider: {
      [testProviderID]: {
        name: "Test",
        id: testProviderID,
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: {
          [testModelID]: {
            id: testModelID,
            name: "Test Model",
            attachment: false,
            reasoning: false,
            temperature: false,
            tool_call: true,
            release_date: "2025-01-01",
            limit: { context: 100_000, output: 10_000 },
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: { apiKey: "test-key", baseURL: llmUrl },
      },
    },
  }
}
