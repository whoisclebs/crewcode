#!/usr/bin/env node
// Thin launcher: finds the native CrewCode binary installed by the matching
// @crewcode/cli-<platform> package and runs it with inherited stdio.
"use strict"

const { spawn, spawnSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

const INSTALL_HINT = "curl -fsSL https://github.com/whoisclebs/crewcode/releases/latest/download/install | sh"
const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"]

function isMusl() {
  if (process.platform !== "linux") return false
  try {
    if (fs.existsSync("/etc/alpine-release")) return true
    const ldd = spawnSync("ldd", ["--version"], { encoding: "utf8" })
    return `${ldd.stdout}${ldd.stderr}`.toLowerCase().includes("musl")
  } catch {
    return false
  }
}

function platformName() {
  const os = process.platform === "win32" ? "windows" : process.platform
  return `${os}-${process.arch}`
}

function fail(message) {
  console.error(`crewcode: ${message}`)
  console.error(`Alternative: install the standalone binary with\n  ${INSTALL_HINT}`)
  process.exit(1)
}

function findBinary() {
  if (process.env.CREWCODE_BIN_PATH) return process.env.CREWCODE_BIN_PATH

  const name = platformName()
  const exe = process.platform === "win32" ? "crewcode.exe" : "crewcode"
  const pkg = `@crewcode/cli-${name}`

  if (isMusl()) fail(`musl libc (Alpine) is not supported by the npm packages yet (${name}).`)

  try {
    const pkgJson = require.resolve(`${pkg}/package.json`)
    const binary = path.join(path.dirname(pkgJson), "bin", exe)
    if (fs.existsSync(binary)) return binary
    fail(`${pkg} is installed but ${binary} is missing. Try reinstalling crewcode.`)
  } catch (error) {
    if (error && error.code !== "MODULE_NOT_FOUND") throw error
  }

  const supported = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "windows-x64"]
  if (!supported.includes(name)) fail(`unsupported platform ${name}. Supported: ${supported.join(", ")}.`)
  return fail(
    `the platform package ${pkg} is not installed. ` +
      "Your package manager probably skipped optional dependencies " +
      "(npm --omit=optional / --no-optional, or a lockfile created on another platform). " +
      "Reinstall with optional dependencies enabled.",
  )
}

const child = spawn(findBinary(), process.argv.slice(2), { stdio: "inherit" })

const forwarders = FORWARDED_SIGNALS.map((signal) => {
  const forward = () => {
    try {
      child.kill(signal)
    } catch {
      // the child already exited
    }
  }
  process.on(signal, forward)
  return [signal, forward]
})

child.on("error", (error) => {
  console.error(`crewcode: cannot start the binary: ${error.message}`)
  process.exit(1)
})

child.on("exit", (code, signal) => {
  for (const [name, forward] of forwarders) process.removeListener(name, forward)
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(typeof code === "number" ? code : 1)
})
