---
description: "Comprehensive PR review using specialized agents"
argument-hint: "[review-aspects] [parallel] [report-only]"
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

## How this command works

**Every agent in this toolkit is read-only.** All six review the diff and report findings; none of
them edits, and none carries `edit` in its `tools` allowlist. Applying fixes is this command's job,
not theirs.

| Agent | Reports on |
| --- | --- |
| `code-reviewer` | Project-guideline compliance and bugs (confidence-scored) |
| `pr-test-analyzer` | Behavioral test coverage and gaps |
| `comment-analyzer` | Comment accuracy and comment rot |
| `silent-failure-hunter` | Swallowed errors and unjustified fallbacks |
| `type-design-analyzer` | Type encapsulation and invariants |
| `code-simplifier` | Simplifications, emitted as before/after patches |

You own three things the agents cannot do individually:

1. **Consolidate** the reports into one deduplicated, severity-ordered list.
2. **Verify independently** — the agents are advisory and can be wrong. Spot-check findings against
   the actual code before acting on them.
3. **Orchestrate the fixes** — fan the accepted findings out to editing agents, then confirm the
   result.

Because nothing mutates during the review, the agents can safely run in parallel and their
`file:line` citations stay valid through consolidation.

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
   - **simplify** - Report simplifications for clarity and maintainability, and right-size over-defensive null/type checks
   - **all** - Run all applicable reviews (default)

   Modifiers (combinable with any aspect above):

   - **parallel** - Launch the applicable agents simultaneously instead of sequentially (step 5)
   - **report-only** - Stop after step 7; do not run the fix phase (step 8)

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
   - **If code changed**: code-simplifier (polish suggestions as patches)

   Note: nothing edits during the review — all six report, so they have no ordering dependency on
   each other and can run in any order. On error-handling and type-design constructs code-simplifier
   defers by topic: it stays off that ground entirely rather than waiting to read
   silent-failure-hunter's or type-design-analyzer's findings, so it should never re-litigate or
   contradict them.

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
   - Always safe: no agent mutates the tree, and none depends on another's output

6. **Consolidate Results**

   After agents complete, merge the reports:
   - Deduplicate — several agents often flag the same line from different angles. Merge them into
     one finding listing each agent that raised it; agreement across agents raises confidence.
   - Group by severity: **Critical** (must fix), **Important** (should fix), **Suggestions**
     (nice to have), plus **Positive Observations**.
   - Note conflicts rather than silently picking a side. Where `code-simplifier` wants a guard
     removed and `silent-failure-hunter` wants it kept, the latter wins — surface the disagreement.

7. **Verify Findings Independently**

   The agents are advisory and can be wrong. Before acting, spot-check:
   - **Read the cited code.** Confirm the `file:line` says what the finding claims. Drop findings
     that misread the code.
   - **Check it's in scope.** Pre-existing issues outside the diff are not this PR's problem —
     note them separately rather than folding them into the fix list.
   - **Weight the confidence signal.** `code-reviewer` scores 0-100 and reports only ≥ 80; treat
     the low end of that range as needing a closer look.
   - **Don't relay a finding you couldn't confirm.** Mark it as unverified so the user can judge.

   Present the verified list:
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

   ## Unverified / Out of Scope
   - Findings you could not confirm, or that predate this change
   ```

8. **Orchestrate the Fixes**

   **Skip this step entirely if the user passed `report-only`** — deliver the step 7 summary and
   stop, leaving the tree untouched.

   Otherwise, confirm with the user which findings to apply (default: critical + important;
   suggestions only if asked), then delegate the work to editing agents:

   - **Group by file, not by finding.** Two agents editing the same file collide. One worker owns
     a file — or a disjoint set of files — for the whole pass. Disjoint groups can run in
     parallel; anything overlapping runs sequentially.
   - **Pass each finding verbatim** — the `file:line`, the reviewing agent's rationale, and for
     `code-simplifier` findings the exact before/after patch. Workers apply the finding; they
     don't re-derive it.
   - **Don't let workers expand scope.** They fix the cited finding and nothing else. Anything
     noticed in passing comes back as a new finding, not an unrequested edit.

   Then close the loop:

   1. Run the project's existing test/build/lint command covering the touched files.
   2. Report per finding: applied, deferred (with reason), or failed verification.
   3. Re-run the affected review agents against the updated tree to confirm the findings are
      actually resolved — citations from the pre-fix tree will have moved.

   If verification fails, revert the offending change and report the finding as still open rather
   than leaving the tree broken.

## Usage Examples:

**Full review (default):**
```
/pr-review-toolkit
# Agents report; you confirm scope before any fixes are applied
```

**Specific aspects:**
```
/pr-review-toolkit tests errors
# Reviews only test coverage and error handling

/pr-review-toolkit comments
# Reviews only code comments

/pr-review-toolkit simplify
# Reports simplification patches for you to apply
```

**Parallel review:**
```
/pr-review-toolkit all parallel
# Launches all agents in parallel — always safe, none of them edit
```

**Review only, skip the fix phase:**
```
/pr-review-toolkit all report-only
# Stop after step 7; leave the tree untouched
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
- Reports simplifications for complex code
- Identifies clarity and readability improvements
- Identifies redundant null checks, argument guards, and type tests
- Checks against project standards
- Preserves functionality
- Emits before/after patches rather than editing

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
- Every agent is read-only — this command owns consolidating, verifying, and applying
- Each agent focuses on its specialty for deep analysis
- Results are actionable with specific file:line references
- All agents available in the `/agent` list
