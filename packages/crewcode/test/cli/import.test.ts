import { test, expect } from "bun:test"
import { formatImportFileError, isRemoteSource, remoteImportMessage } from "../../src/cli/cmd/import"
import { FSUtil } from "@crewcode/core/fs-util"
import { PlatformError } from "effect"

test("formats import file errors", () => {
  expect(
    formatImportFileError(
      "test.json",
      new PlatformError.PlatformError(
        new PlatformError.SystemError({
          _tag: "NotFound",
          module: "FileSystem",
          method: "readFileString",
        }),
      ),
    ),
  ).toBe("File not found: test.json")
  expect(
    formatImportFileError(
      "test.json",
      new PlatformError.PlatformError(
        new PlatformError.SystemError({
          _tag: "PermissionDenied",
          module: "FileSystem",
          method: "readFileString",
        }),
      ),
    ),
  ).toBe("Failed to read file: Permission denied")
  expect(
    formatImportFileError(
      "test.json",
      new FSUtil.FileSystemError({ method: "readJson", cause: new SyntaxError("Unexpected token") }),
    ),
  ).toBe("Invalid JSON in test.json: Unexpected token")
})

// parseShareUrl tests

test("treats anything with a URL scheme as a remote source", () => {
  expect(isRemoteSource("https://example.com/share/abc123")).toBe(true)
  expect(isRemoteSource("http://localhost:4096/session.json")).toBe(true)
  expect(isRemoteSource("ftp://example.com/session.json")).toBe(true)
})

test("treats file paths as local, including Windows drive paths", () => {
  expect(isRemoteSource("session.json")).toBe(false)
  expect(isRemoteSource("./exports/session.json")).toBe(false)
  expect(isRemoteSource("/tmp/session.json")).toBe(false)
  expect(isRemoteSource("C:\\exports\\session.json")).toBe(false)
})

test("explains that only local files can be imported", () => {
  expect(remoteImportMessage("https://example.com/share/abc123")).toContain("Only local files can be imported")
  expect(remoteImportMessage("https://example.com/share/abc123")).toContain("https://example.com/share/abc123")
})
