import {
  createPluginEntry,
  isDeprecatedPlugin,
  resolvePluginTarget,
  type PluginKind,
  type PluginPackage,
  type PluginSource,
} from "./shared"
import { ConfigPlugin } from "@/config/plugin"
import { ConfigPluginV1 } from "@crewcode/core/v1/config/plugin"

export namespace PluginLoader {
  // A normalized plugin declaration derived from config before any filesystem work happens.
  export type Plan = {
    spec: string
    options: ConfigPluginV1.Options | undefined
    deprecated: boolean
  }

  // A plugin that has been resolved to a concrete target and entrypoint on disk.
  export type Resolved = Plan & {
    source: PluginSource
    target: string
    entry: string
    pkg?: PluginPackage
  }

  // A plugin target we could inspect, but which does not expose the requested kind of entrypoint.
  export type Missing = Plan & {
    source: PluginSource
    target: string
    pkg?: PluginPackage
    message: string
  }

  // A resolved plugin whose module has been imported successfully.
  export type Loaded = Resolved & {
    mod: Record<string, unknown>
  }

  type Candidate = { origin: ConfigPlugin.Origin; plan: Plan }
  type Report = {
    // Called before each attempt so callers can log initial load attempts and retries uniformly.
    start?: (candidate: Candidate) => void
    // Called when the package exists but does not provide the requested entrypoint.
    missing?: (candidate: Candidate, message: string, resolved: Missing) => void
    // Called for operational failures such as install, compatibility, or dynamic import errors.
    error?: (
      candidate: Candidate,
      stage: "resolve" | "entry" | "load",
      error: unknown,
      resolved?: Resolved,
    ) => void
  }

  // Normalize a config item into the loader's internal representation.
  function plan(item: ConfigPluginV1.Spec): Plan {
    const spec = ConfigPlugin.pluginSpecifier(item)
    return { spec, options: ConfigPlugin.pluginOptions(item), deprecated: isDeprecatedPlugin(spec) }
  }

  // Resolve a configured plugin into a concrete entrypoint that can later be imported.
  //
  // The stages here intentionally separate target resolution, entrypoint detection,
  // and compatibility checks so callers can report the exact reason a plugin was skipped.
  export async function resolve(
    plan: Plan,
    kind: PluginKind,
  ): Promise<
    | { ok: true; value: Resolved }
    | { ok: false; stage: "missing"; value: Missing }
    | { ok: false; stage: "resolve" | "entry"; error: unknown }
  > {
    // First make sure the plugin exists locally. Package specifiers are rejected here.
    let target = ""
    try {
      target = await resolvePluginTarget(plan.spec)
    } catch (error) {
      return { ok: false, stage: "resolve", error }
    }
    if (!target) return { ok: false, stage: "resolve", error: new Error(`Plugin ${plan.spec} target is empty`) }

    // Then inspect the target for the requested server/tui entrypoint.
    let base
    try {
      base = await createPluginEntry(plan.spec, target, kind)
    } catch (error) {
      return { ok: false, stage: "entry", error }
    }
    if (!base.entry)
      return {
        ok: false,
        stage: "missing",
        value: {
          ...plan,
          source: base.source,
          target: base.target,
          pkg: base.pkg,
          message: `Plugin ${plan.spec} does not expose a ${kind} entrypoint`,
        },
      }

    return { ok: true, value: { ...plan, source: base.source, target: base.target, entry: base.entry, pkg: base.pkg } }
  }

  // Import the resolved module only after all earlier validation has succeeded.
  export async function load(row: Resolved): Promise<{ ok: true; value: Loaded } | { ok: false; error: unknown }> {
    let mod
    try {
      mod = await import(row.entry)
    } catch (error) {
      return { ok: false, error }
    }
    if (!mod) return { ok: false, error: new Error(`Plugin ${row.spec} module is empty`) }
    return { ok: true, value: { ...row, mod } }
  }

  // Run one candidate through the full pipeline: resolve, optionally surface a missing entry,
  // import the module, and finally let the caller transform the loaded plugin into any result type.
  async function attempt<R>(
    candidate: Candidate,
    kind: PluginKind,
    finish: ((load: Loaded, origin: ConfigPlugin.Origin) => Promise<R | undefined>) | undefined,
    missing: ((value: Missing, origin: ConfigPlugin.Origin) => Promise<R | undefined>) | undefined,
    report: Report | undefined,
  ): Promise<R | undefined> {
    const plan = candidate.plan

    // Deprecated plugin packages are silently ignored because they are now built in.
    if (plan.deprecated) return

    report?.start?.(candidate)

    const resolved = await resolve(plan, kind)
    if (!resolved.ok) {
      if (resolved.stage === "missing") {
        // Missing entrypoints are handled separately so callers can still inspect package metadata,
        // for example to load theme files from a tui plugin package that has no code entrypoint.
        if (missing) {
          const value = await missing(resolved.value, candidate.origin)
          if (value !== undefined) return value
        }
        report?.missing?.(candidate, resolved.value.message, resolved.value)
        return
      }
      report?.error?.(candidate, resolved.stage, resolved.error)
      return
    }

    const loaded = await load(resolved.value)
    if (!loaded.ok) {
      report?.error?.(candidate, "load", loaded.error, resolved.value)
      return
    }

    // The default behavior is to return the successfully loaded plugin as-is, but callers can
    // provide a finisher to adapt the result into a more specific runtime shape.
    if (!finish) return loaded.value as R
    return finish(loaded.value, candidate.origin)
  }

  type Input<R> = {
    items: ConfigPlugin.Origin[]
    kind: PluginKind
    finish?: (load: Loaded, origin: ConfigPlugin.Origin) => Promise<R | undefined>
    missing?: (value: Missing, origin: ConfigPlugin.Origin) => Promise<R | undefined>
    report?: Report
  }

  // Resolve and load all configured plugins in parallel, dropping skipped or failed entries
  // while preserving the successful result order.
  export async function loadExternal<R = Loaded>(input: Input<R>): Promise<R[]> {
    const out = await Promise.all(
      input.items.map((origin) =>
        attempt({ origin, plan: plan(origin.spec) }, input.kind, input.finish, input.missing, input.report),
      ),
    )
    return out.filter((item): item is Awaited<R> => item !== undefined)
  }
}
