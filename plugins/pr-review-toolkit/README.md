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

Plus the **`/pr-review-toolkit` command**, which ties the six together. It inspects the diff, runs
all six agents as subagents on the model or mixture you choose, and then owns the three things no
individual agent can do: consolidating the reports into one deduplicated list, independently
verifying the findings before acting on them, and orchestrating the fixes.

Reviewer models are selectable — `model:opus`, `model:sonnet`, `model:sol`, `model:terra`,
`model:gemini`, or a mixture like `model:opus,sol,gemini`. This matters because Copilot CLI ignores
the `model:` field in agent frontmatter and routes delegated subagents to the session model, so
without naming one you get six reviewers sharing a single model's blind spots. Findings raised
independently by more than one provider are weighted above findings raised repeatedly by one, and
the run summary records which model each agent actually ran on.

The read-only guarantee is enforced by the `tools` allowlist for the direct edit path only. The
agents retain `execute` because they need `git diff`, so shell writes rest on instruction — the
contract tells them to keep scratch files outside the repository, but nothing prevents it.

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

Upstream ships no `tools:` allowlists — every agent there inherits full tools and can edit files —
and states the advisory/read-only contract on only one of its six agents (`comment-analyzer`). Its
`code-simplifier` is written as an editing agent outright ("apply refinements", "refining code
immediately after it's written"), and its command ends at a "Recommended Action" checklist with no
apply phase defined.

What actually happens at runtime is looser than either: in a Claude Code session observed in
February 2026, the review agents reported up rather than editing, with the orchestrator then
spawning its own editing agents to work through the findings. That is emergent behavior, not
something upstream's files specify, and it is not guaranteed to hold across models or versions —
so which agents edit depends on the model's judgement on the day.

This port removes that ambiguity. Every agent is read-only and says so, no agent carries `edit`,
and the command documents the three responsibilities it owns on top of the reviews: consolidate,
verify independently, orchestrate the fixes. Note that `tools:` is a Copilot CLI / Kimi Code
dialect; it is one more reason this plugin is not offered for Claude Code, where the allowlist
would be ignored and only the prose contract would remain.

**Do not add Claude Code manifests for this plugin** — use the upstream original there instead.
