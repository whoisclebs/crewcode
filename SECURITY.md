# Security

## Reporting a vulnerability

Report security problems privately, using GitHub's private vulnerability reporting ("Report a vulnerability" in the Security tab of this repository), and do not open a public issue for them. Include what you found, how to reproduce it and which version you tested.

## Auto mode

The permission reviewer (`--auto`) reduces how often you are asked. It is not a security boundary. A deterministic policy runs before any model and sends high-impact actions to you, and the reviewer's approval must quote your own words, but a model can still be misled by hostile content on actions the policy does not list. Measure it in `observe` mode before relying on it. See `docs/auto-mode.md`.

## Threat Model

### Overview

CrewCode is an AI-powered coding assistant that runs locally on your machine. It provides an agent system with access to powerful tools including shell execution, file operations, and web access.

### No Sandbox

CrewCode does **not** sandbox the agent. The permission system exists as a UX feature to help users stay aware of what actions the agent is taking - it prompts for confirmation before executing commands, writing files, etc. However, it is not designed to provide security isolation.

If you need true isolation, run CrewCode inside a Docker container or VM.

### Server Mode

Server mode is opt-in only. When enabled, set `CREWCODE_SERVER_PASSWORD` to require HTTP Basic Auth. Without this, the server runs unauthenticated (with a warning). It is the end user's responsibility to secure the server - any functionality it provides is not a vulnerability.

### Out of Scope

| Category                        | Rationale                                                               |
| ------------------------------- | ----------------------------------------------------------------------- |
| **Server access when opted-in** | If you enable server mode, API access is expected behavior              |
| **Sandbox escapes**             | The permission system is not a sandbox (see above)                      |
| **LLM provider data handling**  | Data sent to your configured LLM provider is governed by their policies |
| **MCP server behavior**         | External MCP servers you configure are outside our trust boundary       |
| **Malicious config files**      | Users control their own config; modifying it is not an attack vector    |

---

# Reporting Security Issues

We appreciate your efforts to responsibly disclose your findings, and will make every effort to acknowledge your contributions.

To report a security issue, please use the GitHub Security Advisory ["Report a Vulnerability"](https://github.com/anomalyco/opencode/security/advisories/new) tab.

The team will send a response indicating the next steps in handling your report. After the initial reply to your report, the security team will keep you informed of the progress towards a fix and full announcement, and may ask for additional information or guidance.

## Escalation

If you do not receive an acknowledgement of your report within 6 business days, you may send an email to security@anoma.ly
