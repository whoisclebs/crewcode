import { run as runTui, type TuiInput } from "@crewcode/tui"
import { Global } from "@crewcode/core/global"
import { AppNodeBuilder } from "@crewcode/core/effect/app-node-builder"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}
