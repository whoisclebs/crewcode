#!/usr/bin/env bun

// Regenerates src/catalog/models-snapshot.json, the only model catalog CrewCode reads at runtime.
//
// This is a developer command and the one place that touches the network for catalog data. Run it on purpose, review the
// diff, commit the result. Nothing at runtime fetches or refreshes the catalog.
//
//   bun run models:snapshot                  # download https://models.dev/api.json
//   bun run models:snapshot --from api.json  # use a local copy (file path or URL)

import { createHash } from "crypto"
import { rename, writeFile } from "fs/promises"
import path from "path"
import { Schema } from "effect"
import { ModelsDev } from "../src/models-dev"
import { ProviderAllowlist } from "../src/provider-allowlist"

const DEFAULT_SOURCE = "https://models.dev/api.json"
const CODEX_ID = "openai-codex"
const REQUIRED = ["openrouter", "openai"] as const

// Codex (ChatGPT account) serves a subset of the OpenAI catalog. The list of eligible models is data produced here, not a
// list hardcoded in the runtime, so it is reviewed as a diff whenever the snapshot is regenerated.
const CODEX_ALLOWED = new Set(["gpt-5.5", "gpt-5.3-codex-spark", "gpt-5.4", "gpt-5.4-mini", "gpt-6-sol", "gpt-6-luna"])
const CODEX_DISALLOWED = new Set(["gpt-5.5-pro"])
const CODEX_LARGE_CONTEXT = { context: 400_000, input: 272_000, output: 128_000 }

const Catalog = Schema.Record(Schema.String, ModelsDev.Provider)
const decodeCatalog = Schema.decodeUnknownSync(Catalog)

export function buildSnapshot(source: Record<string, unknown>): Record<string, ModelsDev.Provider> {
  const missing = REQUIRED.filter((id) => !(id in source))
  if (missing.length > 0) throw new Error(`source catalog is missing required provider(s): ${missing.join(", ")}`)

  const decoded = decodeCatalog(Object.fromEntries(REQUIRED.map((id) => [id, source[id]])))
  const codex = deriveCodex(decoded.openai)
  if (Object.keys(codex.models).length === 0) throw new Error(`no eligible models left for ${CODEX_ID}`)

  const snapshot = ProviderAllowlist.filter({ ...decoded, [CODEX_ID]: codex })
  return sortKeys(snapshot)
}

function deriveCodex(openai: ModelsDev.Provider): ModelsDev.Provider {
  return {
    id: CODEX_ID,
    name: "OpenAI Codex",
    env: [],
    npm: openai.npm,
    models: Object.fromEntries(
      Object.entries(openai.models)
        .filter(([, model]) => codexEligible(model.id))
        .map(([id, model]) => [id, toCodexModel(model)]),
    ),
  }
}

function codexEligible(id: string) {
  if (CODEX_ALLOWED.has(id)) return true
  if (CODEX_DISALLOWED.has(id)) return false
  if (id === "gpt-5.6") return false
  const match = id.match(/^gpt-(\d+)(?:\.(\d+))?/)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2] ?? 0)
  return major > 5 || (major === 5 && minor > 4)
}

function toCodexModel(model: ModelsDev.Model): ModelsDev.Model {
  return {
    ...withoutProModes(model),
    cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    limit: model.id.includes("gpt-5.5") || model.id.includes("gpt-5.6") ? CODEX_LARGE_CONTEXT : model.limit,
  }
}

// Modes with reasoning.mode "pro" expand into extra pro variants at runtime; Codex does not serve those.
function withoutProModes(model: ModelsDev.Model): ModelsDev.Model {
  const modes = Object.entries(model.experimental?.modes ?? {}).filter(([, mode]) => {
    const reasoning = (mode.provider?.body as { reasoning?: { mode?: unknown } } | undefined)?.reasoning
    return reasoning?.mode !== "pro"
  })
  const { experimental: _, ...rest } = model
  return modes.length === 0 ? rest : { ...rest, experimental: { modes: Object.fromEntries(modes) } }
}

function sortKeys(snapshot: Record<string, ModelsDev.Provider>): Record<string, ModelsDev.Provider> {
  return Object.fromEntries(
    Object.entries(snapshot)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, provider]) => [
        id,
        {
          ...provider,
          models: Object.fromEntries(Object.entries(provider.models).sort(([a], [b]) => a.localeCompare(b))),
        },
      ]),
  )
}

async function readSource(from: string) {
  if (/^https?:\/\//.test(from)) {
    const response = await fetch(from)
    if (!response.ok) throw new Error(`failed to download ${from}: ${response.status} ${response.statusText}`)
    return response.text()
  }
  return Bun.file(from).text()
}

async function writeAtomically(file: string, content: string) {
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, content)
  await rename(temp, file)
}

if (import.meta.main) {
  const flag = process.argv.indexOf("--from")
  const from = flag === -1 ? DEFAULT_SOURCE : (process.argv[flag + 1] ?? DEFAULT_SOURCE)
  const text = await readSource(from)

  // Build and validate everything before touching any file, so a bad source never overwrites a good snapshot.
  const snapshot = buildSnapshot(JSON.parse(text))
  const dir = path.resolve(import.meta.dir, "../src/catalog")
  await writeAtomically(path.join(dir, "models-snapshot.json"), JSON.stringify(snapshot, null, 1) + "\n")
  await writeAtomically(
    path.join(dir, "models-snapshot.meta.json"),
    JSON.stringify(
      {
        source: from,
        fetched_at: new Date().toISOString(),
        source_sha256: createHash("sha256").update(text).digest("hex"),
        models: Object.fromEntries(Object.entries(snapshot).map(([id, provider]) => [id, Object.keys(provider.models).length])),
      },
      null,
      2,
    ) + "\n",
  )
  console.log(`Wrote ${path.join(dir, "models-snapshot.json")}`)
}
