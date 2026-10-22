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

For a workbench take, `scripts/workbench-manifest.mjs` builds the chapters from the recorder's
`clips/workbench.webm.manifest-fragment.json`: one item per step (`stepEvidence`), titles,
`source` and `proof` from the notebook's criteria, verdicts from the step markers, and narration
from `narration.json` (`criteria.<id>.card|verdict|note`, `steps.<cellId>`, and
`steps.<cellId>#end` for the part after a trimmed wait). Without a `note` the verdict card says
how many checked steps passed. It refuses to build when a step is ERROR or never finished.

Waits are trimmed automatically for cells marked `trimWait` (see `workbench/README.md`): the
step keeps its first and last seconds and the second part's caption says how much was cut. To
trim by hand instead, split a span into two items and caption the second one with what was cut
and for how long, for example `AC1 · reindex polling trimmed (about 2 minutes of Running)`.
Only cut **waiting**; never cut a request, a result, or anything that changes the verdict.

### Narration (optional)

Add a `voice` section to narrate; leave it out for a silent video.

```json
"voice": {
  "provider": "azure-speech",
  "region": "eastus2",
  "resourceId": "/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.CognitiveServices/accounts/<ai-services-or-speech>",
  "voice": "en-US-AndrewMultilingualNeural",
  "rate": "+4%"
}
```

- `azure-speech` authenticates with `AZURE_SPEECH_KEY`, or with the user's Microsoft Entra login
  (`az account get-access-token`) plus `resourceId`; the account needs a Speech role on that
  resource (for example *Cognitive Services Speech User*). Optional: `style`, `pitch`, `lang`.
  Try a line first: `node <skill-dir>/scripts/narrate.mjs --voice voice.json --text "Test." --out test.mp3`.
- `system` uses the OS voice offline (Windows SAPI, macOS `say`, Linux `espeak-ng`). It sounds
  robotic; use it only when no Azure Speech resource is available.
- Texts: `titleNarration`, chapter `narration` (spoken over the chapter card), evidence item
  `narration` (over the clip, from its start), chapter `verdictNarration` (default
  `"AC1: pass."`), and `summaryNarration` (default: the counts). Audio is cached by voice
  and text in `.narration-cache/`.
- A card or clip is lengthened (last frame held) to fit its narration; nothing is cut. Every
  segment gets an audio track, so the output always has audio when `voice` is set.
- Write narration like a confident presenter explaining what the viewer is seeing: the action,
  then the observed values taken from the evidence files. Do not announce a verdict before the
  evidence has been shown, and do not describe anything that is not on screen.

### Background music (optional)

```json
"music": { "path": "Demo Loop.mp3", "volume": 0.16 }
```

The track loops to the video's length, fades in (`fadeIn`, default 2 s) and out (`fadeOut`,
default 4 s), and with narration it is ducked under the voice by sidechain compression
(`duckThreshold` 0.02, `duckRatio` 8), so speech keeps its level. `volume` 0.16 puts a typical
mastered track around −33 dB against a −21 dB voice. Use only music the user supplied or is
licensed to use. Without `music` there is no music bed.

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
