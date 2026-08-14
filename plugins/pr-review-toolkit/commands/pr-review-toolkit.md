---
description: "Comprehensive PR review using specialized agents"
argument-hint: "[review-aspects]"
---

<!--
  Modified work — ported from the Claude Code 'pr-review-toolkit' plugin
  (https://github.com/anthropics/claude-plugins-official/tree/main/plugins/pr-review-toolkit),
  Copyright Anthropic, licensed under the Apache License, Version 2.0.
  Changes: converted to GitHub Copilot command format; frontmatter reworked
  (dropped allowed-tools); CLAUDE.md references replaced with
  AGENTS.md / .github/copilot-instructions.md.
-->

# Comprehensive PR Review

Run a comprehensive pull request review by delegating to multiple specialized agents, each focusing on a different aspect of code quality.

**Review Aspects (optional):** "$ARGUMENTS"

## Review Workflow:

1. **Determine Review Scope**
   - Check git status to identify changed files
   - Parse arguments to see if user requested specific review aspects
   - Default: Run all applicable reviews

2. **Available Review Aspects:**

   - **comments** - Analyze code comment accuracy and maintainability
   - **tests** - Review test coverage quality and completeness
   - **errors** - Check error handling for silent failures
   - **types** - Analyze type design and invariants (if new types added)
   - **code** - General code review for project guidelines
   - **simplify** - Simplify code for clarity and maintainability, and right-size over-defensive null/type checks
   - **all** - Run all applicable reviews (default)

3. **Identify Changed Files**
   - Run `git diff --name-only` to see modified files
   - Check if PR already exists: `gh pr view`
   - Identify file types and what reviews apply

4. **Determine Applicable Reviews**

   Based on changes:
   - **Always applicable**: code-reviewer (general quality)
   - **If test files changed**: pr-test-analyzer
   - **If comments/docs added**: comment-analyzer
   - **If error handling changed**: silent-failure-hunter
   - **If types added/modified**: type-design-analyzer
   - **After passing review**: code-simplifier (polish and refine)

   Note: code-simplifier is the only agent that edits; the rest are read-only. On error-handling
   and type-design constructs it defers to silent-failure-hunter and type-design-analyzer, which
   run first — it should not re-litigate or undo their findings.

5. **Launch Review Agents**

   Delegate each applicable review to the corresponding custom agent as a subagent:
   - `pr-review-toolkit:code-reviewer`
   - `pr-review-toolkit:pr-test-analyzer`
   - `pr-review-toolkit:comment-analyzer`
   - `pr-review-toolkit:silent-failure-hunter`
   - `pr-review-toolkit:type-design-analyzer`
   - `pr-review-toolkit:code-simplifier`

   **Sequential approach** (one at a time):
   - Easier to understand and act on
   - Each report is complete before next
   - Good for interactive review

   **Parallel approach** (user can request):
   - Launch all agents simultaneously
   - Faster for comprehensive review
   - Results come back together

6. **Aggregate Results**

   After agents complete, summarize:
   - **Critical Issues** (must fix before merge)
   - **Important Issues** (should fix)
   - **Suggestions** (nice to have)
   - **Positive Observations** (what's good)

7. **Provide Action Plan**

   Organize findings:
   ```markdown
   # PR Review Summary

   ## Critical Issues (X found)
   - [agent-name]: Issue description [file:line]

   ## Important Issues (X found)
   - [agent-name]: Issue description [file:line]

   ## Suggestions (X found)
   - [agent-name]: Suggestion [file:line]

   ## Strengths
   - What's well-done in this PR

   ## Recommended Action
   1. Fix critical issues first
   2. Address important issues
   3. Consider suggestions
   4. Re-run review after fixes
   ```

## Usage Examples:

**Full review (default):**
```
/pr-review-toolkit
```

**Specific aspects:**
```
/pr-review-toolkit tests errors
# Reviews only test coverage and error handling

/pr-review-toolkit comments
# Reviews only code comments

/pr-review-toolkit simplify
# Simplifies code after passing review
```

**Parallel review:**
```
/pr-review-toolkit all parallel
# Launches all agents in parallel
```

## Agent Descriptions:

**comment-analyzer**:
- Verifies comment accuracy vs code
- Identifies comment rot
- Checks documentation completeness

**pr-test-analyzer**:
- Reviews behavioral test coverage
- Identifies critical gaps
- Evaluates test quality

**silent-failure-hunter**:
- Finds silent failures
- Reviews catch blocks
- Checks error logging

**type-design-analyzer**:
- Analyzes type encapsulation
- Reviews invariant expression
- Rates type design quality

**code-reviewer**:
- Checks AGENTS.md / .github/copilot-instructions.md compliance
- Detects bugs and issues
- Reviews general code quality

**code-simplifier**:
- Simplifies complex code
- Improves clarity and readability
- Removes redundant null checks, argument guards, and type tests
- Applies project standards
- Preserves functionality

## Tips:

- **Run early**: Before creating PR, not after
- **Focus on changes**: Agents analyze git diff by default
- **Address critical first**: Fix high-priority issues before lower priority
- **Re-run after fixes**: Verify issues are resolved
- **Use specific reviews**: Target specific aspects when you know the concern

## Workflow Integration:

**Before committing:**
```
1. Write code
2. Run: /pr-review-toolkit code errors
3. Fix any critical issues
4. Commit
```

**Before creating PR:**
```
1. Stage all changes
2. Run: /pr-review-toolkit all
3. Address all critical and important issues
4. Run specific reviews again to verify
5. Create PR
```

**After PR feedback:**
```
1. Make requested changes
2. Run targeted reviews based on feedback
3. Verify issues are resolved
4. Push updates
```

## Notes:

- Agents run autonomously and return detailed reports
- Each agent focuses on its specialty for deep analysis
- Results are actionable with specific file:line references
- All agents available in the `/agent` list
