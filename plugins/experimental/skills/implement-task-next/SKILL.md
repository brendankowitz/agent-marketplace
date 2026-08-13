---
name: implement-task-next
description: >
  Implement tasks using appropriate coding agents with continuous build verification.
  Use when user provides a task to implement.
  Delegates to Fast/Coding/Complex Coding agents by tier, tracks progress in a
  compaction-proof ledger, and runs a bounded implement-build-test-review-fix loop.
---

> **Experimental.** This is the in-development successor to `implement-task`. It may
> change or disappear without notice. The stable version ships in the `build` plugin.

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

`<task-slug>` is derived, never invented: kebab-case the plan file's basename, or
if there is no plan file, the first few words of the task as the user stated it
(`add-retry-backoff`). Derive it the same way every time — a resumed run that
picks a different slug will not find its own ledger, which defeats the point.

Before writing anything, make the workspace self-ignoring — it excludes itself
without touching any tracked file. Run whichever matches your shell:

```bash
mkdir -p ./agent-working/<task-slug> && printf '*\n' > ./agent-working/.gitignore
```

```powershell
New-Item -ItemType Directory -Force ./agent-working/<task-slug> | Out-Null
Set-Content ./agent-working/.gitignore '*'
```

Create the ledger at `./agent-working/<task-slug>/progress.md` with its identity
as the first lines, so a ledger you find later can prove it is yours and can
tell you which model column the run committed to:

```
# ledger — task: <task description or plan file path>
# models: anthropic (inferred)
```

See [Model Selection](#model-selection) for what goes on the `models:` line.

Then append one line per state transition, in this grammar:

```
Task 3: started (base a1b2c3d)
Task 3: complete (commits a1b2c3d..d4e5f6a, review clean)
Task 4: started (base d4e5f6a)
Task 4: minor (deferred): magic number in retry backoff
Task 4: fix round 2/5 (1 addressed, 1 open — missing null guard; commits d4e5f6a..b7c8d9e)
Task 4: complete (commits d4e5f6a..b7c8d9e, 1 deferred)
Task 5: started (base b7c8d9e)
Task 5: parked — reviewer flagged duplicate helper — ruling: matches existing file convention
Task 5: complete (commits b7c8d9e..e1f2a3b, 1 parked)
Task 6: started (base e1f2a3b)
Task 6: BLOCKED — schema change contradicts the plan's stated migration order
```

Write the `started` line **before** dispatching the implementer — it carries the
`BASE` the review diff is cut from, and it is the one value a compaction between
implement and review would otherwise destroy.

Every entry names its commits — the ledger is an index over git, not a copy of
it. On resume, trust the ledger and `git log` over recollection. Read each task's
lines in order and resume from its **last** line:

| Last line | Meaning | Resume action |
|-----------|---------|---------------|
| `complete` | done | do not re-dispatch |
| `BLOCKED` | needs a human ruling | stop and report |
| `fix round R/5` | mid-loop | resume at round R+1; at `R = 5` the cap is spent — go straight to adjudication |
| `started` | dispatched, outcome unknown | diff `base..HEAD`; empty → re-dispatch, non-empty → resume at review |
| `minor (deferred)` / `parked` | annotation only, never terminal | keep reading backwards for the real state, and treat it as `started` if none follows |

Only `complete` and `BLOCKED` end a task. A ledger whose identity line names a
different task, or a sibling directory, belongs to another run — leave it alone
and start your own.

Nothing leaves the loop silently: findings that are not fixed are deferred,
parked with a ruling, or BLOCKED — always as a ledger line.

Note that `git clean -fdx` will destroy `agent-working/` since it is ignored
scratch; if that happens, recover from `git log`. Delete the run's directory once
the final review is clean and its residuals are adjudicated — git history is the
record from then on.

## Model Selection

Use the least capable tier that can do the job. **Always name the model
explicitly** — omitting it inherits the session model, usually the most
expensive one.

Tiers are the same three everywhere; only the models filling them change, and
they change by *provider*, not by host:

| Tier | Agent | Anthropic | GPT | Use for |
|------|-------|-----------|-----|---------|
| Fast | Fast Coding Agent | `haiku` @ high | `gpt-5.6-luna` @ xhigh | 1-2 files, complete spec, transcription, build-error fixes |
| Standard | Coding Agent | `sonnet` @ high | `gpt-5.6-terra` @ high | multi-file integration, pattern matching, debugging |
| Deep | Complex Coding Agent | `opus` @ high | `gpt-5.6-sol` @ medium | architecture, design judgment, broad codebase reasoning |

**Effort runs inverse to tier on the GPT column, and that is deliberate** — a
smaller model thinking longer beats a larger one thinking less at comparable
cost, so the tier is bought partly in reasoning rather than entirely in model
size. The Anthropic column is flat high because that is simply the default worth
using, not a tuning result.

Effort is a *dispatch-time* argument, so it applies only where the host exposes
one. Copilot CLI does, for both columns — pass it alongside the model. Claude
Code has no per-subagent effort field, so there is nothing to pass and the tier
does all the work. Do not substitute prompt incantations for the missing knob.

### Picking the column

**Claude Code runs Anthropic models only**, so the column is decided for you and
the agents' frontmatter already pins the alias, which Claude Code honors.

**Copilot CLI can run either**, and it ignores that frontmatter — it routes
delegated subagents to the session model, so naming the model **at dispatch
time** is the only thing that selects a tier. Infer the column from the session
model (`claude-*` → Anthropic, `gpt-*` → GPT), state which one you inferred, and
give the user one chance to override before the first dispatch. Then record it
in the ledger and never ask again. The line is `# models: <provider>
(inferred|confirmed)` — one provider, one qualifier:

```
# ledger — task: <task description or plan file path>
# models: gpt (confirmed)
```

A run that resumes after compaction reads the column off that line rather than
re-asking. If the line is missing on resume, re-infer and append it — do not
interrupt a run in progress to ask.

**Turn count beats token price.** The cheapest tier routinely takes 2-3× the
turns on multi-step work, costing more overall. Standard is the *floor* for
reviewers and for implementers working from prose. Drop to Fast only when the
task text contains the code to write, or the change is a single-file mechanical fix.

**Reviews** scale to the diff's risk, not to a fixed tier: small mechanical
diff → Fast/Standard; subtle concurrency or security change → Deep. The final
whole-branch review is always Deep.

**Who reviews.** Prefer a dedicated reviewer if one is installed —
`pr-review-toolkit:code-reviewer` for general quality, or
`review:well-architected-agent` for architectural risk. Both live in other
plugins, so neither is guaranteed present. If neither is available, dispatch a
general-purpose subagent at the tier above and give it the review brief
explicitly: the diff, the task's requirements, and an instruction to return a
spec-compliance verdict and a quality verdict separately. Never let the
implementer review its own work.

## Iteration Loop

Run per sub-task. Record `BASE = git rev-parse HEAD` and write the task's
`started (base <BASE>)` ledger line before dispatching — step 4 needs `BASE`, and
the ledger is the only place it survives.

1. **Implement** — dispatch one implementer (never two in parallel on the same
   files). Give it: where the task fits, its requirements, interfaces from
   earlier tasks it can't know, and your resolution of any ambiguity. Require it
   to end its report with exactly one status line — `DONE`,
   `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED`. The agents do not emit
   these on their own; you get the contract only by asking for it in the
   dispatch. If a report comes back without one, treat it as
   `DONE_WITH_CONCERNS` and read it closely rather than guessing.
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
   - Rounds 4-5: fresh implementer, **one tier up**, told what was already tried.
     Already at Deep? Keep the tier and dispatch a fresh implementer with a clean
     context and an explicit account of what has been tried and ruled out — a
     fresh context is the variable you have left.
   - At the cap: adjudicate each open finding — park it with a written ruling,
     or STOP and report BLOCKED if it's load-bearing. Silent discards forbidden.
6. **Record & next** — append the round and completion lines to the ledger in
   the same message as your other bookkeeping, then move on. Don't pause to ask
   "should I continue?" — execute the plan.

Spawn independent sub-tasks in parallel when they touch disjoint files.

## Final Review

After all sub-tasks: one whole-branch review on the **Deep** tier over
`$(git merge-base <base-branch> HEAD)..HEAD`, where `<base-branch>` is the branch
this work targets (usually `main`). Hand it the ledger path along with the diff
and tell it to triage the `minor (deferred)` and `parked` lines — which must be
fixed before merge, which stand. A roll-up nobody reads is a silent discard.

If it returns findings, dispatch **one** fix agent with the complete list — not
one fixer per finding — then one scoped re-review of that fix diff. Adjudicate
any residuals as above, then delete `./agent-working/<task-slug>/`. If no other
run is in flight, remove `./agent-working/` entirely — its `.gitignore` is
invisible to `git status` and will otherwise accumulate unnoticed.
