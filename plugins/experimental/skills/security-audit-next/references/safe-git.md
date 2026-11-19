# Safe Git (part of Step 0)

Part of Step 0 of `../SKILL.md`. It applies to every Git command in a run, by the parent or
an agent, in every mode. "The guard" is the `./agent-working/.gitignore` check in Step 0.

Start every Git command, parent or agent, including examples, with `git --no-pager`
followed by `-c core.hooksPath="<hooks>" -c core.fsmonitor=false -c log.showSignature=false`.
Choose `<hooks>` before the first Git command, including the first `rev-parse` of Step 0: an absolute
path in the OS temp directory with a random name that does not exist. Never create it; a
missing hooks directory runs no hooks. Pass this exact prefix with the resolved hooks path
in every dispatch, including retries. Every `-c` option, including the filter overrides
below, goes before the subcommand (`git --no-pager -c ... status --short`); after the
subcommand Git reads it as something else. Use the command-specific flags in the evidence
bar; agents are limited to its commit-only reads.

Before `worktree add`, list the effective drivers. Do the same before `apply`, `status`,
working-tree diffs or `worktree remove` for a worktree the parent created. Query with
`git config --get-regexp '^filter\.'`. Exit 1 with no output means none; on any other
failure stop and ask. For each driver pass `-c filter.<name>.smudge=` and
`-c filter.<name>.process= -c filter.<name>.clean= -c filter.<name>.required=false` for
that command only; never change stored config. Record in `scope.md` that filtered files
were not materialised in those worktrees (LFS pointers stay pointers); list any needed
under "Not examined". Use the same overrides for `status` in the invoking checkout, since
a configured driver can run a script from the audited tree. No output means clean. If
every entry is an unstaged modification (` M`) of a path whose `filter` attribute
(`git check-attr filter -- <path>`) names an overridden driver, the overrides may be the
only cause, so do not audit that checkout: continue in a detached worktree at the target
commit (`HEAD` for a path or whole-repository audit), record that worktree in `scope.md`
as the audited source with a clean status, and list the reported paths under "Not examined"
as working-tree state not compared. Any other entry means the checkout is dirty.

Apart from the GitHub PR metadata and diff retrieval the parent owns, the only Git fetch allowed is
for objects needed to resolve the requested PR, branch or advisory commit: for example
`git fetch <remote> pull/<N>/head`, `git fetch <remote> <branch>`, or
`git fetch <remote> <exact-commit>`. Do not fetch other refs, source archives or
dependencies. If the required remote or ref is unclear, or fetch fails, stop and ask the
user; do not audit another commit instead.
