# Terminal evidence: helpers and VHS tapes

For criteria whose proof is a command and its output: HTTP APIs, emitted logs, CLI
behavior, config, documentation diffs, focused test runs. `<skill-dir>` is this skill's
directory (see SKILL.md).

The **Helpers** section applies to both surfaces: workbench cells (`workbench/README.md`,
the default) and VHS tapes (the rest of this file, for a plain terminal look). In a workbench
notebook, call the scripts directly (`node <skill-dir>/scripts/http-step.mjs ...`) with
`--evidence evidence`; `uat-http` / `uat-log` are the shell functions the VHS setup defines.

## Tools

```text
vhs --version      # https://github.com/charmbracelet/vhs
ttyd --version     # VHS needs it on PATH
ffmpeg -version
node --version     # 18+
```

Do not install anything without asking. If the user agrees:

| OS | Install |
|---|---|
| Windows | `winget install --id charmbracelet.vhs --exact`, `winget install --id tsl0922.ttyd --exact`, `winget install --id Gyan.FFmpeg --exact` |
| macOS | `brew install vhs` (pulls in ttyd and ffmpeg) |
| Linux | VHS release binary or `go install github.com/charmbracelet/vhs@latest`, plus `ttyd` and `ffmpeg` from the distro |

After installing on Windows, refresh PATH in the running shell:
`$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`.

If the user declines, offer the browser path for criteria that have a UI, or stop and ask
how to proceed. Do not substitute screenshots of output you ran outside the recording.

## Setup files

Copy into the working directory:

- `<skill-dir>/templates/uat-env.ps1` (Windows, `Set Shell "pwsh"`) or `uat-env.sh`
  (macOS/Linux, `Set Shell "bash"`). Replace `__SKILL_DIR__` and `__BASE_URL__`. It defines
  `uat-http` and `uat-log`, sets a short prompt, disables history, and prints `UAT_ENV_READY`.
- `<skill-dir>/templates/evidence.tape`: one tape per criterion (`clips/AC1.mp4`, …) so each
  becomes its own chapter.

Run a smoke tape with one trivial scene before contacting the service, to prove VHS, the
shell and the font work.

## Helpers

### `uat-http` (`scripts/http-step.mjs`)

Sends a real request and prints method, URL, request headers (secrets redacted), body,
status with timing, chosen response headers, and the body or selected fields. Then it
asserts and ends with `UAT_STEP <step> PASS|FAIL|ERROR`.

```text
uat-http --step AC2 --method PUT --url "$base/Patient/$id65" \
  --header "Content-Type: application/fhir+json" --body '@patient.json' \
  --bearer-env UAT_TOKEN --expect-status 400 \
  --expect-body "64" --expect-json "issue[0].severity=error" --show-header x-request-id
```

- `--expect-json <path><op><value>` checks JSON values; `op` is `=`, `!=`, `>`, `>=`, `<`, `<=`
  or `~=` (regex). `length` works on strings and arrays (`id.length=64`). Display full critical
  IDs and assert their exact length; similar-looking text is not verification.
- Paths support array filters, which cover FHIR `Parameters` and `Bundle.link`:
  `parameter[name=status].valueString=Completed`, `link[relation=next].url~=ct=`.
- `--save <path>=<file>` stores a value for a later step, and `@file` reads it back as a URL
  (`--url @next-page.txt`) or an expected value (`entry[0].resource.id!=@page1-id.txt`).
- `--reject-body <text>` asserts the body does **not** contain something: an echoed input,
  a secret, a stack trace.
- `--select a,b.c` prints only those fields and labels them "selected response fields".
  Use it for large bodies so the important part stays on screen.
- `--poll <seconds>` re-sends until every assertion passes or time runs out (async APIs:
  `$export`, `$reindex`, long-running operations), showing each attempt and what it is still
  waiting for on one line.
- Request headers are shown with their names exactly as sent (that is also how they go on
  the wire). Values over 100 characters are shortened on screen (`aaaa… ‹2049 chars›`);
  the evidence JSON keeps them whole.
- `--evidence evidence` (set by `uat-env`) saves the redacted exchange as JSON for the report.
- At least one `--expect-*` is required: a step without an assertion cannot give a verdict.
  For a supporting request that only shows state (for example a GET before the change),
  pass `--no-assert`; it ends with `UAT_STEP <step> SHOWN`, so wait on
  `/UAT_STEP <step> (SHOWN|ERROR)/` and never count it as a verdict.
- Exit codes: 0 pass (or SHOWN); 1 an assertion failed, or the request was sent but no
  complete response came back (timeout, connection reset), which is a product FAIL; 2 usage
  error or could not connect (ERROR: fix the step or environment).

### `uat-log` (`scripts/log-step.mjs`)

Remembers where a log file ends, runs the action given after `--run`, then shows only the
new lines matching a pattern and asserts how many appeared.

```text
uat-log --step AC3 --file app.log --pattern "OrderCreated id=" --run node $UatHttp --evidence evidence --step AC3-request --method POST --url "$base/api/orders" --body '@order.json' --expect-status 201
```

(bash: `node "$UAT_HTTP"`.)

- `--expect-count 0` proves something is **not** logged (secrets, PII). Only `>=N` stops as
  soon as enough lines appear; an exact `N`, `<=N` and `0` wait the full `--timeout` so a
  late duplicate still counts. `uat-env` passes `--evidence evidence`, which saves the
  matched lines and verdict as `<step>-<n>.log.json`.
- Everything after `--run` is the action. It runs without a shell, so pass an executable
  (`node`, `pwsh`, `curl`, `dotnet`). `uat-http` is a shell function, so use `node $UatHttp`
  there, as above. Use `--run` rather than a bare `--`: PowerShell drops `--` when it passes
  arguments through a function such as `uat-log`. If the action exits 2 (a helper's "step is
  broken" code), the log step reports ERROR, not FAIL.
- `--show 'AUDIT:'` also displays (dimmed, uncounted) related new lines. Use it whenever a
  check might fail, so the video shows what *was* logged, not just "no matching lines".
- When the action is several typed commands, record the starting point in the hidden setup
  with `uat-log --mark ac6.mark --file app.log`, and check later with `--since ac6.mark`.
- Long log lines are shortened on screen past `--max-line` characters (default 400); the
  evidence keeps them whole.
- Logs must land in a file. When launching locally, redirect the app's output
  (`dotnet run > app.log 2>&1`, `npm start > app.log 2>&1`). For containers, stream them in
  the hidden setup: `docker logs -f <container> > app.log 2>&1 &` (bash) or
  `Start-Job { docker logs -f <container> *> app.log }` (pwsh).
- Remote telemetry (Application Insights, Kusto, Datadog): run the real query in the
  recording with the vendor CLI, filtered to this run's correlation or request ID, and
  print the matching rows. Ingestion delay is real; wait for it with a bounded retry
  loop rather than a fixed sleep, and say in the caption that it is a query.

### Documentation criteria (`scripts/docs-step.mjs`)

Show the lines the PR **added** to each doc and assert the statements the criterion needs:

```text
node <skill-dir>/scripts/docs-step.mjs --step AC9 --base <merge-base sha or @merge-base.txt> \
  --check "docs/SemanticSearch.md::disabled\s+by default" \
  --check "docs/SemanticSearch.md::8,192-token" --evidence evidence
```

Get the base with `git merge-base <target branch> HEAD` (fetch the target first). Paths are
repository-relative. Pair it with the rendered page (browser path) when rendering matters, for
example a docs site, a README table, or an OpenAPI description.

### Focused tests

Only when the criterion is about tests, or as supporting evidence next to real behavior;
a green test run does not prove what a user sees. Run the narrowest filter
(`dotnet test --filter ...`, `npx vitest run path`), not the whole suite.

## Tape rules

- Setup the viewer does not need goes between `Hide` and `Show`; wait on `UAT_ENV_READY`.
  `Hide` hides frames, not output: anything a hidden command prints can still be on screen
  when `Show` runs, so `Clear-Host` / `clear` before `Show`.
- Wait for an outcome, never a duration: `Wait+Screen@90s /UAT_STEP AC1 (PASS|FAIL|ERROR)/`.
  `Wait+60s` is invalid syntax (`+` picks scope, `@` sets the timeout). Plain `Wait` checks
  only the last line, which may already be the prompt.
- Wait on all three outcomes so a failure is recorded, not lost to a timeout. Give
  `--timeout` a shorter limit than the tape's wait.
- Markers must never appear in the typed command; `UAT_STEP <id> …` is printed only by the
  helpers, so it is safe as long as each step ID is unique in the tape.
- `Sleep` is reading time after a result: about 1 s per 2–3 lines of important output,
  6–10 s for a response the viewer must read. It is never a substitute for waiting.
- **Every scene must fit on one screen.** On Windows, VHS (ttyd + ConPTY) stops updating
  the screen as soon as output scrolls: the command still runs, but the marker never
  appears and the wait times out. Hide a `Clear-Host` before each scene (the template shows
  how), record at 1920×1080 with `FontSize 16` (about 50 rows), and cap output with
  `--select` and `--max-lines`. Doing the same on macOS and Linux keeps scenes readable too.
- Keep the typed command readable: put long or noisy values (2048-character strings, header
  sets, regexes, expected messages) in variables in the hidden setup. The helpers print the
  real request, pattern and values, so the viewer still sees what was checked.
- PowerShell turns an unquoted `a,b` into an array, which arrives as separate arguments:
  quote comma lists (`--select "id,meta.versionId"`). Arrays of arguments can be splatted on
  purpose (`uat-http --step AC3 @headers`).
- Start each scene with a comment line (`# AC2: a 65-character id is rejected`) so the
  viewer knows what is being proven before the command runs.
- Record tapes one at a time when they read the same log file.
- `Screenshot evidence/AC1.png` after the hold gives the report a still image.

## Security

- Authenticate through the user's existing login (`az`, `gh`, a dev token command) in the
  hidden section, into an environment variable passed with `--bearer-env`. Never put
  secrets in the tape, in `Env` directives, in command arguments, or in files.
- `http-step` redacts `Authorization`, cookies and common API-key headers on screen and
  in evidence; check that the response body itself carries no secrets before recording.
- Use synthetic data with a per-run suffix. Check that it does not exist before writing;
  write down what you created (a cleanup list) before sending the write, because a
  timeout can happen after the server commits. Delete it afterwards and verify the delete.
