// Pages shown in the browser when a sign-in finishes.
//
// The loopback servers that complete an OAuth exchange (MCP, Codex/ChatGPT, xAI, Snowflake, DigitalOcean, ...)
// answer the browser with one of these. Each function returns a fully self-contained HTML string with no
// external assets, so it works offline and drops into any transport (`res.end(...)`, Effect `response.end`, ...).
//
// The look follows the terminal interface: the CREWCODE wordmark in the same pixel letters, the cyan to violet
// accent, and a line that sends the reader back to the terminal, where CrewCode carries on by itself.

export interface CallbackPageOptions {
  /** Friendly integration name shown in the message, e.g. "xAI", "Snowflake", "MCP". */
  provider?: string
  /** Attempt to close the window shortly after success. Defaults to true. */
  autoClose?: boolean
}

export function success(options?: CallbackPageOptions) {
  const provider = options?.provider
  return renderDocument({
    title: "Connected",
    body: renderCard({
      status: "success",
      headline: "You're connected",
      message: provider ? `CrewCode can now use ${escapeHtml(provider)}.` : "CrewCode is now authorized.",
      next: "Back in your terminal, CrewCode carries on.",
      footnote: "You can close this tab.",
    }),
    script: options?.autoClose === false ? undefined : AUTO_CLOSE_SCRIPT,
  })
}

export function error(detail: string, options?: CallbackPageOptions) {
  const provider = options?.provider
  return renderDocument({
    title: "Couldn't connect",
    body: renderCard({
      status: "error",
      headline: "Couldn't connect",
      message: provider
        ? `CrewCode couldn't finish signing in to ${escapeHtml(provider)}.`
        : "CrewCode couldn't complete the sign-in.",
      detail,
      next: "Press ctrl+k in CrewCode to try again.",
      footnote: "You can close this tab.",
    }),
  })
}

export interface BootstrapOptions {
  /** Same-origin path the in-browser script POSTs the parsed callback to. */
  tokenPath: string
  provider?: string
}

// For flows where the credential arrives in the URL fragment (implicit grant), the browser must relay it back to the
// loopback server. This renders a pending page whose script reads the fragment, POSTs it to `tokenPath`, then
// resolves to the success or error state in place.
export function bootstrap(options: BootstrapOptions) {
  return renderDocument({
    title: "Finishing sign-in",
    body: renderCard({
      status: "pending",
      headline: "Finishing sign-in",
      message: options.provider
        ? `Completing your ${escapeHtml(options.provider)} sign-in.`
        : "Completing the sign-in.",
      next: "This takes a moment.",
      footnote: "Keep this tab open until it finishes.",
    }),
    script: bootstrapScript(options),
  })
}

export * as OauthCallbackPage from "./page"

type Status = "pending" | "success" | "error"

function renderCard(input: {
  status: Status
  headline: string
  message: string
  detail?: string
  next: string
  footnote: string
}) {
  const detail = input.detail?.trim()
  return `<main class="card" id="cc-card" data-status="${input.status}" role="status" aria-live="polite">
      <div class="brand">${WORDMARK}</div>
      <div class="status" aria-hidden="true">
        <span class="icon icon-pending">${ICON_SPINNER}</span>
        <span class="icon icon-success">${ICON_CHECK}</span>
        <span class="icon icon-error">${ICON_CROSS}</span>
      </div>
      <h1 class="headline" id="cc-headline">${escapeHtml(input.headline)}</h1>
      <p class="message" id="cc-message">${input.message}</p>
      <pre class="detail" id="cc-detail"${detail ? "" : " hidden"}>${detail ? escapeHtml(detail) : ""}</pre>
      <p class="next" id="cc-next"><span class="prompt" aria-hidden="true">❯</span> <span id="cc-next-text">${escapeHtml(input.next)}</span></p>
      <p class="footnote" id="cc-footnote">${escapeHtml(input.footnote)}</p>
    </main>`
}

function renderDocument(input: { title: string; body: string; script?: string }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${escapeHtml(input.title)} · CrewCode</title>
    <style>${STYLES}</style>
  </head>
  <body>
    ${input.body}${input.script ? `\n    <script>${input.script}</script>` : ""}
  </body>
</html>`
}

const AUTO_CLOSE_SCRIPT = `setTimeout(function(){try{window.close()}catch(e){}},4000)`

function bootstrapScript(options: BootstrapOptions) {
  return `var PROVIDER=${scriptString(options.provider ?? "")};
var TOKEN_URL=new URL(${scriptString(options.tokenPath)},window.location.origin).href;
(function(){
  var card=document.getElementById("cc-card"),headline=document.getElementById("cc-headline"),message=document.getElementById("cc-message"),detail=document.getElementById("cc-detail"),next=document.getElementById("cc-next-text"),footnote=document.getElementById("cc-footnote");
  function fail(text){card.dataset.status="error";headline.textContent="Couldn't connect";message.textContent=PROVIDER?("CrewCode couldn't finish signing in to "+PROVIDER+"."):"CrewCode couldn't complete the sign-in.";if(text){detail.textContent=text;detail.hidden=false}next.textContent="Press ctrl+k in CrewCode to try again.";footnote.textContent="You can close this tab."}
  function ok(){card.dataset.status="success";headline.textContent="You're connected";message.textContent=PROVIDER?("CrewCode can now use "+PROVIDER+"."):"CrewCode is now authorized.";detail.hidden=true;next.textContent="Back in your terminal, CrewCode carries on.";footnote.textContent="You can close this tab.";setTimeout(function(){try{window.close()}catch(e){}},4000)}
  try{
    var hash=new URLSearchParams((window.location.hash||"").slice(1));
    var search=new URLSearchParams(window.location.search||"");
    var err=hash.get("error")||search.get("error");
    var errDescription=hash.get("error_description")||search.get("error_description");
    var body=err?{error:err,error_description:errDescription||""}:{access_token:hash.get("access_token")||"",expires_in:hash.get("expires_in")||"0",state:hash.get("state")||""};
    fetch(TOKEN_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(function(res){
      if(!res.ok)return res.text().catch(function(){return""}).then(function(t){throw new Error(t||("callback failed ("+res.status+")"))});
      if(err){fail(errDescription||err);return}
      ok();
    }).catch(function(e){fail(String(e&&e.message?e.message:e))});
  }catch(e){fail(String(e&&e.message?e.message:e))}
})()`
}

function scriptString(value: string) {
  return JSON.stringify(value).replaceAll("<", "\\u003c")
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

// Light by default; dark follows the system, and [data-theme] lets a host force one.
const LIGHT_VARS = `
    --cc-bg: #f6f7fb;
    --cc-card: #ffffff;
    --cc-text-strong: #14151c;
    --cc-text-base: #4b5060;
    --cc-text-weak: #7a8090;
    --cc-border: #e3e5ee;
    --cc-wordmark-dim: #9aa0b4;
    --cc-accent-from: #0891b2;
    --cc-accent-to: #7c3aed;
    --cc-success: #15803d;
    --cc-error: #dc2626;
    --cc-detail-bg: #fef2f2;
    --cc-detail-border: #fecaca;
    --cc-terminal-bg: #14151c;
    --cc-terminal-text: #d6d9e6;
    --cc-shadow: 0 18px 50px -10px rgba(20,21,28,.14), 0 4px 10px -2px rgba(20,21,28,.06);`

const DARK_VARS = `
    --cc-bg: #0d0e14;
    --cc-card: #151722;
    --cc-text-strong: #eef0f8;
    --cc-text-base: #aab0c4;
    --cc-text-weak: #7d849a;
    --cc-border: #262a3b;
    --cc-wordmark-dim: #5b6279;
    --cc-accent-from: #22d3ee;
    --cc-accent-to: #a78bfa;
    --cc-success: #4ade80;
    --cc-error: #f87171;
    --cc-detail-bg: #2a1215;
    --cc-detail-border: #6b1d24;
    --cc-terminal-bg: #0a0b10;
    --cc-terminal-text: #c9cde0;
    --cc-shadow: 0 18px 50px -10px rgba(0,0,0,.6), 0 4px 10px -2px rgba(0,0,0,.4);`

const STYLES = `
  :root { color-scheme: light dark;${LIGHT_VARS}
    --cc-font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --cc-font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {${DARK_VARS} } }
  :root[data-theme="dark"] {${DARK_VARS} }
  :root[data-theme="light"] {${LIGHT_VARS} }

  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--cc-bg);
    color: var(--cc-text-base);
    font-family: var(--cc-font-sans);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  .card {
    position: relative;
    width: min(100%, 30rem);
    padding: 2.5rem 2rem 1.75rem;
    background: var(--cc-card);
    border: 1px solid var(--cc-border);
    border-radius: 16px;
    box-shadow: var(--cc-shadow);
    text-align: center;
    overflow: hidden;
  }
  .card::before {
    content: "";
    position: absolute;
    inset: 0 0 auto 0;
    height: 3px;
    background: linear-gradient(90deg, var(--cc-accent-from), var(--cc-accent-to));
  }
  .brand { display: flex; justify-content: center; margin-bottom: 1.75rem; }
  .brand svg { height: 34px; width: auto; }
  .status { display: flex; justify-content: center; margin-bottom: 1rem; }
  .icon { display: none; line-height: 0; }
  .icon svg { display: block; }
  .card[data-status="pending"] .icon-pending,
  .card[data-status="success"] .icon-success,
  .card[data-status="error"] .icon-error { display: block; }
  .icon-success { color: var(--cc-success); }
  .icon-error { color: var(--cc-error); }
  .icon-pending { color: var(--cc-text-weak); }
  .headline { margin: 0; font-size: 1.3rem; font-weight: 600; line-height: 1.3; letter-spacing: -0.015em; color: var(--cc-text-strong); }
  .message { margin: 0.5rem 0 0; font-size: 0.975rem; color: var(--cc-text-base); }
  .detail {
    margin: 1.25rem 0 0;
    padding: 0.75rem 0.875rem;
    text-align: left;
    font-family: var(--cc-font-mono);
    font-size: 0.8125rem;
    line-height: 1.55;
    color: var(--cc-text-strong);
    background: var(--cc-detail-bg);
    border: 1px solid var(--cc-detail-border);
    border-radius: 8px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 9.5rem;
    overflow: auto;
  }
  .detail[hidden] { display: none; }
  .next {
    margin: 1.5rem 0 0;
    padding: 0.7rem 0.9rem;
    display: flex;
    gap: 0.6rem;
    text-align: left;
    font-family: var(--cc-font-mono);
    font-size: 0.8125rem;
    color: var(--cc-terminal-text);
    background: var(--cc-terminal-bg);
    border-radius: 10px;
  }
  .prompt { color: var(--cc-accent-from); font-weight: 700; }
  .card[data-status="error"] .prompt { color: var(--cc-error); }
  .footnote { margin: 1.25rem 0 0; font-size: 0.8125rem; color: var(--cc-text-weak); }
  .spinner { animation: cc-spin 0.8s linear infinite; transform-origin: center; }
  @keyframes cc-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
`

// The CREWCODE wordmark in the pixel letters of the terminal interface: "crew" quiet, "code" in the accent.
const PIXEL_LETTERS: Record<string, readonly string[]> = {
  C: [".###", "#...", "#...", "#...", ".###"],
  R: ["####", "#..#", "####", "#.#.", "#..#"],
  E: ["####", "#...", "###.", "#...", "####"],
  W: ["#...#", "#...#", "#.#.#", "##.##", "#...#"],
  O: [".##.", "#..#", "#..#", "#..#", ".##."],
  D: ["###.", "#..#", "#..#", "#..#", "###."],
}

export function wordmark(text: string, quiet: number) {
  const gap = 1
  let x = 0
  let quietWidth = 0
  const pixels: string[] = []
  ;[...text].forEach((letter, index) => {
    const rows = PIXEL_LETTERS[letter]
    if (!rows) return
    if (index === quiet) quietWidth = x
    const fill = index < quiet ? "var(--cc-wordmark-dim)" : "url(#cc-accent)"
    rows.forEach((row, y) =>
      [...row].forEach((cell, column) => {
        if (cell === "#") pixels.push(`<rect x="${x + column}" y="${y}" width="1" height="1" rx="0.12" fill="${fill}" />`)
      }),
    )
    x += rows[0].length + gap
  })
  const width = x - gap
  return `<svg class="wordmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 5" aria-label="CrewCode" role="img">
        <defs><linearGradient id="cc-accent" gradientUnits="userSpaceOnUse" x1="${quietWidth}" y1="0" x2="${width}" y2="0"><stop offset="0" stop-color="var(--cc-accent-from)" /><stop offset="1" stop-color="var(--cc-accent-to)" /></linearGradient></defs>
        ${pixels.join("\n        ")}
      </svg>`
}

const WORDMARK = wordmark("CREWCODE", 4)

const ICON_CHECK = `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.4 2.4 4.6-5.4" /></svg>`

const ICON_CROSS = `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6m0-6-6 6" /></svg>`

const ICON_SPINNER = `<svg class="spinner" viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9" opacity="0.2" /><path d="M21 12a9 9 0 0 0-9-9" /></svg>`
