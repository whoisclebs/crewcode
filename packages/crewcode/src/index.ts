import { resolveApproval } from "./cli/approval"
import { AuditCommand } from "./cli/cmd/audit"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { RunCommand } from "./cli/cmd/run"
import { GenerateCommand } from "./cli/cmd/generate"
import { ProvidersCommand } from "./cli/cmd/providers"
import { AgentCommand } from "./cli/cmd/agent"
import { ModelsCommand } from "./cli/cmd/models"
import { UI } from "./cli/ui"
import { InstallationVersion } from "@crewcode/core/installation/version"
import { FormatError } from "./cli/error"
import { ServeCommand } from "./cli/cmd/serve"
import { DebugCommand } from "./cli/cmd/debug"
import { StatsCommand } from "./cli/cmd/stats"
import { McpCommand } from "./cli/cmd/mcp"
import { ExportCommand } from "./cli/cmd/export"
import { ImportCommand } from "./cli/cmd/import"
import { AttachCommand } from "./cli/cmd/attach"
import { TuiThreadCommand } from "./cli/cmd/tui"
import { AcpCommand } from "./cli/cmd/acp"
import { EOL } from "os"
import { PrCommand } from "./cli/cmd/pr"
import { SessionCommand } from "./cli/cmd/session"
import { DbCommand } from "./cli/cmd/db"
import { errorMessage } from "./util/error"
import { Heap } from "./cli/heap"

const args = hideBin(process.argv)

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("crewcode ")) {
    process.stderr.write(UI.logo() + EOL + EOL)
    process.stderr.write(text + EOL)
    return
  }
  process.stderr.write(out)
}

const cli = yargs(args)
  .parserConfiguration({ "populate--": true })
  .scriptName("crewcode")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", InstallationVersion)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .option("pure", {
    describe: "run without external plugins",
    type: "boolean",
  })
  .option("auto", {
    describe: "let a reviewer approve safe actions and ask you about the rest",
    type: "boolean",
  })
  .option("unguarded", {
    describe: "approve every action that needs approval, without review (deny rules still apply)",
    type: "boolean",
  })
  .option("approval", {
    describe: "how actions that need approval are handled",
    type: "string",
    choices: ["manual", "auto", "observe"],
  })
  // Removed spellings stay declared so they reach resolveApproval and fail with a way forward.
  .option("yolo", { type: "boolean", hidden: true })
  .option("dangerously-skip-permissions", { type: "boolean", hidden: true })
  .middleware(async (opts) => {
    const approval = resolveApproval(opts)
    if (approval.error) {
      process.stderr.write(`${approval.error}\n`)
      process.exit(1)
    }
    if (approval.mode) process.env.CREWCODE_APPROVAL_MODE = approval.mode
    if (approval.warning) process.stderr.write(`${approval.warning}\n`)

    if (opts.printLogs) process.env.CREWCODE_PRINT_LOGS = "1"
    if (opts.logLevel) process.env.CREWCODE_LOG_LEVEL = opts.logLevel
    if (opts.pure) {
      process.env.CREWCODE_PURE = "1"
    }

    Heap.start()

    process.env.AGENT = "1"
    process.env.CREWCODE = "1"
    process.env.CREWCODE_PID = String(process.pid)
  })
  .usage("")
  .completion("completion", "generate shell completion script")
  .command(AcpCommand)
  .command(McpCommand)
  .command(TuiThreadCommand)
  .command(AttachCommand)
  .command(RunCommand)
  .command(GenerateCommand)
  .command(DebugCommand)
  .command(ProvidersCommand)
  .command(AgentCommand)
  .command(ServeCommand)
  .command(ModelsCommand)
  .command(StatsCommand)
  .command(ExportCommand)
  .command(ImportCommand)
  .command(PrCommand)
  .command(SessionCommand)
  .command(DbCommand)
  .command(AuditCommand)
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp(show)
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  if (args.includes("-h") || args.includes("--help")) {
    await cli.parse(args, (err: Error | undefined, _argv: unknown, out: string) => {
      if (err) throw err
      if (!out) return
      show(out)
    })
  } else {
    await cli.parse()
  }
} catch (e) {
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error" + EOL)
    process.stderr.write(errorMessage(e) + EOL)
  }
  process.exitCode = 1
} finally {
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit()
}
