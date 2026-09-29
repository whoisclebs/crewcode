// No syntax parsers are installed, so the TUI shows code without syntax highlighting.
//
// Nothing is bundled and nothing is downloaded at runtime. To get highlighting, run `bun run setup:parsers` once:
// it downloads the grammars listed in script/parser-sources.ts, checks them against src/assets/parsers/manifest.json
// and rewrites this file so the next build embeds them. The downloaded files are ignored by git.
import type { addDefaultParsers } from "@opentui/core"

const parsers: Parameters<typeof addDefaultParsers>[0] = []

export default { parsers }
