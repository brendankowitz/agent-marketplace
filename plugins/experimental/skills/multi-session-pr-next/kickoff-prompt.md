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

Fill in the bracketed values. Keep exactly one of the three scope lines and
exactly one of the two merge options. Leave the stack unspecified to get the
one-time choice at startup; for unattended runs, say “use the recommended
stack” or name the stages to override.

```text
Use the multi-session-pr-next skill. You are the parent session.

Fix GitHub issue [#N] in [owner/repo] using local child sessions.
Outcome and constraints: [observable result; non-goals, priorities or limits not in the issue].
Own staffing, review routing and engineering decisions within those bounds.
Use at most [4] concurrent children. Confirm the recommended dev stack or my
overrides once at startup (§2b); don't ask me to dispatch people or choose each tool.

New PR: this session's branch is the PR head. Open it as a draft after the first integration.
Existing PR [#M]: this session is on its branch.
Project: break the work into reviewable PRs.

[You may merge a PR that meets Done. / Do not merge.]
Park finished sessions unless I explicitly opt into archival after Done.
Escalate decisions that change my outcome, risk or authority with a recommendation.
Keep going until Done, then show evidence for each acceptance criterion at the published head.
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
Clear it at Done.

```text
multi-session-pr-next check-in for issue [#N] in [owner/repo]. Re-read
./agent-working/multi-session-[N]/ledger.md, run get_sessions_status for the
roster, and run the skill's parent loop (§7). If nothing is actionable, end
the turn.
```
