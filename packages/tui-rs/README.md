# CrewCode TUI (CrewTUI)

The CrewCode terminal interface written in Rust on [CrewTUI](https://github.com/whoisclebs/crewtui). It talks to the CrewCode server over HTTP and server-sent events, so the server and every other package stay as they are.

## Install

One binary, nothing else to install: the server is inside it. See `docs/distribution.md` for the install script, npm (`npm i -g crewcode`, a thin wrapper around the same binary) and how releases are cut.

## Run

```sh
bin/crewcode
```

From the repository root. It builds the interface, starts a local server on a free port and stops it when you quit. To use a server that is already running, set `CREWCODE_URL` (and `CREWCODE_SERVER_USERNAME` and `CREWCODE_SERVER_PASSWORD` when it has a password).

## Keys

| Key | Action |
|---|---|
| `enter` | send the message; while an answer is running it is queued and runs next |
| `alt+enter`, `shift+enter`, `ctrl+j`, or `\` then `enter` | new line in the message |
| `up`, `down` | earlier prompts, when the cursor is on the first or last row |
| `/` | skills and commands, completed as you type; use several in one message (`/review /no-ai-slop fix this`) |
| `@` | attach a project file, completed as you type (`explain @src/app.rs`) |
| `ctrl+k` | connect a provider: API key, or sign in with the browser. Opens by itself when nothing is connected |
| `ctrl+p` | command palette: every action and the server's slash commands |
| `tab` | switch agent |
| `ctrl+s` | switch model |
| `ctrl+o` | sessions |
| `ctrl+n` | new session |
| `ctrl+t` | theme |
| `ctrl+b` | toggle the sidebar |
| `esc esc` | stop the answer (the first press asks for confirmation); `esc` also closes a dialog |
| `pgup`, `pgdn`, mouse wheel | scroll |
| `ctrl+c` | clear the message, or quit when it is empty (twice while an answer is running) |

The palette also renames, forks, compacts and deletes the current session, copies the last answer and changes the approval mode.

## The palette

Everything the interface can do is in `ctrl+p`: sessions (new, switch, rename, fork, compact, delete, subagent sessions and the way back to the parent), model and thinking level, agent, approval mode, theme and theme mode, skills, MCP servers (connect or disconnect), the stash (set a half-written message aside and bring it back), copying the last answer, and the server's own slash commands.

## Themes

`ctrl+t` lists the built-in themes and the ones you add, and previews each as you move (`esc` puts the old one back). Themes use the JSON format `{ "defs": {...}, "theme": {...} }`, with a color per role as `#rrggbb`, the name of a def, or `{ "dark": ..., "light": ... }`. Put your own files in `themes/*.json` under `~/.config/crewcode/`, or under `.crewcode/` in a project; the file name is the theme name. "Theme mode" in the palette switches between the dark and light variants; a light theme paints its own background, a dark one leaves the terminal's.

## Settings

Theme, theme mode, model, agent, recent models, the stash and prompt history are kept in `$XDG_CONFIG_HOME/crewcode/interface-state.json` (`~/.config/crewcode/interface-state.json`).

## Layout

- `client.rs`: the blocking HTTP client and event stream.
- `app.rs`: state, keys and server events.
- `view.rs`: drawing.
- `transcript.rs`: turns messages, parts and deltas into history entries.
- `picker.rs`, `dialogs.rs`, `prompt.rs`: the filterable list, the permission, question and text dialogs, and the message field.
- `connect.rs`, `browser.rs`: connecting a provider (API key, browser sign-in, questions some providers ask first).
- `theme.rs`, `themes.rs`, `store.rs`: colors, JSON themes, saved settings.
- `core.rs`, `server.rs`: the embedded server, unpacked once into the cache and started with a random password that only this process knows; it stops when the interface does.

## Test

```sh
cargo test
cargo clippy --all-targets -- -D warnings
```
