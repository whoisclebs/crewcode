# Distribution

CrewCode ships as ONE native binary, `crewcode`. It is the Rust terminal interface (`packages/tui-rs`) with the TypeScript server embedded inside it. Users need no Bun, no Node and no separate server install.

## How the single binary works

- The server (`packages/crewcode`) is compiled by `bun build --compile` into a standalone executable, the "core".
- `packages/tui-rs` is built with the Cargo feature `embed-core` and `CREWCODE_CORE_BIN=<absolute path of the core>`. `build.rs` gzips the core into the binary.
- On first run the binary unpacks the core into a per-user cache directory, `core-<crc>-<size>/crewcode-core[.exe]`, and removes the cores of older releases. Later runs reuse it, so only the first start pays the extraction (about 144 MB on disk).
  - Linux: `$XDG_CACHE_HOME/crewcode` or `~/.cache/crewcode`
  - macOS: `~/Library/Caches/crewcode`
  - Windows: `%LOCALAPPDATA%\crewcode\cache`
- `crewcode` with no arguments (or a directory) starts the TUI. Any other arguments (`run`, `serve`, `--help`, ...) are passed through to the core.
- Upgrading means replacing the one file. The new binary carries a new core, gets a new cache key and cleans up the old one.

## What the existing build did

`packages/crewcode/script/build.ts` compiles the server for a list of Bun targets (linux/darwin/windows, x64/arm64, plus baseline (no AVX2) and musl variants) into `dist/crewcode-<os>-<arch>[-baseline][-musl]/bin/crewcode`, injecting `CREWCODE_VERSION`/`CREWCODE_CHANNEL` (from `packages/script`, which requires `CREWCODE_VERSION` for a `latest` build), and smoke tests the host binary. `--single --skip-install` builds only the host target in a few seconds. `packages/crewcode/bin/crewcode` and `script/postinstall.mjs` are the older npm launcher for that server-only layout (a `crewcode-<os>-<arch>` optional dependency found under `node_modules`). The repo has no install script, no upgrade command and no publish workflow, so nothing here replaces existing release logic. The release scripts reuse `build.ts --single` and the same platform names.

## Artifacts of a release

For each of `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64` and `windows-x64`:

| File | Content |
|---|---|
| `crewcode-<target>.tar.gz` (`.zip` on Windows) | the `crewcode` / `crewcode.exe` binary at the archive root |
| `crewcode-<target>.<ext>.sha256` | `<sha256>  <file name>` |

Plus `SHA256SUMS`, `install` and `install.ps1` attached to the GitHub release. On npm: `crewcode` (a 3 kB launcher, `bin/crewcode.js`) with `optionalDependencies` on `crewcode-<target>` (unscoped: the `@crewcode` scope on npm belongs to someone else) (each holds only the binary, with `os`/`cpu`/`libc` fields so npm installs just the matching one).

Not published yet: musl (Alpine) and baseline (no AVX2) builds, Windows arm64 (the installer uses the x64 build under emulation).

## Install commands

```sh
curl -fsSL https://github.com/whoisclebs/crewcode/releases/latest/download/install | sh
curl -fsSL .../install | sh -s -- --version 0.1.0 --modify-path   # pin a version, edit the shell profile
npm i -g crewcode        # or: npx crewcode
```

```powershell
irm https://github.com/whoisclebs/crewcode/releases/latest/download/install.ps1 | iex
```

The installer honours `CREWCODE_REPO`, `CREWCODE_VERSION`, `CREWCODE_INSTALL_DIR` (default `~/.crewcode/bin`) and `CREWCODE_BASE_URL`. It verifies the sha256, replaces an existing install atomically (write next to it, then rename) and only edits a shell profile with `--modify-path`. `CREWCODE_REPO` defaults to a placeholder, `whoisclebs/crewcode`; change it in `install`, `install.ps1` and the hint in `packages/npm/crewcode/bin/crewcode.js` once the final repository is known.

## Cutting a release

1. Pick the version and make sure `version` in `packages/tui-rs/Cargo.toml` matches it (`crewcode --version` prints the crate version).
2. Tag and push: `git tag v0.1.0 && git push origin v0.1.0`. The `Release` workflow builds the five targets natively, smoke tests each binary, and uploads the artifacts.
3. Approve the `release` environment (creates the GitHub release with archives, checksums and installers) and the `npm` environment (publishes the packages).
4. Dry run without a tag: run the workflow manually with `dry-run` checked; only the build jobs run.

The workflow needs the secret `NPM_TOKEN`. The interface library, crewtui, comes from a tagged release (`packages/tui-rs/Cargo.toml` pins `tag = "v0.2.0"` of `whoisclebs/crewtui`), so nothing else is checked out.

### Manual npm publish

`script/release/npm-pack.mjs` never publishes. To publish by hand after `dist-release/` holds every target (download the workflow artifacts into it):

```sh
node script/release/npm-pack.mjs --version 0.1.0
cd dist-release/npm
# platform packages first, then the main package
# npm publish crewcode-linux-x64-0.1.0.tgz --access public   (repeat per platform)
# npm publish crewcode-0.1.0.tgz --access public
```

Use `--tag next` for prereleases. The `@crewcode` npm scope and the `crewcode` package name must be available to the publishing account.

## Testing locally

Host build (Linux x64 here; needs `bun install` once and Rust):

```sh
node script/release/build.mjs --version 0.1.0     # -> dist-release/
```

Installer against a local server:

```sh
(cd dist-release && python3 -m http.server 8791 --bind 127.0.0.1) &
CREWCODE_BASE_URL=http://127.0.0.1:8791 CREWCODE_INSTALL_DIR=/tmp/crewcode-test/bin sh install
/tmp/crewcode-test/bin/crewcode --version
```

npm packages (`npm pack` output stays in `dist-release/npm/`; a dry run is `--dry-run`):

```sh
node script/release/npm-pack.mjs
mkdir /tmp/npmtest && cd /tmp/npmtest && npm init -y && npm i /path/to/dist-release/npm/*.tgz && npx crewcode --version
```

`build.mjs --core <path> --rust-bin <path>` skips compiling and only tests the packaging. Cross compiling is not supported by the scripts (the core is built natively); from this Linux x64 host only `linux-x64` can be built (linux-arm64, darwin and windows need their own runners, hence the CI matrix).

## Size (measured, linux-x64, 0.1.0)

| Item | Size |
|---|---|
| compiled core | 144 MB |
| `crewcode` binary (core embedded, gzip) | 51.4 MiB |
| `.tar.gz` release archive | 48.5 MiB |
| npm platform tarball | 50.9 MB |
| main npm package | 1.7 kB |
| unpacked core in the cache | 144 MB |

Startup after the first run is instant (`crewcode --version` takes about 1 ms; the core is only launched for other commands).

## Open issues and risks

- **macOS signing and notarization.** The binaries are unsigned. Gatekeeper blocks a quarantined download; `curl` downloads are not quarantined, browser downloads are. Needs an Apple Developer ID, `codesign` with the JIT/unsigned-memory entitlements Bun requires, and `notarytool`, added to the darwin jobs. The extracted core is a second executable in the cache and should be signed as well, as it is what Bun produced.
- **Windows SmartScreen and antivirus.** Unsigned executables get reputation warnings, and a self-extracting executable that drops a large binary into `%LOCALAPPDATA%` is a typical antivirus heuristic. Authenticode signing (or Azure Trusted Signing) is the fix.
- **Cache extraction.** It needs a writable cache directory (a read-only `$HOME`, containers and CI sandboxes may lack one) and 144 MB of free space. A `noexec` cache mount would prevent starting the core; the fallback is to point `XDG_CACHE_HOME` elsewhere.
- **arm64 runners.** `ubuntu-24.04-arm` is available for public repositories; private repositories need a paid larger runner. `macos-15-intel` is the Intel macOS label and is scheduled to be retired eventually, after which `darwin-x64` needs cross compilation from arm64.
- **crewtui is a tagged git dependency.** `packages/tui-rs` pins `tag = "v0.2.0"`; to use a newer crewtui, release it (a `vX.Y.Z` tag on its `main` also publishes to crates.io) and bump the tag here. The crate could switch to the crates.io version at any time.
- **musl and baseline CPUs.** No Alpine binary, and the core is built with the default (AVX2) x64 target; CPUs without AVX2 are not covered.
- **Windows scripts untested.** `install.ps1` and the Windows CI job could not be run on this host.
- **Size.** About 50 MB per download; the Rust side could later download the core on demand instead, at the cost of the offline single-file property.
