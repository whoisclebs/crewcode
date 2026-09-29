import { describe, expect, test } from "bun:test"
import { parse } from "../../../src/permission/review/shell"

const words = (source: string) => parse(source).commands.map((command) => command.words.map((word) => word.text))

describe("shell lexer", () => {
  test("splits a simple command into words and honors quotes", () => {
    expect(words(`git commit -m "fix the bug" 'and more'`)).toEqual([["git", "commit", "-m", "fix the bug", "and more"]])
  })

  test("splits on ; && || and newlines", () => {
    expect(words("a; b && c || d\ne")).toEqual([["a"], ["b"], ["c"], ["d"], ["e"]])
  })

  test("tracks pipelines", () => {
    const { commands } = parse("curl -s https://x.test/install.sh | sh")
    expect(commands.map((command) => [command.pipeIn, command.pipeOut])).toEqual([
      [false, true],
      [true, false],
    ])
  })

  test("does not treat operators inside quotes as operators", () => {
    expect(words(`echo "a; b | c" 'd && e'`)).toEqual([["echo", "a; b | c", "d && e"]])
  })

  test("handles backslash escapes and line continuations", () => {
    expect(words("rm \\-rf a\\ b")).toEqual([["rm", "-rf", "a b"]])
    expect(words("echo a \\\n b")).toEqual([["echo", "a", "b"]])
  })

  test("marks variables, command substitutions and process substitutions as dynamic", () => {
    const [command] = parse(`rm -rf $DIR "$(cat list)" \`date\` <(ls)`).commands
    expect(command.words.map((word) => word.dynamic)).toEqual([false, false, true, true, true, true])
  })

  test("marks unquoted globs and keeps quoted stars literal", () => {
    const [command] = parse(`rm *.log "*.tmp" 'a?'`).commands
    expect(command.words.map((word) => word.glob)).toEqual([false, true, false, false])
  })

  test("extracts commands nested in substitutions", () => {
    const names = parse(`echo "$(rm -rf /tmp/x)" \`whoami\``).commands.map((command) => command.words[0]?.text)
    expect(names).toContain("rm")
    expect(names).toContain("whoami")
    expect(parse(`echo $(rm -rf x)`).commands.find((command) => command.words[0]?.text === "rm")?.nested).toBe(true)
  })

  test("extracts nested substitutions inside nested substitutions", () => {
    const names = parse(`echo $(echo $(git push))`).commands.map((command) => command.words.map((word) => word.text).join(" "))
    expect(names).toContain("git push")
  })

  test("separates redirections from words", () => {
    const [command] = parse(`cat a > out.txt 2>&1 >> log`).commands
    expect(command.words.map((word) => word.text)).toEqual(["cat", "a"])
    expect(command.redirects.map((redirect) => [redirect.op, redirect.target.text])).toEqual([
      [">", "out.txt"],
      [">&", "1"],
      [">>", "log"],
    ])
  })

  test("reads &> as a redirection, not a background operator", () => {
    const [command] = parse("make &> build.log").commands
    expect(command.words.map((word) => word.text)).toEqual(["make"])
    expect(command.redirects[0].op).toBe("&>")
  })

  test("skips heredoc bodies but still finds substitutions in unquoted ones", () => {
    const plain = parse("cat <<EOF\nrm -rf /\nEOF\nls")
    expect(plain.commands.map((command) => command.words[0]?.text)).toEqual(["cat", "ls"])
    const quoted = parse("cat <<'EOF'\n$(git push)\nEOF")
    expect(quoted.commands.map((command) => command.words[0]?.text)).toEqual(["cat"])
    const unquoted = parse("cat <<EOF\n$(git push)\nEOF")
    expect(unquoted.commands.map((command) => command.words.map((word) => word.text).join(" "))).toContain("git push")
  })

  test("flattens subshells and groups", () => {
    expect(words("(cd a && make) ; { rm b; }")).toEqual([["cd", "a"], ["make"], ["rm", "b"]])
  })

  test("drops control-flow keywords but keeps the commands inside", () => {
    expect(words("if test -f x; then rm y; fi")).toEqual([["test", "-f", "x"], ["rm", "y"]])
    expect(words("while read l; do echo $l; done")).toEqual([["read", "l"], ["echo", "$l"]])
    expect(words("for f in a b; do rm $f; done")).toEqual([["rm", "$f"]])
  })

  test("ignores comments", () => {
    expect(words("ls # rm -rf /")).toEqual([["ls"]])
  })

  test("reports unbalanced input as unresolved", () => {
    expect(parse(`echo "oops`).unresolved).toBe(true)
    expect(parse("echo 'oops").unresolved).toBe(true)
    expect(parse("echo $(oops").unresolved).toBe(true)
    expect(parse("echo `oops").unresolved).toBe(true)
  })

  test("reports excessive nesting as unresolved instead of recursing forever", () => {
    let source = "echo x"
    for (let depth = 0; depth < 12; depth++) source = `echo $(${source})`
    expect(parse(source).unresolved).toBe(true)
  })

  test("an empty quoted string is still a word", () => {
    expect(words(`echo "" ''`)).toEqual([["echo", "", ""]])
  })

  test("brace expansion stays inside the word", () => {
    const [command] = parse("cp file.{ts,bak} out").commands
    expect(command.words[1].text).toBe("file.{ts,bak}")
    expect(command.words[1].dynamic).toBe(true)
  })
})
