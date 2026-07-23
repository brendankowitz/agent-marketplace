# agent-marketplace

A [GitHub Copilot CLI plugin marketplace](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-cli-plugins) collecting my agents, skills, and commands in one installable place.

## Plugins

| Plugin | Contents | License |
|---|---|---|
| `pr-review-toolkit` | 6 PR review agents (code quality, test coverage, silent failures, comment accuracy, type design, simplification) + `/pr-review-toolkit` command that orchestrates them all. Ported from Anthropic's Claude Code [pr-review-toolkit](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/pr-review-toolkit). | Apache-2.0 |
| `copilot-code-template` | AI-native development workflow: 7 agents + 14 skills for a feature-first lifecycle (investigate → ADR → implement → verify → document) plus Well-Architected review skills. From [copilot-cli-code-template](https://github.com/brendankowitz/copilot-cli-code-template). | BSD-3-Clause |
| `claude-code-template` | The same workflow in its original Claude Code form: 7 agents + 14 slash commands (`/fn-review`, `/wa-security`, `/engineer-mode`, …). From [claude-code-template](https://github.com/brendankowitz/claude-code-template). | BSD-3-Clause |

## Install

```bash
# register the marketplace
copilot plugin marketplace add brendankowitz/agent-marketplace

# install what you want
copilot plugin install pr-review-toolkit@agent-marketplace
copilot plugin install copilot-code-template@agent-marketplace
copilot plugin install claude-code-template@agent-marketplace
```

## Note: the two templates overlap

`copilot-code-template` and `claude-code-template` are the same workflow in two
formats, so their agents share IDs (`coding-agent`, `adr-analyzer`, …). Copilot
CLI deduplicates agents first-found-wins, so **install one or the other**, not
both — otherwise one plugin's agents are silently ignored.

- Pick `copilot-code-template` if you want skills that auto-apply as you work.
- Pick `claude-code-template` if you prefer explicit slash commands (`/fn-review`, `/wa-review`, …).

## Licensing

Each plugin carries its own license in its directory. `pr-review-toolkit` is a
derivative of Anthropic's Apache-2.0 plugin — see `NOTICE` and the attribution
headers in its files. The two `*-code-template` plugins are BSD-3-Clause.
