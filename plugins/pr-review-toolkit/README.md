# pr-review-toolkit (plugin)

Six specialized PR review agents for GitHub Copilot CLI and Kimi Code. **All six are read-only** —
they analyze and report findings for the caller to consolidate, and none can edit files:

- **code-reviewer** — general review against project guidelines, bug detection (confidence-scored, high signal)
- **pr-test-analyzer** — behavioral test coverage and critical gaps (1–10 criticality)
- **silent-failure-hunter** — swallowed errors, broad catch blocks, unjustified fallbacks
- **comment-analyzer** — comment accuracy and comment rot
- **type-design-analyzer** — type encapsulation and invariant quality (1–10 per dimension)
- **code-simplifier** — clarity and maintainability polish that preserves functionality, including removal of redundant null/type checks and other over-defensive code; emits before/after patches rather than applying them

This is enforced by the `tools` allowlist, not just convention: no agent carries `edit`. Note that
this closes the direct edit path, not the shell path — the agents retain `execute` because they
need `git diff`, so the ban on working-tree-mutating commands rests on instruction rather than
permission.

Plus the **`/pr-review-toolkit` command**, which ties the six together. It inspects the diff,
delegates each applicable review to the matching agent as a subagent, and then owns the three
things no individual agent can do: consolidating the reports into one deduplicated list,
independently verifying the findings before acting on them, and orchestrating the fixes through
editing agents.

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
defensive-code guidance and the uniform `## Output contract` section on every agent.

Upstream ships no `tools:` allowlists — every agent there inherits full tools and *could* edit
files — and states the advisory/read-only contract on only one of its six agents
(`comment-analyzer`). In observed use the review agents do all report up, and the orchestrator then
launches editing agents to work through the aggregated findings. So upstream's effective shape is
already review-then-apply; it just rests on convention, since nothing prevents a review agent from
editing and the apply phase is emergent rather than documented.

This port makes that shape explicit. Every agent is read-only and says so, no agent carries `edit`,
and the command documents the three responsibilities it owns on top of the reviews: consolidate,
verify independently, orchestrate the fixes. Note that `tools:` is a Copilot CLI / Kimi Code
dialect; it is one more reason this plugin is not offered for Claude Code, where the allowlist
would be ignored and only the prose contract would remain.

**Do not add Claude Code manifests for this plugin** — use the upstream original there instead.
