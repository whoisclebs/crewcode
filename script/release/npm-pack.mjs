#!/usr/bin/env node
// Generates the npm packages from dist-release/ and packs them into dist-release/npm/.
//
//   node script/release/npm-pack.mjs [--version X] [--dry-run]
//
// Produces one @crewcode/cli-<platform> package per staged binary plus the main `crewcode`
// package, all with the same version. It never publishes: see docs/distribution.md for the
// manual `npm publish` commands.

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const releaseDir = path.join(root, "dist-release")
const outDir = path.join(releaseDir, "npm")
const npmSrc = path.join(root, "packages/npm")

const PLATFORMS = {
  "linux-x64": { os: "linux", cpu: "x64", libc: "glibc" },
  "linux-arm64": { os: "linux", cpu: "arm64", libc: "glibc" },
  "darwin-x64": { os: "darwin", cpu: "x64" },
  "darwin-arm64": { os: "darwin", cpu: "arm64" },
  "windows-x64": { os: "win32", cpu: "x64" },
}

function fail(message) {
  console.error(`error: ${message}`)
  process.exit(1)
}

const argv = process.argv.slice(2)
const dryRun = argv.includes("--dry-run")
const versionIndex = argv.indexOf("--version")
const versionArg = versionIndex >= 0 ? argv[versionIndex + 1] : undefined

function stagedVersion(name) {
  const file = path.join(releaseDir, name, "VERSION")
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : undefined
}

const staged = Object.keys(PLATFORMS).filter((name) => fs.existsSync(path.join(releaseDir, name)))
if (staged.length === 0) fail(`no staged binaries in ${releaseDir}; run script/release/build.mjs first`)

const versions = new Set(staged.map(stagedVersion).filter(Boolean))
if (!versionArg && versions.size > 1) fail(`staged binaries disagree on the version: ${[...versions].join(", ")}`)
const version = (versionArg ?? [...versions][0])?.replace(/^v/, "")
if (!version) fail("cannot determine the version; pass --version")

function pack(dir) {
  const args = ["pack", ...(dryRun ? ["--dry-run"] : ["--pack-destination", outDir]), "--ignore-scripts"]
  const result = spawnSync("npm", args, { cwd: dir, stdio: "inherit", shell: process.platform === "win32" })
  if (result.status !== 0) fail(`npm pack failed in ${dir}`)
}

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
const template = fs.readFileSync(path.join(npmSrc, "platform-package.template.json"), "utf8")

for (const name of staged) {
  const platform = PLATFORMS[name]
  const exe = platform.os === "win32" ? "crewcode.exe" : "crewcode"
  const dir = path.join(outDir, "staging", `cli-${name}`)
  fs.mkdirSync(path.join(dir, "bin"), { recursive: true })

  const manifest = JSON.parse(
    template.replaceAll("{{name}}", name).replaceAll("{{version}}", version).replaceAll("{{os}}", platform.os).replaceAll("{{cpu}}", platform.cpu),
  )
  if (platform.libc) manifest.libc = [platform.libc]
  fs.writeFileSync(path.join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  fs.copyFileSync(path.join(releaseDir, name, exe), path.join(dir, "bin", exe))
  fs.chmodSync(path.join(dir, "bin", exe), 0o755)
  console.log(`\n== ${manifest.name}@${version}`)
  pack(dir)
}

// The main package: same shim, dependency versions pinned to this release.
const mainDir = path.join(outDir, "staging", "crewcode")
fs.mkdirSync(path.join(mainDir, "bin"), { recursive: true })
const main = JSON.parse(fs.readFileSync(path.join(npmSrc, "crewcode/package.json"), "utf8"))
main.version = version
main.optionalDependencies = Object.fromEntries(Object.keys(PLATFORMS).map((name) => [`@crewcode/cli-${name}`, version]))
fs.writeFileSync(path.join(mainDir, "package.json"), `${JSON.stringify(main, null, 2)}\n`)
fs.copyFileSync(path.join(npmSrc, "crewcode/bin/crewcode.js"), path.join(mainDir, "bin/crewcode.js"))
fs.chmodSync(path.join(mainDir, "bin/crewcode.js"), 0o755)
console.log(`\n== crewcode@${version}`)
pack(mainDir)

fs.rmSync(path.join(outDir, "staging"), { recursive: true, force: true })
if (staged.length < Object.keys(PLATFORMS).length) {
  console.warn(`\nwarning: only ${staged.join(", ")} were staged; the main package still lists all platforms`)
}
console.log(dryRun ? "\ndry run finished" : `\npacked into ${outDir}`)
