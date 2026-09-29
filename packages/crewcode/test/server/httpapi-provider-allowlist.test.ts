import { afterEach, describe, expect } from "bun:test"
import { rm } from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { Global } from "@crewcode/core/global"
import { ProviderAllowlist } from "@crewcode/core/provider-allowlist"
import { resetDatabase } from "../fixture/db"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const testStateLayer = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.promise(() => resetDatabase()),
    () => Effect.promise(() => resetDatabase()),
  ),
)

const it = testEffect(Layer.mergeAll(testStateLayer, httpApiLayer))
const projectOptions = { config: { formatter: false, lsp: false } }
const json = { "content-type": "application/json" }

afterEach(async () => {
  await rm(path.join(Global.Path.data, "auth.json"), { force: true })
})

const send = (method: string, route: string, body?: unknown) =>
  Effect.gen(function* () {
    const directory = (yield* TestInstance).directory
    const response = yield* requestInDirectory(route, directory, {
      method,
      headers: json,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: yield* response.text }
  })

describe("provider allowlist on the HTTP API", () => {
  it.instance(
    "refuses to store credentials for a provider outside the allowlist and explains why",
    () =>
      Effect.gen(function* () {
        const response = yield* send("PUT", "/auth/anthropic", { type: "api", key: "sk-test" })
        expect(response.status).toBe(400)
        expect(JSON.parse(response.body)).toEqual({
          name: "ProviderAuthUnsupported",
          data: { providerID: "anthropic", message: ProviderAllowlist.message("anthropic") },
        })
        expect(yield* Effect.promise(() => Bun.file(path.join(Global.Path.data, "auth.json")).exists())).toBe(false)
      }),
    projectOptions,
  )

  it.instance(
    "still stores credentials for allowed providers",
    () =>
      Effect.gen(function* () {
        for (const id of ProviderAllowlist.ids.filter((id) => id !== "openai-codex")) {
          const response = yield* send("PUT", `/auth/${id}`, { type: "api", key: "sk-test" })
          expect(response).toEqual({ status: 200, body: "true" })
        }
      }),
    projectOptions,
  )

  it.instance(
    "refuses the OAuth flow of a provider outside the allowlist",
    () =>
      Effect.gen(function* () {
        const authorize = yield* send("POST", "/provider/anthropic/oauth/authorize", { method: 0 })
        expect(authorize.status).toBe(400)
        expect(JSON.parse(authorize.body).name).toBe("ProviderAuthUnsupported")

        const callback = yield* send("POST", "/provider/anthropic/oauth/callback", { method: 0, code: "x" })
        expect(callback.status).toBe(400)
        expect(JSON.parse(callback.body).name).toBe("ProviderAuthUnsupported")
      }),
    projectOptions,
  )

  it.instance(
    "refuses direct v2 connection requests for a provider outside the allowlist",
    () =>
      Effect.gen(function* () {
        const key = yield* send("POST", "/api/integration/anthropic/connect/key", { key: "sk-test" })
        expect(key.status).toBe(400)
        expect(JSON.parse(key.body).message).toBe(ProviderAllowlist.message("anthropic"))

        const oauth = yield* send("POST", "/api/integration/anthropic/connect/oauth", { methodID: "x", inputs: {} })
        expect(oauth.status).toBe(400)
        expect(JSON.parse(oauth.body).message).toBe(ProviderAllowlist.message("anthropic"))
      }),
    projectOptions,
  )

  it.instance(
    "lists only allowed providers",
    () =>
      Effect.gen(function* () {
        const response = yield* send("GET", "/provider")
        expect(response.status).toBe(200)
        const ids: string[] = JSON.parse(response.body).all.map((provider: { id: string }) => provider.id)
        expect(ids.filter((id) => !ProviderAllowlist.isAllowed(id))).toEqual([])
        expect(ids).toContain("openrouter")
      }),
    projectOptions,
  )
})
