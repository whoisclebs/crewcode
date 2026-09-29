import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@crewcode/core/effect/layer-node"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { CrossSpawnSpawner } from "@crewcode/core/cross-spawn-spawner"
import { FSUtil } from "@crewcode/core/fs-util"
import { Config } from "@/config/config"
import { disposeAllInstances, provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const { Plugin } = await import("../../src/plugin/index")
const { PluginLoader } = await import("../../src/plugin/loader")
const { readPackageThemes } = await import("../../src/plugin/shared")
const { TestConfig } = await import("../fixture/config")
const { RuntimeFlags } = await import("../../src/effect/runtime-flags")

afterEach(async () => {
  await disposeAllInstances()
})

const it = testEffect(
  Layer.mergeAll(LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, FSUtil.node])), testInstanceStoreLayer),
)

function withTmp<T, A, E, R>(
  init: (dir: string) => Promise<T>,
  body: (tmp: { path: string; extra: T }) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const extra = yield* Effect.promise(() => init(dir))
    return yield* body({ path: dir, extra })
  })
}

function load(dir: string, flags?: Parameters<typeof RuntimeFlags.layer>[0]) {
  const source = path.join(dir, "crewcode.json")
  return Effect.gen(function* () {
    const config = yield* Effect.promise(
      () => Bun.file(source).json() as Promise<{ plugin?: Array<string | [string, Record<string, unknown>]> }>,
    )
    const plugins = config.plugin ?? []
    return yield* Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      yield* plugin.list()
    }).pipe(
      Effect.provide(
        LayerNode.compile(Plugin.node, [
          [
            Config.node,
            TestConfig.layer({
              get: () =>
                Effect.succeed({
                  plugin: plugins,
                  plugin_origins: plugins.map((plugin) => ({ spec: plugin, source, scope: "local" as const })),
                }),
              directories: () => Effect.succeed([dir]),
            }),
          ],
          [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true, ...flags })],
        ]),
      ),
      provideInstance(dir),
    )
  })
}

describe("plugin.loader.shared", () => {
  it.live("loads a file:// plugin function export", () =>
    withTmp(
      async (dir) => {
        const file = path.join(dir, "plugin.ts")
        const mark = path.join(dir, "called.txt")
        await Bun.write(
          file,
          [
            "export default async () => {",
            `  await Bun.write(${JSON.stringify(mark)}, "called")`,
            "  return {}",
            "}",
            "",
          ].join("\n"),
        )

        await Bun.write(
          path.join(dir, "crewcode.json"),
          JSON.stringify({ plugin: [pathToFileURL(file).href] }, null, 2),
        )

        return { mark }
      },
      (tmp) =>
        Effect.gen(function* () {
          yield* load(tmp.path)
          expect(yield* Effect.promise(() => fs.readFile(tmp.extra.mark, "utf8"))).toBe("called")
        }),
    ),
  )

  it.live("deduplicates same function exported as default and named", () =>
    withTmp(
      async (dir) => {
        const file = path.join(dir, "plugin.ts")
        const mark = path.join(dir, "count.txt")
        await Bun.write(mark, "")
        await Bun.write(
          file,
          [
            "const run = async () => {",
            `  const text = await Bun.file(${JSON.stringify(mark)}).text().catch(() => "")`,
            `  await Bun.write(${JSON.stringify(mark)}, text + "1")`,
            "  return {}",
            "}",
            "export default run",
            "export const named = run",
            "",
          ].join("\n"),
        )

        await Bun.write(
          path.join(dir, "crewcode.json"),
          JSON.stringify({ plugin: [pathToFileURL(file).href] }, null, 2),
        )

        return { mark }
      },
      (tmp) =>
        Effect.gen(function* () {
          yield* load(tmp.path)
          expect(yield* Effect.promise(() => fs.readFile(tmp.extra.mark, "utf8"))).toBe("1")
        }),
    ),
  )

  it.live("uses only default v1 server plugin when present", () =>
    withTmp(
      async (dir) => {
        const file = path.join(dir, "plugin.ts")
        const mark = path.join(dir, "count.txt")
        await Bun.write(
          file,
          [
            "export default {",
            '  id: "demo.v1-default",',
            "  server: async () => {",
            `    await Bun.write(${JSON.stringify(mark)}, "default")`,
            "    return {}",
            "  },",
            "}",
            "export const named = async () => {",
            `  await Bun.write(${JSON.stringify(mark)}, "named")`,
            "  return {}",
            "}",
            "",
          ].join("\n"),
        )

        await Bun.write(
          path.join(dir, "crewcode.json"),
          JSON.stringify({ plugin: [pathToFileURL(file).href] }, null, 2),
        )

        return { mark }
      },
      (tmp) =>
        Effect.gen(function* () {
          yield* load(tmp.path)
          expect(yield* Effect.promise(() => Bun.file(tmp.extra.mark).text())).toBe("default")
        }),
    ),
  )

  it.live("rejects v1 file server plugin without id", () =>
    withTmp(
      async (dir) => {
        const file = path.join(dir, "plugin.ts")
        const mark = path.join(dir, "called.txt")
        await Bun.write(
          file,
          [
            "export default {",
            "  server: async () => {",
            `    await Bun.write(${JSON.stringify(mark)}, "called")`,
            "    return {}",
            "  },",
            "}",
            "",
          ].join("\n"),
        )

        await Bun.write(
          path.join(dir, "crewcode.json"),
          JSON.stringify({ plugin: [pathToFileURL(file).href] }, null, 2),
        )

        return { mark }
      },
      (tmp) =>
        Effect.gen(function* () {
          yield* load(tmp.path)
          const called = yield* Effect.promise(() =>
            Bun.file(tmp.extra.mark)
              .text()
              .then(() => true)
              .catch(() => false),
          )

          expect(called).toBe(false)
        }),
    ),
  )

  it.live("rejects v1 plugin that exports server and tui together", () =>
    withTmp(
      async (dir) => {
        const file = path.join(dir, "plugin.ts")
        const mark = path.join(dir, "called.txt")
        await Bun.write(
          file,
          [
            "export default {",
            '  id: "demo.mixed",',
            "  server: async () => {",
            `    await Bun.write(${JSON.stringify(mark)}, "server")`,
            "    return {}",
            "  },",
            "  tui: async () => {},",
            "}",
            "",
          ].join("\n"),
        )

        await Bun.write(
          path.join(dir, "crewcode.json"),
          JSON.stringify({ plugin: [pathToFileURL(file).href] }, null, 2),
        )

        return { mark }
      },
      (tmp) =>
        Effect.gen(function* () {
          yield* load(tmp.path)
          const called = yield* Effect.promise(() =>
            Bun.file(tmp.extra.mark)
              .text()
              .then(() => true)
              .catch(() => false),
          )

          expect(called).toBe(false)
        }),
    ),
  )

  it.live("skips legacy codex and copilot auth plugin specs without reporting errors", () =>
    Effect.gen(function* () {
      const failed: string[] = []
      const loaded = yield* Effect.promise(() =>
        PluginLoader.loadExternal({
          items: ["crewcode-openai-codex-auth@1.0.0", "crewcode-copilot-auth@1.0.0", "regular-plugin@1.0.0"].map(
            (spec) => ({ spec, scope: "local" as const, source: "test" }),
          ),
          kind: "server",
          report: {
            error(candidate) {
              failed.push(candidate.plan.spec)
            },
          },
        }),
      )

      expect(loaded).toEqual([])
      expect(failed).toEqual(["regular-plugin@1.0.0"])
    }),
  )

  it.live("skips npm plugin specs and still loads local plugins", () =>
    withTmp(
      async (dir) => {
        const ok = path.join(dir, "ok.ts")
        const mark = path.join(dir, "ok.txt")
        await Bun.write(
          ok,
          [
            "export default {",
            '  id: "demo.ok",',
            "  server: async () => {",
            `    await Bun.write(${JSON.stringify(mark)}, "ok")`,
            "    return {}",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
        await Bun.write(
          path.join(dir, "crewcode.json"),
          JSON.stringify({ plugin: ["npm-plugin@9.9.9", pathToFileURL(ok).href] }, null, 2),
        )
        return { mark }
      },
      (tmp) =>
        Effect.gen(function* () {
          yield* load(tmp.path)
          expect(yield* Effect.promise(() => Bun.file(tmp.extra.mark).text())).toBe("ok")
        }),
    ),
  )

  it.live("continues loading plugins when plugin init throws", () =>
    withTmp(
      async (dir) => {
        const file = pathToFileURL(path.join(dir, "throws.ts")).href
        const ok = pathToFileURL(path.join(dir, "ok.ts")).href
        const mark = path.join(dir, "ok.txt")
        await Bun.write(
          path.join(dir, "throws.ts"),
          [
            "export default {",
            '  id: "demo.throws",',
            "  server: async () => {",
            '    throw new Error("explode")',
            "  },",
            "}",
            "",
          ].join("\n"),
        )
        await Bun.write(
          path.join(dir, "ok.ts"),
          [
            "export default {",
            '  id: "demo.ok",',
            "  server: async () => {",
            `    await Bun.write(${JSON.stringify(mark)}, "ok")`,
            "    return {}",
            "  },",
            "}",
            "",
          ].join("\n"),
        )

        await Bun.write(path.join(dir, "crewcode.json"), JSON.stringify({ plugin: [file, ok] }, null, 2))

        return { mark }
      },
      (tmp) =>
        Effect.gen(function* () {
          yield* load(tmp.path)
          expect(yield* Effect.promise(() => Bun.file(tmp.extra.mark).text())).toBe("ok")
        }),
    ),
  )

  it.live("continues loading plugins when plugin module has invalid export", () =>
    withTmp(
      async (dir) => {
        const file = pathToFileURL(path.join(dir, "invalid.ts")).href
        const ok = pathToFileURL(path.join(dir, "ok.ts")).href
        const mark = path.join(dir, "ok.txt")
        await Bun.write(
          path.join(dir, "invalid.ts"),
          ["export default {", '  id: "demo.invalid",', "  nope: true,", "}", ""].join("\n"),
        )
        await Bun.write(
          path.join(dir, "ok.ts"),
          [
            "export default {",
            '  id: "demo.ok",',
            "  server: async () => {",
            `    await Bun.write(${JSON.stringify(mark)}, "ok")`,
            "    return {}",
            "  },",
            "}",
            "",
          ].join("\n"),
        )

        await Bun.write(path.join(dir, "crewcode.json"), JSON.stringify({ plugin: [file, ok] }, null, 2))

        return { mark }
      },
      (tmp) =>
        Effect.gen(function* () {
          yield* load(tmp.path)
          expect(yield* Effect.promise(() => Bun.file(tmp.extra.mark).text())).toBe("ok")
        }),
    ),
  )

  it.live("continues loading plugins when plugin import fails", () =>
    withTmp(
      async (dir) => {
        const missing = pathToFileURL(path.join(dir, "missing-plugin.ts")).href
        const ok = pathToFileURL(path.join(dir, "ok.ts")).href
        const mark = path.join(dir, "ok.txt")
        await Bun.write(
          path.join(dir, "ok.ts"),
          [
            "export default {",
            '  id: "demo.ok",',
            "  server: async () => {",
            `    await Bun.write(${JSON.stringify(mark)}, "ok")`,
            "    return {}",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
        await Bun.write(path.join(dir, "crewcode.json"), JSON.stringify({ plugin: [missing, ok] }, null, 2))

        return { mark }
      },
      (tmp) =>
        Effect.gen(function* () {
          yield* load(tmp.path)
          expect(yield* Effect.promise(() => Bun.file(tmp.extra.mark).text())).toBe("ok")
        }),
    ),
  )

  it.live("loads object plugin via plugin.server", () =>
    withTmp(
      async (dir) => {
        const file = path.join(dir, "object-plugin.ts")
        const mark = path.join(dir, "object-called.txt")
        await Bun.write(
          file,
          [
            "const plugin = {",
            '  id: "demo.object",',
            "  server: async () => {",
            `    await Bun.write(${JSON.stringify(mark)}, "called")`,
            "    return {}",
            "  },",
            "}",
            "export default plugin",
            "",
          ].join("\n"),
        )

        await Bun.write(
          path.join(dir, "crewcode.json"),
          JSON.stringify({ plugin: [pathToFileURL(file).href] }, null, 2),
        )

        return { mark }
      },
      (tmp) =>
        Effect.gen(function* () {
          yield* load(tmp.path)
          expect(yield* Effect.promise(() => fs.readFile(tmp.extra.mark, "utf8"))).toBe("called")
        }),
    ),
  )

  it.live("passes tuple plugin options into server plugin", () =>
    withTmp(
      async (dir) => {
        const file = path.join(dir, "options-plugin.ts")
        const mark = path.join(dir, "options.json")
        await Bun.write(
          file,
          [
            "const plugin = {",
            '  id: "demo.options",',
            "  server: async (_input, options) => {",
            `    await Bun.write(${JSON.stringify(mark)}, JSON.stringify(options ?? null))`,
            "    return {}",
            "  },",
            "}",
            "export default plugin",
            "",
          ].join("\n"),
        )

        await Bun.write(
          path.join(dir, "crewcode.json"),
          JSON.stringify({ plugin: [[pathToFileURL(file).href, { source: "tuple", enabled: true }]] }, null, 2),
        )

        return { mark }
      },
      (tmp) =>
        Effect.gen(function* () {
          yield* load(tmp.path)
          expect(
            (yield* (yield* FSUtil.Service).readJson(tmp.extra.mark)) as { source: string; enabled: boolean },
          ).toEqual({
            source: "tuple",
            enabled: true,
          })
        }),
    ),
  )

  it.live("initializes server plugins in config order", () =>
    withTmp(
      async (dir) => {
        const a = path.join(dir, "a-plugin.ts")
        const b = path.join(dir, "b-plugin.ts")
        const marker = path.join(dir, "server-order.txt")
        const aSpec = pathToFileURL(a).href
        const bSpec = pathToFileURL(b).href

        await Bun.write(
          a,
          `import fs from "fs/promises"

export default {
  id: "demo.order.a",
  server: async () => {
    await fs.appendFile(${JSON.stringify(marker)}, "a-start\\n")
    await Bun.sleep(25)
    await fs.appendFile(${JSON.stringify(marker)}, "a-end\\n")
    return {}
  },
}
`,
        )
        await Bun.write(
          b,
          `import fs from "fs/promises"

export default {
  id: "demo.order.b",
  server: async () => {
    await fs.appendFile(${JSON.stringify(marker)}, "b\\n")
    return {}
  },
}
`,
        )

        await Bun.write(path.join(dir, "crewcode.json"), JSON.stringify({ plugin: [aSpec, bSpec] }, null, 2))

        return { marker }
      },
      (tmp) =>
        Effect.gen(function* () {
          yield* load(tmp.path)
          const lines = (yield* Effect.promise(() => fs.readFile(tmp.extra.marker, "utf8"))).trim().split("\n")
          expect(lines).toEqual(["a-start", "a-end", "b"])
        }),
    ),
  )

  it.live("skips external plugins in pure mode", () =>
    withTmp(
      async (dir) => {
        const file = path.join(dir, "plugin.ts")
        const mark = path.join(dir, "called.txt")
        await Bun.write(
          file,
          [
            "export default {",
            '  id: "demo.pure",',
            "  server: async () => {",
            `    await Bun.write(${JSON.stringify(mark)}, "called")`,
            "    return {}",
            "  },",
            "}",
            "",
          ].join("\n"),
        )

        await Bun.write(
          path.join(dir, "crewcode.json"),
          JSON.stringify({ plugin: [pathToFileURL(file).href] }, null, 2),
        )

        return { mark }
      },
      (tmp) =>
        Effect.gen(function* () {
          yield* load(tmp.path, { pure: true })
          const called = yield* Effect.promise(() =>
            fs
              .readFile(tmp.extra.mark, "utf8")
              .then(() => true)
              .catch(() => false),
          )
          expect(called).toBe(false)
        }),
    ),
  )

  it.live("reads oc-themes from package manifest", () =>
    withTmp(
      async (dir) => {
        const mod = path.join(dir, "mod")
        await fs.mkdir(path.join(mod, "themes"), { recursive: true })
        await Bun.write(
          path.join(mod, "package.json"),
          JSON.stringify(
            {
              name: "acme-plugin",
              version: "1.0.0",
              "oc-themes": ["themes/one.json", "./themes/one.json", "themes/two.json"],
            },
            null,
            2,
          ),
        )

        return { mod }
      },
      (tmp) =>
        Effect.gen(function* () {
          const file = path.join(tmp.extra.mod, "package.json")
          const fsys = yield* FSUtil.Service
          const json = (yield* fsys.readJson(file)) as Record<string, unknown>
          const list = readPackageThemes("acme-plugin", {
            dir: tmp.extra.mod,
            pkg: file,
            json,
          })

          expect(list).toEqual([
            FSUtil.resolve(path.join(tmp.extra.mod, "themes", "one.json")),
            FSUtil.resolve(path.join(tmp.extra.mod, "themes", "two.json")),
          ])
        }),
    ),
  )

  it.live("handles no-entrypoint tui packages via missing callback", () =>
    withTmp(
      async (dir) => {
        const mod = path.join(dir, "mods", "acme-plugin")
        await fs.mkdir(path.join(mod, "themes"), { recursive: true })
        await Bun.write(
          path.join(mod, "package.json"),
          JSON.stringify(
            {
              name: "acme-plugin",
              version: "1.0.0",
              "oc-themes": ["themes/night.json"],
            },
            null,
            2,
          ),
        )
        await Bun.write(path.join(mod, "themes", "night.json"), "{}\n")
        return { mod }
      },
      (tmp) =>
        Effect.gen(function* () {
          const missing: string[] = []

            const loaded = yield* Effect.promise(() =>
              PluginLoader.loadExternal({
                items: [
                  {
                    spec: pathToFileURL(tmp.extra.mod).href,
                    scope: "local" as const,
                    source: tmp.path,
                  },
                ],
                kind: "tui",
                missing: async (item) => {
                  if (!item.pkg) return
                  const themes = readPackageThemes(item.spec, item.pkg)
                  if (!themes.length) return
                  return {
                    spec: item.spec,
                    target: item.target,
                    themes,
                  }
                },
                report: {
                  missing(_candidate, message) {
                    missing.push(message)
                  },
                },
              }),
            )

            expect(loaded).toEqual([
              {
                spec: pathToFileURL(tmp.extra.mod).href,
                target: pathToFileURL(tmp.extra.mod).href,
                themes: [FSUtil.resolve(path.join(tmp.extra.mod, "themes", "night.json"))],
              },
            ])
            expect(missing).toHaveLength(0)
        }),
    ),
  )

  it.live("passes package metadata for entrypoint tui plugins", () =>
    withTmp(
      async (dir) => {
        const mod = path.join(dir, "mods", "acme-plugin")
        await fs.mkdir(path.join(mod, "themes"), { recursive: true })
        await Bun.write(
          path.join(mod, "package.json"),
          JSON.stringify(
            {
              name: "acme-plugin",
              version: "1.0.0",
              exports: {
                "./tui": "./tui.js",
              },
              "oc-themes": ["themes/night.json"],
            },
            null,
            2,
          ),
        )
        await Bun.write(path.join(mod, "tui.js"), 'export default { id: "demo", tui: async () => {} }\n')
        await Bun.write(path.join(mod, "themes", "night.json"), "{}\n")
        return { mod }
      },
      (tmp) =>
        Effect.gen(function* () {

            const loaded = yield* Effect.promise(() =>
              PluginLoader.loadExternal({
                items: [
                  {
                    spec: pathToFileURL(tmp.extra.mod).href,
                    scope: "local" as const,
                    source: tmp.path,
                  },
                ],
                kind: "tui",
                finish: async (item) => {
                  if (!item.pkg) return
                  return {
                    spec: item.spec,
                    themes: readPackageThemes(item.spec, item.pkg),
                  }
                },
              }),
            )

            expect(loaded).toEqual([
              {
                spec: pathToFileURL(tmp.extra.mod).href,
                themes: [FSUtil.resolve(path.join(tmp.extra.mod, "themes", "night.json"))],
              },
            ])
        }),
    ),
  )

  it.live("rejects oc-themes path traversal", () =>
    withTmp(
      async (dir) => {
        const mod = path.join(dir, "mod")
        await fs.mkdir(mod, { recursive: true })
        const file = path.join(mod, "package.json")
        await Bun.write(file, JSON.stringify({ name: "acme", "oc-themes": ["../escape.json"] }, null, 2))
        return { mod, file }
      },
      (tmp) =>
        Effect.gen(function* () {
          const fsys = yield* FSUtil.Service
          const json = (yield* fsys.readJson(tmp.extra.file)) as Record<string, unknown>
          expect(() =>
            readPackageThemes("acme", {
              dir: tmp.extra.mod,
              pkg: tmp.extra.file,
              json,
            }),
          ).toThrow("outside plugin directory")
        }),
    ),
  )

  it.live("reports permanent file plugin entry errors once", () =>
    withTmp(
      async (dir) => {
        const mod = path.join(dir, "bad-entry")
        const spec = pathToFileURL(mod).href
        await fs.mkdir(mod, { recursive: true })
        await Bun.write(
          path.join(mod, "package.json"),
          JSON.stringify({ exports: { "./tui": "../outside.js" } }, null, 2),
        )
        return { spec }
      },
      (tmp) =>
        Effect.gen(function* () {
          const errors: string[] = []

          const loaded = yield* Effect.promise(() =>
            PluginLoader.loadExternal({
              items: [
                {
                  spec: tmp.extra.spec,
                  scope: "local" as const,
                  source: tmp.path,
                },
              ],
              kind: "tui",
              report: {
                error(_candidate, stage) {
                  errors.push(stage)
                },
              },
            }),
          )

          expect(loaded).toEqual([])
          expect(errors).toEqual(["entry"])
        }),
    ),
  )

  it.live("drops file plugins when finish returns undefined", () =>
    withTmp(
      async (dir) => {
        const file = path.join(dir, "plugin.ts")
        const spec = pathToFileURL(file).href
        await Bun.write(file, "export default {}\n")
        return { spec }
      },
      (tmp) =>
        Effect.gen(function* () {
          let count = 0

          const loaded = yield* Effect.promise(() =>
            PluginLoader.loadExternal({
              items: [
                {
                  spec: tmp.extra.spec,
                  scope: "local" as const,
                  source: tmp.path,
                },
              ],
              kind: "tui",
              finish: async () => {
                count += 1
              },
            }),
          )

          expect(count).toBe(1)
          expect(loaded).toEqual([])
        }),
    ),
  )
})
