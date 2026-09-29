import { LayerNode } from "@crewcode/core/effect/layer-node"
import { serviceUse } from "@crewcode/core/effect/service-use"
import path from "path"
import { pathToFileURL } from "url"
import os from "os"
import { mergeDeep } from "remeda"
import { Global } from "@crewcode/core/global"
import fsNode from "fs/promises"
import { Flag } from "@crewcode/core/flag/flag"
import { applyEdits, modify } from "jsonc-parser"
import { existsSync } from "fs"
import { isRecord } from "@/util/record"
import { FSUtil } from "@crewcode/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { Context, Duration, Effect, Layer } from "effect"
import { containsPath, type InstanceContext } from "../project/instance-context"
import { ConfigV1 } from "@crewcode/core/v1/config/config"
import { ConfigPermissionV1 } from "@crewcode/core/v1/config/permission"
import { ConfigPluginV1 } from "@crewcode/core/v1/config/plugin"
import { ConfigAgent } from "./agent"
import { ConfigCommand } from "./command"
import { ConfigManaged } from "./managed"
import { ConfigParse } from "./parse"
import { ConfigPaths } from "./paths"
import { ConfigPlugin } from "./plugin"
import { ConfigVariable } from "./variable"
import { ConfigV2Compat } from "./v2-compat"

// Custom merge function that concatenates array fields instead of replacing them
// Keep remeda's deep conditional merge type out of hot config-loading paths; TS profiling showed it dominates here.
function mergeConfig(target: Info, source: Info): Info {
  return mergeDeep(target, source) as Info
}

function mergeConfigConcatArrays(target: Info, source: Info): Info {
  const merged = mergeConfig(target, source)
  if (target.instructions && source.instructions) {
    merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]))
  }
  return merged
}

// Keys of features CrewCode does not have. Old configs may still carry them, so they are dropped instead of rejected.
const REMOVED_KEYS = ["share", "autoshare", "enterprise", "autoupdate"] as const

function removedKeys(data: unknown) {
  if (!isRecord(data)) return []
  return REMOVED_KEYS.filter((key) => key in data)
}

function normalizeLoadedConfig(data: unknown) {
  if (!isRecord(data)) return data
  const copy = { ...data }
  const hadLegacy = "theme" in copy || "keybinds" in copy || "tui" in copy || removedKeys(copy).length > 0
  if (!hadLegacy) return copy
  delete copy.theme
  delete copy.keybinds
  delete copy.tui
  for (const key of REMOVED_KEYS) delete copy[key]
  return copy
}

async function resolveLoadedPlugins<T extends { plugin?: ConfigPluginV1.Spec[] }>(config: T, filepath: string) {
  if (!config.plugin) return config
  for (let i = 0; i < config.plugin.length; i++) {
    // Normalize path-like plugin specs while we still know which config file declared them.
    // This prevents `./plugin.ts` from being reinterpreted relative to some later merge location.
    config.plugin[i] = await ConfigPlugin.resolvePluginSpec(config.plugin[i], filepath)
  }
  return config
}

type Info = ConfigV1.Info & {
  // plugin_origins is derived state, not a persisted config field. It keeps each winning plugin spec together
  // with the file and scope it came from so later runtime code can make location-sensitive decisions.
  plugin_origins?: ConfigPlugin.Origin[]
}

type State = {
  config: Info
  directories: string[]
}

export interface Interface {
  readonly get: () => Effect.Effect<Info>
  readonly getGlobal: () => Effect.Effect<Info>
  readonly update: (config: Info) => Effect.Effect<void>
  readonly updateGlobal: (config: Info) => Effect.Effect<{ info: Info; changed: boolean }>
  readonly invalidate: () => Effect.Effect<void>
  readonly directories: () => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@crewcode/Config") {}

export const use = serviceUse(Service)

function globalConfigFile() {
  const candidates = ["crewcode.jsonc", "crewcode.json", "config.json"].map((file) =>
    path.join(Global.Path.config, file),
  )
  for (const file of candidates) {
    if (existsSync(file)) return file
  }
  return candidates[0]
}

function patchJsonc(input: string, patch: unknown, path: string[] = []): string {
  if (!isRecord(patch)) {
    const edits = modify(input, path, patch, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
      },
    })
    return applyEdits(input, edits)
  }

  return Object.entries(patch).reduce((result, [key, value]) => patchJsonc(result, value, [...path, key]), input)
}

function writable(info: Info) {
  const { plugin_origins: _plugin_origins, ...next } = info
  return next
}

function writableGlobal(info: Info) {
  const next = writable(info)
  // When a user changes config from a value back to default in the Desktop app, we don't want to leave a blank `"shell": "",` key
  if ("shell" in next && next.shell === "") return { ...next, shell: undefined }
  return next
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    const readConfigFile = (filepath: string) => fs.readFileStringSafe(filepath).pipe(Effect.orDie)

    const decodeConfig = Effect.fnUntraced(function* (input: unknown, source: string) {
      const removed = removedKeys(input)
      if (removed.length > 0) {
        yield* Effect.logWarning(
          `Ignoring config key(s) ${removed.join(", ")} in ${source}: not supported by CrewCode (no session sharing, hosted enterprise service or auto-update).`,
        )
      }
      const result = ConfigV2Compat.lower(normalizeLoadedConfig(input), source)
      yield* Effect.forEach(result.diagnostics, (diagnostic) =>
        Effect.logWarning("configuration compatibility diagnostic", {
          source,
          path: diagnostic.path,
          kind: diagnostic.kind,
          action: diagnostic.message,
        }),
      )
      return ConfigParse.schema(ConfigV1.Info, result.value, source)
    })

    const loadConfig = Effect.fnUntraced(function* (
      text: string,
      options: { path: string } | { dir: string; source: string },
    ) {
      const source = "path" in options ? options.path : options.source
      const expanded = yield* Effect.promise(() =>
        ConfigVariable.substitute(
          "path" in options ? { text, type: "path", path: options.path } : { text, type: "virtual", ...options },
        ),
      )
      const parsed = ConfigParse.jsonc(expanded, source)
      const data = yield* decodeConfig(parsed, source)
      if (!("path" in options)) return data

      yield* Effect.promise(() => resolveLoadedPlugins(data, options.path))
      return data
    })

    const loadFile = Effect.fnUntraced(function* (filepath: string) {
      yield* Effect.logInfo("loading", { path: filepath })
      const text = yield* readConfigFile(filepath)
      if (!text) return {} as Info
      return yield* loadConfig(text, { path: filepath })
    })

    const loadGlobal = Effect.fnUntraced(function* () {
      let result: Info = {}
      result = mergeConfig(result, yield* loadFile(path.join(Global.Path.config, "config.json")))
      result = mergeConfig(result, yield* loadFile(path.join(Global.Path.config, "crewcode.json")))
      result = mergeConfig(result, yield* loadFile(path.join(Global.Path.config, "crewcode.jsonc")))

      const legacy = path.join(Global.Path.config, "config")
      if (existsSync(legacy)) {
        yield* Effect.promise(() =>
          import(pathToFileURL(legacy).href, { with: { type: "toml" } })
            .then(async (mod) => {
              const { provider, model, ...rest } = mod.default
              if (provider && model) result.model = `${provider}/${model}`
              result = mergeConfig(result, rest)
              await fsNode.writeFile(path.join(Global.Path.config, "config.json"), JSON.stringify(result, null, 2))
              await fsNode.unlink(legacy)
            })
            .catch(() => {}),
        )
      }

      return result
    })

    const [cachedGlobal, invalidateGlobal] = yield* Effect.cachedInvalidateWithTTL(
      loadGlobal().pipe(
        Effect.tapError((error) =>
          Effect.logError("failed to load global config, using defaults", { error: String(error) }),
        ),
        Effect.orElseSucceed((): Info => ({})),
      ),
      Duration.infinity,
    )

    const getGlobal = Effect.fn("Config.getGlobal")(function* () {
      return yield* cachedGlobal
    })

    const loadInstanceState = Effect.fn("Config.loadInstanceState")(
      function* (ctx: InstanceContext) {
        let result: Info = {}

        const pluginScopeForSource = Effect.fnUntraced(function* (source: string) {
          if (source === "CREWCODE_CONFIG_CONTENT") return "local"
          if (containsPath(source, ctx)) return "local"
          return "global"
        })

        const mergePluginOrigins = Effect.fnUntraced(function* (
          source: string,
          // mergePluginOrigins receives raw Specs from one config source, before provenance for this merge step
          // is attached.
          list: ConfigPluginV1.Spec[] | undefined,
          // Scope can be inferred from the source path, but some callers already know whether the config should
          // behave as global or local and can pass that explicitly.
          kind?: ConfigPlugin.Scope,
        ) {
          if (!list?.length) return
          const hit = kind ?? (yield* pluginScopeForSource(source))
          // Merge newly seen plugin origins with previously collected ones, then dedupe by plugin identity while
          // keeping the winning source/scope metadata for downstream installs, writes, and diagnostics.
          const plugins = ConfigPlugin.deduplicatePluginOrigins([
            ...(result.plugin_origins ?? []),
            ...list.map((spec) => ({ spec, source, scope: hit })),
          ])
          result.plugin = plugins.map((item) => item.spec)
          result.plugin_origins = plugins
        })

        const merge = (source: string, next: Info, kind?: ConfigPlugin.Scope) => {
          result = mergeConfigConcatArrays(result, next)
          return mergePluginOrigins(source, next.plugin, kind)
        }

        const global = yield* getGlobal()
        yield* merge(Global.Path.config, global, "global")

        if (Flag.CREWCODE_CONFIG) {
          yield* merge(Flag.CREWCODE_CONFIG, yield* loadFile(Flag.CREWCODE_CONFIG))
          yield* Effect.logDebug("loaded custom config", { path: Flag.CREWCODE_CONFIG })
        }

        if (!Flag.CREWCODE_DISABLE_PROJECT_CONFIG) {
          for (const file of yield* ConfigPaths.files("crewcode", ctx.directory, ctx.worktree).pipe(Effect.orDie)) {
            yield* merge(file, yield* loadFile(file), "local")
          }
        }

        result.agent = result.agent || {}
        result.mode = result.mode || {}
        result.plugin = result.plugin || []

        const directories = yield* ConfigPaths.directories(ctx.directory, ctx.worktree)

        if (Flag.CREWCODE_CONFIG_DIR) {
          yield* Effect.logDebug("loading config from CREWCODE_CONFIG_DIR", { path: Flag.CREWCODE_CONFIG_DIR })
        }

        for (const dir of directories) {
          if (dir.endsWith(".crewcode") || dir === Flag.CREWCODE_CONFIG_DIR) {
            for (const file of ["crewcode.json", "crewcode.jsonc"]) {
              const source = path.join(dir, file)
              yield* Effect.logDebug(`loading config from ${source}`)
              yield* merge(source, yield* loadFile(source))
              result.agent ??= {}
              result.mode ??= {}
              result.plugin ??= []
            }
          }

          result.command = mergeDeep(result.command ?? {}, yield* Effect.promise(() => ConfigCommand.load(dir)))
          result.agent = mergeDeep(result.agent ?? {}, yield* Effect.promise(() => ConfigAgent.load(dir)))
          result.agent = mergeDeep(result.agent ?? {}, yield* Effect.promise(() => ConfigAgent.loadMode(dir)))
          // Auto-discovered plugins under `.crewcode/plugin(s)` are already local files, so ConfigPlugin.load
          // returns normalized Specs and we only need to attach origin metadata here.
          const list = yield* Effect.promise(() => ConfigPlugin.load(dir))
          yield* mergePluginOrigins(dir, list)
        }

        if (process.env.CREWCODE_CONFIG_CONTENT) {
          const source = "CREWCODE_CONFIG_CONTENT"
          const next = yield* loadConfig(process.env.CREWCODE_CONFIG_CONTENT, {
            dir: ctx.directory,
            source,
          })
          yield* merge(source, next, "local")
          yield* Effect.logDebug("loaded custom config from CREWCODE_CONFIG_CONTENT")
        }

        const managedDir = ConfigManaged.managedConfigDir()
        if (existsSync(managedDir)) {
          for (const file of ["crewcode.json", "crewcode.jsonc"]) {
            const source = path.join(managedDir, file)
            yield* merge(source, yield* loadFile(source), "global")
          }
        }

        // macOS managed preferences (.mobileconfig deployed via MDM) override everything
        const managed = yield* Effect.promise(() => ConfigManaged.readManagedPreferences())
        if (managed) {
          result = mergeConfigConcatArrays(
            result,
            yield* loadConfig(managed.text, {
              dir: path.dirname(managed.source),
              source: managed.source,
            }),
          )
        }

        for (const [name, mode] of Object.entries(result.mode ?? {})) {
          result.agent = mergeDeep(result.agent ?? {}, {
            [name]: {
              ...mode,
              mode: "primary" as const,
            },
          })
        }

        if (Flag.CREWCODE_PERMISSION) {
          try {
            result.permission = mergeDeep(result.permission ?? {}, JSON.parse(Flag.CREWCODE_PERMISSION))
          } catch (err) {
            yield* Effect.logWarning("CREWCODE_PERMISSION contains invalid JSON, skipping", { err })
          }
        }

        if (result.tools) {
          const perms: Record<string, ConfigPermissionV1.Action> = {}
          for (const [tool, enabled] of Object.entries(result.tools)) {
            const action: ConfigPermissionV1.Action = enabled ? "allow" : "deny"
            if (tool === "write" || tool === "edit" || tool === "patch") {
              perms.edit = action
              continue
            }
            perms[tool] = action
          }
          result.permission = mergeDeep(perms, result.permission ?? {})
        }

        if (!result.username) {
          try {
            result.username = os.userInfo().username || "user"
          } catch (err) {
            yield* Effect.logWarning("failed to read system username, using fallback", { err })
            result.username = "user"
          }
        }

        if (Flag.CREWCODE_DISABLE_AUTOCOMPACT) {
          result.compaction = { ...result.compaction, auto: false }
        }
        if (Flag.CREWCODE_DISABLE_PRUNE) {
          result.compaction = { ...result.compaction, prune: false }
        }

        return {
          config: result,
          directories,
        }
      },
      Effect.provideService(FSUtil.Service, fs),
    )

    const state = yield* InstanceState.make<State>(
      Effect.fn("Config.state")(function* (ctx) {
        return yield* loadInstanceState(ctx).pipe(Effect.orDie)
      }),
    )

    const get = Effect.fn("Config.get")(function* () {
      return yield* InstanceState.use(state, (s) => s.config)
    })

    const directories = Effect.fn("Config.directories")(function* () {
      return yield* InstanceState.use(state, (s) => s.directories)
    })

    const update = Effect.fn("Config.update")(function* (config: Info) {
      const dir = yield* InstanceState.directory
      const file = path.join(dir, "config.json")
      const existing = yield* loadFile(file)
      const text = yield* readConfigFile(file)
      const original = text ? ConfigParse.jsonc(text, file) : writable(existing)
      yield* fs
        .writeFileString(
          file,
          JSON.stringify(mergeDeep(isRecord(original) ? original : writable(existing), writable(config)), null, 2),
        )
        .pipe(Effect.orDie)
    })

    const invalidate = Effect.fn("Config.invalidate")(function* () {
      yield* invalidateGlobal
    })

    const updateGlobal = Effect.fn("Config.updateGlobal")(function* (config: Info) {
      const file = globalConfigFile()
      const before = (yield* readConfigFile(file)) ?? "{}"
      const patch = writableGlobal(config)

      let next: Info
      let changed: boolean
      if (!file.endsWith(".jsonc")) {
        const existing = ConfigParse.jsonc(before, file)
        ConfigParse.schema(ConfigV1.Info, ConfigV2Compat.lower(normalizeLoadedConfig(existing), file).value, file)
        const merged = mergeDeep(isRecord(existing) ? existing : {}, patch)
        const serialized = JSON.stringify(merged, null, 2)
        next = yield* decodeConfig(merged, file)
        changed = serialized !== before
        if (changed) yield* fs.writeFileString(file, serialized).pipe(Effect.orDie)
      } else {
        const updated = patchJsonc(before, patch)
        next = yield* decodeConfig(ConfigParse.jsonc(updated, file), file)
        changed = updated !== before
        if (changed) yield* fs.writeFileString(file, updated).pipe(Effect.orDie)
      }

      if (changed) yield* invalidate()
      return { info: next, changed }
    })

    return Service.of({
      get,
      getGlobal,
      update,
      updateGlobal,
      invalidate,
      directories,
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [FSUtil.node],
})

export * as Config from "./config"
