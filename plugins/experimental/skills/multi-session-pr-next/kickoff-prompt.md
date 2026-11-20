# Kickoff prompts

Three prompts:

1. **Parent kickoff.** The human pastes it into the parent session.
2. **Child kickoff.** The parent fills it in for each `create_session` call.
3. **Check-in.** The parent schedules it with `save_session_automation`.

## 1. Parent kickoff

Start the parent in a project session on the repository:
- For a new PR, use a new worktree session. Its branch becomes the PR head.
- For a project, use a new worktree session for the parent. Each author child's
  branch becomes its own PR head.
- For an existing PR, use that PR's session (`open_pr_session`).

Fill in the delivery contract and bracketed values. Delivery mode and execution
shape are separate; one parent PR is the default execution shape. `Project` and
`ship` do not select a delivery mode. Ask once
at startup if the mode is missing; an unattended run with no mode defaults to
`feature-pr`, and one with no authority defaults to `hold`. Derive the target
and completion check from the human's brief or verified PR/repository metadata;
if either remains missing or ambiguous, ask before target-dependent work. For
the stack, say “ask me once at startup” or leave it unspecified; an unattended
run uses the recommended stack (§2b).

Authority (§2c) is one preset, which you can edit.

| Preset | The parent may |
|---|---|
| `hold` | Publish the draft PR. The human marks it ready, requests reviewers and merges; sessions stay parked. |
| `deliver` | `hold` plus mark ready, request and remind the reviewers you name, and archive eligible finished child sessions (§10). The human merges product-outcome deliverables or feature-pr components. |
| `ship` | `deliver` plus merge eligible PRs allowed by the selected delivery mode, once their merge gates pass. |

`product-outcome` requires `ship` for the parent to merge its PRs. In
`feature-pr`, `ship` can merge internal component PRs to the feature branch but
never the final feature PR. That PR is handed to the human for review.

```text
Use the multi-session-pr-next skill. You are the parent session.

Fix GitHub issue [#N] in [owner/repo] using local child sessions.
Delivery mode: [feature-pr | product-outcome].
Outcome: [observable result].
Repository and target branch: [owner/repo, verified target branch].
Boundaries: [non-goals, priorities, and limits not in the issue].
Completion evidence: [observable acceptance checks on the final PR or target].
Own staffing, review routing and engineering decisions within those bounds.
Use at most [4] concurrent children.
Stack: [ask me once at startup | use the recommended stack | overrides: ...] (§2b);
don't ask me to dispatch people or choose each tool.

Execution shape: [one parent PR (default) | project of component/deliverable PRs].
Starting session: [new PR on this branch | existing PR #M | new project parent].

Authority: [hold | deliver | ship]. Reviewers to request: [@user or org/team, or none].
Overrides: [none, or e.g. "squash-merge", "no archive"].
Escalate decisions that change my outcome, risk or authority with a recommendation.
Keep going until Done and act within that authority, then show evidence for each
acceptance criterion at the published head.
```

## 2. Child kickoff (filled in by the parent)

Fill in every slot. Add only facts the skill cannot derive: its rules, ledger
path, runner slug and commit trailer come from the name, and `WORK`, `REVIEW`
and `FINAL` carry their own SHAs.

```text
Use the multi-session-pr-next skill. You are child session [Name]; your parent
session is [parent session id].

The human's request (verbatim):
> [quote]

Issue [#N] in [owner/repo]. Scope: [one PR, or this project PR]. PR [key] targets [branch].

Your assignment: [implementation task or review target]
You own: [paths, or "none: review-only"]. Send the parent CHANGE before touching anything else.

| # | task | owner | depends on |
|---|---|---|---|
[rows]

Decided: [interfaces, out-of-scope items, the human's decisions]
Acceptance: [criteria this assignment covers and expected evidence]
Your tests: [test projects or filters to run before each READY]
Stack: [agreed stages, tools and runner model column applicable to this assignment; required or optional; integration or FINAL gate]
Local resources: [distinct port / database / temp names, or "none"]

Start with: [WORK task# pr=key sync=sha, or REVIEW review-id pr=key author=name base...sha kind=<partner or stage> rerun=tests]
```

## 3. Check-in prompt

Schedule this in the parent with `save_session_automation`:
- `interval: "minutes"`
- `every_minutes: 30`

It is a safety net under the wake-ups from messages and idle notifications.
Clear it once the scope is Done and nothing granted is left to wait for (§10).

```text
multi-session-pr-next check-in for issue [#N] in [owner/repo]. Re-read
./agent-working/multi-session-[N]/ledger.md, run get_sessions_status for the
roster, and run the skill's parent loop (§7), or its §10 step 4 once the
scope is Done. If nothing is actionable, end the turn.
```
