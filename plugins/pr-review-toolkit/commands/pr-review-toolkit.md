---
description: "Comprehensive PR review using specialized agents"
argument-hint: "[review-aspects] [model:<names>] [parallel] [report-only]"
---

<!--
  Modified work — ported from the Claude Code 'pr-review-toolkit' plugin
  (https://github.com/anthropics/claude-plugins-official/tree/main/plugins/pr-review-toolkit),
  Copyright Anthropic, licensed under the Apache License, Version 2.0.
  Changes: converted to GitHub Copilot command format; renamed from upstream's
  commands/review-pr.md and invocations updated from /pr-review-toolkit:review-pr to
  /pr-review-toolkit; frontmatter reworked (dropped allowed-tools, extended argument-hint
  with the model/parallel/report-only modifiers); CLAUDE.md references replaced with
  AGENTS.md / .github/copilot-instructions.md; added the read-only contract summary and
  agent table, reviewer model selection, the parallel/report-only modifiers, and the
  consolidate/verify/apply phases (steps 6-8), which replace upstream's "Recommended
  Action" checklist; upstream's conditional agent-applicability rules replaced with
  running all six by default -- all local additions, not upstream.
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
3. **Orchestrate the fixes** — apply the accepted findings, delegating to editing subagents where
   that helps, then confirm the result.

You also choose the model each agent reviews with, in the model-selection step below. Copilot CLI routes delegated subagents
to the session model unless you name one, so without that choice every agent shares one model's
blind spots.

Because no agent applies fixes, the agents can safely run in parallel and their `file:line`
citations normally stay valid through consolidation. That rests on instruction rather than
permission, though: the agents retain `execute`, so a shell command could still write to the tree.
If citations start landing on the wrong lines, suspect that before suspecting the agents.

## Review Workflow:

1. **Determine Review Scope**
   - Check git status to identify changed files
   - Parse arguments for aspects, modifiers, and `model:`
   - **If a token doesn't match anything below, stop and ask.** Don't guess. An unmatched aspect
     merely over-reviews, but an unmatched `report-only` — `--report-only`, `report only`,
     `reportonly` — silently drops the one instruction that keeps this run from editing the tree.
     Never let a near-miss token resolve to "edit."
   - Default: run all six agents

2. **Arguments**

   Aspects — supply one or more to narrow the run. Omit them and all six agents run. Each maps to
   one agent: **comments** → comment-analyzer, **tests** → pr-test-analyzer, **errors** →
   silent-failure-hunter, **types** → type-design-analyzer, **code** → code-reviewer,
   **simplify** → code-simplifier.

   - **comments** - Analyze code comment accuracy and maintainability
   - **tests** - Review test coverage quality and completeness
   - **errors** - Check error handling for silent failures
   - **types** - Analyze type design and invariants
   - **code** - General code review for project guidelines
   - **simplify** - Report simplifications for clarity and maintainability, and right-size over-defensive null/type checks
   - **all** - Run all six (default)

   Modifiers (combinable with any aspect above):

   - **parallel** - Launch the agents simultaneously instead of sequentially
   - **report-only** - Stop after the verified summary; do not run the fix phase
   - **model:`<names>`** - Which model(s) to review with; see "Choose the Reviewer Model(s)"

3. **Identify Changed Files**
   - Resolve one concrete review scope and pass that same scope to every agent, so their
     `file:line` citations are comparable
   - If the user named a PR or branch, diff that: `gh pr view`, or `git diff <base>...HEAD`
   - Otherwise review local work in full — `git diff HEAD --name-only` for staged **and**
     unstaged changes, plus untracked files from `git status --short`. Plain `git diff` omits
     staged files, which would silently review nothing right after `git add`
   - Note the file types, so you can tell each agent what it's looking at

4. **Choose the Reviewer Model(s)**

   Copilot CLI ignores the `model:` field in agent frontmatter — it routes delegated subagents to
   the **session model**. Naming a model at dispatch time is therefore the only thing that selects
   one. Say nothing and you get six reviewers on one model: six correlated opinions rather than six
   independent ones.

   Aliases:

   | Alias | Model | Provider |
   |-------|-------|----------|
   | `opus` | `claude-opus-5` | Anthropic (default) |
   | `sonnet` | `claude-sonnet-4.6` | Anthropic |
   | `sol` | `gpt-5.6-sol` | OpenAI (default) |
   | `terra` | `gpt-5.6-terra` | OpenAI |
   | `gemini` | `gemini-3.1-pro-preview` | Google (default) |

   **How the model actually reaches the agent.** Pass the alias's **Model** column value as the
   `model` argument of the subagent dispatch itself — the same argument you would use to run any
   subagent on a non-default model. It is not something you can put in the prompt text: a model
   name mentioned in the prompt has no effect on which model runs, and the agent's own frontmatter
   is ignored by Copilot CLI. If your dispatch mechanism has no such argument, you cannot honor
   this modifier — say so plainly and run on the session model rather than reporting a mixture you
   did not achieve.

   **Record what you actually dispatched, not what you intended.** The run summary must name the
   model each agent really ran on. This is the only thing that makes a silent failure here
   visible: if the model argument never took effect, every agent ran on the session model, and a
   report that still claims a mixture would invent cross-model agreement that never happened.

   **If the user passed `model:`** — honor it and don't ask. One name runs every agent on that
   model (`model:sol`). Several names spread the agents across them, assigned round-robin in the
   order they are listed under "Launch Review Agents" (`model:opus,sol,gemini`).

   **If a name isn't in the table** — don't dispatch it. Say which name you didn't recognize, show
   the alias list, and ask. Silently passing an unknown string produces a failed dispatch that is
   easy to mistake for a completed review.

   **If the user passed no `model:` modifier** — pick the default alias for the session model's
   provider (`claude-*` → `opus`, `gpt-*` → `sol`, `gemini-*` → `gemini`), then ask **once**,
   before the first dispatch:

   ```
   Reviewing with <default alias> (inferred from your session model).
   Use that, or pick another: opus / sonnet / sol / terra / gemini,
   or a mixture like opus,sol.
   ```

   If the session model matches none of those prefixes, don't guess — say so and offer the full
   alias list with nothing preselected.

   Record the answer and never ask again during the run. If you find yourself past the first
   dispatch without having asked, don't interrupt the run — proceed on the default and say in the
   summary which model you proceeded with.

   **If a dispatch fails** — an alias the host doesn't recognize, or a provider this session can't
   reach — report which agent and model failed rather than silently dropping that agent's review.
   Re-dispatch it on one of the models that did work, and note the substitution in the summary, so
   a missing perspective never passes for a clean one.

   **Prefer a mixture when the diff carries real risk.** Reviewers on different models fail
   differently, so a finding two providers raise independently is worth more than one raised twice
   by the same model — and single-model findings are where false positives concentrate.
   Consolidation uses this.

5. **Launch Review Agents**

   Run all six unless the user narrowed the set with aspects. Pass each one the model chosen in
   the model-selection step, its effort from the table, and the review scope:
   - `pr-review-toolkit:code-reviewer`
   - `pr-review-toolkit:pr-test-analyzer`
   - `pr-review-toolkit:comment-analyzer`
   - `pr-review-toolkit:silent-failure-hunter`
   - `pr-review-toolkit:type-design-analyzer`
   - `pr-review-toolkit:code-simplifier`

   **Sequential approach** (one at a time):
   - Easier to follow when you want to read each report as it lands
   - Good for interactive review
   - Note that no agent consumes another's output, so sequencing buys correctness nothing —
     prefer it only for readability

   **Parallel approach** (recommended; `parallel`):
   - Launch all agents simultaneously
   - Faster for comprehensive review
   - Results come back together
   - Always safe: no agent applies fixes, and none depends on another's output

6. **Consolidate Results**

   **Open with a roll-call**, before any findings. One row per agent dispatched: the agent, the
   model it actually ran on, and whether it returned, failed, or was substituted. Without this, a
   five-agent run reads exactly like a six-agent one — the missing agent's findings are simply
   absent, and absence looks like a clean bill of health.

   ```markdown
   | Agent | Model | Status |
   |---|---|---|
   | code-reviewer | claude-opus-5 | returned |
   | silent-failure-hunter | gpt-5.6-sol | FAILED — dispatch error, not re-run |
   ```

   Then merge the reports:
   - Deduplicate — several agents often flag the same line from different angles. Merge them into
     one finding listing each agent that raised it, **and which model each ran on**.
   - Weight agreement by independence. Two agents on *different* models raising the same finding is
     a much stronger signal than two on the same model, which share failure modes. Rank a
     cross-model finding above a same-model one at equal severity. **Only claim this when the
     models really differed** — if the model argument didn't take effect, every agent ran on the
     session model and there is no cross-model signal to report.
   - Normalize severity. The agents emit different scales — `silent-failure-hunter` uses
     CRITICAL/HIGH/MEDIUM, `pr-test-analyzer` rates 1-10, `code-reviewer` scores 0-100,
     `comment-analyzer` uses its own headings, and `code-simplifier` and `type-design-analyzer`
     emit none. Map them onto **Critical** (must fix), **Important** (should fix), **Suggestions**
     (nice to have), plus **Positive Observations**, and say how you mapped anything ambiguous.
   - Resolve conflicts explicitly, never silently. Where `code-simplifier` wants a guard removed
     and `silent-failure-hunter` wants it kept, keep the guard — and record both positions in the
     finding so the user can override.
   - Where agents contradict each other on a *factual* claim, don't average them — go verify it in
     verification. A confident claim from one agent that two others contradict is usually wrong.

7. **Verify Findings Independently**

   The agents are advisory and can be wrong. Verify each finding before listing it as Critical,
   Important, or a Suggestion; anything you did not confirm goes under Unverified instead.
   - **Read the cited code.** Confirm the `file:line` says what the finding claims. Drop findings
     that misread the code.
   - **Scrutinize single-source findings hardest.** A finding only one agent raised — especially
     one no other model saw — is where false positives concentrate. Check it before it reaches the
     fix list.
   - **Distinguish verified from inferred.** Agents sometimes present reasoning as fact ("no file
     records this, so it must have come from upstream"). If a finding rests on an inference about
     something checkable, check it.
   - **Check it's in scope.** Pre-existing issues outside the diff are not this PR's problem —
     note them separately rather than folding them into the fix list.
   - **Weight the confidence signal.** `code-reviewer` scores 0-100 and reports only ≥ 80; treat
     the low end of that range as needing a closer look.
   - **Don't present an unconfirmed finding as verified.** List it under Unverified so the user
     can judge. Reserve dropping for findings you actively disconfirmed.

   Present the verified list. Carry the roll-call table from consolidation at the top, and mark
   each finding with how it was checked — `[verified]`, or `[unverified: reason]` — so a run that
   skipped verification cannot pass for one that did it:
   ```markdown
   # PR Review Summary

   <roll-call table: agent | model | status>

   ## Critical Issues (X found)
   - [agent-name, model] Issue description [file:line] — [verified: read the cited lines]

   ## Important Issues (X found)
   - [agent-name, model] Issue description [file:line] — [verified: ...]

   ## Suggestions (X found)
   - [agent-name, model] Suggestion [file:line] — [verified: ...]

   ## Positive Observations
   - What's well-done in this PR

   ## Unverified / Out of Scope
   - Findings you could not confirm, or that predate this change
   ```

8. **Orchestrate the Fixes**

   **Skip this step entirely if the user passed `report-only`** — deliver the verified summary from
   the previous step and stop, leaving the tree untouched. If you are unsure whether an argument
   meant `report-only`, treat it as though it did and ask; erring toward not editing is always the
   safe direction here.

   Otherwise, confirm with the user which findings to apply (default: critical + important;
   suggestions only if asked). None of this toolkit's agents can apply them, so either do it
   yourself or delegate to a general-purpose editing subagent — this marketplace's
   `build:coding-agent` suits it well when installed, but do not assume it is: this plugin is
   deliberately standalone, so fall back to applying the edits directly in this session. **Say
   which route you took**, so "applied" never hides who did the work.

   When you delegate to more than one worker:

   - **Group by file, not by finding.** Two agents editing the same file collide. One worker owns
     a file — or a disjoint set of files — for the whole pass. Disjoint groups can run in
     parallel; anything overlapping runs sequentially. With a single worker, or findings confined
     to one file, skip the grouping and apply them in order.
   - **Pass each finding verbatim** — the `file:line`, the reviewing agent's rationale, and for
     `code-simplifier` findings the exact before/after patch. Workers apply the finding; they
     don't re-derive it.
   - **Don't let workers expand scope.** They fix the cited finding and nothing else. Anything
     noticed in passing comes back as a new finding, not an unrequested edit.

   Then close the loop:

   1. Run the project's existing test/build/lint command covering the touched files. **If the
      project defines none you can identify, say so explicitly** — never report a finding as
      "applied" in a way that implies validation you didn't run. "Applied, unverified — no test
      command found" is the honest form.
   2. Report per finding: applied, deferred (with reason), or failed verification.
   3. Re-run the affected review agents to confirm the findings are actually resolved, passing the
      **same explicit scope** you resolved earlier. Don't rely on the agents' own defaults — they
      review unstaged changes by default, so if anything was staged or committed during the fix
      phase they would see an empty diff and report a clean result that means nothing.

   If verification fails, undo only the exact change applied for that finding — never a broad
   `git checkout` or `git restore`, which can discard unrelated work — and report the finding as
   still open rather than leaving the tree broken. If the change can't be isolated safely, stop and
   ask.

## Usage Examples:

**Full review (default):**
```
/pr-review-toolkit
# All six agents. Asks once which model to review with, defaulting to your
# session provider, then confirms scope before any fixes are applied.
```

**Choosing the reviewer model:**
```
/pr-review-toolkit model:opus
# All six on claude-opus-5

/pr-review-toolkit model:sol
# All six on gpt-5.6-sol

/pr-review-toolkit model:opus,sol,gemini
# Spread the six across three providers — findings raised by more than one
# provider carry more weight in consolidation
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
# Stop after the verified summary; leave the tree untouched
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
- **Mix models on risky diffs**: `model:opus,sol,gemini` — reviewers on different models fail
  differently, and cross-provider agreement is the strongest confidence signal available
- **Address critical first**: The fix phase defaults to critical + important, in that order
- **Use `report-only`**: When you want the findings without the tree being touched
- **Use specific reviews**: Target specific aspects when you know the concern

## Workflow Integration:

**Before committing:**
```
1. Write code
2. Run: /pr-review-toolkit code errors
3. Confirm which findings to apply when prompted
4. Commit
```

**Before creating PR:**
```
1. Stage all changes
2. Run: /pr-review-toolkit all
3. Confirm the critical and important findings when prompted
4. The command re-runs the affected agents to verify
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
