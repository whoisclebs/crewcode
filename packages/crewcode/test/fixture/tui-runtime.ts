import { spyOn } from "bun:test"
import path from "path"
import { resolve, type Info, type Resolved } from "@crewcode/tui/config"
import { TuiKeybind } from "@crewcode/tui/config/keybind"

type PluginSpec = string | [string, Record<string, unknown>]
type PluginOrigin = {
  spec: PluginSpec
  scope: "global" | "local"
  source: string
}
type HostResolved = Resolved & { plugin_origins?: PluginOrigin[] }
type ResolvedInput = Omit<Info, "attention" | "keybinds" | "leader_timeout"> & {
  attention?: Partial<Resolved["attention"]>
  keybinds?: Partial<TuiKeybind.Keybinds>
  leader_timeout?: number
  plugin_origins?: PluginOrigin[]
}

export function createTuiResolvedKeybinds(input: Partial<TuiKeybind.Keybinds> = {}): Resolved["keybinds"] {
  return resolve({ keybinds: input }, { terminalSuspend: process.platform !== "win32" }).keybinds
}

export function createTuiResolvedConfig(input: ResolvedInput = {}): HostResolved {
  return {
    ...resolve(input, { terminalSuspend: process.platform !== "win32" }),
    plugin_origins: input.plugin_origins,
  }
}

export function mockTuiRuntime(dir: string, plugin: PluginSpec[], opts?: { plugin_enabled?: Record<string, boolean> }) {
  process.env.CREWCODE_PLUGIN_META_FILE = path.join(dir, "plugin-meta.json")
  const plugin_origins = plugin.map((spec) => ({
    spec,
    scope: "local" as const,
    source: path.join(dir, "tui.json"),
  }))
  const cwd = spyOn(process, "cwd").mockImplementation(() => dir)

  const config = createTuiResolvedConfig({
    plugin,
    plugin_origins,
    ...(opts?.plugin_enabled && { plugin_enabled: opts.plugin_enabled }),
  })

  return {
    config,
    restore: () => {
      cwd.mockRestore()
      delete process.env.CREWCODE_PLUGIN_META_FILE
    },
  }
}
