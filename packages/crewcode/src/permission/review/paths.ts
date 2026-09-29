// the OpenCode names below are protected on purpose
import path from "path"

// Path rules for the permission reviewer. They work on strings only: nothing here touches the filesystem.

const TEMPLATE_SUFFIX = /\.(example|sample|template|dist|tpl)$/i

const SECRET_BASENAMES = [
  /^\.env(\..+)?$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\..+)?$/i,
  /\.(pem|key|p12|pfx|kdbx|jks|keystore)$/i,
  /^\.?netrc$/i,
  /^_netrc$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^\.git-credentials$/i,
  /^\.pgpass$/i,
  /^\.htpasswd$/i,
  /^credentials(\.json)?$/i,
  /^secrets?\.(json|ya?ml|toml|env|txt)$/i,
  /^service[-_]account.*\.json$/i,
  /\.tfvars$/i,
  /\.tfstate(\.backup)?$/i,
]

const SECRET_SEGMENTS = [".ssh", ".aws", ".gnupg", ".kube", ".azure", ".password-store", "keychains", "keyrings"]

const SECRET_SUFFIXES = [
  ".docker/config.json",
  ".config/gcloud",
  ".config/gh/hosts.yml",
  ".config/op",
  "/etc/shadow",
  "/etc/gshadow",
  "/etc/sudoers",
  "/proc/self/environ",
]

const SHELL_STARTUP = new Set([
  ".bashrc",
  ".bash_profile",
  ".bash_login",
  ".bash_logout",
  ".profile",
  ".zshrc",
  ".zshenv",
  ".zprofile",
  ".zlogin",
  ".zlogout",
  ".cshrc",
  ".tcshrc",
  ".kshrc",
  ".xinitrc",
  ".xprofile",
])

// The agent's own configuration decides what it may do, so an agent editing it is editing its own permissions.
// The OpenCode names stay because a project or home directory may still carry them.
const AGENT_CONFIG_FILES = new Set(["crewcode.json", "crewcode.jsonc", "opencode.json", "opencode.jsonc", "tui.json"])
const AGENT_CONFIG_DIRS = [".crewcode", ".opencode"]

const CI_AND_HOOKS = [
  ".git/hooks",
  ".git/config",
  ".github/workflows",
  ".github/actions",
  ".circleci",
  ".buildkite",
  ".husky",
]
const CI_FILES = new Set([".gitlab-ci.yml", ".gitlab-ci.yaml", "azure-pipelines.yml", "jenkinsfile", "bitbucket-pipelines.yml"])

export function resolvePath(input: string, cwd: string, home: string) {
  const value = input.replace(/^\$\{?HOME\}?(?=\/|$)/, home)
  if (value === "~") return home
  if (value.startsWith("~/")) return path.posix.join(home, value.slice(2))
  return path.posix.resolve(cwd, value)
}

export function isInside(target: string, root: string) {
  const relative = path.posix.relative(root, target)
  return relative === "" || (!relative.startsWith("..") && !path.posix.isAbsolute(relative))
}

/** A label when the path holds credentials, keys or tokens, otherwise undefined. */
export function secretLabel(target: string) {
  const normalized = target.replace(/\\/g, "/")
  const base = path.posix.basename(normalized)
  const lowerBase = base.toLowerCase()
  if (TEMPLATE_SUFFIX.test(base)) return undefined
  if (SECRET_BASENAMES.some((pattern) => pattern.test(base))) return `credential file ${base}`
  const segments = normalized.toLowerCase().split("/")
  const segment = SECRET_SEGMENTS.find((item) => segments.includes(item))
  if (segment) return `credential directory ${segment}`
  const suffix = SECRET_SUFFIXES.find((item) => normalized.toLowerCase().includes(item))
  if (suffix) return `credential path ${suffix}`
  if (/\/proc\/[^/]+\/environ$/.test(normalized)) return "process environment"
  if (lowerBase === "auth.json" && /\/(crewcode|opencode)\//.test(normalized)) return "agent credential store"
  return undefined
}

/** A label when writing here can run code later, change the shell, or change the agent's own permissions. */
export function sensitiveWriteLabel(target: string, home: string) {
  const normalized = target.replace(/\\/g, "/")
  const base = path.posix.basename(normalized)
  const secret = secretLabel(normalized)
  if (secret) return secret
  const lower = normalized.toLowerCase()
  const ci = CI_AND_HOOKS.find((item) => lower.includes(`/${item}/`) || lower.endsWith(`/${item}`))
  if (ci) return `automation entry point ${ci}`
  if (CI_FILES.has(base.toLowerCase())) return `CI configuration ${base}`
  if (AGENT_CONFIG_FILES.has(base)) return `agent configuration ${base}`
  const configDir = AGENT_CONFIG_DIRS.find((item) => normalized.split("/").includes(item))
  if (configDir) return `agent configuration directory ${configDir}`
  if (normalized.startsWith(`${home}/.config/crewcode`) || normalized.startsWith(`${home}/.config/opencode`)) {
    return "agent configuration directory"
  }
  if (path.posix.dirname(normalized) === home && SHELL_STARTUP.has(base)) return `shell startup file ${base}`
  if (normalized.startsWith(`${home}/.config/fish/`)) return "shell startup file"
  if (normalized.startsWith(`${home}/.config/systemd/`)) return "user service definition"
  if (normalized.startsWith(`${home}/.local/bin/`) || normalized.startsWith(`${home}/bin/`)) return "executable on PATH"
  if (normalized.startsWith("/etc/") || normalized === "/etc") return "system configuration"
  if (normalized.startsWith("/var/spool/cron")) return "scheduled jobs"
  return undefined
}

// Canonical secret locations. A glob is refused when it can expand to any of them.
const SECRET_SAMPLES = [
  ".env",
  ".env.local",
  ".env.production",
  ".ssh/id_rsa",
  ".ssh/id_ed25519",
  ".ssh/config",
  ".aws/credentials",
  ".aws/config",
  ".gnupg/private-keys-v1.d",
  ".kube/config",
  ".docker/config.json",
  ".npmrc",
  ".netrc",
  ".pgpass",
  ".pypirc",
  ".git-credentials",
  "id_rsa",
  "credentials",
  "server.pem",
  "server.key",
  "cert.pfx",
  "vault.kdbx",
  "secrets.json",
  "terraform.tfvars",
]

/** True when the glob can expand to a credential or key file. Compares the glob and each sample from the end. */
export function globMayMatchSecret(glob: string) {
  const segments = glob.replace(/\\/g, "/").split("/").filter((segment) => segment !== "" && segment !== "~" && segment !== ".")
  if (segments.length === 0) return false
  return SECRET_SAMPLES.some((sample) => {
    const parts = sample.split("/")
    const compared = Math.min(segments.length, parts.length)
    for (let offset = 1; offset <= compared; offset++) {
      const pattern = segments[segments.length - offset]
      const part = parts[parts.length - offset]
      if (!segmentMatches(pattern, part)) return false
    }
    return true
  })
}

function segmentMatches(pattern: string, value: string) {
  const source = pattern
    .replace(/[.+^${}()|\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  try {
    return new RegExp(`^${source}$`).test(value)
  } catch {
    return true
  }
}
