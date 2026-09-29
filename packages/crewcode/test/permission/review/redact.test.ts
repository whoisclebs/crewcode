import { describe, expect, test } from "bun:test"
import { redact, truncate } from "../../../src/permission/review/redact"

describe("redact", () => {
  test.each([
    ["key sk-proj-abcdefghijklmnopqrstuvwxyz0123456789", "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789"],
    ["token ghp_abcdefghijklmnopqrstuvwxyz0123456789", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
    ["pat github_pat_11ABCDEFG0abcdefghijklmnop_abcdefghijklmnopqrstuvwxyz", "github_pat_11ABCDEFG0abcdefghijklmnop_abcdefghijklmnopqrstuvwxyz"],
    ["slack xoxb-1234567890-abcdefghijkl", "xoxb-1234567890-abcdefghijkl"],
    ["aws AKIAIOSFODNN7EXAMPLE", "AKIAIOSFODNN7EXAMPLE"],
    ["google AIzaSyA-abcdefghijklmnopqrstuvwxyz012345", "AIzaSyA-abcdefghijklmnopqrstuvwxyz012345"],
    ["curl -H 'Authorization: Bearer abcdefghijklmnop.qrstuvwxyz012345'", "abcdefghijklmnop.qrstuvwxyz012345"],
    ["export API_KEY=supersecretvalue123", "supersecretvalue123"],
    ["password: hunter2hunter2", "hunter2hunter2"],
    ["git clone https://user:p4ssw0rd@example.com/repo.git", "p4ssw0rd"],
    ["-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\n-----END PRIVATE KEY-----", "MIIEvQIBADANBgkq"],
    ["DATABASE_URL=postgres://admin:s3cr3tpass@db.internal/app", "s3cr3tpass"],
  ])("removes the secret from %p", (input, secret) => {
    const output = redact(input)
    expect(output).not.toContain(secret)
    expect(output).toContain("[redacted]")
  })

  test("keeps ordinary text and commands readable", () => {
    expect(redact("git status && npm test -- --watch=false")).toBe("git status && npm test -- --watch=false")
    expect(redact("rm -rf ./dist")).toBe("rm -rf ./dist")
  })

  test("redacts every occurrence", () => {
    const output = redact("a sk-abcdefghijklmnopqrstuvwx b sk-zyxwvutsrqponmlkjihgfedcba")
    expect(output.match(/\[redacted\]/g)?.length).toBe(2)
  })

  test("is idempotent", () => {
    const once = redact("token=abcdef1234567890abcdef")
    expect(redact(once)).toBe(once)
  })
})

describe("truncate", () => {
  test("shortens long text and marks the cut", () => {
    expect(truncate("a".repeat(50), 10)).toBe("aaaaaaaaaa…")
  })

  test("leaves short text alone", () => {
    expect(truncate("short", 10)).toBe("short")
  })
})
