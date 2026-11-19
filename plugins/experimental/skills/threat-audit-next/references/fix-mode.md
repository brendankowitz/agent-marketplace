# Fix mode

The `fix` mode of `../SKILL.md`. Step numbers refer to that file; its Rules and Steps 0 and
1, including `safe-git.md`, apply here.

Resolve the scope as in Step 1 with slug `fix-<candidate-id>`. If the finding has no
candidate ID from a hunt or `validate` run, stop and ask. For a new advisory, the user
can run `validate` first to assign a candidate ID and record the audited commit. Strip
`-C<nnn>` from the candidate ID to get `<run-id>`, then locate the originating run at
`./agent-working/threat-audit-*/<run-id>/`. Stop and ask if no run directory matches,
the audited tree was dirty, or the run's `scope.md` records no audited `HEAD`. Read the
candidate's final disposition in that run's `candidate-ledger.md`. Continue only if it is
`confirmed`. If it is `rejected`, stop and say so. For `needs_validation`, stop and point
the user to the missing fact and safe check in the local record. Suggest a new `validate`
run only if the user can now record the deployment shape that decides the finding. For
`Not examined`, stop and suggest running `validate` first. Use the recorded `HEAD` as the
source commit. A supplied PR, branch or diff identifies the patch, not the source commit.
In the new `scope.md`, record the clean source root, source commit, full finding record,
originating run directory and, for a check, the patch's origin.

**Propose** (finding only). The verified record already carries a fix line. Expand it into
`fix-<candidate-id>.md`; the candidate ID includes its originating run ID, so the proposal
ID remains unique across runs. Include the invariant in one sentence, the last trusted
decision point where it should be enforced, the smallest change there, every sibling path
that reaches the same sink (search the recorded source root at that commit; cite `file:line`),
and one regression test for the reported path and one per sibling. This skill does not edit
the target. Hand the proposal to whoever implements it, for example `implement-task`.

Each fix check is one review round in its own run. Never check a second patch in the same
run. The first check is round 1; for a revised patch, use the next round number in a new
run with `prior-run <run directory>` pointing to the previous round. Confirm that its
source commit and finding match; otherwise stop and ask. Keep the finding's original
ledger ID. Add the prior round number and every path left open or not examined to the new
`scope.md`. Give the reviewer the prior run's accepted review result; never edit that run.

**Check** (finding plus patch). For a PR or branch, use the Step 0 flags with
`git diff --binary <recorded source commit> <patch head>` to generate `fix.patch`;
otherwise save the supplied patch as `fix.patch`. Create an isolated detached worktree at
the exact source commit. The parent applies the patch with `git apply` only in that worktree,
without modifying the target checkout. If the patch does not apply cleanly, stop and ask;
do not review a partially patched tree. Dispatch one fresh agent that has not seen the
prior hunt or proposal rationale; it does receive the verified finding and sibling paths
to examine. If there is no proposal, pass `none` for proposed sibling paths and require
the reviewer to derive variants from the finding and source:

```
Follow <skill-dir>/prompts/fix-reviewer.md.
Safe Git prefix: <exact Step 0 prefix with the absolute hooks path>
Finding: <path to the verified record or advisory>
Scope: <current run directory>/scope.md
Source: <source root> at <commit>
Fix: <current run directory>/fix.patch, applied in <patched worktree>
Sibling paths proposed: <the proposal's enumerated sibling paths, or "none">
Review round: <round number>
Prior round: <path to the prior run's accepted fix-review result, or "none">
Write your result to <current run directory>/fix-review-<round>.md and reply with its path.
```

Apply the Step 0 result-validation rule. Use exactly one verdict. `closes` means the
reported path, all proposed, discovered or verified siblings, and all prior-round paths
carried as open or not examined are blocked, no relevant path is unexamined, and a test
would catch a revert. `partial` requires a blocked reported path and at least one gap:
another relevant path is open or unexamined, or no test would catch a revert.
`does not close` means the reported path remains open.
Use `inconclusive` when the reported path was traced up to one fact outside the source,
such as a dependency's behaviour, that decides whether it is blocked. Name the fact and
how the owner can check it safely with dummy data and no live or shared system. Do not
use this verdict if reading more of the source would settle the question.
If the reviewer left the reported path not examined, treat the review as a failed
fix-review assignment (`Not examined`) whatever its verdict.

Check the reviewer's "Proposal paths" against the proposal and "Prior-round paths" against
the prior result. Compare both lists with "Variants" and account for each path. Keep each
round's `fix-review-<round>.md` in its own run directory. In the current run's `report.md`,
write the verdict and each path's outcome, including paths carried over from the prior
round. Mark paths blocked, still open or not examined. Keep the reported path's original
ID; if its outcome is `inconclusive`, record that instead, with the missing fact and safe
check. Tell the user the verdict and report path. In this run's `candidate-ledger.md`,
give each other open or unexamined path its own ID with disposition `Not examined` until
a fresh verifier decides it.

After review, compare `git -C <patched-worktree> diff --binary` with `fix.patch`; it must
contain only the supplied hunks. Check the patched worktree with
`git -C <patched-worktree> status --short --ignored --untracked-files=all`. It must
succeed and show no staged changes. Every untracked or ignored file must match a patch
addition in both path and content. Only then may the parent run
`git worktree remove --force <exact patched-worktree path>`. Force removal is allowed only
for this parent-created patched worktree. Remove clean source worktrees without `--force`;
if any unexpected change or file exists, stop and report the path instead of removing it.
