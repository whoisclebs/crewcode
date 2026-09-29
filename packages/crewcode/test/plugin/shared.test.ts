import { describe, expect, test } from "bun:test"
import { parsePluginSpecifier } from "../../src/plugin/shared"

describe("parsePluginSpecifier", () => {
  test("parses standard npm package without version", () => {
    expect(parsePluginSpecifier("acme")).toEqual({
      pkg: "acme",
      version: "latest",
    })
  })

  test("parses standard npm package with version", () => {
    expect(parsePluginSpecifier("acme@1.0.0")).toEqual({
      pkg: "acme",
      version: "1.0.0",
    })
  })

  test("parses scoped npm package without version", () => {
    expect(parsePluginSpecifier("@crewcode/acme")).toEqual({
      pkg: "@crewcode/acme",
      version: "latest",
    })
  })

  test("parses scoped npm package with version", () => {
    expect(parsePluginSpecifier("@crewcode/acme@1.0.0")).toEqual({
      pkg: "@crewcode/acme",
      version: "1.0.0",
    })
  })

  test("parses package with git+https url", () => {
    expect(parsePluginSpecifier("acme@git+https://github.com/crewcode/acme.git")).toEqual({
      pkg: "acme",
      version: "git+https://github.com/crewcode/acme.git",
    })
  })

  test("parses scoped package with git+https url", () => {
    expect(parsePluginSpecifier("@crewcode/acme@git+https://github.com/crewcode/acme.git")).toEqual({
      pkg: "@crewcode/acme",
      version: "git+https://github.com/crewcode/acme.git",
    })
  })

  test("parses package with git+ssh url containing another @", () => {
    expect(parsePluginSpecifier("acme@git+ssh://git@github.com/crewcode/acme.git")).toEqual({
      pkg: "acme",
      version: "git+ssh://git@github.com/crewcode/acme.git",
    })
  })

  test("parses scoped package with git+ssh url containing another @", () => {
    expect(parsePluginSpecifier("@crewcode/acme@git+ssh://git@github.com/crewcode/acme.git")).toEqual({
      pkg: "@crewcode/acme",
      version: "git+ssh://git@github.com/crewcode/acme.git",
    })
  })

  test("parses unaliased git+ssh url", () => {
    expect(parsePluginSpecifier("git+ssh://git@github.com/crewcode/acme.git")).toEqual({
      pkg: "git+ssh://git@github.com/crewcode/acme.git",
      version: "",
    })
  })

  test("parses npm alias using the alias name", () => {
    expect(parsePluginSpecifier("acme@npm:@crewcode/acme@1.0.0")).toEqual({
      pkg: "acme",
      version: "npm:@crewcode/acme@1.0.0",
    })
  })

  test("parses bare npm protocol specifier using the target package", () => {
    expect(parsePluginSpecifier("npm:@crewcode/acme@1.0.0")).toEqual({
      pkg: "@crewcode/acme",
      version: "1.0.0",
    })
  })

  test("parses unversioned npm protocol specifier", () => {
    expect(parsePluginSpecifier("npm:@crewcode/acme")).toEqual({
      pkg: "@crewcode/acme",
      version: "latest",
    })
  })
})
