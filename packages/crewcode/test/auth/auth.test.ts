import { describe, expect } from "bun:test"
import { LayerNode } from "@crewcode/core/effect/layer-node"
import { Effect } from "effect"
import { Auth } from "../../src/auth"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Auth.node))

describe("Auth", () => {
  it.instance("set normalizes trailing slashes in keys", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("openrouter/", {
        type: "api",
        key: "abc",
      })
      const data = yield* auth.all()
      expect(data["openrouter"]).toBeDefined()
      expect(data["openrouter/"]).toBeUndefined()
    }),
  )

  it.instance("set cleans up pre-existing trailing-slash entry", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("openrouter/", {
        type: "api",
        key: "old",
      })
      yield* auth.set("openrouter", {
        type: "api",
        key: "new",
      })
      const data = yield* auth.all()
      const keys = Object.keys(data).filter((key) => key.includes("openrouter"))
      expect(keys).toEqual(["openrouter"])
      const entry = data["openrouter"]!
      expect(entry.type).toBe("api")
      if (entry.type === "api") expect(entry.key).toBe("new")
    }),
  )

  it.instance("remove deletes both trailing-slash and normalized keys", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("openrouter", {
        type: "api",
        key: "abc",
      })
      yield* auth.remove("openrouter/")
      const data = yield* auth.all()
      expect(data["openrouter"]).toBeUndefined()
      expect(data["openrouter/"]).toBeUndefined()
    }),
  )

  it.instance("set and remove are no-ops on keys without trailing slashes", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("openrouter", {
        type: "api",
        key: "sk-test",
      })
      const data = yield* auth.all()
      expect(data["openrouter"]).toBeDefined()
      yield* auth.remove("openrouter")
      const after = yield* auth.all()
      expect(after["openrouter"]).toBeUndefined()
    }),
  )
})
