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
  - **Fast Coding Agent** (`haiku` / `gpt-5.6-luna`): Simple tasks, single-file edits
  - **Coding Agent** (`sonnet` / `gpt-5.6-terra`): Medium complexity, multi-file changes
  - **Complex Coding Agent** (`opus` / `gpt-5.6-sol`): High-complexity architectural work
  - **Principal Coding Agent** (`fable` / `gpt-6-astra`): Whole-system reasoning, cross-cutting change, and escalation when a lower tier has failed - the slowest and most expensive tier, so do not reach for it by default
  - **Bulk Reader** (`haiku`): Answering questions about files you do not need to edit, so their contents never enter your context
- Spawn as many agents as needed, including using the fleet skill for parallel work
- Always use modern language syntax when possible

## Iteration Loop

1. **Implement** sub-task
2. **Build & Test**
3. **Fix** if needed (repeat 1-2)
4. **Code review** Use multiple high-end models (Opus, Gemini Pro, Codex) to review code for quality, security, and best practices and alignment to the task. Iterate and fix (critical, high, medium) feedback.
5. **Next** sub-task
