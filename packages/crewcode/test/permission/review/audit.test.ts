import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, rm, stat } from "fs/promises"
import os from "os"
import path from "path"
import { actionRef, decisionRecord, humanRecord, parseRecords, previewOf, sessionRef, stats, write, type AuditRecord } from "../../../src/permission/review/audit"

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "crewcode-audit-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const base = {
  mode: "auto" as const,
  session: "ses_abc",
  request: "per_1",
  permission: "bash",
  patterns: ["npm test"],
  metadata: { command: "npm test" },
  decision: "allow_once" as const,
  reason: "user asked for tests",
  source: "reviewer" as const,
  durationMs: 12,
}

describe("records", () => {
  test("carry decision, reason, duration, origin and a reference to the action", () => {
    const record = decisionRecord({ ...base, reviewerModel: "openai/gpt-x" })
    expect(record).toMatchObject({
      type: "decision",
      mode: "auto",
      request: "per_1",
      permission: "bash",
      decision: "allow_once",
      reason: "user asked for tests",
      source: "reviewer",
      duration_ms: 12,
      reviewer_model: "openai/gpt-x",
    })
    expect(record.action_ref).toMatch(/^[0-9a-f]{16}$/)
    expect(record.action_preview).toBe("npm test")
    expect(new Date(record.ts).toString()).not.toBe("Invalid Date")
  })

  test("never contain the session id, the full command, or any secret", () => {
    const secret = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789"
    const record = decisionRecord({
      ...base,
      patterns: [`curl -H "Authorization: Bearer ${secret}" https://x.test`],
      metadata: { command: `API_KEY=${secret} node run.js ${"x".repeat(500)}`, diff: `password = "hunter2hunter2"` },
      reason: `token=${secret}`,
    })
    const text = JSON.stringify(record)
    expect(text).not.toContain(secret)
    expect(text).not.toContain("hunter2")
    expect(text).not.toContain("ses_abc")
    expect(record.action_preview!.length).toBeLessThanOrEqual(121)
  })

  test("the action reference is stable, differs between actions and does not reveal them", () => {
    expect(actionRef("bash", ["ls"])).toBe(actionRef("bash", ["ls"]))
    expect(actionRef("bash", ["ls"])).not.toBe(actionRef("bash", ["ls -la"]))
    expect(actionRef("bash", ["ls"])).not.toBe(actionRef("edit", ["ls"]))
    expect(actionRef("bash", ["ls"])).not.toContain("ls")
  })

  test("the session reference is stable and opaque", () => {
    expect(sessionRef("ses_abc")).toBe(sessionRef("ses_abc"))
    expect(sessionRef("ses_abc")).not.toBe(sessionRef("ses_abd"))
    expect(sessionRef("ses_abc")).not.toContain("abc")
  })

  test("the preview prefers the command and falls back to the patterns", () => {
    expect(previewOf("bash", ["a", "b"], { command: "a && b" })).toBe("a && b")
    expect(previewOf("edit", ["src/a.ts"], {})).toBe("src/a.ts")
  })

  test("a human answer is recorded against the request", () => {
    expect(humanRecord({ mode: "observe", session: "ses_abc", request: "per_1", reply: "reject" })).toMatchObject({
      type: "human",
      request: "per_1",
      human: "reject",
      source: "human",
    })
  })
})

describe("write", () => {
  test("appends one JSON line per record to a monthly file with private permissions", async () => {
    const at = new Date("2026-09-15T10:00:00Z")
    await write(dir, decisionRecord({ ...base, request: "a" }), at)
    await write(dir, decisionRecord({ ...base, request: "b" }), at)
    const files = await readdir(dir)
    expect(files).toEqual(["permission-2026-09.jsonl"])
    const lines = (await readFile(path.join(dir, files[0]), "utf8")).trim().split("\n")
    expect(lines.map((line) => JSON.parse(line).request)).toEqual(["a", "b"])
    expect(((await stat(path.join(dir, files[0]))).mode & 0o777).toString(8)).toBe("600")
  })

  test("a different month goes to a different file", async () => {
    await write(dir, decisionRecord(base), new Date("2026-09-30T23:00:00Z"))
    await write(dir, decisionRecord(base), new Date("2026-10-01T01:00:00Z"))
    expect((await readdir(dir)).sort()).toEqual(["permission-2026-09.jsonl", "permission-2026-10.jsonl"])
  })

  test("creates the directory when it does not exist", async () => {
    const nested = path.join(dir, "a", "b")
    await write(nested, decisionRecord(base))
    expect((await readdir(nested)).length).toBe(1)
  })

  test("reports a failure instead of throwing when the directory cannot be written", async () => {
    const result = await write(path.join("/proc", "nope"), decisionRecord(base))
    expect(result).toBe(false)
  })
})

describe("parseRecords", () => {
  test("skips blank and malformed lines", () => {
    const good = JSON.stringify(decisionRecord(base))
    expect(parseRecords(`${good}\n\nnot json\n{"type":"unknown"}\n${good}\n`).length).toBe(2)
  })

  test("survives a line cut short by a crash in the middle of a write", () => {
    const good = JSON.stringify(decisionRecord(base))
    expect(parseRecords(`${good}\n{"ts":"2026-09-15T10:00:00Z","type":"deci`).length).toBe(1)
  })
})

describe("stats", () => {
  const decision = (overrides: Partial<Parameters<typeof decisionRecord>[0]>): AuditRecord =>
    decisionRecord({ ...base, ...overrides })

  test("counts decisions by mode, decision and origin and averages the duration", () => {
    const result = stats([
      decision({ request: "1", mode: "auto", decision: "allow_once", source: "reviewer", durationMs: 10 }),
      decision({ request: "2", mode: "auto", decision: "ask_user", source: "rule", durationMs: 0 }),
      decision({ request: "3", mode: "auto", decision: "deny", source: "reviewer", durationMs: 20 }),
      decision({ request: "4", mode: "observe", decision: "ask_user", source: "failure", durationMs: 30 }),
    ])
    expect(result.total).toBe(4)
    expect(result.byMode).toMatchObject({ auto: 3, observe: 1 })
    expect(result.byDecision).toMatchObject({ allow_once: 1, ask_user: 2, deny: 1 })
    expect(result.bySource).toMatchObject({ reviewer: 2, rule: 1, failure: 1 })
    expect(result.averageDurationMs).toBe(15)
  })

  test("a false approval is a reviewer approval, observed without being applied, that the user rejected", () => {
    const records = [
      decision({ request: "1", mode: "observe", decision: "allow_once", source: "reviewer" }),
      humanRecord({ mode: "observe", session: "s", request: "1", reply: "reject" }),
      decision({ request: "2", mode: "observe", decision: "allow_once", source: "reviewer" }),
      humanRecord({ mode: "observe", session: "s", request: "2", reply: "once" }),
      decision({ request: "3", mode: "observe", decision: "allow_once", source: "reviewer" }),
      decision({ request: "4", mode: "observe", decision: "ask_user", source: "reviewer" }),
      humanRecord({ mode: "observe", session: "s", request: "4", reply: "reject" }),
    ]
    const result = stats(records)
    expect(result.observedApprovals).toBe(3)
    expect(result.falseApprovals).toBe(1)
    expect(result.falseApprovalRate).toBe(0.5)
    expect(result.approvalsWithoutAnswer).toBe(1)
  })

  test("approvals applied in auto mode have no human check and are counted apart", () => {
    const result = stats([
      decision({ request: "1", mode: "auto", decision: "allow_once", source: "reviewer" }),
      decision({ request: "2", mode: "auto", decision: "allow_once", source: "rule" }),
    ])
    expect(result.unverifiedApprovals).toBe(2)
    expect(result.falseApprovalRate).toBeNull()
  })

  test("with no records everything is zero and the rate is unknown", () => {
    expect(stats([])).toMatchObject({ total: 0, falseApprovals: 0, falseApprovalRate: null, averageDurationMs: 0 })
  })
})
