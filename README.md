# CrewCode

A local-first coding agent for the terminal. Sessions, configuration, permission decisions and the running of the product do not depend on any hosted backend. CrewCode only talks to the model providers you configure.

It is a hard fork of [OpenCode](https://github.com/anomalyco/opencode) (MIT). This is **v0**: small on purpose,.

## What it is

- **Every provider that speaks the OpenAI protocol, no list of names:** the local catalog holds all the models.dev providers whose SDK ships inside CrewCode: `@ai-sdk/openai-compatible` (DeepSeek, Ollama Cloud and about 180 others), `@ai-sdk/openai` and OpenRouter. OpenAI Codex (sign in with a ChatGPT account) is derived from the OpenAI models and is a separate flow. Add anything else (a local Ollama, vLLM, LM Studio, your own gateway) in `crewcode.json` with `"npm": "@ai-sdk/openai-compatible"` and a `baseURL`. A provider that needs its own SDK (Anthropic, Google, Bedrock and so on) does not appear, because CrewCode never installs code at run time.
- **Local model catalog:** a versioned snapshot, with no remote lookup at startup or during use.
- **Local sessions only:** there is no session sharing. `export` and `import` of a file remain.
- **No OpenCode services:** no accounts, console, Zen/Go, auto-update, telemetry, plugin installation or binary downloads at run time.
- **Native auto mode:** a contextual review between the `ask` rule and the question to you. `deny` rules are never overridden, a failure never becomes an approval, and there is an observe mode to measure before turning it on. See [docs/auto-mode.md](docs/auto-mode.md).
- **Its own identity:** `@crewcode/*` packages, `CREWCODE_*` variables, the `crewcode` binary, `crewcode.json` config. It reads nothing from an OpenCode installation.

## Getting started

```sh
bun install --frozen-lockfile --ignore-scripts
cd packages/crewcode
bun run script/build.ts --single --skip-install
./dist/crewcode-linux-x64/bin/crewcode
```

You need `bun` (the version in `package.json`), `git` and `rg`.

```sh
export OPENROUTER_API_KEY=sk-or-...           # or OPENAI_API_KEY, or: crewcode providers login
crewcode                                       # the interface (Rust binary in packages/tui-rs)
crewcode run -m openrouter/openai/gpt-5.4-mini "explain this repository" < /dev/null
crewcode --auto                                # interface with contextual review of actions that need approval
crewcode audit stats                           # what the reviewer decided and how many false approvals
```

An OpenAI-compatible provider, for example a local Ollama:

```jsonc
// crewcode.json
{
  "provider": {
    "ollama": {
      "name": "Ollama",
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://localhost:11434/v1", "apiKey": "ollama" },
      "models": { "qwen2.5-coder:32b": { "name": "Qwen 2.5 Coder 32B" } }
    }
  }
}
```

`crewcode run` reads `stdin` when it is not a terminal (so that `cat file | crewcode run "..."` works). In scripts with no input, use `< /dev/null`.

Prompt caching: providers that cache on their own (OpenAI, DeepSeek, Groq, Grok, Moonshot, Z.AI) need nothing. CrewCode marks cache breakpoints (`cache_control`) for Claude models on any provider, and for Qwen and Gemini on OpenRouter, and it sends `X-Session-Id` so OpenRouter keeps a conversation on the same backend. For a custom endpoint that serves a Claude model under another name, set `"setCacheControl": true` in that provider's `options`.

## Documentation

[docs/auto-mode.md](docs/auto-mode.md): modes, order of decision, policy, reviewer and audit.

## License

MIT. The original text is in [LICENSE](LICENSE) and the attribution in [NOTICE](NOTICE).
