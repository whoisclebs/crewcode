import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@crewcode/core/flag/flag"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless crewcode server",
  // Server loads instances per-request via x-crewcode-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("../../server/server"))
    if (!Flag.CREWCODE_SERVER_PASSWORD) {
      console.log("Warning: CREWCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`crewcode server listening on http://${server.hostname}:${server.port}`)

    // An interface that started this server exits without warning if it is killed, so the server follows it out.
    const parent = Number(process.env.CREWCODE_EXIT_WITH_PARENT)
    if (parent > 0) {
      setInterval(() => {
        const alive = (() => {
          try {
            process.kill(parent, 0)
            return true
          } catch (error) {
            return (error as NodeJS.ErrnoException).code === "EPERM"
          }
        })()
        if (!alive) process.exit(0)
      }, 2000).unref()
    }

    yield* Effect.never
  }),
})
