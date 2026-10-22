# Assembling, checking and delivering the video

`<skill-dir>` is this skill's directory (see SKILL.md).

## Manifest

Write `manifest.json` in the working directory. Start from
`<skill-dir>/templates/uat-manifest.example.json`. Paths are relative to the manifest.

| Field | Meaning |
|---|---|
| `title` | Shown large on the title card; `PR #<n> — <title>` |
| `subtitle` | One or more lines: repo, head commit, environment, data used |
| `output` | MP4 path (default `uat.mp4`) |
| `width`, `height`, `fps`, `crf` | Defaults 1920, 1080, 30, 23 |
| `cardSeconds`, `titleSeconds`, `summarySeconds` | Card durations (3, 5, 6) |
| `font` | Monospace `.ttf`/`.ttc` if auto-detection fails (or set `UAT_FONT`) |
| `chapters[]` | One per criterion, in the confirmed order |

Each chapter:

| Field | Meaning |
|---|---|
| `id`, `title` | `AC1` and the observable criterion as confirmed |
| `source` | `quoted from …`, `derived from …`, `inferred from …; confirmed by the user` |
| `proof` | What the evidence shows, e.g. `HTTP request and response + emitted log` |
| `verdict` | `PASS`, `FAIL`, `BLOCKED` or `NOT RUN`, taken from the step markers and evidence JSON |
| `note` | One line under the verdict: the decisive fact (`201 Created; id length 64`, `got 500, expected 400`) |
| `evidence[]` | Clip or image paths in viewing order. Objects allow `caption` (`""` for none), `seconds` (images, or to cut a clip), `startSeconds` |

PASS and FAIL require evidence; the script refuses to make either without it. BLOCKED and
NOT RUN may have none, and their `note` must say why.

## Build

```bash
node <skill-dir>/scripts/assemble-uat-video.mjs manifest.json
```

It renders the title card, then for each criterion a chapter card, its evidence (scaled
and padded to the output size, with a caption bar naming the criterion), and a verdict card,
then a results card. It writes:

- the MP4 with embedded chapters (players with chapter support show them);
- `<output>.chapters.md`: a timestamp table for the report;
- `<output>.result.json`: duration, size, segment timings, frame paths;
- `<output stem>-frames/`: a frame from the middle of every segment and from 1 s before the
  end of every evidence clip.

It fails (exit 2) on a bad manifest, missing evidence, an ffmpeg without `drawtext`, a dirty
full decode, or wrong output dimensions.

## Check before showing anyone

Producing an MP4 proves nothing. Look at the extracted frames (read the PNGs) and confirm:

- [ ] The title card names the right PR, commit and environment.
- [ ] Every `*-evidence-*-end.png` shows the result the verdict claims: the status code,
      the log line, the highlighted element. Text is readable, not clipped or truncated.
- [ ] Each verdict matches its `UAT_STEP` marker and evidence JSON. A FAIL is shown as FAIL.
- [ ] No secrets, tokens, cookies, personal data or internal hostnames the user did not
      approve are visible in any frame.
- [ ] The summary card's counts match the report.

If a frame is unreadable, fix the recording (fewer lines, `--select`, a smaller viewport),
not the verdict. Re-record and re-assemble.

Size: GitHub accepts video attachments up to 10 MB on free plans and 100 MB on paid plans.
If the file is too large, raise `crf` (28 is still legible for terminals) or render at
1280×720.

## Report

Fill `<skill-dir>/templates/uat-report.md` as `uat-report.md` in the working directory: the
counts, the commit and environment tested, one row per criterion with its evidence and
timestamp (from `<output>.chapters.md`), and, for every FAIL and BLOCKED, what was expected,
what happened, and how to reproduce it.

## Deliver

Always give the user the absolute paths of the MP4 and the report. Upload or post **only
after the user explicitly says yes** to that specific action; the video may show internal
URLs or data.

- **GitHub:** `gh pr comment <n> --body-file uat-report.md --attach <video.mp4>` (gh 2.99+).
  Without a matching markdown reference, gh appends the asset URL on its own line, which is
  what GitHub needs to render a player. If the host has a `github-pr-media` skill, follow it.
  GitHub Enterprise Server has no attachment upload API: give the path instead.
- **Azure DevOps:** upload with the Pull Request Attachments REST API
  (`POST …/_apis/git/repositories/{repo}/pullRequests/{id}/attachments/{fileName}`), for example
  through `az rest`, then post `uat-report.md` as a PR thread comment that links the attachment.
  Alternatively attach the video to the work item (the ADO MCP `wit_work_item_attachment_upload`
  tool or `az boards work-item` + REST) and link it from the comment.
- Never publish to a public host (for example `vhs publish`) without explicit permission.

## Clean up

- Delete synthetic data you created and verify the deletion.
- Stop processes you started (app servers, log followers, browsers).
- Delete `auth.json` and any token files.
- Keep the working directory until the user has the video; then offer to remove it. It is
  ignored by git (`agent-working/.gitignore` contains `*`), but `git clean -fdx` deletes it.
