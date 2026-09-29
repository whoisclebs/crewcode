// What the reviewer may know about the conversation: what the user typed (trusted) and what the agent just did
// (untrusted). Kept apart from the reviewer so it can be replaced in tests and so the reviewer never touches storage.

import { eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@crewcode/core/effect/layer-node"
import { Database } from "@crewcode/core/database/database"
import { SessionTable } from "@crewcode/core/session/sql"
import { MessageV2 } from "@/session/message-v2"
import type { SessionV1 } from "@crewcode/core/v1/session"
import type { SessionID } from "@/session/schema"

export interface Interface {
  /** Text the user typed, oldest first, from the whole chain of sessions up to the root. */
  readonly userMessages: (sessionID: string) => Effect.Effect<string[]>
  /** The last tool calls of this session, as short untrusted summaries. */
  readonly recent: (sessionID: string) => Effect.Effect<{ tool: string; summary: string }[]>
}

export class Service extends Context.Service<Service, Interface>()("@crewcode/PermissionReviewConversation") {}

const PAGE = 40
const MAX_DEPTH = 8

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const db = database.db

    // A subagent works for the request the user made in its parent, so authorization is looked up at the root.
    const root = Effect.fn("PermissionReviewConversation.root")(function* (sessionID: string) {
      let current = sessionID
      for (let depth = 0; depth < MAX_DEPTH; depth++) {
        const row = yield* db
          .select({ parent: SessionTable.parent_id })
          .from(SessionTable)
          .where(eq(SessionTable.id, current as SessionID))
          .get()
          .pipe(Effect.orDie)
        if (!row?.parent) return current
        current = row.parent
      }
      return current
    })

    const userMessages = Effect.fn("PermissionReviewConversation.userMessages")(function* (sessionID: string) {
      const id = yield* root(sessionID)
      const page = yield* MessageV2.page({ sessionID: id as SessionID, limit: PAGE }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.catchCause(() => Effect.succeed({ items: [] as SessionV1.WithParts[] })),
      )
      return page.items
        .filter((message) => message.info.role === "user")
        .map((message) =>
          message.parts
            .flatMap((part) => (part.type === "text" && !part.synthetic && !part.ignored ? [part.text] : []))
            .join("\n")
            .trim(),
        )
        .filter((text) => text.length > 0)
    })

    const recent = Effect.fn("PermissionReviewConversation.recent")(function* (sessionID: string) {
      const page = yield* MessageV2.page({ sessionID: sessionID as SessionID, limit: PAGE }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.catchCause(() => Effect.succeed({ items: [] as SessionV1.WithParts[] })),
      )
      return page.items
        .flatMap((message) => message.parts)
        .flatMap((part) => (part.type === "tool" ? [{ tool: part.tool, summary: summarize(part.state.input) }] : []))
    })

    return Service.of({ userMessages, recent })
  }),
)

function summarize(input: unknown) {
  if (typeof input !== "object" || input === null) return ""
  const record = input as Record<string, unknown>
  const value = record.command ?? record.filePath ?? record.path ?? record.url ?? record.pattern
  return typeof value === "string" ? value : Object.keys(record).join(", ")
}

export const node = LayerNode.make({ service: Service, layer, deps: [Database.node] })

export * as PermissionReviewConversation from "./conversation"
