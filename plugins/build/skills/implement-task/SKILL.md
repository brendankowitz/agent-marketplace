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
- Always use modern language syntax when possible
- Never fix code yourself as coordinator — dispatch it. Coordinator fixes
  pollute your context and skip review.
- Hand artifacts to subagents as **file paths** under the run's
  `./agent-working/<task-slug>/` directory, not pasted content. Anything you
  paste into a dispatch stays in your context for the rest of the session.

## Ledger

Your conversation memory does not survive compaction; a file does. Each task
run owns a directory under `./agent-working/<task-slug>/` at the repo root —
home to the ledger and any briefs, reports, or diff packages you hand to
subagents.

Before writing anything, make the workspace self-ignoring — it excludes itself
without touching any tracked file:

```bash
mkdir -p ./agent-working/<task-slug> && printf '*\n' > ./agent-working/.gitignore
```

Create the ledger at `./agent-working/<task-slug>/progress.md` with its identity
as the first line, so a ledger you find later can prove it is yours:

```
# ledger — task: <task description or plan file path>
```

Then append one line per state transition, in this grammar:

```
Task 3: complete (commits a1b2c3d..d4e5f6a, review clean)
Task 3: complete (commits a1b2c3d..d4e5f6a, 2 parked)
Task 4: fix round 2/5 (1 addressed, 1 open — missing null guard; commits d4e5f6a..b7c8d9e)
Task 4: minor (deferred): magic number in retry backoff
Task 5: parked — reviewer flagged duplicate helper — ruling: matches existing file convention
Task 6: BLOCKED — schema change contradicts the plan's stated migration order
```

Every entry names its commits — the ledger is an index over git, not a copy of
it. On resume, trust the ledger and `git log` over recollection. Tasks with a
`complete` line are done — do not re-dispatch them. A task whose last line is a
fix round is mid-loop: resume at the next round. A ledger whose identity line
names a different task, or a sibling directory, belongs to another run — leave
it alone and start your own.

Nothing leaves the loop silently: findings that are not fixed are deferred,
parked with a ruling, or BLOCKED — always as a ledger line.

Note that `git clean -fdx` will destroy `agent-working/` since it is ignored
scratch; if that happens, recover from `git log`. When the final review is clean
and merged, delete the run's directory — git history is the record now.

## Model Selection

Use the least capable tier that can do the job. **Always name the model
explicitly** — omitting it inherits the session model, usually the most
expensive one.

| Tier | Agent | Models | Use for |
|------|-------|--------|---------|
| Fast | Fast Coding Agent | `gpt-5.6-luna`, `haiku` | 1-2 files, complete spec, transcription, build-error fixes |
| Standard | Coding Agent | `gpt-5.6-terra`, `sonnet` | multi-file integration, pattern matching, debugging |
| Deep | Complex Coding Agent | `gpt-5.6-sol`, `opus` | architecture, design judgment, broad codebase reasoning |

**Turn count beats token price.** The cheapest tier routinely takes 2-3× the
turns on multi-step work, costing more overall. Standard is the *floor* for
reviewers and for implementers working from prose. Drop to Fast only when the
task text contains the code to write, or the change is a single-file mechanical fix.

**Reviews** scale to the diff's risk, not to a fixed tier: small mechanical
diff → Fast/Standard; subtle concurrency or security change → Deep. The final
whole-branch review is always Deep.

## Iteration Loop

Run per sub-task. Record `BASE = git rev-parse HEAD` before dispatching.

1. **Implement** — dispatch one implementer (never two in parallel on the same
   files). Give it: where the task fits, its requirements, interfaces from
   earlier tasks it can't know, and your resolution of any ambiguity.
2. **Build & Test** — the implementer runs the tests covering its change and
   reports the command and its output.
3. **Handle the report:**
   - **DONE** → review
   - **DONE_WITH_CONCERNS** → read them; correctness/scope concerns get
     addressed before review, observations get noted
   - **NEEDS_CONTEXT** → supply it, re-dispatch same model
   - **BLOCKED** → change something: more context, higher tier, or smaller
     pieces. Never force the same model to retry unchanged.
4. **Review** — dispatch a reviewer with the `BASE..HEAD` diff written to
   `./agent-working/<task-slug>/task-<N>-review.diff`. It must return both a
   spec-compliance verdict and a quality verdict. Don't pre-judge findings
   ("don't flag X") — let it raise them and adjudicate.
5. **Fix loop** — Critical/Important findings only; Minor findings go to the
   ledger as deferred. Max 5 rounds, each round = one fix plus one *scoped*
   re-review of the fix diff.
   - Rounds 1-3: resume the same implementer with the findings verbatim
   - Rounds 4-5: fresh implementer, **one tier up**, told what was already tried
   - At the cap: adjudicate each open finding — park it with a written ruling,
     or STOP and report BLOCKED if it's load-bearing. Silent discards forbidden.
6. **Record & next** — append the round and completion lines to the ledger in
   the same message as your other bookkeeping, then move on. Don't pause to ask
   "should I continue?" — execute the plan.

Spawn independent sub-tasks in parallel when they touch disjoint files.

## Final Review

After all sub-tasks: one whole-branch review on the **Deep** tier over
`merge-base..HEAD`. Hand it the ledger path along with the diff and tell it to
triage the `minor (deferred)` and `parked` lines — which must be fixed before
merge, which stand. A roll-up nobody reads is a silent discard.

If it returns findings, dispatch **one** fix agent with the complete list — not
one fixer per finding — then one scoped re-review of that fix diff. Adjudicate
any residuals as above, then delete `./agent-working/<task-slug>/`.
