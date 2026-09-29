// Local audit trail for permission decisions.
//
// One JSON line per decision and per human answer, in a monthly file under the data directory. A record carries the
// decision, the short reason, how long it took, where the decision came from and an opaque reference to the action. It
// never carries tokens, secrets, the full command, the session id or any part of the conversation.

import { createHash } from "crypto"
import { Schema } from "effect"
import { appendFile, chmod, mkdir } from "fs/promises"
import path from "path"
import { redact, truncate } from "./redact"

export type Mode = "manual" | "auto" | "observe" | "unguarded"
export type Action = "allow_once" | "ask_user" | "deny"
export type Source = "rule" | "reviewer" | "failure" | "unguarded" | "human"

export interface AuditRecord {
  readonly ts: string
  readonly type: "decision" | "human"
  readonly mode: Mode
  readonly session: string
  readonly request: string
  readonly permission?: string
  readonly action_ref?: string
  readonly action_preview?: string
  readonly decision?: Action
  readonly reason?: string
  readonly source?: Source
  readonly duration_ms?: number
  readonly reviewer_model?: string
  readonly categories?: readonly string[]
  readonly human?: "once" | "always" | "reject"
}

const PREVIEW_LENGTH = 120
const REASON_LENGTH = 200
const REFERENCE_LENGTH = 16

function digest(text: string) {
  return createHash("sha256").update(text).digest("hex").slice(0, REFERENCE_LENGTH)
}

export function sessionRef(sessionID: string) {
  return digest(`session:${sessionID}`)
}

export function actionRef(permission: string, patterns: readonly string[]) {
  return digest(JSON.stringify([permission, patterns]))
}

export function previewOf(permission: string, patterns: readonly string[], metadata: Record<string, unknown>) {
  const command = typeof metadata.command === "string" ? metadata.command : undefined
  const text = command ?? patterns.join(" ; ") ?? permission
  return truncate(redact(text.replace(/\s+/g, " ").trim()), PREVIEW_LENGTH)
}

export interface DecisionInput {
  readonly mode: Mode
  readonly session: string
  readonly request: string
  readonly permission: string
  readonly patterns: readonly string[]
  readonly metadata: Record<string, unknown>
  readonly decision: Action
  readonly reason: string
  readonly source: Source
  readonly durationMs: number
  readonly reviewerModel?: string
  readonly categories?: readonly string[]
}

export function decisionRecord(input: DecisionInput): AuditRecord {
  return {
    ts: new Date().toISOString(),
    type: "decision",
    mode: input.mode,
    session: sessionRef(input.session),
    request: input.request,
    permission: input.permission,
    action_ref: actionRef(input.permission, input.patterns),
    action_preview: previewOf(input.permission, input.patterns, input.metadata),
    decision: input.decision,
    reason: truncate(redact(input.reason), REASON_LENGTH),
    source: input.source,
    duration_ms: Math.round(input.durationMs),
    ...(input.reviewerModel ? { reviewer_model: input.reviewerModel } : {}),
    ...(input.categories && input.categories.length > 0 ? { categories: input.categories } : {}),
  }
}

export function humanRecord(input: {
  readonly mode: Mode
  readonly session: string
  readonly request: string
  readonly reply: "once" | "always" | "reject"
}): AuditRecord {
  return {
    ts: new Date().toISOString(),
    type: "human",
    mode: input.mode,
    session: sessionRef(input.session),
    request: input.request,
    source: "human",
    human: input.reply,
  }
}

export function fileFor(dir: string, at: Date) {
  return path.join(dir, `permission-${at.toISOString().slice(0, 7)}.jsonl`)
}

/** Appends a record. Returns false, never throws: a broken audit file must not stop the agent or hide a decision. */
export async function write(dir: string, record: AuditRecord, at = new Date()) {
  const file = fileFor(dir, at)
  const created = await mkdir(dir, { recursive: true }).then(
    () => true,
    () => false,
  )
  if (!created) return false
  const written = await appendFile(file, `${JSON.stringify(record)}\n`, { mode: 0o600 }).then(
    () => true,
    () => false,
  )
  if (written) await chmod(file, 0o600).catch(() => undefined)
  return written
}

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

export function parseRecords(text: string): AuditRecord[] {
  return text.split("\n").flatMap((line) => {
    const parsed = decodeLine(line)
    if (parsed._tag === "None" || typeof parsed.value !== "object" || parsed.value === null) return []
    const record = parsed.value as AuditRecord
    return record.type === "decision" || record.type === "human" ? [record] : []
  })
}

export interface Stats {
  readonly total: number
  readonly byMode: Partial<Record<Mode, number>>
  readonly byDecision: Partial<Record<Action, number>>
  readonly bySource: Partial<Record<Source, number>>
  readonly averageDurationMs: number
  /** Approvals made while observing (not applied) that the user could then judge. */
  readonly observedApprovals: number
  /** Observed approvals that the user rejected: an action that should have reached the user and was approved. */
  readonly falseApprovals: number
  readonly falseApprovalRate: number | null
  readonly approvalsWithoutAnswer: number
  /** Approvals applied in auto mode. Nobody checked them. */
  readonly unverifiedApprovals: number
}

function count<K extends string>(values: readonly (K | undefined)[]) {
  const result: Partial<Record<K, number>> = {}
  for (const value of values) if (value !== undefined) result[value] = (result[value] ?? 0) + 1
  return result
}

export function stats(records: readonly AuditRecord[]): Stats {
  const decisions = records.filter((record) => record.type === "decision")
  const answers = new Map(records.filter((record) => record.type === "human").map((record) => [record.request, record.human]))
  const observed = decisions.filter((record) => record.mode === "observe" && record.decision === "allow_once")
  const answered = observed.filter((record) => answers.has(record.request))
  const falseApprovals = answered.filter((record) => answers.get(record.request) === "reject").length
  const durations = decisions.map((record) => record.duration_ms ?? 0)

  return {
    total: decisions.length,
    byMode: count(decisions.map((record) => record.mode)),
    byDecision: count(decisions.map((record) => record.decision)),
    bySource: count(decisions.map((record) => record.source)),
    averageDurationMs: durations.length === 0 ? 0 : durations.reduce((sum, value) => sum + value, 0) / durations.length,
    observedApprovals: observed.length,
    falseApprovals,
    falseApprovalRate: answered.length === 0 ? null : falseApprovals / answered.length,
    approvalsWithoutAnswer: observed.length - answered.length,
    unverifiedApprovals: decisions.filter((record) => record.mode === "auto" && record.decision === "allow_once").length,
  }
}
