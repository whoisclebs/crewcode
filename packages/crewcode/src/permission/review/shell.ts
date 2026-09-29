// A small shell lexer for the permission reviewer.
//
// It does not execute or expand anything. It splits a command line into simple commands the way a shell would (quotes,
// escapes, pipes, lists, subshells, `$(...)`, backticks, heredocs) and marks every word it cannot resolve statically.
// Anything it cannot parse confidently is reported as `unresolved`, and callers must treat that as "ask a human".

export interface Word {
  readonly text: string
  /** Contains `$VAR`, `${...}`, `$(...)`, backticks or process substitution: the real value is unknown. */
  readonly dynamic: boolean
  /** Contains an unquoted glob character, so it can expand to many paths. */
  readonly glob: boolean
}

export interface Redirect {
  readonly op: string
  readonly target: Word
  /** Text of a heredoc (`<<`) or here-string (`<<<`), when the redirect carries one. */
  readonly body?: string
}

export interface Command {
  readonly words: readonly Word[]
  readonly redirects: readonly Redirect[]
  readonly pipeIn: boolean
  readonly pipeOut: boolean
  /** Came from inside `$(...)`, backticks, process substitution, `sh -c` or `eval`. */
  readonly nested: boolean
}

export interface Parsed {
  readonly commands: readonly Command[]
  /** Unbalanced quotes or parentheses, too deep nesting, or anything else the lexer could not follow. */
  readonly unresolved: boolean
}

const MAX_DEPTH = 6
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh", "ash"])

type Token =
  | { readonly type: "word"; readonly word: Word }
  | { readonly type: "op"; readonly op: string }
  | { readonly type: "redirect"; readonly op: string; readonly body?: number }

interface Scan {
  readonly tokens: Token[]
  readonly nested: string[]
  /** Heredoc bodies in the order their redirects appear. */
  readonly bodies: string[]
  unresolved: boolean
}

export function parse(source: string, depth = 0): Parsed {
  if (depth > MAX_DEPTH) return { commands: [], unresolved: true }
  const scan = scanTokens(source)
  const parsed = group(scan.tokens, depth > 0, scan.bodies)
  const commands = [...parsed]
  let unresolved = scan.unresolved
  for (const inner of scan.nested) {
    const result = parse(inner, depth + 1)
    commands.push(...result.commands.map((command) => ({ ...command, nested: true })))
    unresolved ||= result.unresolved
  }
  return { commands, unresolved }
}

/** Parses the script argument of `sh -c`, `eval` and friends and marks the result as nested. */
export function parseNested(script: string, depth: number): Parsed {
  const result = parse(script, depth + 1)
  return { commands: result.commands.map((command) => ({ ...command, nested: true })), unresolved: result.unresolved }
}

export function isShell(name: string) {
  return SHELLS.has(name)
}

function scanTokens(source: string): Scan {
  const scan: Scan = { tokens: [], nested: [], bodies: [], unresolved: false }
  const heredocs: { delimiter: string; quoted: boolean; strip: boolean; slot: number }[] = []
  let index = 0

  const at = (offset = 0) => source[index + offset]
  const flush = (word: WordBuilder) => {
    if (!word.started) return
    scan.tokens.push({ type: "word", word: word.build() })
    word.reset()
  }

  const readHeredocBodies = () => {
    for (const heredoc of heredocs) {
      const lines: string[] = []
      while (index < source.length) {
        const end = source.indexOf("\n", index)
        const line = source.slice(index, end === -1 ? source.length : end)
        index = end === -1 ? source.length : end + 1
        const candidate = heredoc.strip ? line.replace(/^\t+/, "") : line
        if (candidate === heredoc.delimiter) break
        lines.push(candidate)
        if (!heredoc.quoted) collectSubstitutions(line, scan)
      }
      scan.bodies[heredoc.slot] = lines.join("\n")
    }
    heredocs.length = 0
  }

  const word = new WordBuilder()
  while (index < source.length) {
    const char = at()

    if (char === "\n") {
      flush(word)
      scan.tokens.push({ type: "op", op: "\n" })
      index++
      if (heredocs.length > 0) readHeredocBodies()
      continue
    }
    if (char === " " || char === "\t" || char === "\r") {
      flush(word)
      index++
      continue
    }
    if (char === "\\") {
      if (at(1) === "\n") {
        index += 2
        continue
      }
      if (index + 1 >= source.length) {
        scan.unresolved = true
        index++
        continue
      }
      word.add(at(1))
      index += 2
      continue
    }
    if (char === "#" && !word.started) {
      while (index < source.length && at() !== "\n") index++
      continue
    }
    if (char === "'") {
      const end = source.indexOf("'", index + 1)
      if (end === -1) {
        scan.unresolved = true
        index = source.length
        continue
      }
      word.add(source.slice(index + 1, end))
      index = end + 1
      continue
    }
    if (char === '"') {
      index = readDoubleQuoted(source, index, word, scan)
      continue
    }
    if (char === "$") {
      index = readDollar(source, index, word, scan)
      continue
    }
    if (char === "`") {
      const end = findBacktick(source, index)
      if (end === -1) {
        scan.unresolved = true
        index = source.length
        continue
      }
      scan.nested.push(source.slice(index + 1, end))
      word.add("`...`", { dynamic: true })
      index = end + 1
      continue
    }
    if ((char === "<" || char === ">") && at(1) === "(") {
      const end = findClosing(source, index + 1, "(", ")")
      if (end === -1) {
        scan.unresolved = true
        index = source.length
        continue
      }
      scan.nested.push(source.slice(index + 2, end))
      word.add(`${char}(...)`, { dynamic: true })
      index = end + 1
      continue
    }
    if (char === "*" || char === "?" || char === "[") {
      word.add(char, { glob: true })
      index++
      continue
    }
    if (char === "{" || char === "}") {
      // A lone `{` or `}` is command grouping. Anywhere else it belongs to the word, and `{a,b}` is brace expansion.
      const next = at(1)
      const standalone = !word.started && (next === undefined || /[\s;&|)]/.test(next))
      if (standalone) {
        scan.tokens.push({ type: "op", op: char })
        index++
        continue
      }
      word.add(char, { dynamic: char === "{" && /^\{[^{}\s]*,[^{}\s]*\}/.test(source.slice(index)) })
      index++
      continue
    }
    if (char === "&" && at(1) === ">") {
      flush(word)
      const op = at(2) === ">" ? "&>>" : "&>"
      scan.tokens.push({ type: "redirect", op })
      index += op.length
      continue
    }
    if (char === "|" || char === "&" || char === ";" || char === "(" || char === ")") {
      flush(word)
      const two = source.slice(index, index + 2)
      const op = ["&&", "||", "|&", ";;"].includes(two) ? two : char
      scan.tokens.push({ type: "op", op })
      index += op.length
      continue
    }
    if (char === "<" || char === ">") {
      const numeric = word.started && /^\d+$/.test(word.peek())
      if (numeric) word.reset()
      else flush(word)
      const three = source.slice(index, index + 3)
      const two = source.slice(index, index + 2)
      const op = ["<<<", "&>>"].includes(three)
        ? three
        : ["<<", ">>", ">&", "<&", ">|", "&>"].includes(two)
          ? two
          : char
      if (op === "<<") {
        const slot = scan.bodies.length
        scan.bodies.push("")
        scan.tokens.push({ type: "redirect", op, body: slot })
        index += op.length
        index = readHeredocDelimiter(source, index, heredocs, scan, slot)
        continue
      }
      scan.tokens.push({ type: "redirect", op })
      index += op.length
      continue
    }
    word.add(char)
    index++
  }
  flush(word)
  return scan
}

class WordBuilder {
  private text = ""
  private isDynamic = false
  private isGlob = false
  started = false

  add(text: string, flags: { dynamic?: boolean; glob?: boolean } = {}) {
    this.text += text
    this.started = true
    this.isDynamic ||= flags.dynamic === true
    this.isGlob ||= flags.glob === true
  }

  /** A quoted empty string such as `""` still counts as a word. */
  touch() {
    this.started = true
  }

  peek() {
    return this.text
  }

  build(): Word {
    return { text: this.text, dynamic: this.isDynamic, glob: this.isGlob }
  }

  reset() {
    this.text = ""
    this.isDynamic = false
    this.isGlob = false
    this.started = false
  }
}

function readDoubleQuoted(source: string, start: number, word: WordBuilder, scan: Scan) {
  word.touch()
  let index = start + 1
  while (index < source.length) {
    const char = source[index]
    if (char === '"') return index + 1
    if (char === "\\" && index + 1 < source.length) {
      const next = source[index + 1]
      if (['"', "\\", "$", "`"].includes(next)) word.add(next)
      else if (next !== "\n") word.add(char + next)
      index += 2
      continue
    }
    if (char === "$") {
      index = readDollar(source, index, word, scan)
      continue
    }
    if (char === "`") {
      const end = findBacktick(source, index)
      if (end === -1) break
      scan.nested.push(source.slice(index + 1, end))
      word.add("`...`", { dynamic: true })
      index = end + 1
      continue
    }
    word.add(char)
    index++
  }
  scan.unresolved = true
  return source.length
}

function readDollar(source: string, start: number, word: WordBuilder, scan: Scan) {
  const next = source[start + 1]
  if (next === "(") {
    const arithmetic = source[start + 2] === "("
    const end = findClosing(source, start + 1, "(", ")")
    if (end === -1) {
      scan.unresolved = true
      return source.length
    }
    if (!arithmetic) scan.nested.push(source.slice(start + 2, end))
    word.add("$(...)", { dynamic: true })
    return end + 1
  }
  if (next === "{") {
    const end = findClosing(source, start + 1, "{", "}")
    if (end === -1) {
      scan.unresolved = true
      return source.length
    }
    collectSubstitutions(source.slice(start + 2, end), scan)
    word.add("${...}", { dynamic: true })
    return end + 1
  }
  if (next === "'") {
    // ANSI-C quoting: $'a\nb'. Treated as a plain quoted literal.
    const end = findSingleQuoteEnd(source, start + 2)
    if (end === -1) {
      scan.unresolved = true
      return source.length
    }
    // Escapes such as \x72 or \155 decode to other characters, so the real text is not the literal one.
    const literal = source.slice(start + 2, end)
    word.add(literal, { dynamic: literal.includes("\\") })
    return end + 1
  }
  if (next !== undefined && /[A-Za-z0-9_@*#?$!-]/.test(next)) {
    let end = start + 2
    if (/[A-Za-z_]/.test(next)) while (end < source.length && /[A-Za-z0-9_]/.test(source[end])) end++
    word.add(source.slice(start, end), { dynamic: true })
    return end
  }
  word.add("$")
  return start + 1
}

function readHeredocDelimiter(
  source: string,
  start: number,
  heredocs: { delimiter: string; quoted: boolean; strip: boolean; slot: number }[],
  scan: Scan,
  slot: number,
) {
  let index = start
  const strip = source[index] === "-"
  if (strip) index++
  while (source[index] === " " || source[index] === "\t") index++
  let delimiter = ""
  let quoted = false
  while (index < source.length && !/[\s;&|()<>]/.test(source[index])) {
    const char = source[index]
    if (char === "'" || char === '"') {
      const end = source.indexOf(char, index + 1)
      if (end === -1) {
        scan.unresolved = true
        return source.length
      }
      delimiter += source.slice(index + 1, end)
      quoted = true
      index = end + 1
      continue
    }
    if (char === "\\") {
      quoted = true
      index++
      continue
    }
    delimiter += char
    index++
  }
  if (delimiter === "") scan.unresolved = true
  else heredocs.push({ delimiter, quoted, strip, slot })
  return index
}

function collectSubstitutions(text: string, scan: Scan) {
  let index = 0
  while (index < text.length) {
    if (text[index] === "\\") {
      index += 2
      continue
    }
    if (text[index] === "$" && text[index + 1] === "(" && text[index + 2] !== "(") {
      const end = findClosing(text, index + 1, "(", ")")
      if (end === -1) {
        scan.unresolved = true
        return
      }
      scan.nested.push(text.slice(index + 2, end))
      index = end + 1
      continue
    }
    if (text[index] === "`") {
      const end = findBacktick(text, index)
      if (end === -1) {
        scan.unresolved = true
        return
      }
      scan.nested.push(text.slice(index + 1, end))
      index = end + 1
      continue
    }
    index++
  }
}

function findBacktick(source: string, start: number) {
  for (let index = start + 1; index < source.length; index++) {
    if (source[index] === "\\") {
      index++
      continue
    }
    if (source[index] === "`") return index
  }
  return -1
}

function findSingleQuoteEnd(source: string, start: number) {
  for (let index = start; index < source.length; index++) {
    if (source[index] === "\\") {
      index++
      continue
    }
    if (source[index] === "'") return index
  }
  return -1
}

/** Index of the bracket that closes the one at `open`, skipping quotes and escapes. */
function findClosing(source: string, open: number, left: string, right: string) {
  let depth = 0
  for (let index = open; index < source.length; index++) {
    const char = source[index]
    if (char === "\\") {
      index++
      continue
    }
    if (char === "'") {
      const end = source.indexOf("'", index + 1)
      if (end === -1) return -1
      index = end
      continue
    }
    if (char === '"') {
      let end = index + 1
      while (end < source.length && source[end] !== '"') end += source[end] === "\\" ? 2 : 1
      if (end >= source.length) return -1
      index = end
      continue
    }
    if (char === left) depth++
    if (char === right) {
      depth--
      if (depth === 0) return index
    }
  }
  return -1
}

const NO_TARGET: Word = { text: "", dynamic: false, glob: false }

const KEYWORDS_DROP_LINE = new Set(["for", "select", "case", "function"])
const KEYWORDS_DROP_WORD = new Set(["if", "then", "else", "elif", "fi", "while", "until", "do", "done", "esac", "in", "!"])

function group(tokens: readonly Token[], nested: boolean, bodies: readonly string[]): Command[] {
  const commands: Command[] = []
  let words: Word[] = []
  let redirects: Redirect[] = []
  let pipeIn = false
  let pendingRedirect: { readonly op: string } | undefined

  const finish = (pipeOut: boolean) => {
    const cleaned = dropKeywords(words)
    if (cleaned.length > 0 || redirects.length > 0) {
      commands.push({ words: cleaned, redirects, pipeIn, pipeOut, nested })
    }
    words = []
    redirects = []
    pipeIn = pipeOut
    pendingRedirect = undefined
  }

  for (const token of tokens) {
    if (token.type === "redirect") {
      // A heredoc delimiter is consumed by the scanner, so this redirect never gets a target word of its own.
      if (token.body !== undefined) {
        redirects.push({ op: token.op, target: NO_TARGET, body: bodies[token.body] })
        continue
      }
      pendingRedirect = { op: token.op }
      continue
    }
    if (token.type === "word") {
      if (pendingRedirect !== undefined) {
        redirects.push({
          op: pendingRedirect.op,
          target: token.word,
          body: pendingRedirect.op === "<<<" ? token.word.text : undefined,
        })
        pendingRedirect = undefined
        continue
      }
      words.push(token.word)
      continue
    }
    if (token.op === "|" || token.op === "|&") {
      finish(true)
      continue
    }
    if (token.op === "{" || token.op === "}") {
      continue
    }
    finish(false)
    pipeIn = false
  }
  finish(false)
  return commands
}

function dropKeywords(words: Word[]): Word[] {
  let start = 0
  while (start < words.length && KEYWORDS_DROP_WORD.has(words[start].text) && !words[start].dynamic) start++
  const rest = words.slice(start)
  if (rest.length > 0 && KEYWORDS_DROP_LINE.has(rest[0].text)) return []
  return rest
}
