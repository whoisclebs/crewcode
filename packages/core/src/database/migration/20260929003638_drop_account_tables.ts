import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260929003638_drop_account_tables",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP TABLE \`account_state\`;`)
      yield* tx.run(`DROP TABLE \`account\`;`)
      yield* tx.run(`DROP TABLE \`control_account\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
