import { OpenAIPlugin } from "./provider/openai"
import { OpenAICompatiblePlugin } from "./provider/openai-compatible"
import { OpenRouterPlugin } from "./provider/openrouter"
import type { PluginInternal } from "./internal"
import type { Scope } from "effect"

export const ProviderPlugins: PluginInternal.Plugin<PluginInternal.Requirements | Scope.Scope>[] = [
  OpenAICompatiblePlugin,
  OpenAIPlugin,
  OpenRouterPlugin,
]
