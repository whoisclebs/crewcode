import { LayerNode } from "@crewcode/core/effect/layer-node"
import path from "path"
import { Effect, Layer, Record, Result, Schema, Context } from "effect"
import { NonNegativeInt } from "@crewcode/core/schema"
import { Global } from "@crewcode/core/global"
import { FSUtil } from "@crewcode/core/fs-util"
import { ProviderAllowlist } from "@crewcode/core/provider-allowlist"

export const OAUTH_DUMMY_KEY = "crewcode-oauth-dummy-key"

const file = path.join(Global.Path.data, "auth.json")

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export const Info = Schema.Union([Oauth, Api]).annotate({ discriminator: "type", identifier: "Auth" })
export type Info = Schema.Schema.Type<typeof Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

const CODEX = "openai-codex"
// Before the Codex flow had its own provider, its OAuth credential was stored under "openai".
const LEGACY_CODEX = "openai"
const warned = new Set<string>()

function view(data: Record<string, Info>): Record<string, Info> {
  const legacy = data[LEGACY_CODEX]
  if (legacy?.type !== "oauth") return ProviderAllowlist.filter(data)
  const migrated = Object.fromEntries(Object.entries(data).filter(([id]) => id !== LEGACY_CODEX))
  return ProviderAllowlist.filter({ [CODEX]: legacy, ...migrated })
}

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@crewcode/Auth") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* FSUtil.Service
    const decode = Schema.decodeUnknownOption(Info)

    // What is on disk (or in CREWCODE_AUTH_CONTENT), untouched. Writes start from this, so credentials of providers
    // CrewCode no longer supports stay in the file instead of being erased by an unrelated set or remove.
    const stored = Effect.fn("Auth.stored")(function* () {
      if (process.env.CREWCODE_AUTH_CONTENT) {
        try {
          return JSON.parse(process.env.CREWCODE_AUTH_CONTENT) as Record<string, Info>
        } catch (err) {}
      }

      const data = (yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>
      return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
    })

    // What the rest of the app sees: only allowed providers, with the ChatGPT OAuth credential under openai-codex.
    const all = Effect.fn("Auth.all")(function* () {
      const data = yield* stored()
      const ignored = Object.keys(data).filter((id) => !ProviderAllowlist.isAllowed(id) && !warned.has(id))
      for (const id of ignored) warned.add(id)
      if (ignored.length > 0) {
        yield* Effect.logWarning(
          `Ignoring stored credentials for unsupported providers: ${ignored.join(", ")}. ${ProviderAllowlist.message(ignored[0])}`,
        )
      }
      return view(data)
    })

    const get = Effect.fn("Auth.get")(function* (providerID: string) {
      return (yield* all())[providerID]
    })

    const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
      const norm = key.replace(/\/+$/, "")
      if (!ProviderAllowlist.isAllowed(norm)) return yield* new AuthError({ message: ProviderAllowlist.message(norm) })
      const data = yield* stored()
      if (norm !== key) delete data[key]
      delete data[norm + "/"]
      yield* fsys
        .writeJson(file, { ...data, [norm]: info }, 0o600)
        .pipe(Effect.mapError(fail("Failed to write auth data")))
    })

    const remove = Effect.fn("Auth.remove")(function* (key: string) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* stored()
      delete data[key]
      delete data[norm]
      // Logging out of Codex must also drop the legacy OAuth entry that view() would otherwise resurrect.
      if (norm === CODEX && data[LEGACY_CODEX]?.type === "oauth") delete data[LEGACY_CODEX]
      yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
    })

    return Service.of({ get, all, set, remove })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node] })

export * as Auth from "."
