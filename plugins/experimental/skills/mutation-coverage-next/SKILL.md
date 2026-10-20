---
name: mutation-coverage-next
description: Use Stryker.NET mutation testing to curate a .NET (C#) test suite to "just enough" coverage - close surviving-mutant gaps, document equivalent mutants, and prune tests that kill no mutants or only duplicate other tests' kills. Use when asked to run Stryker or mutation testing, improve a mutation score, investigate surviving mutants, or check whether a .NET test suite has redundant tests. Not for plain line-coverage requests or non-.NET projects.
---

> **Experimental.** New in the `experimental` plugin; it may change or disappear without
> notice. There is no stable counterpart yet.

# Mutation Coverage

Mutation testing changes production code one small edit at a time (a "mutant") and runs the
tests. A mutant the tests catch is **killed**; one they miss **survived**. Survivors point at
missing assertions or branches. Tests that kill nothing, or whose kills another test already
covers, add runtime without adding protection.

The goal is **just enough** tests: every behaviorally meaningful mutant killed, with as few
overlapping tests as possible. Mutation score is a means, not the target.

**Prerequisites:** the .NET SDK, PowerShell 7+ (`pwsh`; the scripts do not run on Windows
PowerShell 5.1), and git if you use `--since`.

**Script paths.** `scripts/...` below is relative to this skill's directory. Step 2 changes
directory into the test project, so resolve this skill's absolute directory once and call the
scripts as `pwsh <skill-dir>/scripts/...`.

**Script exit codes.** `Get-MutationSummary.ps1` exits 0 (summary printed), 1 (kills lost versus
the baseline: a verdict), or 2 (the report is missing, empty, malformed or unusable: **not** a
verdict; read the message, fix the run, and try again). A section marked `UNAVAILABLE` means the
data cannot support it; do not act on it.

## 0. Check the repository is set up

Before the first run, verify each item independently. Fix only what is missing, and ask before
changing anything the user would not expect.

| Check | Where to look | If missing |
|---|---|---|
| Tool pinned | `.config/dotnet-tools.json` lists `dotnet-stryker` | Profile step P4 |
| Output ignored | `.gitignore` contains `StrykerOutput/` | Profile step P4 |
| Profile present | `## Mutation Testing` section in the agent instructions | Profile steps P1-P5 |
| Profile current | Every `-p` target and test project it names still exists | Fix the profile (P1) |
| Contributor docs | `CONTRIBUTING.md`, if the repo has one, mentions `dotnet tool restore` and a manual `dotnet stryker` example | Offer a short section; do not add it unasked |

When every applicable row is satisfied, follow the profile and continue at section 1
(Choose the smallest scope).

### Load or create the repository profile

Repository-specific facts live in the repository's agent instructions, not in this skill. Look
for a `## Mutation Testing` section in `AGENTS.md` (or, if the repository has no `AGENTS.md`, in
`CLAUDE.md` or `.github/copilot-instructions.md`). If it exists, use it and finish any other
missing checks above. If it does not, create it before mutation testing:

- **P1. Find targets.** Run `pwsh <skill-dir>/scripts/Get-MutationTargets.ps1 -Root <repo root> | Format-List`.
  It lists each test project with a suggested production project (`Target`), how it was chosen
  (`Match`), and all `Candidates`. Only `exact` is trustworthy; confirm `sole-reference`,
  `prefix` and `none` by reading the test code. It can miss projects that get their test
  settings only from `Directory.Build.props`, and it warns about projects named like tests that
  it skipped; add those by hand. Mark projects that are E2E, integration, container, or network
  dependent as excluded.
- **P2. Find conventions.** Read existing agent instructions, `CONTRIBUTING.md`, and a few test
  files to learn the test framework, assertion and mocking libraries, naming and structure
  conventions, and setup steps (submodules, fixtures, services).
- **P3. Find protected tests.** Search for tests that must survive regardless of kill data:
  regression tests (names or comments citing issues/bugs), version- or platform-specific
  variants, tests that enumerate types or fixtures and fail when a new one is unclassified
  (reflection scans, "every corpus row must compile" checks), architecture/guard tests, and
  security or multi-tenant boundary tests. Record them by name or pattern.
- **P4. Ensure the tool and ignore rule.** If `.config/dotnet-tools.json` does not pin
  `dotnet-stryker`, ask before running `dotnet new tool-manifest` (if needed) and
  `dotnet tool install dotnet-stryker`. If `.gitignore` lacks `StrykerOutput/`, add it. Each is
  independent: a repository may have the tool but not the ignore rule, or the reverse.
- **P5. Write the section** using the template below, show it to the user, and continue once they
  accept it. Keep it short; it is read on every run.

```markdown
## Mutation Testing

Use the mutation-coverage skill (published as `mutation-coverage-next` while experimental) if it
is installed; otherwise follow this section by hand. Run Stryker from the test project directory
with `dotnet stryker -p <Target> -r json -r html -r dots --disable-bail`.

| Test project | `-p` target | Notes |
|---|---|---|
| `tests/Foo.Tests` | `Foo.csproj` | |
| `tests/Foo.E2E.Tests` | excluded | needs a running server |

- Setup: <steps such as `git submodule update --init --recursive`, or "none">.
- Test conventions: <framework, assertion/mocking libraries, naming pattern>.
- Never remove: <protected tests by name or pattern, with one-line reasons>.
```

When later runs teach something durable (a new exclusion, a slow project, a protected test),
update this section rather than this skill.

## 1. Choose the smallest scope

Full-project runs can take tens of minutes. Always scope unless the user asked for a
whole-project cleanup. Pruning needs a separate whole-project run (section 5).

| Situation | Scope flags |
|---|---|
| Code changed on this branch | `--since:origin/<base branch>` (a fresh clone or CI checkout may have no local base branch) |
| Specific files | `-m "**/Path/File.cs"` (repeatable) |
| Specific spans | `-m "**/File.cs{start..end}"`; `start` and `end` are **character offsets** into the file, not line numbers |
| Whole-project curation | no filter |

If several test projects exercise one production project, per-test-project runs hide
redundancy between them. Stryker needs a run from the production project directory with
`test-projects` in a config file for that; say so to the user rather than guessing.

## 2. Run Stryker with the full kill matrix

```powershell
cd <test project directory>
Remove-Item -Recurse -Force <repo root>/StrykerOutput/<label>-before -ErrorAction SilentlyContinue
dotnet stryker -p <Target> -r json -r html -r dots --disable-bail <scope flags> -O <repo root>/StrykerOutput/<label>-before *>&1 | Tee-Object <repo root>/StrykerOutput/<label>-before.log
```

- Clear the output directory first and check the run finished: if Stryker fails (red initial
  tests, wrong `-p`, bad `--since` base), an old report may still be sitting there. Stop if
  `reports/mutation-report.json` is missing or `$LASTEXITCODE` is non-zero. The summary prints the
  report's write time; make sure it is from this run.
- `-p` is the production project **file name** (not a path) from the profile.
- `-r json` is required; the summary script reads `reports/mutation-report.json`.
- `--disable-bail` is required: without it Stryker records only the first test that kills each
  mutant, which makes redundancy analysis meaningless.
- Keep the log. Search it for `safe mode` before trusting a clean result (see Troubleshooting).

## 3. Summarize the report

```powershell
pwsh <skill-dir>/scripts/Get-MutationSummary.ps1 -ReportPath <output>/reports/mutation-report.json
```

The summary prints status counts and the score (killed / tested; `Timeout` counts as killed;
`Ignored`, `CompileError`, `RuntimeError` and `Pending` are excluded), then each **Survived** and
**NoCoverage** mutant with its source line, then **tests that killed no mutants**, then **tests
whose kills are all covered by another test**. It marks the run `PARTIAL` for `-m` and `--since`
runs, and withholds the two test sections (`UNAVAILABLE`) when the run was partial, when no test
names are in the report, or when the kill data looks like it came from a bail-mode run.

## 4. Close the gaps

For each survivor or uncovered mutant, decide which it is:

- **Missing behavior check**: add or strengthen a test that would fail with the mutation.
  Prefer extending an existing test's data rows or assertions over adding a new test. Follow
  the profile's test conventions and assert on public behavior, not on the mutated line.
- **Equivalent mutant**: the mutation cannot change observable behavior (an unreachable
  boundary, a log or exception message string, a branch already guaranteed by types). Do not
  write a test for it. Record why with a Stryker comment so later runs skip it:

  ```csharp
  // Stryker disable once Equality : value is clamped to [0, 28] by the only caller
  ```

  Every such comment hides a survivor from the next report, so list each one with its reason in
  the final report, and ask the user before adding more than a handful.
- **Dead code**: if no caller can reach the branch, tell the user; removing production code is
  outside this skill unless they ask.

Never add a test whose only purpose is to execute a line without asserting a result.

## 5. Prune redundant tests

Removal candidates come from the summary's last two sections. If the run was `PARTIAL`, they
are `UNAVAILABLE`: do a whole-project run first (with its own `-before` directory), or stop and
tell the user pruning is not possible from this run. Before removing anything:

- **Only trust whole-scope results.** A test that kills nothing in a `-m` or `--since` run may
  kill mutants elsewhere. Confirm with a run whose scope covers everything the test exercises,
  normally the whole target project.
- **Check what the test is for.** Stryker mutates one production project. A test aimed at a
  different project, a test helper, fixture integrity, or round-trips against vendored data
  will show zero kills and may still be essential.
- **Parameterized tests are judged per method.** Depending on the runner, Stryker reports a
  `[Theory]` (or NUnit `[TestCase]` set) as one test or as one test per data row. The summary
  script merges rows into their method, so redundancy between rows is invisible; prune rows
  only by reasoning about the inputs, and remove whole methods only when the script flags them.
- **Identical tests are listed once.** When two tests kill exactly the same mutants, only the
  one sorting later is flagged as covered by the other. Do not remove the covering test too.
- **Prefer merging over deleting.** Fold a redundant test's unique assertions into the test that
  covers it, then remove it.
- **Respect the profile's never-remove list**, and by default never remove regression,
  version-specific, tripwire/census, architecture-guard, or security/tenancy tests.

Unless the user explicitly asked for a cleanup pass, list removal candidates with your reasoning
and let them decide instead of deleting.

## 6. Prove nothing was lost

After pruning, re-run the **same scope** and compare against the before report:

```powershell
Remove-Item -Recurse -Force <repo root>/StrykerOutput/<label>-after -ErrorAction SilentlyContinue
dotnet stryker -p <Target> -r json -r html -r dots --disable-bail <same scope flags> -O <repo root>/StrykerOutput/<label>-after *>&1 | Tee-Object <repo root>/StrykerOutput/<label>-after.log
pwsh <skill-dir>/scripts/Get-MutationSummary.ps1 `
    -ReportPath <repo root>/StrykerOutput/<label>-after/reports/mutation-report.json `
    -BaselinePath <repo root>/StrykerOutput/<label>-before/reports/mutation-report.json
```

Exit 1 lists every mutant the baseline killed that is no longer killed, with its baseline and
current status. Restore or rewrite tests until that list is empty. An entry that was `Timeout`,
or sits on a loop condition, can be noise: re-run the after pass once before restoring tests.
Exit 2 is an unusable report or baseline, not a pass; "None." appears only on exit 0.

The comparison matches mutants by file, line, column, and mutation, so **production source must
be identical between the two runs**. Do the prune-and-verify pass with test-only changes, and
make Stryker disable comments or production edits in a separate pass with its own baseline.

## 7. Finish

- Run the touched test project's tests; they must pass.
- Report to the user: scope, before/after mutation score, tests added, tests removed or merged
  (each with the covering test), equivalent mutants recorded (each with its reason), and
  anything unresolved, including methods Stryker rolled back in safe mode.
- Do not commit unless the user asked you to.

## Troubleshooting

- **Many `CompileError` mutants**: expected for some code shapes; they do not affect the score.
  But when the run log reports a method rolled back in **safe mode** (for example CS0165 on
  pattern variables), Stryker drops every mutant in that method, so gaps there are invisible and
  the survivor list looks cleaner than it is. Search the log from step 2 for `safe mode` and
  list those methods to the user as untested by mutation rather than treating them as covered.
- **`Timeout` mutants**: usually mutated loop conditions; they count as killed. Timeout counts
  can vary slightly between runs.
- **Static initializers**: with the default `perTest` coverage, mutants in static constructors
  run against all tests. If kill data there looks wrong, re-run with a config file setting
  `coverage-analysis` to `perTestInIsolation`. In `stryker-config.json` the key sits inside the
  `"stryker-config"` object. Apply the same file to both the before and after runs, since it
  changes every later result, or pass it with `-f <path>` for this investigation only.
- **Microsoft Testing Platform**: pass `--test-runner mtp` only for projects that actually run
  on MTP (MSTest.Sdk, TUnit, xUnit v3 without the VSTest adapter); it is a preview runner, and
  xUnit v3 can still run under VSTest. Some options, such as `--test-case-filter`, are not
  available with the xUnit v3 and TUnit MTP runners.
- **Slow runs**: narrow `-m`, or raise concurrency with `-c <n>`.
