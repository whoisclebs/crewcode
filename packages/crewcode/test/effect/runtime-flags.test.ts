import { describe, expect } from "bun:test"
import { ConfigProvider, Effect, Layer } from "effect"
import { AppNodeBuilder } from "@crewcode/core/effect/app-node-builder"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { it } from "../lib/effect"

const fromConfig = (input: Record<string, unknown>) =>
  AppNodeBuilder.build(RuntimeFlags.node).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(input))))

const readFlags = RuntimeFlags.Service.useSync((flags) => flags)

describe("RuntimeFlags", () => {
  it.effect("layer parses plugin flags from the active ConfigProvider", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(
        Effect.provide(
          fromConfig({
            CREWCODE_PURE: "true",
            CREWCODE_DISABLE_DEFAULT_PLUGINS: "true",
            CREWCODE_DISABLE_EXTERNAL_SKILLS: "true",
            CREWCODE_EXPERIMENTAL: "true",
            CREWCODE_ENABLE_EXA: "true",
            CREWCODE_ENABLE_PARALLEL: "true",
            CREWCODE_ENABLE_EXPERIMENTAL_MODELS: "true",
            CREWCODE_ENABLE_QUESTION_TOOL: "true",
            CREWCODE_CLIENT: "desktop",
          }),
        ),
      )

      expect(flags.pure).toBe(true)
      expect(flags.disableDefaultPlugins).toBe(true)
      expect(flags.disableExternalSkills).toBe(true)
      expect(flags.disableClaudeCodePrompt).toBe(false)
      expect(flags.enableExa).toBe(true)
      expect(flags.enableParallel).toBe(true)
      expect(flags.enableExperimentalModels).toBe(true)
      expect(flags.enableQuestionTool).toBe(true)
      expect(flags.experimentalReferences).toBe(true)
      expect(flags.experimentalBackgroundSubagents).toBe(true)
      expect(flags.experimentalLspTy).toBe(false)
      expect(flags.experimentalLspTool).toBe(true)
      expect(flags.experimentalOxfmt).toBe(true)
      expect(flags.experimentalPlanMode).toBe(true)
      expect(flags.experimentalEventSystem).toBe(true)
      expect(flags.experimentalWorkspaces).toBe(true)
      expect(flags.experimentalIconDiscovery).toBe(true)
      expect(flags.experimentalNativeLlm).toBe(false)
      expect(flags.experimentalWebSockets).toBe(false)
      expect(flags.client).toBe("desktop")
    }),
  )

  it.effect("layer parses CREWCODE_EXPERIMENTAL_LSP_TY", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(
        Effect.provide(
          fromConfig({
            CREWCODE_EXPERIMENTAL_LSP_TY: "true",
          }),
        ),
      )

      expect(flags.experimentalLspTy).toBe(true)
    }),
  )

  it.effect("enables native LLM via dedicated flag only", () =>
    Effect.gen(function* () {
      const explicit = yield* readFlags.pipe(Effect.provide(fromConfig({ CREWCODE_EXPERIMENTAL_NATIVE_LLM: "true" })))
      const umbrella = yield* readFlags.pipe(Effect.provide(fromConfig({ CREWCODE_EXPERIMENTAL: "true" })))

      expect(explicit.experimentalNativeLlm).toBe(true)
      expect(umbrella.experimentalNativeLlm).toBe(false)
    }),
  )

  it.effect("enables WebSockets via dedicated flag only", () =>
    Effect.gen(function* () {
      const explicit = yield* readFlags.pipe(Effect.provide(fromConfig({ CREWCODE_EXPERIMENTAL_WEBSOCKETS: "true" })))
      const umbrella = yield* readFlags.pipe(Effect.provide(fromConfig({ CREWCODE_EXPERIMENTAL: "true" })))

      expect(explicit.experimentalWebSockets).toBe(true)
      expect(umbrella.experimentalWebSockets).toBe(false)
    }),
  )

  it.effect("layer accepts partial test overrides and fills defaults from Config definitions", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(
        Effect.provide(RuntimeFlags.layer({ disableDefaultPlugins: true, bashDefaultTimeoutMs: 1_000 })),
      )

      expect(flags.pure).toBe(false)
      expect(flags.disableDefaultPlugins).toBe(true)
      expect(flags.disableExternalSkills).toBe(false)
      expect(flags.disableClaudeCodePrompt).toBe(false)
      expect(flags.disableClaudeCodeSkills).toBe(false)
      expect(flags.enableExa).toBe(false)
      expect(flags.experimentalIconDiscovery).toBe(false)
      expect(flags.experimentalOxfmt).toBe(false)
      expect(flags.outputTokenMax).toBeUndefined()
      expect(flags.bashDefaultTimeoutMs).toBe(1_000)
      expect(flags.enableExperimentalModels).toBe(false)
      expect(flags.client).toBe("cli")
    }),
  )

  it.effect("experimentalIconDiscovery defaults to false", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({})))

      expect(flags.experimentalIconDiscovery).toBe(false)
    }),
  )

  it.effect("disableExternalSkills defaults to false", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({})))

      expect(flags.disableExternalSkills).toBe(false)
    }),
  )

  it.effect("disableExternalSkills reads CREWCODE_DISABLE_EXTERNAL_SKILLS", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({ CREWCODE_DISABLE_EXTERNAL_SKILLS: "true" })))

      expect(flags.disableExternalSkills).toBe(true)
    }),
  )

  it.effect("disableClaudeCodePrompt defaults to false", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({})))

      expect(flags.disableClaudeCodePrompt).toBe(false)
    }),
  )

  it.effect("disableClaudeCodePrompt reads CREWCODE_DISABLE_CLAUDE_CODE_PROMPT", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({ CREWCODE_DISABLE_CLAUDE_CODE_PROMPT: "true" })))

      expect(flags.disableClaudeCodePrompt).toBe(true)
    }),
  )

  it.effect("disableClaudeCodePrompt inherits CREWCODE_DISABLE_CLAUDE_CODE", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({ CREWCODE_DISABLE_CLAUDE_CODE: "true" })))

      expect(flags.disableClaudeCodePrompt).toBe(true)
    }),
  )

  it.effect("experimentalIconDiscovery reads CREWCODE_EXPERIMENTAL_ICON_DISCOVERY", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({ CREWCODE_EXPERIMENTAL_ICON_DISCOVERY: "true" })))

      expect(flags.experimentalIconDiscovery).toBe(true)
    }),
  )

  it.effect("experimentalIconDiscovery inherits CREWCODE_EXPERIMENTAL", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({ CREWCODE_EXPERIMENTAL: "true" })))

      expect(flags.experimentalIconDiscovery).toBe(true)
    }),
  )

  it.effect("specific experimental flags override CREWCODE_EXPERIMENTAL", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(
        Effect.provide(
          fromConfig({
            CREWCODE_EXPERIMENTAL: "true",
            CREWCODE_EXPERIMENTAL_ICON_DISCOVERY: "false",
          }),
        ),
      )

      expect(flags.experimentalIconDiscovery).toBe(false)
    }),
  )

  it.effect("experimentalOxfmt defaults to false", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({})))

      expect(flags.experimentalOxfmt).toBe(false)
    }),
  )

  it.effect("experimentalOxfmt is enabled by CREWCODE_EXPERIMENTAL_OXFMT", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(
        Effect.provide(
          fromConfig({
            CREWCODE_EXPERIMENTAL_OXFMT: "true",
          }),
        ),
      )

      expect(flags.experimentalOxfmt).toBe(true)
    }),
  )

  it.effect("experimentalOxfmt inherits CREWCODE_EXPERIMENTAL", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(
        Effect.provide(
          fromConfig({
            CREWCODE_EXPERIMENTAL: "true",
          }),
        ),
      )

      expect(flags.experimentalOxfmt).toBe(true)
    }),
  )

  for (const input of [
    { name: "absent", config: {}, expected: undefined },
    {
      name: "valid positive integer",
      config: { CREWCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: "1234" },
      expected: 1234,
    },
    {
      name: "invalid string",
      config: { CREWCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: "nope" },
      expected: undefined,
    },
    { name: "zero", config: { CREWCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: "0" }, expected: undefined },
    { name: "negative", config: { CREWCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: "-1" }, expected: undefined },
    {
      name: "non-integer",
      config: { CREWCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: "1.5" },
      expected: undefined,
    },
  ]) {
    it.effect(`parses bashDefaultTimeoutMs from config: ${input.name}`, () =>
      Effect.gen(function* () {
        const flags = yield* readFlags.pipe(Effect.provide(fromConfig(input.config)))

        expect(flags.bashDefaultTimeoutMs).toBe(input.expected)
      }),
    )
  }

  for (const input of [
    { name: "absent", config: {}, expected: undefined },
    {
      name: "valid positive integer",
      config: { CREWCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: "1234" },
      expected: 1234,
    },
    {
      name: "invalid string",
      config: { CREWCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: "nope" },
      expected: undefined,
    },
    { name: "zero", config: { CREWCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: "0" }, expected: undefined },
    { name: "negative", config: { CREWCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: "-1" }, expected: undefined },
    {
      name: "non-integer",
      config: { CREWCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: "1.5" },
      expected: undefined,
    },
  ]) {
    it.effect(`parses outputTokenMax from config: ${input.name}`, () =>
      Effect.gen(function* () {
        const flags = yield* readFlags.pipe(Effect.provide(fromConfig(input.config)))

        expect(flags.outputTokenMax).toBe(input.expected)
      }),
    )
  }

  it.effect("layer ignores the active ConfigProvider for omitted test overrides", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(
        Effect.provide(RuntimeFlags.layer()),
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              CREWCODE_PURE: "true",
              CREWCODE_DISABLE_DEFAULT_PLUGINS: "true",
              CREWCODE_DISABLE_EXTERNAL_SKILLS: "true",
              CREWCODE_EXPERIMENTAL: "true",
              CREWCODE_ENABLE_EXA: "true",
              CREWCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: "1234",
              CREWCODE_CLIENT: "desktop",
            }),
          ),
        ),
      )

      expect(flags.pure).toBe(false)
      expect(flags.disableDefaultPlugins).toBe(false)
      expect(flags.disableExternalSkills).toBe(false)
      expect(flags.disableClaudeCodePrompt).toBe(false)
      expect(flags.disableClaudeCodeSkills).toBe(false)
      expect(flags.enableExa).toBe(false)
      expect(flags.experimentalIconDiscovery).toBe(false)
      expect(flags.experimentalOxfmt).toBe(false)
      expect(flags.outputTokenMax).toBeUndefined()
      expect(flags.bashDefaultTimeoutMs).toBeUndefined()
      expect(flags.client).toBe("cli")
    }),
  )

  it.effect("disableClaudeCodeSkills defaults to false", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({})))

      expect(flags.disableClaudeCodeSkills).toBe(false)
    }),
  )

  it.effect("disableClaudeCodeSkills reads CREWCODE_DISABLE_CLAUDE_CODE_SKILLS", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({ CREWCODE_DISABLE_CLAUDE_CODE_SKILLS: "true" })))

      expect(flags.disableClaudeCodeSkills).toBe(true)
    }),
  )

  it.effect("disableClaudeCodeSkills inherits CREWCODE_DISABLE_CLAUDE_CODE", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({ CREWCODE_DISABLE_CLAUDE_CODE: "true" })))

      expect(flags.disableClaudeCodeSkills).toBe(true)
    }),
  )
})
