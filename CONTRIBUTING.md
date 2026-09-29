# Contributing to CrewCode

CrewCode v0 is deliberately small. Before opening a change, know the scope: the terminal UI, the local server, three model providers and the auto mode.

## What fits

- Bug fixes, with a test that fails without the fix.
- Improvements to the auto mode, the deterministic policy and the audit tools. A new bypass of the policy is a bug: add it to `packages/crewcode/test/permission/review/policy.test.ts` first.
- Formatters and language servers (they are configured, never downloaded).
- Documentation.

## What does not fit in v0

New model providers, session sharing, hosted services, telemetry, and anything that makes the app download or install code at run time.

## Working on it

```sh
bun install --frozen-lockfile --ignore-scripts
bun turbo typecheck
cd packages/crewcode && bun test          # never from the repository root
```

Follow the style in `AGENTS.md` and `packages/crewcode/AGENTS.md`.

## Tests

Write the test for a behavior change before the change. Do not add a test whose only purpose is to prove that something removed is gone; check that by hand and say so in the pull request. Tests that need a provider use the fake one in `packages/crewcode/test/lib/test-provider.ts`, never a real service.

## Origin and license

CrewCode is derived from OpenCode (MIT). Keep `LICENSE` and `NOTICE` intact.
