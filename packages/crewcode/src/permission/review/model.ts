// Calls the reviewer model. It goes through the same provider machinery as a normal session (credentials, OAuth,
// headers), but it is a plain completion: no tools, no session, nothing that could run the action being judged.

import { generateText, streamText } from "ai"
import { Context, Effect, Layer, Schema } from "effect"
import { LayerNode } from "@crewcode/core/effect/layer-node"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"

export class ModelError extends Schema.TaggedErrorClass<ModelError>()("PermissionReview.ModelError", {
  message: Schema.String,
}) {}

export interface Completion {
  readonly text: string
  /** provider/model that answered, for the audit log. */
  readonly model: string
}

export interface Interface {
  readonly complete: (input: { system: string; user: string }) => Effect.Effect<Completion, ModelError>
}

export class Service extends Context.Service<Service, Interface>()("@crewcode/PermissionReviewModel") {}

const MAX_OUTPUT_TOKENS = 400

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const provider = yield* Provider.Service

    const target = Effect.fn("PermissionReviewModel.target")(function* () {
      const cfg = yield* config.get()
      const configured = cfg.approval?.reviewer?.model
      if (configured) return Provider.parseModel(configured)
      const main = yield* provider.defaultModel().pipe(Effect.mapError(() => new ModelError({ message: "no model is available" })))
      const small = yield* provider.getSmallModel(main.providerID)
      return small ? { providerID: small.providerID, modelID: small.id } : main
    })

    const complete = Effect.fn("PermissionReviewModel.complete")(function* (input: { system: string; user: string }) {
      const chosen = yield* target()
      const resolved = yield* provider
        .getModel(chosen.providerID, chosen.modelID)
        .pipe(Effect.mapError((error) => new ModelError({ message: error.message })))
      const language = yield* provider
        .getLanguage(resolved)
        .pipe(Effect.mapError((error) => new ModelError({ message: error.message })))
      const codex = resolved.providerID === "openai-codex"

      const text = yield* Effect.tryPromise({
        try: async (signal) => {
          if (!codex) {
            const result = await generateText({
              model: language,
              system: input.system,
              prompt: input.user,
              temperature: 0,
              maxOutputTokens: MAX_OUTPUT_TOKENS,
              abortSignal: signal,
              maxRetries: 0,
            })
            return result.text
          }
          // The Codex backend takes its instructions as an option and does not accept a system message.
          const result = streamText({
            model: language,
            messages: [{ role: "user", content: input.user }],
            providerOptions: ProviderTransform.providerOptions(resolved, { instructions: input.system, store: false }),
            abortSignal: signal,
            maxRetries: 0,
            onError: () => {},
          })
          let collected = ""
          for await (const part of result.fullStream) {
            if (part.type === "error") throw part.error
            if (part.type === "text-delta") collected += part.text
          }
          return collected
        },
        catch: (cause) => new ModelError({ message: cause instanceof Error ? cause.message : String(cause) }),
      })
      return { text, model: `${resolved.providerID}/${resolved.id}` }
    })

    return Service.of({ complete })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Config.node, Provider.node] })

export * as PermissionReviewModel from "./model"
