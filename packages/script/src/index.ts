import { $ } from "bun"
import semver from "semver"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  CREWCODE_CHANNEL: process.env["CREWCODE_CHANNEL"],
  CREWCODE_VERSION: process.env["CREWCODE_VERSION"],
  CREWCODE_RELEASE: process.env["CREWCODE_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.CREWCODE_CHANNEL) return env.CREWCODE_CHANNEL
  if (env.CREWCODE_VERSION && !env.CREWCODE_VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

// The version is never looked up in an external service: it is either given explicitly or a local development version.
const VERSION = (() => {
  if (env.CREWCODE_VERSION) return env.CREWCODE_VERSION
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  throw new Error("release build requires CREWCODE_VERSION to be set explicitly")
})()

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.CREWCODE_RELEASE
  },
}
console.log(`crewcode script`, JSON.stringify(Script, null, 2))
