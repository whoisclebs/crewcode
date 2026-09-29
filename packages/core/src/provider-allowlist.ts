import { Schema } from "effect"

/**
 * The only providers CrewCode accepts. Every entry point that can introduce a provider (catalog, config, auth store,
 * environment, plugins, HTTP routes, CLI) consults this list, so a provider cannot come back through a side door.
 *
 * To support another provider in the future: add its id here and add its entry to the catalog snapshot.
 */
export const ids = ["openrouter", "openai", "openai-codex"] as const
export type ID = (typeof ids)[number]

export function isAllowed(id: string): id is ID {
  return (ids as readonly string[]).includes(id)
}

export function filter<T>(input: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(input).filter(([id]) => isAllowed(id)))
}

export function message(id: string) {
  return `Provider "${id}" is not supported in CrewCode v0. Supported providers: ${ids.join(", ")}.`
}

export class UnsupportedProviderError extends Schema.TaggedErrorClass<UnsupportedProviderError>()(
  "ProviderAllowlist.UnsupportedProviderError",
  {
    providerID: Schema.String,
  },
) {
  override get message() {
    return message(this.providerID)
  }
}

export function assertAllowed(id: string): asserts id is ID {
  if (!isAllowed(id)) throw new UnsupportedProviderError({ providerID: id })
}

export * as ProviderAllowlist from "./provider-allowlist"
