# agent-marketplace

A plugin marketplace for **GitHub Copilot CLI** and **Claude Code**, collecting my agents
and skills in one installable place. One canonical content set, thin per-platform
manifests — the same approach as [superpowers](https://github.com/obra/superpowers).

## Plugins

| Plugin | Contents | License |
|---|---|---|
| `pr-review-toolkit` | 6 PR review agents (code quality, test coverage, silent failures, comment accuracy, type design, simplification) + `/pr-review-toolkit` command that orchestrates them all. Ported from Anthropic's Claude Code [pr-review-toolkit](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/pr-review-toolkit). **Copilot CLI only** — Claude Code users should use the upstream original. | Apache-2.0 |
| `discover` | Start a feature right: `create-feature`, `create-investigation`, `reject-investigation` skills | BSD-3-Clause |
| `decide` | `adr-analyzer` agent + `create-adr`, `accept-adr` skills | BSD-3-Clause |
| `build` | Levelled coding agents (`fast-coding-agent` → `coding-agent` → `complex-coding-agent`) with delegation + `implement-task`, `engineer-mode` skills | BSD-3-Clause |
| `review` | `well-architected-agent` + Well-Architected reviews (`wa-full-review`, `wa-security-review`, `wa-reliability-review`, `wa-performance-review`) + `technical-review` | BSD-3-Clause |
| `document` | `documentation-agent`, `persona-agent` (models your style from agent-journal sessions) + `update-documentation`, `agent-journal` skills | BSD-3-Clause |

The five phase plugins follow a feature-first workflow: **discover → decide → build → review → document**.
See [docs/workflow.md](docs/workflow.md) for the full workflow guide (preserved from the retired template repos).
Skills both auto-apply by description and are slash-invokable (`/engineer-mode`, `/wa-security-review`, …)
in Copilot CLI and Claude Code.

## Install

### GitHub Copilot CLI

```bash
copilot plugin marketplace add brendankowitz/agent-marketplace
copilot plugin install pr-review-toolkit@agent-marketplace
copilot plugin install build@agent-marketplace   # etc.
```

### Claude Code

```bash
claude plugin marketplace add brendankowitz/agent-marketplace
claude plugin install build@agent-marketplace   # etc.
```

## Design notes

- **One canonical content set.** Each agent/skill exists exactly once; per-platform
  manifests (`plugin.json` for Copilot CLI, `.claude-plugin/plugin.json` for Claude Code,
  marketplace manifests in `.github/plugin/` and `.claude-plugin/`) all point at the
  same files. The phase plugins were unified from
  [copilot-cli-code-template](https://github.com/brendankowitz/copilot-cli-code-template)
  and [claude-code-template](https://github.com/brendankowitz/claude-code-template)
  (both retired); the Copilot variants were kept as canonical because the two had
  diverged and the Copilot versions carried the newer, delegation-aware prompts.
- **Skills over commands.** Skills are the single format that both auto-applies and
  slash-invokes on both platforms, so the old `commands/` tree was dropped.
- **Neutral agent frontmatter.** Agents carry only `name` + `description` so the same
  file loads on both platforms (no `model:`/`tools:` platform dialect).

## Licensing

Each plugin carries its own license in its directory. `pr-review-toolkit` is a
derivative of Anthropic's Apache-2.0 plugin — see `NOTICE` and the attribution
headers in its files. The five phase plugins are BSD-3-Clause.
