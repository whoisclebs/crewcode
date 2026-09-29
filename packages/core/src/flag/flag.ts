import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["CREWCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
const fff = process.env["CREWCODE_DISABLE_FFF"]

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? truthy("CREWCODE_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  CREWCODE_AUTO_HEAP_SNAPSHOT: truthy("CREWCODE_AUTO_HEAP_SNAPSHOT"),
  CREWCODE_GIT_BASH_PATH: process.env["CREWCODE_GIT_BASH_PATH"],
  CREWCODE_CONFIG: process.env["CREWCODE_CONFIG"],
  CREWCODE_CONFIG_CONTENT: process.env["CREWCODE_CONFIG_CONTENT"],
  CREWCODE_DISABLE_PRUNE: truthy("CREWCODE_DISABLE_PRUNE"),
  CREWCODE_DISABLE_TERMINAL_TITLE: truthy("CREWCODE_DISABLE_TERMINAL_TITLE"),
  CREWCODE_SHOW_TTFD: truthy("CREWCODE_SHOW_TTFD"),
  CREWCODE_DISABLE_AUTOCOMPACT: truthy("CREWCODE_DISABLE_AUTOCOMPACT"),
  CREWCODE_DISABLE_MOUSE: truthy("CREWCODE_DISABLE_MOUSE"),
  CREWCODE_FAKE_VCS: process.env["CREWCODE_FAKE_VCS"],
  CREWCODE_SERVER_PASSWORD: process.env["CREWCODE_SERVER_PASSWORD"],
  CREWCODE_SERVER_USERNAME: process.env["CREWCODE_SERVER_USERNAME"],
  CREWCODE_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("CREWCODE_DISABLE_FFF"),

  // Experimental
  CREWCODE_EXPERIMENTAL_FILEWATCHER: Config.boolean("CREWCODE_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  CREWCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("CREWCODE_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  CREWCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("CREWCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  CREWCODE_MODELS_PATH: process.env["CREWCODE_MODELS_PATH"],
  CREWCODE_DB: process.env["CREWCODE_DB"],

  CREWCODE_WORKSPACE_ID: process.env["CREWCODE_WORKSPACE_ID"],
  CREWCODE_EXPERIMENTAL_WORKSPACES: enabledByExperimental("CREWCODE_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get CREWCODE_DISABLE_PROJECT_CONFIG() {
    return truthy("CREWCODE_DISABLE_PROJECT_CONFIG")
  },
  get CREWCODE_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("CREWCODE_EXPERIMENTAL_REFERENCES")
  },
  get CREWCODE_TUI_CONFIG() {
    return process.env["CREWCODE_TUI_CONFIG"]
  },
  get CREWCODE_CONFIG_DIR() {
    return process.env["CREWCODE_CONFIG_DIR"]
  },
  get CREWCODE_PURE() {
    return truthy("CREWCODE_PURE")
  },
  get CREWCODE_PERMISSION() {
    return process.env["CREWCODE_PERMISSION"]
  },
  get CREWCODE_PLUGIN_META_FILE() {
    return process.env["CREWCODE_PLUGIN_META_FILE"]
  },
  get CREWCODE_CLIENT() {
    return process.env["CREWCODE_CLIENT"] ?? "cli"
  },
}
