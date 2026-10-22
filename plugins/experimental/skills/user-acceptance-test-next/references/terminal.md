# Terminal evidence (VHS)

For criteria whose proof is a command and its output: HTTP APIs, emitted logs, CLI
behavior, config, documentation diffs, focused test runs. `<skill-dir>` is this skill's
directory (see SKILL.md).

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

- `--expect-json path=value` compares JSON values; `length` works on strings and arrays
  (`id.length=64`). Display full critical IDs and assert their exact length; similar-looking
  text is not verification.
- `--select a,b.c` prints only those fields and labels them "selected response fields".
  Use it for large bodies so the important part stays on screen.
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
  arguments through a function such as `uat-log`.
- Logs must land in a file. When launching locally, redirect the app's output
  (`dotnet run > app.log 2>&1`, `npm start > app.log 2>&1`). For containers, stream them in
  the hidden setup: `docker logs -f <container> > app.log 2>&1 &` (bash) or
  `Start-Job { docker logs -f <container> *> app.log }` (pwsh).
- Remote telemetry (Application Insights, Kusto, Datadog): run the real query in the
  recording with the vendor CLI, filtered to this run's correlation or request ID, and
  print the matching rows. Ingestion delay is real; wait for it with a bounded retry
  loop rather than a fixed sleep, and say in the caption that it is a query.

### Documentation and code criteria

Show the change itself, from the PR's own commits:

```text
git --no-pager diff --color=always <base>...<head> -- docs/limits.md
```

Pair it with the rendered page (browser path) when rendering matters, for example a docs
site, a README table, or an OpenAPI description.

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
- Keep lines under about 100 columns at 1600×900 and 22 px. Use `--select` and
  `--max-lines` rather than shrinking the font.
- Start each scene with a comment line (`# AC2: a 65-character id is rejected`) so the
  viewer knows what is being proven before the command runs.
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
