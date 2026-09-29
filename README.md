# CrewCode

A local-first coding agent for the terminal. Sessions, configuration, permission decisions and the running of the product do not depend on any hosted backend. CrewCode only talks to the model providers you configure.

It is a hard fork of [OpenCode](https://github.com/anomalyco/opencode) (MIT). This is **v0**: small on purpose,.

## What it is

- **Three providers, and only those:** OpenRouter (API key), OpenAI API (API key) and OpenAI Codex (sign in with a ChatGPT account). They are separate authentication and billing flows. Any other provider is refused in the catalog, in configuration, in `auth.json`, in the environment, in plugins and in the server routes.
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
crewcode                                       # the TUI
crewcode run -m openrouter/openai/gpt-5.4-mini "explain this repository" < /dev/null
crewcode --auto                                # TUI with contextual review of actions that need approval
crewcode audit stats                           # what the reviewer decided and how many false approvals
```

`crewcode run` reads `stdin` when it is not a terminal (so that `cat file | crewcode run "..."` works). In scripts with no input, use `< /dev/null`.

There is no syntax highlighting by default: no parser is bundled in the repository. To turn it on, run `bun run --cwd packages/tui setup:parsers` once. It is the only step that downloads anything, and only when you ask for it.

## Documentation

[docs/auto-mode.md](docs/auto-mode.md): modes, order of decision, policy, reviewer and audit.

## License

MIT. The original text is in [LICENSE](LICENSE) and the attribution in [NOTICE](NOTICE).
