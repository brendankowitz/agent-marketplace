# pr-review-toolkit (plugin)

Six specialized PR review agents for GitHub Copilot CLI and Kimi Code:

- **code-reviewer** — general review against project guidelines, bug detection (confidence-scored, high signal)
- **pr-test-analyzer** — behavioral test coverage and critical gaps (1–10 criticality)
- **silent-failure-hunter** — swallowed errors, broad catch blocks, unjustified fallbacks
- **comment-analyzer** — comment accuracy and comment rot
- **type-design-analyzer** — type encapsulation and invariant quality (1–10 per dimension)
- **code-simplifier** — clarity and maintainability polish that preserves functionality, including removal of redundant null/type checks and other over-defensive code

Plus the **`/pr-review-toolkit` command**, which orchestrates all of the above in one shot:
it inspects the diff, delegates each applicable review to the matching agent as a
subagent, and aggregates the findings into a single report.

Ported from Anthropic's Claude Code `pr-review-toolkit` plugin (Apache-2.0). See the repository-root
README for install and usage instructions.

## Not offered for Claude Code — by design

This plugin ships **no `.claude-plugin/plugin.json`** and is **not listed in the root
`.claude-plugin/marketplace.json`**, so it is deliberately not installable from Claude Code.
It does ship for Copilot CLI and Kimi Code.

That gap is intentional, not an oversight: Claude Code users already have the official
[`pr-review-toolkit`](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/pr-review-toolkit)
in Anthropic's own marketplace, and installing this port alongside it would create a second
set of agents with the same names.

Being a port, this plugin is also the repo's exception to two conventions the phase plugins
follow: it keeps its upstream `commands/` tree, and its agents carry a `tools:` allowlist.
It additionally uses `AGENTS.md` / `.github/copilot-instructions.md` conventions in place of
upstream's `CLAUDE.md`, and carries local additions such as the code-simplifier's
defensive-code guidance.

**Do not add Claude Code manifests for this plugin** — use the upstream original there instead.
