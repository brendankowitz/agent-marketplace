---
name: pr-review-toolkit-next
description: >
  Review a pull request, branch, or local changes with a single reviewer pass on a
  frontier model instead of a fan-out of specialist reviewer agents. Use when asked to
  review a PR or diff with the experimental single-pass reviewer, or to compare it
  against /pr-review-toolkit.
---

> **Experimental.** This is the in-development successor to `/pr-review-toolkit`. It may
> change or disappear without notice. The stable version ships in the `pr-review-toolkit`
> plugin.

# Single-Pass PR Review

## What is being tried

`/pr-review-toolkit` dispatches six specialist reviewers, then consolidates and verifies
their reports. Each reviewer re-reads the same diff and surrounding code, so the run pays
for that context six times, and the specialists' narrow briefs produce overlapping,
differently scaled findings that the orchestrator has to reconcile.

The hypothesis: **one reviewer with one well-scoped prompt, on the newest frontier model,
catches as many real issues or more, at a fraction of the cost and time.** This skill exists to
test that on real PRs before anything changes in the stable toolkit.

Low reasoning effort was tried and dropped. At low effort the reviewer samples a few files of a
large diff and stops, regardless of the prompt. Medium is the default.

## Arguments

All optional, in any order:

- **Target** — a PR number, a branch, or paths. Omit it to review local work.
- **`model:<alias>`** — `opus`, `sonnet`, `astra`, `sol`, `mai`, `gemini`, each meaning the
  newest model in that family the host offers. Default: the frontier family for the session
  model's provider (`claude-*` → `opus`, `gpt-*` → `astra`, `gemini-*` → `gemini`).
- **`effort:<level>`** — `medium` (default), `high`, or `low`. Avoid `low` on anything but a
  small diff; it trades coverage for speed.
- **`fix`** — apply verified Critical and Important findings after reporting. Without it the
  run is report-only and leaves the tree untouched.

If a token matches none of these, stop and ask. A misspelt `fix` must not quietly become
report-only, and a misspelt target must not quietly review something else.

## Workflow

### 1. Resolve the scope into a file

Create `./agent-working/pr-review-<slug>/`, where `<slug>` is `pr-<number>`, the branch name,
or `local`. Write `*` to `./agent-working/.gitignore` before anything else, as
`implement-task-next` does. Otherwise, in local mode, this run's own files show up as untracked
and get reviewed as part of the change. Then write the diff to `diff.patch` in that directory:

- PR: `gh pr diff <number>`, and `gh pr view <number> --json title,body,baseRefName` to
  `pr.json` so the reviewer knows the stated intent.
- Branch: `git diff <base>...<branch>`.
- Local work: `git diff HEAD` (staged **and** unstaged), plus the contents of untracked files
  from `git status --short`. Plain `git diff` omits staged changes.

If the diff is empty, say so and stop. An empty diff reviewed is a clean report that means
nothing.

### 2. Dispatch one reviewer

Dispatch **exactly one** subagent — a general-purpose agent with read and shell access — with
this prompt, filling in the paths:

```
Follow the review instructions in <skill-dir>/reviewer-prompt.md.
Review scope: ./agent-working/pr-review-<slug>/diff.patch
PR metadata (if present): ./agent-working/pr-review-<slug>/pr.json
Write your report to ./agent-working/pr-review-<slug>/report.md and reply with its path.
```

Pass the resolved model and effort as **dispatch arguments**, not prompt text — a model named
in the prompt has no effect. If the dispatch mechanism has no effort argument, run without it
and record `effort: not settable` in the summary. Dispatch a plain one-shot subagent, not a
named or teammate-style agent: hosts have been seen silently dropping the effort argument for
those. Where the host exposes the subagent's metadata or transcript, check the effort it
actually ran at. If it has no model argument either, record
the session model. Never report a model or effort you did not actually dispatch with; the
experiment is worthless if the run summary lies about its configuration.

If the host cannot dispatch subagents at all, follow `reviewer-prompt.md` yourself in this
session and record `inline` as the dispatch mode.

Do not add a second reviewer, a specialist follow-up, or a "just to be safe" re-review. One
pass is the thing being tested.

### 3. Spot-check the citations

Read `report.md`. For each Critical and Important finding, open the cited `file:line` and
confirm the quoted line is there and says what the finding claims. That is the whole check —
do not re-review the change. Move any finding whose citation does not hold to **Rejected**
with a one-line reason.

### 4. Report

```markdown
# PR Review — <target>

| Dispatch | Model | Effort | Wall-clock | Tokens / cost |
|---|---|---|---|---|
| subagent | <concrete model id> | low | 2m 10s | <as reported by the host, or "not reported"> |

## Critical (N)
- Description [file:line] — failure scenario
## Important (N)
## Suggestions (N)
## Rejected at spot-check (N)
## Pre-existing (outside the diff)
```

Record wall-clock and tokens or cost whenever the host exposes them. Those numbers are half
of what this experiment measures.

### 5. Fix (only with `fix`)

Confirm with the user which findings to apply (default: Critical and Important). Apply them
directly, run the project's existing build or test command for the touched files, and report
each finding as applied, deferred (with a reason), or failed verification. If no build or test
command exists, say "applied, unverified". Undo only the exact change for a finding that
fails — never a broad `git checkout` or `git restore`.

## Comparing against `/pr-review-toolkit`

To evaluate, run both on the **same scope** and append one row per run to
`./agent-working/pr-review-eval.md`:

```markdown
| Target | Variant | Model | Effort | Wall-clock | Tokens / cost | Findings | Confirmed real | False positive | Missed (real, found only by the other variant) |
|---|---|---|---|---|---|---|---|---|---|
```

Judge "confirmed real" by reading the code, not by which variant raised it, and judge both
variants by the same standard. A finding counts as missed only if it is real and the other
variant caught it. Prefer PRs whose real defects are already known, such as bugs that later
needed a follow-up fix, or plant a few, so recall can be measured and not just guessed.
