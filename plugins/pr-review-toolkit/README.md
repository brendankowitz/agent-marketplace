# pr-review-toolkit (plugin)

Six specialized PR review agents for GitHub Copilot:

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
