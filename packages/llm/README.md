# @crewcode/llm

Schema-first LLM core for crewcode. One typed request, response, event, and tool language; provider quirks live in adapters, not in calling code.

```ts
import { Effect } from "effect"
import { LLM, LLMClient } from "@crewcode/llm"
import { OpenAI } from "@crewcode/llm/providers"

const model = OpenAI.configure({ apiKey: process.env.OPENAI_API_KEY }).responses("gpt-4o-mini")

const request = LLM.request({
  model,
  system: "You are concise.",
  prompt: "Say hello in one short sentence.",
  generation: { maxTokens: 40 },
})

const program = Effect.gen(function* () {
  const response = yield* LLMClient.generate(request)
  console.log(response.text)
})
```

Run `LLMClient.stream(request)` instead of `generate` when you want incremental `LLMEvent`s. The event stream is provider-neutral — same shape across OpenAI Chat, OpenAI Responses, and any OpenAI-compatible deployment (OpenRouter included).

## Public API

- **`LLM.request({...})`** — build a provider-neutral `LLMRequest`. Accepts ergonomic inputs (`system: string`, `prompt: string`) that normalize into the canonical Schema classes.
- **`LLM.generate` / `LLM.stream`** — re-exported from `LLMClient` for one-import use.
- **`Message.user(...)` / `Message.assistant(...)` / `Message.tool(...)`** — message constructors from the canonical schema model.
- **`Model.make(...)` / `ToolCallPart.make(...)` / `ToolResultPart.make(...)` / `ToolDefinition.make(...)`** — model and tool-related constructors from the canonical schema model.
- **`LLMClient.prepare(request)`** — compile a request through protocol body construction, validation, and HTTP preparation without sending. Useful for inspection and testing.
- **`LLMEvent.is.*`** — typed guards (`is.textDelta`, `is.toolCall`, `is.finish`, …) for filtering streams.

## Providers

Provider facades configure endpoint/auth/deployment details first, then expose model selectors that take only a model or deployment id. The selected model carries the executable route value used at runtime.

```ts
import { OpenAI } from "@crewcode/llm/providers"

const openai = OpenAI.configure({ apiKey: process.env.OPENAI_API_KEY }).responses("gpt-4o-mini")
```

Included providers: OpenAI, OpenRouter, plus generic OpenAI-compatible helpers for DeepSeek, Cerebras, Groq, Fireworks, Together, etc.

## Provider options & HTTP overlays

Three escape hatches in order of stability:

1. **`generation`** — portable knobs (`maxTokens`, `temperature`, `topP`, `topK`, penalties, seed, stop).
2. **`providerOptions: { <provider>: {...} }`** — typed-at-the-facade provider-specific knobs (OpenAI `promptCacheKey`, OpenRouter routing).
3. **`http: { body, headers, query }`** — last-resort serializable overlays merged into the final HTTP request. Reach for this only when a stable typed path doesn't yet exist.

Route/provider defaults are overridden by request-level values for each axis.

## Routes

Adding a new model or deployment is usually 5-15 lines using `Route.make({ protocol, endpoint, auth, framing, ... })`. The route owns endpoint/auth/framing and the protocol owns body construction plus stream parsing. Transports are reusable IO templates that receive route endpoint/auth at compile time. Capability/catalog metadata lives outside this low-level package; unsupported request shapes fail during protocol lowering. See `AGENTS.md` for the architectural detail.

## Effect

This package is built on Effect. Public methods return `Effect` or `Stream`; provide `LLMClient.layer` for runtime dispatch and import the provider/protocol modules for the routes you use. The example at `example/tutorial.ts` is a runnable walkthrough.

## See also

- `AGENTS.md` — architecture, route construction, contributor guide
- `example/tutorial.ts` — runnable end-to-end walkthrough
- `test/provider/*.test.ts` — fixture-first protocol tests; `*.recorded.test.ts` files cover live cassettes
