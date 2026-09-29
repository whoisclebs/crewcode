import { describe, expect, test } from "bun:test"
import { decisionRecord, humanRecord, stats } from "../../src/permission/review/audit"
import { formatStats } from "../../src/cli/cmd/audit"

const decision = (request: string, overrides: Partial<Parameters<typeof decisionRecord>[0]> = {}) =>
  decisionRecord({
    mode: "observe",
    session: "s",
    request,
    permission: "bash",
    patterns: ["npm test"],
    metadata: {},
    decision: "allow_once",
    reason: "ok",
    source: "reviewer",
    durationMs: 10,
    ...overrides,
  })

describe("formatStats", () => {
  test("says plainly that there is nothing to report", () => {
    expect(formatStats(stats([]))).toContain("No decisions recorded")
  })

  test("reports the false approval rate as a percentage with the counts behind it", () => {
    const text = formatStats(
      stats([
        decision("1"),
        humanRecord({ mode: "observe", session: "s", request: "1", reply: "reject" }),
        decision("2"),
        humanRecord({ mode: "observe", session: "s", request: "2", reply: "once" }),
        decision("3"),
        humanRecord({ mode: "observe", session: "s", request: "3", reply: "once" }),
        decision("4"),
        humanRecord({ mode: "observe", session: "s", request: "4", reply: "once" }),
      ]),
    )
    expect(text).toContain("False approvals: 1 of 4")
    expect(text).toContain("25.0%")
  })

  test("says the rate is unknown when the user has not answered any observed approval", () => {
    expect(formatStats(stats([decision("1")]))).toMatch(/False approvals:.*not measured/i)
  })

  test("counts approvals applied without a human check apart", () => {
    const text = formatStats(stats([decision("1", { mode: "auto" }), decision("2", { mode: "auto", source: "rule" })]))
    expect(text).toContain("Approved without a human check (auto mode): 2")
  })

  test("lists decisions and origins", () => {
    const text = formatStats(stats([decision("1"), decision("2", { decision: "ask_user", source: "rule" })]))
    expect(text).toMatch(/allow_once\s+1/)
    expect(text).toMatch(/ask_user\s+1/)
    expect(text).toMatch(/reviewer\s+1/)
    expect(text).toMatch(/rule\s+1/)
  })
})
