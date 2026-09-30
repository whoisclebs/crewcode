# Auto mode

When a permission rule marks an action as `ask`, CrewCode normally asks you. Auto mode puts a contextual review between the rule and the question: it approves what is clearly safe and covered by what you asked for, and keeps asking about the rest. It never replaces your rules; it only acts on what was already going to be asked.

## Modes

| Mode | How to turn it on | What happens to an action that would need an answer |
|---|---|---|
| `manual` (default) | nothing | You are asked. |
| `auto` | `crewcode --auto` or `approval.mode: "auto"` | Deterministic rules first, then a reviewer model. It approves, denies or asks you. |
| `observe` | `crewcode --approval observe` or `approval.mode: "observe"` | The reviewer decides, but the decision is **not applied**: you are still asked, and your answer is recorded next to the reviewer's opinion. Use it to measure before turning `auto` on. |
| `unguarded` | only `crewcode --unguarded` | Approves everything without review. Prints a warning on stderr and shows a permanent indicator in the TUI. `deny` rules still apply. It never comes from a configuration file. |

In the terminal interface, `alt+m` cycles through `manual`, `auto` and `observe` while it runs (typing `/approval` and pressing enter does the same, and so does "Change approval mode" in the command palette, `ctrl+p`). The current mode is shown in the status row under the prompt whenever it is not `manual`. `tab` still switches agent. The choice applies to the whole running instance and is not written to the configuration. `unguarded` is not part of the cycle: it cannot be entered or left from inside the interface.

`--yolo` and `--dangerously-skip-permissions` were removed and fail with a message that points to `--auto` and `--unguarded`. OpenCode's `--auto` approved everything silently; here it means the review.

## Order of decision

1. An `allow` rule runs the action.
2. A `deny` rule blocks the action. **Nothing below can override a `deny`**: not the reviewer, not a cache, not an authorization from you in the chat, not the `unguarded` mode.
3. An `ask` rule (the default for anything without a rule) goes to auto mode, when it is on:
   1. **Deterministic policy.** High-impact actions go straight to you, without asking the model. Plain read-only commands inside the project are approved without a model.
   2. **Reviewer.** Everything else goes to the reviewer model, which answers `allow_once`, `ask_user` or `deny` with a short reason.
4. The reviewer only produces an approval **for one call** (`allow_once`). It never creates an "always allow" rule.

## What the deterministic policy never approves by itself

It goes to you (or is refused, if nobody can answer) when it:

- deletes a lot: `rm -r`, `rm` with a glob or outside the project, `find -delete`, `git clean -f`, `dd of=`, `mkfs`, `chmod -R`, `rsync --delete`;
- touches secrets: `.env*`, SSH/AWS/GPG keys, `.npmrc`, `.netrc`, tokens, `printenv`, `env` with no command, `gh auth token`;
- uses elevated privileges: `sudo`, `su`, `doas`, `docker --privileged`, `chmod u+s`, `mount`;
- runs `git push` or rewrites or discards history: `--force`, `reset --hard`, `rebase`, `commit --amend`, `branch -D`, `checkout --` / `restore`, `stash drop`;
- publishes: `npm/pnpm/yarn/bun publish`, `cargo publish`, `twine upload`, `docker push`, `gh release`, `gh pr create`;
- deploys or changes infrastructure: `terraform apply/destroy`, a `kubectl` that changes things, `helm install/upgrade`, `wrangler deploy`, `aws`/`gcloud`/`az` with verbs that change things;
- downloads and runs code: `curl ... | sh`, `bash <(curl ...)`, `eval "$(curl ...)"`, `npx`, `bunx`, `pnpm dlx`, `uvx`;
- talks to another machine: `ssh`, `scp`, `rsync host:`, `nc`, `/dev/tcp`;
- writes where it changes the shell, automation or the agent itself: `~/.bashrc`, `.git/hooks`, `.github/workflows`, `crewcode.json`, `/etc`;
- **cannot be resolved statically**: a command built from a variable or substitution (`$CMD`, `$(...)`), an obfuscated name (`$'\x72m'`, `/???/rm`), a script fed to a shell through a pipe, `parallel`, `tmux`, unbalanced quotes or parentheses.

Wrappers do not hide the command: `sudo`, `env`, `nohup`, `timeout`, `xargs`, `sh -c`, `eval`, `find -exec`, subshells, heredocs and `$(...)` are taken apart and each piece is evaluated.

The list is conservative on purpose. It errs on the side of asking you.

## The reviewer

- It runs **without tools** and without an agent session: it is a plain model call, through the same credential path as the providers. It has no way to run the action it judges.
- It receives two separate channels. What **you typed** goes in `<trusted_user_requests>` and is the only source of authorization. The action, its arguments, the directory and the recent context go in `<untrusted_action>` and `<untrusted_context>` and are treated as data that may be hostile. Text that imitates the tags is neutralized, and secrets are removed before anything is sent.
- It answers a strict, versioned JSON object. Anything else (extra text, an extra field, an unknown value, two objects) is treated as a failure.
- **Verifiable reason:** to approve, it must quote your words. The quote is checked against your messages; if it is not there, the approval becomes a question. The model cannot approve just because it thinks the action is low risk.
- Choose the model with `approval.reviewer.model` (`openai/gpt-5.4-mini`, `openrouter/...`, `openai-codex/...`). Without it, the small model of your default provider is used.

## A failure never becomes an approval

An error, a timeout (15 s by default), a malformed answer, an unknown version, a missing model, a missing message of yours to compare with, or a paused reviewer all become **a question to you**. When nobody can answer (`crewcode run` without a terminal), the action is **refused with the reason**, and the agent receives that reason so it can try something more restricted. After 3 failures in a row in a session the reviewer pauses, and resumes when you answer a question.

## Configuration

```jsonc
// crewcode.json
{
  "approval": {
    "mode": "observe",                       // manual | auto | observe
    "reviewer": {
      "model": "openai/gpt-5.4-mini",        // provider/model
      "timeout": 15000                       // ms
    }
  }
}
```

The command line flag wins over the configuration.

## Audit and measurement

Every decision and every answer of yours goes to `<data>/audit/permission-YYYY-MM.jsonl`, one line per record, with `600` permissions. A record carries the mode, the decision, the short reason, the duration, the origin (`rule`, `reviewer`, `failure`, `unguarded`, `human`), the reviewer model and an opaque reference to the action (a hash) plus a preview of up to 120 characters. It **never** stores a token, a secret, the full command, the session id or any part of the conversation.

```sh
crewcode audit stats            # all months
crewcode audit stats --month 2026-09 --json
```

A **false approval** is an action the reviewer would have approved and that you rejected. It can only be measured in `observe` mode, where the reviewer gives an opinion and you still answer. The recommendation is to run in `observe` for a while, look at the rate, and only then move to `auto`. In `auto`, the reviewer's approvals have no human check and show up as "approved without a human check".

## Limits you should know

- The reviewer is a model: a determined agent may try to mislead it on actions the policy does not list. That is why the policy comes first, the quote is verified and an approval is valid once.
- A message of yours that contains text pasted from a third party is still "yours" to the reviewer.
- The policy does not know every program in the world. Unknown commands go to the reviewer, not to automatic approval.
