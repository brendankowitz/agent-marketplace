# Browser evidence (Playwright)

For criteria a user sees in a web UI: an element appears, a flow works, an error message
shows, a rendered docs page changed. `<skill-dir>` is this skill's directory (see SKILL.md).

## Setup

In the working directory (never in the product repo's own `package.json`):

```bash
npm init -y
npm install playwright
npx playwright install chromium
cp <skill-dir>/templates/browser-evidence.mjs ./AC3.mjs      # one copy per criterion
```

Ask before the install if the user has not already approved tool installs for this run.

## Explore first, record second

Find stable locators before writing the scenario. If the host has a Playwright MCP server
(both Copilot CLI and Claude Code can), use `browser_navigate` and `browser_snapshot` to read
the accessibility tree; otherwise run `npx playwright codegen <url>`. Prefer
`getByRole`/`getByLabel`/`getByText` over CSS selectors.

The recording itself always comes from the script: an interactive MCP session has no clean,
repeatable video and mixes exploration with evidence.

## Write the scenario

Edit only the `SCENARIO` function in the copy:

- `ui.caption(text)` sets the caption bar along the bottom. Start with the criterion:
  `AC3 · An Export button appears for admins`. Captions, highlight labels and the network
  panel are drawn inside a closed shadow root, so locators never match them; a check on
  `getByText('…')` only finds the application's own text.
- `check(name, fn)` is the only way to make a claim. It records pass/fail; on failure it
  shows the failure on screen, holds for 3 s and stops the scenario. A scenario with no
  `check()` ends as ERROR.
- `ui.highlight(locator, label)` outlines the element that proves the criterion, with a
  label such as "New: Export button". `ui.clearHighlights()` removes them.
- `ui.pause(ms)` is reading time after something changes, about 1.5–3 s.
- Wait on real conditions: `locator.waitFor`, `page.waitForResponse`, `expect`-style polling.
  Never `waitForTimeout` as a substitute for a condition.

Run it:

```bash
node AC3.mjs --step AC3 --base-url http://localhost:5173 --out clips --evidence evidence --api "/api/"
```

- `--api <regex>` shows a live panel of matching network calls (method, status, path) in
  the top-right corner, and saves them to `evidence/AC3.browser.json`. Use it whenever the
  criterion has a backend side, so the viewer sees the UI action and the request it made.
- Output: `clips/AC3.webm`, `evidence/AC3.browser.json` (checks, network calls, console
  errors), and the `UAT_STEP AC3 PASS|FAIL|ERROR` marker. Exit codes 0/1/2.
- `--headed` shows the browser while you debug; record headless.
- The default viewport is 1600×900. If the app's text is too small in the frames, record
  at `--width 1280 --height 720`; the assembler scales it up to 1080p.

## Authentication

Never type credentials in the recording, and never automate a login by entering a password.
Ask the user to sign in once in a browser Playwright controls, and save the session:

```bash
npx playwright codegen --save-storage=auth.json <app-url>
```

Then pass `--storage-state auth.json`. `auth.json` holds live session cookies: keep it in the
working directory (ignored by git), and delete it when the run is finished.

## Rules

- Drive the real application. Do not stub responses (`page.route`), inject DOM, or edit
  page state to make a check pass. If the environment cannot show the behavior, the
  verdict is BLOCKED, not a staged PASS.
- One criterion per recording, so each becomes its own chapter.
- The template draws its own caption bar, so in the manifest give these clips
  `"caption": ""` to avoid a second bar from the assembler.
- Before/after comparisons are optional. Record the "before" against the base branch only
  when the criterion is about a change a viewer could not otherwise see ("the error message
  now names the limit"), and label each clip clearly.

## Documentation criteria

Show the rendered result where readers will see it: the local docs site
(`npm run docs:dev`, `mkdocs serve`, `docfx serve`), the PR branch's file view on
GitHub/ADO, or the rendered Markdown preview. Highlight the changed section with
`ui.highlight`, and pair it with the terminal diff when the exact wording matters.
