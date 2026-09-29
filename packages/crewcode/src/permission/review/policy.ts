// Deterministic policy for permission requests that a rule already classified as `ask`.
//
// This runs before any model. Whatever it marks `high_impact` is never approved automatically: it goes to a human (or is
// refused when nobody can answer). The reviewer model is only consulted for `review`, and only `routine` may be approved
// without a model. Parsing errors, dynamic command names and anything else the policy cannot resolve are `high_impact`,
// because "I could not tell" must never read as "safe".

import path from "path"
import { globMayMatchSecret, isInside, resolvePath, secretLabel, sensitiveWriteLabel } from "./paths"
import { isShell, parse, parseNested, type Command, type Redirect, type Word } from "./shell"

export type Category =
  | "mass_delete"
  | "secrets"
  | "privilege"
  | "git_push"
  | "history_rewrite"
  | "publish"
  | "deploy"
  | "remote_exec"
  | "remote_access"
  | "sensitive_write"
  | "unresolved"
  | "loop"

export interface Input {
  readonly permission: string
  readonly patterns: readonly string[]
  readonly metadata?: Record<string, unknown>
  /** Project root: paths outside it count as leaving the project. */
  readonly cwd: string
  readonly home: string
}

export type Verdict =
  | { readonly kind: "high_impact"; readonly categories: readonly Category[]; readonly reason: string }
  | { readonly kind: "routine"; readonly reason: string }
  | { readonly kind: "review" }

const REASONS: Record<Category, string> = {
  mass_delete: "deletes or rewrites many files",
  secrets: "reads credentials or secrets",
  privilege: "uses elevated privileges",
  git_push: "publishes commits with git push",
  history_rewrite: "rewrites or discards git history or work",
  publish: "publishes a package, image or release",
  deploy: "changes deployed infrastructure",
  remote_exec: "downloads and runs code",
  remote_access: "talks to a remote host",
  sensitive_write: "writes a file that changes the shell, automation or the agent itself",
  unresolved: "contains something that cannot be resolved statically",
  loop: "repeats the same tool call",
}

export function classify(input: Input): Verdict {
  switch (input.permission) {
    case "bash":
      return classifyBash(input)
    case "edit":
    case "write":
    case "apply_patch":
      return classifyWrite(input)
    case "read":
      return classifyRead(input)
    case "external_directory":
      return classifyExternal(input)
    case "doom_loop":
      return highImpact(["loop"])
    default:
      return { kind: "review" }
  }
}

function highImpact(categories: Iterable<Category>): Verdict {
  const unique = [...new Set(categories)]
  return { kind: "high_impact", categories: unique, reason: unique.map((category) => REASONS[category]).join("; ") }
}

// --- file tools -----------------------------------------------------------------------------------------------------

function toolPaths(input: Input) {
  const values: string[] = [...input.patterns]
  const meta = input.metadata ?? {}
  if (typeof meta.filepath === "string") values.push(meta.filepath)
  if (Array.isArray(meta.files)) {
    for (const file of meta.files) {
      if (typeof file === "string") values.push(file)
      else if (typeof file === "object" && file !== null) {
        const record = file as Record<string, unknown>
        for (const key of ["filePath", "filepath", "path", "relativePath"]) {
          if (typeof record[key] === "string") values.push(record[key])
        }
      }
    }
  }
  return values.filter((value) => value !== "*" && value.length > 0).map((value) => value.replace(/\/\*$/, ""))
}

function classifyWrite(input: Input): Verdict {
  const categories = toolPaths(input).flatMap((value) =>
    sensitiveWriteLabel(resolvePath(value, input.cwd, input.home), input.home) ? (["sensitive_write"] as const) : [],
  )
  return categories.length > 0 ? highImpact(categories) : { kind: "review" }
}

function classifyRead(input: Input): Verdict {
  const secret = toolPaths(input).some((value) => secretLabel(resolvePath(value, input.cwd, input.home)))
  if (secret) return highImpact(["secrets"])
  return { kind: "routine", reason: "reads a file that is not a credential" }
}

function classifyExternal(input: Input): Verdict {
  const secret = toolPaths(input).some((value) => secretLabel(resolvePath(value, input.cwd, input.home)))
  return secret ? highImpact(["secrets"]) : { kind: "review" }
}

// --- bash -----------------------------------------------------------------------------------------------------------

interface Effective {
  readonly name: string
  readonly args: readonly Word[]
  readonly redirects: readonly Redirect[]
  readonly command: Command
  /** True when a wrapper other than plain execution was involved (sudo, env, sh -c, xargs...). */
  readonly wrapped: boolean
  /** Arguments come from a pipe, not from the command line (xargs). */
  readonly fromStdin: boolean
  /** git global options that can change behavior: -c key=value, --exec-path. */
  readonly gitGlobals: boolean
}

interface Analysis {
  readonly categories: Set<Category>
  readonly effective: Effective[]
  /** Something a routine command must not contain: substitutions, unknown wrappers, opaque scripts. */
  opaque: boolean
}

function classifyBash(input: Input): Verdict {
  const meta = input.metadata ?? {}
  const sources = [typeof meta.command === "string" ? meta.command : undefined, ...input.patterns].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  )
  if (sources.length === 0) return { kind: "review" }

  const analysis: Analysis = { categories: new Set(), effective: [], opaque: false }
  for (const source of sources) {
    const parsed = parse(source)
    if (parsed.unresolved) analysis.categories.add("unresolved")
    analyze(parsed.commands, analysis, input, 0)
  }
  if (analysis.categories.size > 0) return highImpact(analysis.categories)
  if (analysis.opaque || analysis.effective.length === 0) return { kind: "review" }
  return analysis.effective.every((item) => isRoutine(item, input))
    ? { kind: "routine", reason: "only reads project files" }
    : { kind: "review" }
}

function analyze(commands: readonly Command[], analysis: Analysis, input: Input, depth: number) {
  detectRemoteExec(commands, analysis)
  for (const command of commands) {
    for (const item of unwrap(command, analysis, input, depth)) {
      analysis.effective.push(item)
      inspect(item, analysis, input, depth)
    }
  }
}

// -- wrappers --

const PRIVILEGE_WRAPPERS = new Set(["sudo", "doas", "pkexec", "su", "runuser", "gosu", "sudoedit"])
const PLAIN_WRAPPERS = new Set([
  "command",
  "builtin",
  "exec",
  "nohup",
  "time",
  "noglob",
  "setsid",
  "caffeinate",
  "unbuffer",
  "stdbuf",
  "ionice",
  "nice",
  "timeout",
  "watch",
  "flock",
  "chronic",
  "busybox",
  "xargs",
  "env",
])

const OPTIONS_WITH_VALUE: Record<string, readonly string[]> = {
  sudo: ["-u", "-g", "-h", "-p", "-C", "-r", "-t", "-T", "-D", "-U", "--user", "--group", "--host", "--prompt"],
  doas: ["-u", "-C"],
  env: ["-u", "-C", "-S", "--unset", "--chdir"],
  nice: ["-n", "--adjustment"],
  ionice: ["-c", "-n", "-p", "-P", "-u"],
  timeout: ["-s", "-k", "--signal", "--kill-after"],
  stdbuf: ["-i", "-o", "-e"],
  xargs: ["-I", "-n", "-P", "-d", "-E", "-s", "-L", "-a", "-R", "-S", "--max-args", "--max-procs", "--delimiter"],
  flock: ["-w", "-E", "--timeout"],
  exec: ["-a"],
  watch: ["-n", "-d", "--interval"],
}

function unwrap(command: Command, analysis: Analysis, input: Input, depth: number): Effective[] {
  let words = command.words.slice()
  let wrapped = command.nested
  let fromStdin = command.pipeIn
  let privileged = false

  for (let guard = 0; guard < 12; guard++) {
    while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0].text) && !words[0].dynamic) words = words.slice(1)
    // Redirections still matter when nothing is left to run, for example `exec 3<>/dev/tcp/host/80`.
    if (words.length === 0) return command.redirects.length > 0 ? [makeEffective("", [], command, wrapped, fromStdin)] : []
    const first = words[0]
    if (first.dynamic || first.glob) {
      analysis.categories.add("unresolved")
      return []
    }
    const name = commandName(first.text)
    const rest = words.slice(1)

    if (PRIVILEGE_WRAPPERS.has(name)) {
      analysis.categories.add("privilege")
      if (name === "su" || name === "runuser") {
        scriptArgument(rest, analysis, input, depth)
        return []
      }
      words = skipOptions(rest, OPTIONS_WITH_VALUE[name] ?? [])
      privileged = true
      wrapped = true
      continue
    }
    if (OPAQUE_RUNNERS.has(name)) {
      analysis.categories.add("unresolved")
      return []
    }
    if (name === "env" && splitString(rest, analysis, input, depth)) return []
    if (PLAIN_WRAPPERS.has(name)) {
      wrapped = true
      const skipped = skipWrapper(name, rest)
      if (name === "xargs") fromStdin = true
      if (name === "env" && skipped.length === 0) {
        analysis.categories.add("secrets")
        return []
      }
      words = skipped
      continue
    }
    if (isShell(name)) {
      if (scriptArgument(rest, analysis, input, depth)) return []
      const file = rest.find((word) => !word.text.startsWith("-"))
      if (file) analysis.opaque = true
      else stdinScript(command, analysis, input, depth)
      return [makeEffective(name, rest, command, true, fromStdin)]
    }
    if (name === "eval") {
      evalWords(rest, analysis, input, depth)
      return []
    }
    if (privileged && rest.length === 0) return []
    return [makeEffective(name, name === "git" ? gitArgs(rest, analysis) : rest, command, wrapped, fromStdin, name === "git" && hasGitGlobals(rest))]
  }
  analysis.categories.add("unresolved")
  return []
}

function makeEffective(
  name: string,
  args: readonly Word[],
  command: Command,
  wrapped: boolean,
  fromStdin: boolean,
  gitGlobals = false,
): Effective {
  return { name, args, redirects: command.redirects, command, wrapped, fromStdin, gitGlobals }
}

function commandName(text: string) {
  return path.posix.basename(text.replace(/^\\+/, ""))
}

function skipOptions(words: readonly Word[], withValue: readonly string[]) {
  let index = 0
  while (index < words.length && words[index].text.startsWith("-") && words[index].text !== "-") {
    const option = words[index].text
    index += withValue.includes(option) ? 2 : 1
    if (option === "--") break
  }
  return words.slice(index)
}

function skipWrapper(name: string, words: readonly Word[]) {
  if (name === "env") {
    let index = 0
    while (index < words.length) {
      const text = words[index].text
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(text)) index++
      else if (text === "--") {
        index++
        break
      } else if (text.startsWith("-")) index += (OPTIONS_WITH_VALUE.env ?? []).includes(text) ? 2 : 1
      else break
    }
    return words.slice(index)
  }
  const skipped = skipOptions(words, OPTIONS_WITH_VALUE[name] ?? [])
  // timeout takes a duration and flock takes a lock file before the command.
  if (name === "timeout" || name === "flock") return skipped.slice(1)
  return skipped
}

/** Analyzes the script given to `sh -c` or `su -c`. Returns true when a script argument was found. */
function scriptArgument(words: readonly Word[], analysis: Analysis, input: Input, depth: number) {
  const index = words.findIndex((word) => /^-[A-Za-z]*c[A-Za-z]*$/.test(word.text) && !word.text.startsWith("--"))
  if (index === -1) return false
  const script = words[index + 1]
  if (!script || script.dynamic) {
    analysis.categories.add("unresolved")
    return true
  }
  const parsed = parseNested(script.text, depth)
  if (parsed.unresolved) analysis.categories.add("unresolved")
  analyze(parsed.commands, analysis, input, depth + 1)
  return true
}

function evalWords(words: readonly Word[], analysis: Analysis, input: Input, depth: number) {
  if (words.some((word) => word.dynamic)) {
    analysis.categories.add("unresolved")
    return
  }
  const parsed = parseNested(words.map((word) => word.text).join(" "), depth)
  if (parsed.unresolved) analysis.categories.add("unresolved")
  analyze(parsed.commands, analysis, input, depth + 1)
}

/** `env -S 'cmd args'` runs the string as a command line. */
function splitString(words: readonly Word[], analysis: Analysis, input: Input, depth: number) {
  const index = words.findIndex((word) => word.text === "-S" || word.text === "--split-string")
  if (index === -1) return false
  const script = words[index + 1]
  if (!script || script.dynamic) {
    analysis.categories.add("unresolved")
    return true
  }
  const parsed = parseNested(script.text, depth)
  if (parsed.unresolved) analysis.categories.add("unresolved")
  analyze(parsed.commands, analysis, input, depth + 1)
  return true
}

/** A shell with no script argument reads its script from stdin: a heredoc, a here-string or a pipe. */
function stdinScript(command: Command, analysis: Analysis, input: Input, depth: number) {
  const body = command.redirects.find((redirect) => redirect.body !== undefined)?.body
  if (body !== undefined) {
    const parsed = parseNested(body, depth)
    if (parsed.unresolved) analysis.categories.add("unresolved")
    analyze(parsed.commands, analysis, input, depth + 1)
    return
  }
  if (command.pipeIn) analysis.categories.add("unresolved")
}

// -- git --

const GIT_OPTIONS_WITH_VALUE = ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix"]

function hasGitGlobals(words: readonly Word[]) {
  for (const word of words) {
    if (!word.text.startsWith("-")) return false
    if (word.text === "-c" || word.text.startsWith("--exec-path") || word.text.startsWith("--git-dir")) return true
  }
  return false
}

/** Drops git's global options so the arguments start at the subcommand. */
const GIT_CONFIG_THAT_RUNS_COMMANDS =
  /^(alias\.|core\.(sshcommand|pager|editor|fsmonitor|hookspath|askpass)|credential\.|diff\.[^=]*\.(command|textconv)|diff\.external|sequence\.editor|gpg\.program|http\.proxy|url\..*\.insteadof)/i

function gitArgs(words: readonly Word[], analysis: Analysis) {
  let index = 0
  while (index < words.length && words[index].text.startsWith("-")) {
    const option = words[index].text
    if (option === "-c" && GIT_CONFIG_THAT_RUNS_COMMANDS.test(words[index + 1]?.text ?? "")) analysis.categories.add("unresolved")
    const takesValue = GIT_OPTIONS_WITH_VALUE.includes(option)
    index += takesValue ? 2 : 1
    if (takesValue && index > words.length) analysis.categories.add("unresolved")
  }
  return words.slice(index)
}

// -- rules --

const INTERPRETERS = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "ash",
  "python",
  "python2",
  "python3",
  "node",
  "nodejs",
  "bun",
  "deno",
  "perl",
  "ruby",
  "php",
  "pwsh",
  "powershell",
  "iex",
  "invoke-expression",
  "source",
  ".",
  "eval",
  "lua",
  "osascript",
])
const DOWNLOADERS = new Set(["curl", "wget", "fetch", "http", "https", "xh", "aria2c", "iwr", "irm", "invoke-webrequest", "invoke-restmethod"])

function stripVersion(name: string) {
  return name.replace(/[0-9.]+$/, "")
}

function isInterpreter(name: string) {
  return INTERPRETERS.has(name) || INTERPRETERS.has(stripVersion(name))
}

function detectRemoteExec(commands: readonly Command[], analysis: Analysis) {
  const downloader = (command: Command | undefined) => {
    const word = command?.words[0]
    return word !== undefined && !word.dynamic && DOWNLOADERS.has(commandName(word.text).toLowerCase())
  }
  const hasDownload = commands.some(downloader)
  if (!hasDownload) return

  for (let index = 0; index < commands.length - 1; index++) {
    if (!downloader(commands[index]) || !commands[index].pipeOut) continue
    const target = firstExecutable(commands[index + 1])
    if (target && isInterpreter(target)) analysis.categories.add("remote_exec")
  }

  for (const command of commands) {
    if (command.nested || downloader(command)) continue
    const name = firstExecutable(command)
    if (!name) continue
    const substituted = command.words.slice(1).some((word) => word.dynamic)
    if (isInterpreter(name) && substituted && commands.some((other) => other.nested && downloader(other))) {
      analysis.categories.add("remote_exec")
    }
    const runsFile =
      name.startsWith(".") || name.startsWith("/") || (isInterpreter(name) && command.words.slice(1).some((word) => !word.text.startsWith("-")))
    const makesExecutable = name === "chmod" && command.words.slice(1).some((word) => /\+x|^[0-7]*[1357][0-7]{0,2}$/.test(word.text))
    if (runsFile || makesExecutable) analysis.categories.add("remote_exec")
  }
}

/** First word after assignments and simple wrappers, used only for pipeline and download detection. */
function firstExecutable(command: Command | undefined) {
  if (!command) return undefined
  let words = command.words.slice()
  for (let guard = 0; guard < 8 && words.length > 0; guard++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0].text)) {
      words = words.slice(1)
      continue
    }
    const name = commandName(words[0].text)
    if (PRIVILEGE_WRAPPERS.has(name) || PLAIN_WRAPPERS.has(name)) {
      words = name === "env" ? skipWrapper("env", words.slice(1)) : skipOptions(words.slice(1), OPTIONS_WITH_VALUE[name] ?? [])
      continue
    }
    return words[0].text.startsWith("./") || words[0].text.startsWith("/") ? words[0].text : name
  }
  return undefined
}

// Commands that run other commands in a way the policy cannot follow, or that schedule work for later.
const OPAQUE_RUNNERS = new Set(["parallel", "at", "batch", "systemd-run", "screen", "tmux", "script", "expect", "zellij", "crontab"])

const RECURSIVE_FLAG = /^-[A-Za-z]*[rR][A-Za-z]*$/
const READERS_OF_NAMES_ONLY = new Set(["ls", "stat", "test", "[", "du", "df", "readlink", "realpath", "basename", "dirname", "which", "type"])
const WRITERS = new Set(["cp", "mv", "install", "ln", "tee", "sed", "perl", "touch", "chmod", "chown", "truncate", "patch", "dd", "curl", "wget", "rsync", "tar", "unzip", "mkdir", "rm"])

function texts(words: readonly Word[]) {
  return words.map((word) => word.text)
}

function flagLetters(args: readonly string[]) {
  return args.filter((arg) => /^-[A-Za-z]+$/.test(arg)).join("").replace(/-/g, "")
}

function inspect(item: Effective, analysis: Analysis, input: Input, depth: number) {
  const add = (category: Category) => analysis.categories.add(category)
  const args = texts(item.args)
  const operands = item.args.filter((word) => !word.text.startsWith("-"))

  inspectPaths(item, analysis, input)

  if (item.name.startsWith("mkfs")) {
    add("mass_delete")
    return
  }

  switch (item.name) {
    case "rm":
    case "unlink":
    case "rmdir": {
      const recursive = args.some((arg) => RECURSIVE_FLAG.test(arg) || arg === "--recursive" || arg === "--no-preserve-root")
      const escapes = operands.some((word) => !isInside(resolvePath(word.text, input.cwd, input.home), input.cwd))
      const wide = operands.some((word) => word.glob || word.text === "." || word.text === ".." || word.text === "*")
      if (recursive || wide || escapes || item.fromStdin) add("mass_delete")
      return
    }
    case "shred":
    case "wipe":
    case "srm":
    case "wipefs":
    case "blkdiscard":
    case "fdisk":
    case "parted":
    case "mke2fs":
      add("mass_delete")
      return
    case "dd":
      if (args.some((arg) => arg.startsWith("of="))) add("mass_delete")
      return
    case "find":
      if (args.includes("-delete")) add("mass_delete")
      analyzeFindExec(item.args, analysis, input, depth)
      return
    case "rsync":
      if (args.some((arg) => arg.startsWith("--delete"))) add("mass_delete")
      if (args.some(isRemoteSpec)) add("remote_access")
      return
    case "chmod":
    case "chown":
    case "chgrp":
      if (args.some((arg) => arg === "--recursive" || RECURSIVE_FLAG.test(arg))) add("mass_delete")
      if (item.name === "chmod" && args.some((arg) => /^[ugoa]*[+=][rwxXt]*s|^[2467][0-7]{3}$/.test(arg))) add("privilege")
      return
    case "printenv":
      add("secrets")
      return
    case "export":
      if (args.includes("-p")) add("secrets")
      return
    case "set":
      if (args.length === 0) add("secrets")
      return
    case "gh":
      inspectGh(args, add)
      return
    case "security":
      if (args.some((arg) => arg.startsWith("find-") && arg.endsWith("-password"))) add("secrets")
      return
    case "ssh":
    case "scp":
    case "sftp":
    case "ssh-copy-id":
    case "mosh":
    case "ftp":
    case "telnet":
    case "nc":
    case "ncat":
    case "netcat":
    case "socat":
    case "rclone":
      add("remote_access")
      return
    case "chroot":
    case "nsenter":
    case "unshare":
    case "setcap":
    case "visudo":
    case "mount":
    case "umount":
    case "insmod":
    case "modprobe":
    case "rmmod":
    case "iptables":
    case "nft":
    case "ufw":
    case "sysctl":
    case "useradd":
    case "userdel":
    case "usermod":
    case "passwd":
    case "chpasswd":
      add("privilege")
      return
    case "docker":
    case "podman":
    case "nerdctl":
    case "buildah":
      inspectContainer(args, add)
      return
    case "git":
      inspectGit(args, add)
      return
    case "npx":
    case "bunx":
    case "pnpx":
    case "uvx":
      add("remote_exec")
      return
    case "pipx":
      if (args[0] === "run") add("remote_exec")
      return
    case "deno":
      if (args[0] === "run" && args.some((arg) => /^https?:\/\//.test(arg))) add("remote_exec")
      return
    case "npm":
    case "pnpm":
    case "yarn":
    case "bun":
      inspectPackageManager(item.name, args, add)
      return
    case "cargo":
      if (["publish", "yank", "login", "owner", "logout"].includes(args[0])) add("publish")
      return
    case "twine":
      if (["upload", "register"].includes(args[0])) add("publish")
      return
    case "python":
    case "python3":
      if (args[0] === "-m" && args[1] === "twine" && args.includes("upload")) add("publish")
      return
    case "gem":
      if (["push", "yank", "owner", "signin"].includes(args[0])) add("publish")
      return
    case "vsce":
    case "ovsx":
    case "semantic-release":
    case "goreleaser":
      if (item.name !== "goreleaser" || args[0] === "release") add("publish")
      return
    case "poetry":
    case "flit":
    case "hatch":
    case "uv":
      if (args[0] === "publish") add("publish")
      return
    case "dotnet":
      if (args[0] === "nuget" && args[1] === "push") add("publish")
      return
    case "mvn":
    case "gradle":
    case "sbt":
    case "lerna":
    case "changeset":
      if (args.some((arg) => arg === "deploy" || arg === "publish" || arg.startsWith("publish"))) add("publish")
      return
    case "helm":
      if (args[0] === "push" || (args[0] === "registry" && args[1] === "login")) add("publish")
      else if (["install", "upgrade", "uninstall", "delete", "rollback"].includes(args[0])) add("deploy")
      return
    default:
      inspectDeploy(item.name, args, add)
  }
}

function inspectPaths(item: Effective, analysis: Analysis, input: Input) {
  const add = (category: Category) => analysis.categories.add(category)
  const candidates = pathCandidates(item)

  for (const redirect of item.redirects) {
    if (/^\/dev\/(tcp|udp)\//.test(redirect.target.text)) add("remote_access")
  }

  if (!READERS_OF_NAMES_ONLY.has(item.name)) {
    for (const candidate of candidates) {
      if (secretLabel(resolvePath(candidate.text, input.cwd, input.home))) add("secrets")
      if (candidate.glob && globMayMatchSecret(candidate.text)) add("secrets")
    }
    for (const redirect of item.redirects) {
      if (redirect.op.startsWith("<") && secretLabel(resolvePath(redirect.target.text, input.cwd, input.home))) add("secrets")
    }
  }

  const written = item.redirects
    .filter((redirect) => isWriteRedirect(redirect))
    .map((redirect) => redirect.target.text)
  if (WRITERS.has(item.name)) written.push(...candidates.map((candidate) => candidate.text))
  for (const target of written) {
    if (sensitiveWriteLabel(resolvePath(target, input.cwd, input.home), input.home)) add("sensitive_write")
  }
}

/** Words that look like paths: operands, `--opt=value` values, `@file` forms and `of=` style values. */
function pathCandidates(item: Effective): { text: string; glob: boolean }[] {
  return item.args.flatMap((word) => {
    const text = word.text
    const as = (value: string) => [{ text: value, glob: word.glob }]
    if (text.startsWith("--") && text.includes("=")) return as(text.slice(text.indexOf("=") + 1))
    if (text.startsWith("-") && text.length > 2 && text.includes("=")) return as(text.slice(text.indexOf("=") + 1))
    if (text.startsWith("-")) return []
    if (text.startsWith("@")) return as(text.slice(1))
    if (/^[a-z]+=/i.test(text)) return as(text.slice(text.indexOf("=") + 1))
    return as(text)
  })
}

function isWriteRedirect(redirect: Redirect) {
  if (redirect.target.text === "/dev/null") return false
  if (redirect.op === ">&" || redirect.op === "<&") return !/^\d+$/.test(redirect.target.text) && redirect.target.text !== "-"
  return redirect.op.startsWith(">") || redirect.op.startsWith("&>")
}

function isRemoteSpec(arg: string) {
  if (arg.startsWith("-")) return false
  if (/^rsync:\/\//.test(arg)) return true
  return /^[^/\s:]+:[^\s]*/.test(arg) && !/^[A-Za-z]:[\\/]/.test(arg)
}

/** Analyzes each command that `find -exec ... ;` or `-exec ... +` would run. */
function analyzeFindExec(words: readonly Word[], analysis: Analysis, input: Input, depth: number) {
  for (let index = 0; index < words.length; index++) {
    if (!["-exec", "-execdir", "-ok", "-okdir"].includes(words[index].text)) continue
    const end = words.findIndex((word, position) => position > index && (word.text === ";" || word.text === "+"))
    const body = words.slice(index + 1, end === -1 ? words.length : end).filter((word) => word.text !== "{}")
    if (body.length === 0) continue
    analyze(
      // The targets come from find, not from the command line, so treat them like piped input.
      [{ words: body, redirects: [], pipeIn: true, pipeOut: false, nested: true }],
      analysis,
      input,
      depth + 1,
    )
  }
}

function inspectGh(args: readonly string[], add: (category: Category) => void) {
  const [group, action] = args.filter((arg) => !arg.startsWith("-"))
  if (group === "auth" && (action === "token" || args.includes("--show-token") || args.includes("-t"))) add("secrets")
  if (group === "auth") return
  const readOnly: Record<string, readonly string[]> = {
    pr: ["view", "list", "diff", "checks", "status"],
    issue: ["view", "list", "status"],
    run: ["view", "list", "watch"],
    repo: ["view", "list"],
    release: ["view", "list"],
    workflow: ["view", "list"],
    search: [],
  }
  if (group === "search" || group === "status" || group === "browse" || group === "help" || group === "--version") return
  if (group && readOnly[group]?.includes(action ?? "")) return
  if (group === "release" && ["view", "list"].includes(action ?? "")) return
  add("publish")
}

function inspectContainer(args: readonly string[], add: (category: Category) => void) {
  const sub = args.find((arg) => !arg.startsWith("-"))
  if (sub === "push" || sub === "login") add("publish")
  if (sub === "manifest" && args.includes("push")) add("publish")
  if (args.includes("--push")) add("publish")
  if (args.some((arg) => arg === "--privileged" || arg === "--pid=host" || arg.startsWith("--cap-add") || arg === "--userns=host")) {
    add("privilege")
  }
  const mounted = args.some((arg, index) => (arg === "-v" || arg === "--volume") && /^\/(:|$)/.test(args[index + 1] ?? ""))
  if (mounted) add("privilege")
}

function inspectPackageManager(name: string, args: readonly string[], add: (category: Category) => void) {
  const words = args.filter((arg) => !arg.startsWith("-"))
  const [sub, next] = words
  const publishing = ["publish", "unpublish", "deprecate", "dist-tag", "access", "owner", "adduser", "login", "token", "team", "org", "hook"]
  if (publishing.includes(sub)) add("publish")
  if (name === "yarn" && sub === "npm" && publishing.includes(next)) add("publish")
  if (["dlx", "exec"].includes(sub) || (name === "bun" && sub === "x")) add("remote_exec")
}

const DEPLOY_TABLE: Record<string, readonly string[] | "always"> = {
  terraform: ["apply", "destroy", "import", "taint", "untaint", "state", "force-unlock", "workspace", "refresh"],
  tofu: ["apply", "destroy", "import", "taint", "untaint", "state", "force-unlock", "workspace", "refresh"],
  terragrunt: ["apply", "destroy", "run-all"],
  pulumi: ["up", "destroy", "refresh", "import", "cancel", "stack", "state"],
  cdk: ["deploy", "destroy", "bootstrap"],
  sst: ["deploy", "remove", "unlock"],
  serverless: ["deploy", "remove"],
  sls: ["deploy", "remove"],
  firebase: ["deploy"],
  railway: ["up", "deploy", "down", "redeploy", "delete"],
  amplify: ["publish", "push", "delete"],
  sam: ["deploy", "delete"],
}

const CLOUD_CLIS = new Set(["aws", "gcloud", "az", "doctl", "hcloud", "linode-cli", "oci", "ibmcloud", "scw", "upctl"])
const MUTATING_VERB =
  /^(delete|remove|rm|terminate|destroy|create|update|deploy|apply|put|set|run|start|stop|reboot|attach|detach|invoke|publish|push|sync|cp|mv|add|modify|reset|import|export|copy|patch|replace|scale|enable|disable|grant|revoke|rotate|release|promote|rollback|upload|write|kill|purge|drop|truncate)([-_].*)?$/
const KUBECTL_READ = new Set(["get", "describe", "logs", "top", "explain", "api-resources", "api-versions", "version", "cluster-info", "diff", "events", "completion", "options", "auth", "config"])

function inspectDeploy(name: string, args: readonly string[], add: (category: Category) => void) {
  const words = args.filter((arg) => !arg.startsWith("-"))
  const rule = DEPLOY_TABLE[name]
  if (rule) {
    if (rule === "always" || words.some((word) => rule.includes(word))) add("deploy")
    return
  }
  if (name === "kubectl" || name === "oc") {
    if (words.length > 0 && !KUBECTL_READ.has(words[0])) add("deploy")
    if (words[0] === "config" && args.includes("--raw")) add("secrets")
    return
  }
  if (name === "wrangler") {
    if (words.length > 0 && !["dev", "types", "whoami", "tail", "help", "version"].includes(words[0])) add("deploy")
    return
  }
  if (["vercel", "netlify", "now", "surge", "gh-pages"].includes(name)) {
    if (!["whoami", "ls", "list", "inspect", "logs", "dev", "help", "status", "version"].includes(words[0] ?? "")) add("deploy")
    return
  }
  if (["fly", "flyctl"].includes(name)) {
    if (!["status", "logs", "version", "help", "doctor", "info", "ping"].includes(words[0] ?? "")) add("deploy")
    return
  }
  if (name === "heroku") {
    if (!["logs", "whoami", "help", "version"].includes(words[0] ?? "")) add("deploy")
    return
  }
  if (CLOUD_CLIS.has(name)) {
    if (words.some((word) => MUTATING_VERB.test(word))) add("deploy")
  }
}

// -- git --

const GIT_READ_ONLY = new Set([
  "status",
  "diff",
  "log",
  "show",
  "rev-parse",
  "ls-files",
  "blame",
  "describe",
  "shortlog",
  "whatchanged",
  "ls-tree",
  "cat-file",
  "rev-list",
  "name-rev",
  "grep",
  "count-objects",
  "diff-tree",
  "merge-base",
  "for-each-ref",
  "version",
  "help",
])

function inspectGit(args: readonly string[], add: (category: Category) => void) {
  const [sub, ...rest] = args
  const restFlags = rest.filter((arg) => arg.startsWith("-"))
  const has = (...names: string[]) => rest.some((arg) => names.includes(arg))
  switch (sub) {
    case "push": {
      add("git_push")
      const refspecRewrite = rest.some((arg) => arg.startsWith(":") || arg.startsWith("+"))
      if (has("--force", "-f", "--force-with-lease", "--delete", "-d", "--mirror", "--prune") || rest.some((arg) => arg.startsWith("--force-with-lease")) || refspecRewrite) {
        add("history_rewrite")
      }
      return
    }
    case "reset": {
      const hard = has("--hard", "--merge", "--keep")
      const target = rest.some((arg) => /~|\^|^[0-9a-f]{7,40}$/i.test(arg))
      if (hard || ((has("--soft", "--mixed") || target) && target)) add("history_rewrite")
      return
    }
    case "rebase":
    case "filter-branch":
    case "filter-repo":
    case "prune":
      add("history_rewrite")
      return
    case "commit":
      if (has("--amend")) add("history_rewrite")
      return
    case "reflog":
      if (has("expire", "delete")) add("history_rewrite")
      return
    case "branch":
      if (has("-D") || (has("--delete") && has("--force", "-f"))) add("history_rewrite")
      return
    case "checkout": {
      const creates = has("-b", "-B", "--orphan", "--track", "-t", "--detach")
      if (!creates && (has("--", "-f", "--force", ".") )) add("history_rewrite")
      return
    }
    case "restore": {
      const stagedOnly = has("--staged", "-S") && !has("--worktree", "-W")
      if (!stagedOnly) add("history_rewrite")
      return
    }
    case "stash":
      if (has("drop", "clear")) add("history_rewrite")
      return
    case "update-ref":
      if (has("-d")) add("history_rewrite")
      return
    case "gc":
      if (rest.some((arg) => arg.startsWith("--prune=") && arg !== "--prune=2.weeks.ago")) add("history_rewrite")
      return
    case "clean":
      if (!has("-n", "--dry-run") && flagLetters(rest).includes("f")) add("mass_delete")
      else if (has("--force")) add("mass_delete")
      return
    case "rm":
      if (restFlags.some((flag) => RECURSIVE_FLAG.test(flag))) add("mass_delete")
      return
    case "credential":
      add("secrets")
      return
    case "config":
      if (rest.some((arg) => /credential|token|password|secret/i.test(arg))) add("secrets")
      return
  }
}

// -- routine --

const READ_ONLY_COMMANDS = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "stat",
  "file",
  "du",
  "df",
  "tree",
  "nl",
  "sort",
  "uniq",
  "cut",
  "tr",
  "diff",
  "cmp",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "fd",
  "fdfind",
  "find",
  "jq",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "sha256sum",
  "md5sum",
  "cksum",
  "column",
  "cd",
  "test",
  "[",
  "echo",
  "printf",
  "pwd",
  "date",
  "whoami",
  "uname",
  "id",
  "hostname",
  "true",
  "false",
  "which",
  "type",
])
const PATHLESS = new Set(["echo", "printf", "pwd", "date", "whoami", "uname", "id", "hostname", "true", "false", "which", "type"])

const GIT_LIST_FLAGS = new Set(["-a", "-r", "-v", "-vv", "--all", "--remotes", "--list", "-l", "--show-current", "--verbose"])

function isRoutine(item: Effective, input: Input) {
  if (item.wrapped || item.command.nested) return false
  if (item.args.some((word) => word.dynamic)) return false
  if (item.redirects.some((redirect) => !isHarmlessRedirect(redirect, input))) return false
  const args = texts(item.args)

  if (item.name === "git") {
    if (item.gitGlobals) return false
    const [sub, ...rest] = args
    if (!GIT_READ_ONLY.has(sub) && !isGitListing(sub, rest)) return false
    if (rest.some((arg) => arg.startsWith("--output") || arg.startsWith("--exec") || arg.startsWith("--ext-diff"))) return false
    return relativePaths(item.args.slice(1), input)
  }
  if (!READ_ONLY_COMMANDS.has(item.name)) return false
  if (item.name === "find" && args.some((arg) => /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/.test(arg))) return false
  if (item.name === "sort" && args.some((arg) => arg === "-o" || arg.startsWith("--output") || arg.startsWith("-o"))) return false
  if (item.name === "tree" && args.some((arg) => arg === "-o" || arg.startsWith("--output"))) return false
  if (item.name === "rg" && args.some((arg) => arg.startsWith("--pre"))) return false
  if (["fd", "fdfind"].includes(item.name) && args.some((arg) => ["-x", "--exec", "-X", "--exec-batch"].includes(arg))) return false
  if (PATHLESS.has(item.name)) return true
  return relativePaths(item.args, input)
}

function isGitListing(sub: string, rest: readonly string[]) {
  if (sub === "branch") return rest.every((arg) => GIT_LIST_FLAGS.has(arg))
  if (sub === "tag") return rest.every((arg) => arg === "-l" || arg === "--list")
  if (sub === "remote") return rest.every((arg) => arg === "-v" || arg === "--verbose")
  if (sub === "stash") return rest[0] === "list"
  if (sub === "reflog") return rest.length === 0 || rest[0] === "show"
  return false
}

function isHarmlessRedirect(redirect: Redirect, input: Input) {
  if (redirect.target.text === "/dev/null") return true
  if (redirect.op === ">&" || redirect.op === "<&") return /^\d+$/.test(redirect.target.text)
  if (redirect.op === "<") return relativePaths([redirect.target], input)
  return false
}

/** Every operand stays inside the project: no absolute paths, no home, no parent directories. */
function relativePaths(words: readonly Word[], input: Input) {
  return words.every((word) => {
    if (word.text.startsWith("-")) return true
    const text = word.text
    if (text.startsWith("/") || text.startsWith("~")) return false
    if (text === ".." || text.startsWith("../") || text.includes("/../")) return false
    return isInside(resolvePath(text, input.cwd, input.home), input.cwd) || !/[\\/]/.test(text)
  })
}
