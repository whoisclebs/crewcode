#!/usr/bin/env node
// Builds the single-binary CrewCode release for ONE target (native build per CI runner).
//
//   node script/release/build.mjs [--target <name|triple>] [--version X]
//                                 [--core <path>] [--rust-bin <path>] [--out <dir>]
//
// 1. compiles the TypeScript server ("core") with the existing packages/crewcode/script/build.ts
// 2. builds packages/tui-rs with the core embedded (feature `embed-core`, env CREWCODE_CORE_BIN)
// 3. stages dist-release/<target>/crewcode[.exe] and writes crewcode-<target>.(tar.gz|zip) + .sha256
//
// --core      use an already compiled core instead of building it (required when cross compiling)
// --rust-bin  skip cargo and stage this binary (used to test the packaging without the Rust build)

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const crateDir = path.join(root, "packages/tui-rs")
const manifest = path.join(crateDir, "Cargo.toml")

// Release name -> Bun/npm identity and Rust triple. Names match packages/crewcode/script/build.ts.
const TARGETS = {
  "linux-x64": { os: "linux", arch: "x64", triple: "x86_64-unknown-linux-gnu" },
  "linux-arm64": { os: "linux", arch: "arm64", triple: "aarch64-unknown-linux-gnu" },
  "darwin-x64": { os: "darwin", arch: "x64", triple: "x86_64-apple-darwin" },
  "darwin-arm64": { os: "darwin", arch: "arm64", triple: "aarch64-apple-darwin" },
  "windows-x64": { os: "win32", arch: "x64", triple: "x86_64-pc-windows-msvc" },
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (!flag.startsWith("--")) fail(`unexpected argument: ${flag}`)
    const value = argv[++i]
    if (value === undefined) fail(`missing value for ${flag}`)
    args[flag.slice(2)] = value
  }
  return args
}

function fail(message) {
  console.error(`error: ${message}`)
  process.exit(1)
}

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(" ")}`)
  const result = spawnSync(command, args, { stdio: "inherit", ...options })
  if (result.error) fail(`${command}: ${result.error.message}`)
  if (result.status !== 0) fail(`${command} exited with status ${result.status}`)
}

function resolveTarget(value) {
  const name =
    value ?? `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`
  const found = Object.entries(TARGETS).find(([key, item]) => key === name || item.triple === name)
  if (!found) fail(`unsupported target "${name}"; supported: ${Object.keys(TARGETS).join(", ")}`)
  return { name: found[0], ...found[1] }
}

function defaultVersion() {
  const toml = fs.readFileSync(manifest, "utf8")
  return /^version\s*=\s*"([^"]+)"/m.exec(toml)?.[1]
}

const args = parseArgs(process.argv.slice(2))
const target = resolveTarget(args.target)
const version = (args.version ?? process.env.CREWCODE_VERSION ?? defaultVersion()).replace(/^v/, "")
const outRoot = path.resolve(args.out ?? path.join(root, "dist-release"))
const exe = target.os === "win32" ? "crewcode.exe" : "crewcode"
const isNative = target.os === process.platform && target.arch === process.arch

console.log(`target ${target.name} (${target.triple}), version ${version}`)

// 1. core: the TypeScript server compiled to a standalone executable
function buildCore() {
  if (args.core) return path.resolve(args.core)
  if (!isNative) fail(`the core is compiled natively; build ${target.name} on its own runner or pass --core`)
  const env = { ...process.env, CREWCODE_VERSION: version, CREWCODE_CHANNEL: "latest" }
  run("bun", ["run", "script/build.ts", "--single", "--skip-install"], { cwd: path.join(root, "packages/crewcode"), env })
  const binDir = path.join(root, "packages/crewcode/dist", `crewcode-${target.name}`, "bin")
  const built = [path.join(binDir, "crewcode.exe"), path.join(binDir, "crewcode")].find(fs.existsSync)
  if (!built) fail(`core build produced no executable in ${binDir}`)
  return built
}

// 2. the Rust binary with the core embedded
function buildRust(core) {
  if (args["rust-bin"]) return path.resolve(args["rust-bin"])
  if (!/^\[features\][\s\S]*^embed-core\s*=/m.test(fs.readFileSync(manifest, "utf8"))) {
    fail(`${manifest} has no "embed-core" feature yet (or pass --rust-bin to only test the packaging)`)
  }
  const cargoArgs = ["build", "--release", "--features", "embed-core", "--manifest-path", manifest]
  if (!isNative || args.target) cargoArgs.push("--target", target.triple)
  run("cargo", cargoArgs, { env: { ...process.env, CREWCODE_CORE_BIN: core, CREWCODE_VERSION: version } })
  const targetDir = process.env.CARGO_TARGET_DIR ?? path.join(crateDir, "target")
  const profileDir = cargoArgs.includes("--target") ? path.join(targetDir, target.triple, "release") : path.join(targetDir, "release")
  const built = path.join(profileDir, exe)
  if (!fs.existsSync(built)) fail(`cargo did not produce ${built} (the Cargo bin name must be "crewcode")`)
  return built
}

// 3. staging, archive and checksum
function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex")
}

function archive(stageDir) {
  const zip = target.os === "win32"
  const file = `crewcode-${target.name}.${zip ? "zip" : "tar.gz"}`
  const out = path.join(outRoot, file)
  fs.rmSync(out, { force: true })
  // bsdtar (macOS, Windows 10+) and GNU tar both work; `-a` picks zip from the extension on bsdtar
  if (zip) run("tar", ["-a", "-c", "-f", out, "-C", stageDir, exe])
  else run("tar", ["-czf", out, "-C", stageDir, exe])
  fs.writeFileSync(`${out}.sha256`, `${sha256(out)}  ${file}\n`)
  return out
}

const core = buildCore()
const built = buildRust(core)

const stageDir = path.join(outRoot, target.name)
fs.rmSync(stageDir, { recursive: true, force: true })
fs.mkdirSync(stageDir, { recursive: true })
fs.copyFileSync(built, path.join(stageDir, exe))
fs.chmodSync(path.join(stageDir, exe), 0o755)
fs.writeFileSync(path.join(stageDir, "VERSION"), `${version}\n`)

const archivePath = archive(stageDir)
const size = (file) => `${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MiB`
console.log(`\nstaged   ${path.join(stageDir, exe)} (${size(path.join(stageDir, exe))})`)
console.log(`archive  ${archivePath} (${size(archivePath)})`)
console.log(`checksum ${archivePath}.sha256`)
