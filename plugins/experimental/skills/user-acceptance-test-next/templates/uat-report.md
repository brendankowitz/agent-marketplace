## User acceptance test: <PR title> (#<number>)

**Result:** <n> PASS · <n> FAIL · <n> BLOCKED · <n> NOT RUN
**Tested:** <head commit sha> on <environment: URL or "local build of the PR branch"> at <UTC time>
**Recorded by:** an AI agent using the `user-acceptance-test` skill; every verdict comes from the run shown in the video.

<video: attach the MP4 here; GitHub needs the bare asset URL on its own line>

### Criteria

| ID | Criterion | Source | Verdict | Evidence | Video |
|---|---|---|---|---|---|
| AC1 | <observable statement> | quoted from <where> | PASS | `PUT /Patient/…` → 201, `id.length = 64` | 0:05 |
| AC2 | <observable statement> | inferred from diff, confirmed by <user> | FAIL | expected 400, got 500 | 0:15 |

### Failures and blockers

- **AC2:** <what was expected, what happened, the exact request/response or log excerpt, and how to reproduce it>.
- **AC4 (blocked):** <what prevented verification and what would unblock it>.

### Not covered

<criteria deliberately left out, and why; anything only checked by reading code rather than running it>

<details><summary>How this was run</summary>

- Environment and data: <URL / local build command; synthetic data created and cleaned up>
- Commands: the tapes and scripts in `<working dir>` reproduce every step.

</details>
