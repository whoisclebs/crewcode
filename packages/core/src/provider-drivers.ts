/**
 * The provider SDKs that ship inside CrewCode. A catalog entry or a configured provider is usable only if its driver is
 * one of these (or a `file://` path the user supplies): CrewCode never installs code at run time, so anything else could
 * not be loaded. Most hosted providers, and every local server (Ollama, vLLM, LM Studio), speak the OpenAI protocol and
 * use `@ai-sdk/openai-compatible`.
 */
export const bundled = ["@ai-sdk/openai", "@ai-sdk/openai-compatible", "@openrouter/ai-sdk-provider"] as const
export type Bundled = (typeof bundled)[number]

export function isBundled(npm: string): npm is Bundled {
  return (bundled as readonly string[]).includes(npm)
}

export function isAvailable(npm: string) {
  return isBundled(npm) || npm.startsWith("file://")
}

export function message(providerID: string, npm: string) {
  return `Provider "${providerID}" needs the SDK ${npm}, which is not bundled with CrewCode. Bundled: ${bundled.join(", ")}. If it speaks the OpenAI protocol, set "npm": "@ai-sdk/openai-compatible" and a "baseURL" in crewcode.json.`
}

/**
 * The providers offered by default in connect lists. The catalog holds many more; those stay usable by id (config,
 * `crewcode providers login <id>`, environment variables) and show up in lists once configured or connected.
 */
export const featured = ["openai-codex", "openai", "openrouter"] as const

export function isVisible(id: string, configured: { connected?: boolean; declared?: boolean }) {
  return (featured as readonly string[]).includes(id) || !!configured.connected || !!configured.declared
}

export * as ProviderDrivers from "./provider-drivers"
