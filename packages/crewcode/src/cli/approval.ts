// Turns the approval flags into a mode. Kept apart from yargs so the rules are easy to test and to read.
//
// `--auto` used to answer "once" to every request without looking. It now means the reviewed mode. Approving
// everything is `--unguarded`, and the two old spellings of that (`--yolo`, `--dangerously-skip-permissions`) are
// errors, so an old script fails loudly instead of approving everything or silently changing meaning.

export type ApprovalMode = "manual" | "auto" | "observe" | "unguarded"

export interface ApprovalArgs {
  readonly auto?: boolean
  readonly unguarded?: boolean
  readonly approval?: string
  readonly yolo?: boolean
  readonly "dangerously-skip-permissions"?: boolean
  readonly dangerouslySkipPermissions?: boolean
}

export interface ApprovalResult {
  readonly mode?: ApprovalMode
  readonly error?: string
  readonly warning?: string
}

const CHOICES = ["manual", "auto", "observe"] as const

const REMOVED =
  "--yolo and --dangerously-skip-permissions were removed. Use --auto to let a reviewer approve safe actions and ask you about the rest, or --unguarded to approve everything without review."

export function resolveApproval(args: ApprovalArgs): ApprovalResult {
  if (args.yolo || args["dangerously-skip-permissions"] || args.dangerouslySkipPermissions) return { error: REMOVED }

  const chosen = [args.auto, args.unguarded, args.approval !== undefined].filter(Boolean).length
  if (chosen > 1) return { error: "Use only one of --auto, --unguarded and --approval." }

  if (args.auto) return { mode: "auto" }
  if (args.unguarded) {
    return {
      mode: "unguarded",
      warning: "UNGUARDED: every action that needs approval will run without review. Only deny rules still apply.",
    }
  }
  if (args.approval === undefined) return {}
  if (args.approval === "unguarded") return { error: "Use --unguarded to approve everything without review." }
  const mode = CHOICES.find((choice) => choice === args.approval)
  if (!mode) return { error: `--approval must be one of: ${CHOICES.join(", ")}.` }
  return { mode }
}
