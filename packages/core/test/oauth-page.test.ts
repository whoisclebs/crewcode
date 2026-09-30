import { describe, expect, test } from "bun:test"
import { OauthCallbackPage, wordmark } from "../src/oauth/page"

describe("OauthCallbackPage", () => {
  test("escapes bootstrap options embedded in the inline script", () => {
    const html = OauthCallbackPage.bootstrap({
      provider: `xAI</script><script>alert("provider")</script>`,
      tokenPath: `/token</script><script>alert("path")</script>`,
    })

    expect(html.match(/<\/script>/g)).toHaveLength(1)
    expect(html).toContain(`xAI\\u003c/script>\\u003cscript>alert(\\\"provider\\\")\\u003c/script>`)
    expect(html).toContain(`/token\\u003c/script>\\u003cscript>alert(\\\"path\\\")\\u003c/script>`)
  })

  test("the success page thanks the reader, names the provider and sends them back to the terminal", () => {
    const html = OauthCallbackPage.success({ provider: "ChatGPT" })

    expect(html).toContain("You&#39;re connected")
    expect(html).toContain("CrewCode can now use ChatGPT.")
    expect(html).toContain("Back in your terminal")
    expect(html).toContain('data-status="success"')
  })

  test("the error page shows the reason, escaped, and how to try again", () => {
    const html = OauthCallbackPage.error(`<img src=x onerror=alert(1)>`, { provider: "ChatGPT" })

    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;")
    expect(html).not.toContain("<img src=x")
    expect(html).toContain("Press ctrl+k in CrewCode to try again.")
    expect(html).toContain('data-status="error"')
  })

  test("the auto-close script is left out when the host asks for no auto close", () => {
    expect(OauthCallbackPage.success({ autoClose: false })).not.toContain("window.close")
    expect(OauthCallbackPage.success()).toContain("window.close")
  })

  test("the wordmark spells CREWCODE in pixels and is not another product's logo", () => {
    const svg = wordmark("CREWCODE", 4)
    const quiet = svg.match(/var\(--cc-wordmark-dim\)/g)?.length ?? 0
    const accent = svg.match(/url\(#cc-accent\)/g)?.length ?? 0

    expect(svg).toContain('aria-label="CrewCode"')
    expect(quiet).toBeGreaterThan(0)
    expect(accent).toBeGreaterThan(0)
    expect(svg).toContain("<rect")
    expect(svg).not.toContain("<path")
  })

  test("no page mentions another product or keeps its old styling hooks", () => {
    const pages = [
      OauthCallbackPage.success({ provider: "ChatGPT" }),
      OauthCallbackPage.error("boom", { provider: "ChatGPT" }),
      OauthCallbackPage.bootstrap({ tokenPath: "/token", provider: "xAI" }),
    ]

    pages.forEach((html) => {
      expect(html.toLowerCase()).not.toContain("opencode")
      expect(html).not.toContain("oc-")
      expect(html).toContain("CrewCode")
    })
  })
})
