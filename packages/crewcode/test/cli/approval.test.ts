import { describe, expect, test } from "bun:test"
import { resolveApproval } from "../../src/cli/approval"

describe("resolveApproval", () => {
  test("leaves everything to the config when no flag is given", () => {
    expect(resolveApproval({})).toEqual({})
  })

  test("--auto turns on the reviewed mode", () => {
    expect(resolveApproval({ auto: true })).toEqual({ mode: "auto" })
  })

  test("--unguarded approves everything and warns about it", () => {
    const result = resolveApproval({ unguarded: true })
    expect(result.mode).toBe("unguarded")
    expect(result.warning).toMatch(/without review/i)
  })

  test.each(["manual", "auto", "observe"] as const)("--approval %s selects that mode", (mode) => {
    expect(resolveApproval({ approval: mode })).toEqual({ mode })
  })

  test("--approval unguarded is refused: that mode has its own flag", () => {
    expect(resolveApproval({ approval: "unguarded" }).error).toMatch(/--unguarded/)
  })

  test("--approval with an unknown value lists the valid ones", () => {
    const { error } = resolveApproval({ approval: "yes" })
    expect(error).toContain("manual")
    expect(error).toContain("auto")
    expect(error).toContain("observe")
  })

  test.each([
    [{ auto: true, unguarded: true }],
    [{ auto: true, approval: "observe" }],
    [{ unguarded: true, approval: "auto" }],
  ])("two ways of choosing the mode at once is an error: %p", (argv) => {
    expect(resolveApproval(argv).error).toMatch(/only one/i)
  })

  test.each([
    [{ yolo: true }],
    [{ "dangerously-skip-permissions": true }],
    [{ dangerouslySkipPermissions: true }],
  ])("the old flags fail with a way forward and never approve anything: %p", (argv) => {
    const result = resolveApproval(argv)
    expect(result.mode).toBeUndefined()
    expect(result.error).toContain("--auto")
    expect(result.error).toContain("--unguarded")
  })

  test("an old flag together with a new one is still an error", () => {
    const result = resolveApproval({ yolo: true, auto: true })
    expect(result.error).toBeDefined()
    expect(result.mode).toBeUndefined()
  })
})
