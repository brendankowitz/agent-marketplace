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
  - `build:bulk-reader` - answering questions about files you are *not* about to edit, so their contents never enter your context. Not for files an implementer is editing: those need exact content and line numbers. On Copilot dispatch it with `mai-code-1.1-flash`, which measured about a tenth the cost of `claude-haiku-4.5` on the same read.

  Claude Code reads the tier off each agent's frontmatter, so dispatch by name and
  the model follows. Copilot CLI does not, and its failure modes are quiet: a bare
  dispatch errors on the alias, and passing the Claude Code alias at dispatch time
  silently runs a *different, larger* model. On Copilot, name the Copilot id —
  `claude-haiku-4.5`, `claude-sonnet-5`, `claude-opus-5`, or the GPT tier ids in
  `implement-task-next`, which carries the full table.
- Spawn as many agents as needed, including using the fleet skill for parallel work
- Always use modern language syntax when possible

## Iteration Loop

1. **Implement** sub-task
2. **Build & Test**
3. **Fix** if needed (repeat 1-2)
4. **Code review** Use multiple high-end models (Opus, Gemini Pro, Codex) to review code for quality, security, and best practices and alignment to the task. Iterate and fix (critical, high, medium) feedback.
5. **Next** sub-task
