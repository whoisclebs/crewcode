import { Config, ConfigProvider, Context, Effect, Layer, Option } from "effect"
import { ConfigService } from "@/effect/config-service"

const bool = (name: string) => Config.boolean(name).pipe(Config.withDefault(false))
const positiveInteger = (name: string) =>
  Config.number(name).pipe(
    Config.map((value) => (Number.isInteger(value) && value > 0 ? value : undefined)),
    Config.orElse(() => Config.succeed(undefined)),
  )
// "unguarded" can only come from here (the --unguarded flag), never from a config file.
const APPROVAL_MODES = ["manual", "auto", "observe", "unguarded"] as const

const experimental = bool("CREWCODE_EXPERIMENTAL")
const enabledByExperimental = (name: string) =>
  Config.all({ experimental, enabled: Config.boolean(name).pipe(Config.option) }).pipe(
    Config.map((flags) => Option.getOrElse(flags.enabled, () => flags.experimental)),
  )

export class Service extends ConfigService.Service<Service>()("@crewcode/RuntimeFlags", {
  pure: bool("CREWCODE_PURE"),
  approvalMode: Config.string("CREWCODE_APPROVAL_MODE").pipe(
    Config.map((value) => APPROVAL_MODES.find((mode) => mode === value)),
    Config.orElse(() => Config.succeed(undefined)),
  ),
  disableDefaultPlugins: bool("CREWCODE_DISABLE_DEFAULT_PLUGINS"),
  disableExternalSkills: bool("CREWCODE_DISABLE_EXTERNAL_SKILLS"),
  disableClaudeCodePrompt: Config.all({
    broad: bool("CREWCODE_DISABLE_CLAUDE_CODE"),
    direct: bool("CREWCODE_DISABLE_CLAUDE_CODE_PROMPT"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  disableClaudeCodeSkills: Config.all({
    broad: bool("CREWCODE_DISABLE_CLAUDE_CODE"),
    direct: bool("CREWCODE_DISABLE_CLAUDE_CODE_SKILLS"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  enableExa: Config.all({
    experimental,
    enabled: bool("CREWCODE_ENABLE_EXA"),
    legacy: bool("CREWCODE_EXPERIMENTAL_EXA"),
  }).pipe(Config.map((flags) => flags.experimental || flags.enabled || flags.legacy)),
  enableParallel: Config.all({
    enabled: bool("CREWCODE_ENABLE_PARALLEL"),
    legacy: bool("CREWCODE_EXPERIMENTAL_PARALLEL"),
  }).pipe(Config.map((flags) => flags.enabled || flags.legacy)),
  enableExperimentalModels: bool("CREWCODE_ENABLE_EXPERIMENTAL_MODELS"),
  enableQuestionTool: bool("CREWCODE_ENABLE_QUESTION_TOOL"),
  experimentalReferences: enabledByExperimental("CREWCODE_EXPERIMENTAL_REFERENCES"),
  experimentalBackgroundSubagents: enabledByExperimental("CREWCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS"),
  experimentalLspTy: bool("CREWCODE_EXPERIMENTAL_LSP_TY"),
  experimentalLspTool: enabledByExperimental("CREWCODE_EXPERIMENTAL_LSP_TOOL"),
  experimentalOxfmt: enabledByExperimental("CREWCODE_EXPERIMENTAL_OXFMT"),
  experimentalPlanMode: enabledByExperimental("CREWCODE_EXPERIMENTAL_PLAN_MODE"),
  experimentalCodeMode: enabledByExperimental("CREWCODE_EXPERIMENTAL_CODE_MODE"),
  experimentalEventSystem: enabledByExperimental("CREWCODE_EXPERIMENTAL_EVENT_SYSTEM"),
  experimentalWorkspaces: enabledByExperimental("CREWCODE_EXPERIMENTAL_WORKSPACES"),
  experimentalIconDiscovery: enabledByExperimental("CREWCODE_EXPERIMENTAL_ICON_DISCOVERY"),
  outputTokenMax: positiveInteger("CREWCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX"),
  bashDefaultTimeoutMs: positiveInteger("CREWCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"),
  experimentalNativeLlm: bool("CREWCODE_EXPERIMENTAL_NATIVE_LLM"),
  experimentalWebSockets: bool("CREWCODE_EXPERIMENTAL_WEBSOCKETS"),
  client: Config.string("CREWCODE_CLIENT").pipe(Config.withDefault("cli")),
}) {}

export type Info = Context.Service.Shape<typeof Service>

const emptyConfigLayer = Service.layer.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
  Layer.orDie,
)

export const layer = (overrides: Partial<Info> = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const flags = yield* Service
      return Service.of({ ...flags, ...overrides })
    }),
  ).pipe(Layer.provide(emptyConfigLayer))

export const node = LayerNode.make({ service: Service, layer: Service.layer.pipe(Layer.orDie), deps: [] })

export * as RuntimeFlags from "./runtime-flags"
import { LayerNode } from "@crewcode/core/effect/layer-node"
