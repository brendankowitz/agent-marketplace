# UAT workbench

A notebook-style browser UI for terminal evidence, recorded with Playwright. Each cell explains a
step, shows the command, **runs it for real** when its Run button is clicked, streams the output,
and renders the evidence JSON that `http-step.mjs`, `log-step.mjs` and `browser-evidence.mjs`
write as HTTP, log and browser cards. It is an alternative to VHS for criteria whose proof is a
command and its output.

| File | Purpose |
|---|---|
| `server.mjs` | Zero-dependency runner (Node 18+): serves the UI, runs the notebook's cells, streams output (SSE) |
| `index.html`, `app.js`, `style.css` | The UI: vanilla JS/CSS, no network assets, designed for 1920×1080 |
| `record.mjs` | Playwright recorder: video, timeline, manifest fragment |
| `example/` | Runnable example: tiny API, notebook with PASS, PASS and a deliberate FAIL |

## Notebook schema (`uat-notebook.json`)

```json
{
  "title": "PR #123 — Add order export",
  "subtitle": ["contoso/orders-api · head 1a2b3c4", "Environment: http://localhost:5000"],
  "criteria": [{ "id": "AC1", "title": "Creating an order returns 201" }],
  "setup": { "shell": "pwsh", "script": "Remove-Item evidence -Recurse -ErrorAction Ignore" },
  "cells": [
    {
      "id": "ac1-create",
      "criterion": "AC1",
      "step": "AC1",
      "title": "POST /api/orders creates an order",
      "markdown": "Send a **real** `POST`; expect **201**.",
      "display": "uat-http --step AC1 --method POST --url $base/api/orders ...",
      "command": ["node", "../scripts/http-step.mjs", "--step", "AC1", "--evidence", "evidence", "..."],
      "cwd": ".",
      "env": { "UAT_BASE": "http://localhost:5000" },
      "timeoutSeconds": 120,
      "readSeconds": 3,
      "holdSeconds": 8
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `title`, `subtitle[]` | Top bar (repo · commit · environment) |
| `criteria[{id,title}]` | Sidebar list; a criterion's status is the worst verdict (FAIL > ERROR > PASS) among its cells that have one; SHOWN cells do not count. Cells are grouped by their `criterion` in notebook order: when a criterion has several cells, each cell header reads **AC5 · Step 2 of 2**, the sidebar lists the steps under the active criterion with live ticks, and a short cue (criterion · step · title) appears as the recording moves to each step |
| `setup` | Optional hidden step, same shape as a cell. Runs once when the server starts; cells wait for it. Its output never reaches the UI (printed on the server console only if it fails), and if it fails every cell is ERROR |
| `cells[].id` | Unique, `[A-Za-z0-9_.-]`; the recorder clicks `[data-run="<id>"]` |
| `criterion` | Criterion id the cell proves |
| `step` | The `UAT_STEP` id whose marker gives the cell's verdict. With `log-step --run http-step`, use the **outer** (log) step. A cell without `step` makes no claim: SHOWN on exit 0, ERROR otherwise. A cell with `step` but no matching marker is ERROR |
| `title`, `markdown` | Header and explanation. Markdown subset: paragraphs, headings, lists, `**bold**`, `*em*`, `` `code` ``, `[links](https://…)`, quotes, fenced code. HTML is escaped |
| `display` | Human-readable command shown in the code block (defaults to the argv joined, or the script) |
| `command` | argv array, spawned without a shell (`node`, `dotnet`, `git`, …; on Windows `.cmd` shims such as `npm` need `shell`) |
| `shell` + `script` | `"pwsh"` → `pwsh -NoProfile -NonInteractive -Command <script>`; `"bash"` → `bash -lc <script>` |
| `cwd` | Relative to the notebook's directory (default: that directory) |
| `env` | Extra **non-secret** variables. `FORCE_COLOR=1` is always set |
| `evidence[]` | Optional extra evidence files (relative to `cwd`) to render, e.g. `evidence/AC4.browser.json`; shown only if written during this run. Files printed as `evidence: <path>` by the helpers are picked up automatically |
| `timeoutSeconds` | Default 300; on timeout the process tree is killed and the cell is ERROR |
| `readSeconds`, `holdSeconds` | Recorder pacing: reading time before the click (default 2.5) and after the result (default `--hold`) |

Evidence kind comes from the file name: `*.http.json`, `*.log.json`, `*.browser.json`, else a
generic JSON card. Evidence files are read only when they resolve inside the notebook's directory
tree, so keep the notebook in the UAT working directory next to `evidence/`.

## Run and record

Put the notebook in the UAT working directory (`./agent-working/uat-<n>/uat-notebook.json`), with
`--evidence evidence` on every helper call. Start the system under test first (the hidden setup
runs as soon as the server starts), then:

```powershell
node <skill-dir>/workbench/server.mjs --notebook uat-notebook.json     # prints sha256 and http://127.0.0.1:4317/
```

Preflight by opening the URL and clicking Run on each cell. **Restart the server before
recording** so the hidden setup runs again and the page starts with no results. Then, from a
directory where `playwright` is installed (`npm init -y; npm install playwright; npx playwright install chromium`):

```powershell
node <skill-dir>/workbench/record.mjs --url http://127.0.0.1:4317 --out clips/workbench.webm --timeline workbench-timeline.json
```

Options: `--cells id1,id2` (subset and order), `--hold 6`, `--read 2.5`, `--overview 3`,
`--summary 5`, `--width 1920 --height 1080`, `--headed`. Flow: overview hold → per cell focus,
read, real click on Run, wait for `data-state="done"` (timeout `timeoutSeconds + 30`), scroll the
results into view, hold → results summary overlay. It prints each cell's verdict and exits 0 when
the recording completed (whatever the verdicts), 2 when the recording failed or a cell never
finished.

Outputs:

- `clips/workbench.webm`: the video.
- `workbench-timeline.json`: per cell `{cellId, criterion, step, verdict, exitCode, focusAt, runAt, doneAt, endAt}` in seconds from video start. The reference time is taken right after Playwright creates the page (when its video starts), so values can trail the video by a few milliseconds. The video runs a few seconds past `summary.endAt` while the context closes.
- `clips/workbench.webm.manifest-fragment.json`: one chapter per criterion with `evidence` (one item `{path, startSeconds, seconds, caption: ""}` spanning the first cell's focus to the last cell's end) and `stepEvidence` (one item per step, back to back over the same span, with `step` "2/3", `cellId`, `title` and `verdict`). Use `stepEvidence` when a criterion has several steps, so each step gets its own narration. Its `verdict` is the worst cell marker; check it against the evidence.

Automation API (`window.uat`, used by `record.mjs`): `ready()`, `cells()`, `focus(id)`,
`reveal(id)`, `run(id)` → `{verdict, exitCode}`, `waitDone(id)`, `caption(text|null)`,
`showSummary()`, `hideSummary()`, `state()`.

### Example

```powershell
cd <skill-dir>/workbench/example
node example-api.mjs                                   # terminal 1: API on 127.0.0.1:4318, logs to app.log
node ../server.mjs --notebook example-notebook.json    # terminal 2: workbench on 127.0.0.1:4317
node <skill-dir>/workbench/record.mjs --url http://127.0.0.1:4317 --out clips/workbench.webm --timeline workbench-timeline.json   # terminal 3, where playwright is installed
```

Expected verdicts: `ac1-create` PASS, `ac2-logged` PASS (log check wrapping a request), `ac3-refund`
FAIL (the API answers 400, the criterion expects 202). Delete `app.log` and `evidence/` afterwards.

## Security model

- Binds `127.0.0.1` by default. Every request must carry `Host: 127.0.0.1:<port>` or
  `localhost:<port>` (defeats DNS rebinding); POSTs with an `Origin` other than the same origin are
  rejected (defeats cross-site requests). A strict CSP allows only same-origin scripts and styles.
- The notebook is read once at startup and its SHA-256 printed; edits need a restart. Only its
  cells can run (`POST /api/cells/<id>/run`, 404 for unknown ids, 409 while that cell is running).
  There is no endpoint that runs anything else.
- `GET /api/notebook` returns display information only (titles, markdown and the `display` text,
  which defaults to the argv joined); never `env` values or the hidden setup.
- Evidence files are served only from inside the notebook's directory tree.

## Honesty rules

- **No replay.** Every output on screen is streamed from a process started by the click in the
  recording. Nothing is cached, edited or re-used between runs; re-running a cell visibly resets it.
- **Verdicts come from markers**, not the UI: the cell's `UAT_STEP <step>` line and the evidence
  JSON the helper wrote during that run. FAIL and ERROR are shown exactly like PASS; never drop,
  re-order or re-run a cell to hide one.
- **Secrets** come only from the server process environment (set offscreen before starting it),
  are passed with `--bearer-env`, and are redacted by the helpers in output and evidence. Never put
  secrets in the notebook (`env`, `command`, `script`, `display`), which is shown and hashed.
- Inspect the frames before delivery, as for any other clip.
