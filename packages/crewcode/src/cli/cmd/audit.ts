import type { Argv } from "yargs"
import { readdir, readFile } from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { Global } from "@crewcode/core/global"
import { parseRecords, stats, type Stats } from "@/permission/review/audit"
import { effectCmd } from "../effect-cmd"

function table(title: string, values: Record<string, number | undefined>) {
  const rows = Object.entries(values).filter((entry): entry is [string, number] => entry[1] !== undefined)
  if (rows.length === 0) return []
  return [`${title}:`, ...rows.map(([name, count]) => `  ${name.padEnd(12)} ${count}`)]
}

export function formatStats(result: Stats) {
  if (result.total === 0) return "No decisions recorded yet."
  const rate =
    result.falseApprovalRate === null
      ? "not measured (no observed approval has been answered by you yet)"
      : `${result.falseApprovals} of ${result.observedApprovals - result.approvalsWithoutAnswer} answered, ${(result.falseApprovalRate * 100).toFixed(1)}%`
  const answered = result.observedApprovals - result.approvalsWithoutAnswer
  return [
    `Decisions: ${result.total}   Average time: ${Math.round(result.averageDurationMs)} ms`,
    ...table("By mode", result.byMode),
    ...table("By decision", result.byDecision),
    ...table("By origin", result.bySource),
    "",
    "Observe mode (the reviewer's approvals, which were not applied):",
    `  Observed approvals: ${result.observedApprovals}   Answered by you: ${answered}`,
    result.falseApprovalRate === null
      ? `  False approvals: ${rate}`
      : `  False approvals: ${result.falseApprovals} of ${answered} (${(result.falseApprovalRate * 100).toFixed(1)}%)`,
    "  A false approval is an action the reviewer would have approved and that you rejected.",
    "",
    `Approved without a human check (auto mode): ${result.unverifiedApprovals}`,
  ].join("\n")
}

const StatsCommand = effectCmd({
  command: "stats",
  describe: "summarize the local audit log of permission decisions",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .option("month", { type: "string", describe: "only this month, as YYYY-MM" })
      .option("json", { type: "boolean", default: false, describe: "print the numbers as JSON" }),
  handler: Effect.fn("Cli.audit.stats")(function* (args: { month?: string; json: boolean }) {
    const dir = path.join(Global.Path.data, "audit")
    const files = yield* Effect.promise(() => readdir(dir).catch(() => [] as string[]))
    const wanted = files.filter((file) => file.startsWith("permission-") && file.endsWith(".jsonl")).filter((file) => !args.month || file.includes(args.month))
    const texts = yield* Effect.promise(() => Promise.all(wanted.map((file) => readFile(path.join(dir, file), "utf8"))))
    const result = stats(texts.flatMap((text) => parseRecords(text)))
    console.log(args.json ? JSON.stringify(result, null, 2) : formatStats(result))
  }),
})

export const AuditCommand = effectCmd({
  command: "audit",
  describe: "review the local audit log of permission decisions",
  instance: false,
  builder: (yargs: Argv) => yargs.command(StatsCommand).demandCommand(),
  handler: Effect.fn("Cli.audit")(function* () {}),
})
