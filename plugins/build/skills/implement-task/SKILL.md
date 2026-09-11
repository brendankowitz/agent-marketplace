---
name: implement-task
description: >
  Implement tasks using appropriate coding agents with continuous build verification.
  Use when user provides a task to implement.
  Delegates to Fast/Coding/Complex Coding agents based on complexity. Follows implement-build-test-fix loop.
---

# Implement and Iterate Task

Implement tasks using appropriate coding agents with continuous build verification.

**Usage**: When user provides a task to implement

## Instructions

- Respect AGENTS.md (and Claude.md if it exists)
- Use MCP servers to assist
- Delegate to appropriate coding agents when possible:
  - `build:fast-coding-agent` - simple tasks, single-file edits
  - `build:coding-agent` - medium complexity, multi-file changes
  - `build:complex-coding-agent` - high-complexity architectural work
  - `build:principal-coding-agent` - whole-system reasoning, cross-cutting change, and escalation when a lower tier has failed; the slowest and most expensive tier, so do not reach for it by default

  Claude Code takes the tier from each agent's frontmatter. Copilot does not, and
  fails quietly, so name a Copilot id there: `claude-haiku-4.5`, `claude-sonnet-5`,
  `claude-opus-5`, `mai-code-1.1-flash` for bulk-reader. Full table in
  `implement-task-next`.
- Spawn as many agents as needed, including using the fleet skill for parallel work
- Always use modern language syntax when possible

## Reading without spending context

Both the primary context and delegated coding agents may use `build:bulk-reader`
for read-only questions about files they are not about to edit. Give it a bounded
question and file paths; use its concise answer and `path:line` references instead
of loading those files into the caller's context. Read files being edited directly
for exact content and line numbers. Read a single small file directly as well.

When dispatching an implementer that must own its code changes, explicitly permit
bulk-reader calls for this read-only context gathering. Restrict delegation of
implementation work, not reading assistance; the implementer still owns code
changes, debugging decisions, and architectural judgment.

## Iteration Loop

1. **Implement** sub-task
2. **Build & Test**
3. **Fix** if needed (repeat 1-2)
4. **Code review** Use multiple high-end models (Opus, Gemini Pro, Codex) to review code for quality, security, and best practices and alignment to the task. Iterate and fix (critical, high, medium) feedback.
5. **Next** sub-task
