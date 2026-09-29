import { expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../../fixture/fixture"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const { TuiPluginRuntime } = await import("../../../src/plugin/tui/runtime")

test("does not use directory package main for tui entry", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const mod = path.join(dir, "mods", "dir-plugin")
      const spec = pathToFileURL(mod).href
      const marker = path.join(dir, "dir-main-called.txt")
      await fs.mkdir(mod, { recursive: true })

      await Bun.write(
        path.join(mod, "package.json"),
        JSON.stringify({
          name: "dir-plugin",
          type: "module",
          main: "./main.js",
        }),
      )
      await Bun.write(
        path.join(mod, "main.js"),
        `export default {
  id: "demo.dir.main",
  tui: async () => {
    await Bun.write(${JSON.stringify(marker)}, "called")
  },
}
`,
      )

      return { marker, spec }
    },
  })

  process.env.CREWCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const config = createTuiResolvedConfig({
    plugin: [tmp.extra.spec],
    plugin_origins: [
      {
        spec: tmp.extra.spec,
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
    ],
  })
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)

  try {
    await TuiPluginRuntime.init({ api: createTuiPluginApi(), config })
    await expect(fs.readFile(tmp.extra.marker, "utf8")).rejects.toThrow()
    expect(TuiPluginRuntime.list().some((item) => item.spec === tmp.extra.spec)).toBe(false)
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    delete process.env.CREWCODE_PLUGIN_META_FILE
  }
})

test("uses directory index fallback for tui when package.json is missing", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const mod = path.join(dir, "mods", "dir-index")
      const spec = pathToFileURL(mod).href
      const marker = path.join(dir, "dir-index-called.txt")
      await fs.mkdir(mod, { recursive: true })
      await Bun.write(
        path.join(mod, "index.ts"),
        `export default {
  id: "demo.dir.index",
  tui: async () => {
    await Bun.write(${JSON.stringify(marker)}, "called")
  },
}
`,
      )
      return { marker, spec }
    },
  })

  process.env.CREWCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const config = createTuiResolvedConfig({
    plugin: [tmp.extra.spec],
    plugin_origins: [
      {
        spec: tmp.extra.spec,
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
    ],
  })
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)

  try {
    await TuiPluginRuntime.init({ api: createTuiPluginApi(), config })
    await expect(fs.readFile(tmp.extra.marker, "utf8")).resolves.toBe("called")
    expect(TuiPluginRuntime.list().find((item) => item.id === "demo.dir.index")?.active).toBe(true)
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    delete process.env.CREWCODE_PLUGIN_META_FILE
  }
})
