// Removes credentials from text before it is sent to the reviewer model or written to the audit log.
// This is best effort: it catches well-known token shapes and `name=value` pairs whose name sounds secret.

const REDACTED = "[redacted]"

const TOKEN_SHAPES = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /AIza[0-9A-Za-z_-]{30,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
]

const BEARER = /(bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi
const URL_CREDENTIALS = /(:\/\/)[^\s/:@]+:[^\s/@]+@/g
const NAMED_SECRET =
  /((?:api[_-]?key|access[_-]?key|secret[_-]?key|secret|token|passwd|password|authorization|auth)[A-Za-z0-9_]*\s*[=:]\s*)(?!\[redacted\])["']?[^\s"'&;]{6,}["']?/gi

export function redact(text: string) {
  let output = text
  for (const shape of TOKEN_SHAPES) output = output.replace(shape, REDACTED)
  output = output.replace(BEARER, `$1${REDACTED}`)
  output = output.replace(URL_CREDENTIALS, `$1${REDACTED}@`)
  output = output.replace(NAMED_SECRET, `$1${REDACTED}`)
  return output
}

export function truncate(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}
