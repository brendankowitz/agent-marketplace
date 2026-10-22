#!/usr/bin/env node
// Records the UAT workbench with Playwright: opens the notebook UI served by server.mjs, then for
// each cell focuses it, holds for reading time, really clicks its Run button, waits for the real
// run to finish, and holds on the results. Writes the video, a timeline (seconds from video
// start) and a manifest fragment (<out>.manifest-fragment.json) for scripts/workbench-manifest.mjs,
// which turns it into the assembler's manifest.
//
//   node record.mjs --url http://127.0.0.1:4317 --out clips/workbench.webm --timeline workbench-timeline.json
//                   [--cells id1,id2] [--hold 6] [--read 2.5] [--overview 3] [--summary 5]
//                   [--width 1920 --height 1080] [--headed]
//
// Run it from a directory where `playwright` is installed (npm install playwright); it is resolved
// from the current working directory, so the skill directory needs no node_modules.
// Exit codes: 0 the recording completed (whatever the verdicts), 2 the recording itself failed or a
// cell never finished.

import { copyFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';

const HELP = `node record.mjs --url http://127.0.0.1:4317 --out clips/workbench.webm --timeline workbench-timeline.json
  [--cells id1,id2] [--hold 6] [--read 2.5] [--overview 3] [--summary 5] [--width 1920 --height 1080] [--headed]`;

let opts;
try {
  ({ values: opts } = parseArgs({
    options: {
      url: { type: 'string', default: 'http://127.0.0.1:4317' },
      out: { type: 'string', default: 'clips/workbench.webm' },
      timeline: { type: 'string', default: 'workbench-timeline.json' },
      cells: { type: 'string' },
      hold: { type: 'string', default: '6' },
      read: { type: 'string', default: '2.5' },
      overview: { type: 'string', default: '3' },
      summary: { type: 'string', default: '5' },
      width: { type: 'string', default: '1920' },
      height: { type: 'string', default: '1080' },
      headed: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  }));
} catch (e) {
  console.error(`${e.message}\n${HELP}`);
  process.exit(2);
}
if (opts.help) { console.log(HELP); process.exit(0); }

let chromium;
try {
  ({ chromium } = createRequire(path.join(process.cwd(), 'package.json'))('playwright'));
} catch {
  console.error(`playwright is not installed in ${process.cwd()}. Run: npm init -y && npm install playwright && npx playwright install chromium`);
  process.exit(2);
}

const viewport = { width: Number(opts.width), height: Number(opts.height) };
const outAbs = path.resolve(opts.out);
const timelineAbs = path.resolve(opts.timeline);
const fragmentAbs = `${outAbs}.manifest-fragment.json`;
const rawDir = path.join(path.dirname(outAbs), `.raw-workbench-${process.pid}`);
const toPosix = (p) => p.split(path.sep).join('/');
const round = (n) => Math.round(n * 100) / 100;

// Never leave an earlier take's output behind to be mistaken for this one.
for (const p of [outAbs, timelineAbs, fragmentAbs]) rmSync(p, { force: true });
mkdirSync(rawDir, { recursive: true });
const browser = await chromium.launch({ headless: !opts.headed });
let context;
let page;
let t0 = 0;
let startedAt = null;
const at = () => round((Date.now() - t0) / 1000);
const timeline = [];
let notebook = null;
let summaryAt = null;
let endAt = null;
let fatal = null;
let problems = 0;

try {
  context = await browser.newContext({ viewport, deviceScaleFactor: 1, recordVideo: { dir: rawDir, size: viewport } });
  page = await context.newPage();
  // Playwright starts the video when the page is created; this reference is taken right after,
  // so timeline values trail the true video time by the few milliseconds newPage() takes to return.
  t0 = Date.now();
  startedAt = new Date(t0).toISOString();
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));

  await page.goto(opts.url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.uat, null, { timeout: 15_000 });
  await page.evaluate(() => window.uat.ready());
  notebook = await page.evaluate(() => ({ ...window.uat.state(), cells: window.uat.cells() }));
  const criteriaTitles = await page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('[data-criterion]')].map((li) => [li.dataset.criterion, li.querySelector('.crit-title')?.textContent ?? '']),
  ));
  const byId = new Map(notebook.cells.map((c) => [c.id, c]));
  const wanted = opts.cells ? opts.cells.split(',').map((s) => s.trim()).filter(Boolean) : notebook.cells.map((c) => c.id);
  const unknown = wanted.filter((id) => !byId.has(id));
  if (unknown.length) throw new Error(`unknown cell id(s): ${unknown.join(', ')}`);
  // A chapter is one contiguous span of the video, so a criterion's cells must be recorded back
  // to back; otherwise another criterion's footage would land inside its chapter.
  const order = wanted.map((id) => byId.get(id).criterion ?? id);
  const split = order.find((k, i) => i > 0 && k !== order[i - 1] && order.slice(0, i - 1).includes(k));
  if (split) throw new Error(`criterion ${split}'s cells are not consecutive in the recording order; reorder the notebook or --cells`);
  notebook.criteriaTitles = criteriaTitles;

  await page.waitForTimeout(Number(opts.overview) * 1000);

  for (const id of wanted) {
    const cell = byId.get(id);
    const focusAt = at();
    await page.evaluate((cid) => window.uat.focus(cid), id);
    await page.waitForTimeout((cell.readSeconds ?? Number(opts.read)) * 1000);

    const runAt = at();
    await page.click(`[data-run="${id}"]`);
    let verdict = null;
    let exitCode = null;
    try {
      await page.waitForSelector(`[data-cell="${id}"][data-state="done"]`, { timeout: ((cell.timeoutSeconds ?? 300) + 30) * 1000 });
      ({ verdict, exitCode } = await page.evaluate((cid) => window.uat.state().cells[cid], id));
    } catch (e) {
      problems++;
      console.error(`${id}: did not finish: ${e.message.split('\n')[0]}`);
    }
    const doneAt = at();
    await page.evaluate((cid) => window.uat.reveal(cid), id);
    await page.waitForTimeout((cell.holdSeconds ?? Number(opts.hold)) * 1000);
    const cellEnd = at();
    timeline.push({ cellId: id, criterion: cell.criterion, step: cell.step, title: cell.title, trimWait: cell.trimWait ?? null, verdict, exitCode, focusAt, runAt, doneAt, endAt: cellEnd });
    console.log(`${id.padEnd(16)} ${String(verdict ?? 'NO RESULT').padEnd(6)} exit ${exitCode ?? '—'}  (${focusAt}s → ${cellEnd}s)`);
  }

  summaryAt = at();
  await page.evaluate(() => window.uat.showSummary());
  await page.waitForTimeout(Number(opts.summary) * 1000);
  endAt = at();
} catch (e) {
  fatal = e;
  console.error(`recording failed: ${e.stack ?? e}`);
}

// Closing the context flushes the video file.
const video = page?.video();
try { await context?.close(); } catch (e) {
  // Closing flushes the video; if that fails the file may be truncated, so the take is not usable.
  if (!fatal) { fatal = e; console.error(`could not close the browser context (video flush): ${e.message}`); }
}
await browser.close();

if (video && !fatal) {
  mkdirSync(path.dirname(outAbs), { recursive: true });
  rmSync(outAbs, { force: true });
  const src = await video.path();
  try { renameSync(src, outAbs); } catch { copyFileSync(src, outAbs); }
}
rmSync(rawDir, { recursive: true, force: true });
if (fatal) process.exit(2);

// ERROR ranks worst: a step that produced no result must not hide behind another step's FAIL.
const RANK = { PASS: 1, FAIL: 2, ERROR: 3 };
const outRel = toPosix(path.relative(process.cwd(), outAbs));
writeFileSync(timelineAbs, `${JSON.stringify({
  video: outRel,
  url: opts.url,
  width: viewport.width,
  height: viewport.height,
  recordedAt: startedAt,
  notebook: { title: notebook.title, sha256: notebook.sha256 },
  timeBase: 'seconds from video start; the reference is taken right after the page is created, so values may trail the video by a few milliseconds',
  cells: timeline,
  summary: { at: summaryAt, endAt },
}, null, 2)}\n`, 'utf8');

const chapters = [];
for (const t of timeline) {
  const key = t.criterion ?? t.cellId;
  let ch = chapters.find((c) => c.id === key);
  if (!ch) {
    ch = { id: key, title: notebook.criteriaTitles[key] ?? '', verdict: null, cells: [], steps: [], start: t.focusAt, end: t.endAt };
    chapters.push(ch);
  }
  ch.cells.push(`${t.cellId}: ${t.verdict ?? 'NO RESULT'}`);
  ch.steps.push(t);
  ch.end = Math.max(ch.end, t.endAt);
  ch.start = Math.min(ch.start, t.focusAt);
  // A cell that never finished counts as ERROR for its criterion, never as "no opinion"; so does
  // any verdict this recorder does not know.
  const v = t.verdict ?? 'ERROR';
  const known = v in RANK ? v : 'ERROR';
  if (v !== 'SHOWN' && RANK[known] > (RANK[ch.verdict] ?? 0)) ch.verdict = known;
}
writeFileSync(fragmentAbs, `${JSON.stringify({
  note: 'Build the assembler manifest from this file with scripts/workbench-manifest.mjs: it re-bases paths on baseDir, takes one item per step from stepEvidence, and refuses a take with an ERROR, unfinished or unrecorded step. verdict is the worst UAT_STEP verdict of the chapter\'s cells; check it against the evidence before using it.',
  baseDir: toPosix(process.cwd()),
  notebook: { title: notebook.title, sha256: notebook.sha256 },
  chapters: chapters.map((c) => ({
    id: c.id,
    title: c.title,
    verdict: c.verdict ?? (c.cells.length ? 'SHOWN' : null),
    cells: c.cells,
    evidence: [{ path: outRel, startSeconds: round(c.start), seconds: round(c.end - c.start), caption: '' }],
    // Each step runs from its focus to the next step's focus (the last to the chapter end), so
    // the items are contiguous and together cover exactly the same span as "evidence". A passing
    // step marked trimWait whose run is long keeps only the start and the end of the wait; the
    // second item's caption says how much was cut, so the cut is visible in the video. A step that
    // did not pass is never trimmed: the middle of its wait may be what explains the failure.
    stepEvidence: c.steps.flatMap((t, i) => {
      const end = i + 1 < c.steps.length ? c.steps[i + 1].focusAt : c.end;
      const base = { path: outRel, caption: '', step: `${i + 1}/${c.steps.length}`, cellId: t.cellId, title: t.title, verdict: t.verdict ?? 'NO RESULT' };
      const trim = t.verdict === 'PASS' || t.verdict === 'SHOWN' ? (t.trimWait === true ? {} : t.trimWait) : null;
      const keepStart = trim?.keepStart ?? 15;
      const keepEnd = trim?.keepEnd ?? 8;
      const waited = t.doneAt - t.runAt;
      if (!trim || waited <= keepStart + keepEnd + 10) {
        return [{ ...base, startSeconds: round(t.focusAt), seconds: round(end - t.focusAt) }];
      }
      const cutFrom = t.runAt + keepStart;
      const resumeAt = t.doneAt - keepEnd;
      const cut = resumeAt - cutFrom;
      const amount = cut >= 90 ? `${(cut / 60).toFixed(1)} min` : `${Math.round(cut)} s`;
      return [
        { ...base, startSeconds: round(t.focusAt), seconds: round(cutFrom - t.focusAt), part: 'wait-start' },
        { ...base, startSeconds: round(resumeAt), seconds: round(end - resumeAt), part: 'wait-end', trimmedSeconds: round(cut),
          caption: `${t.criterion ?? ''} · Step ${i + 1} of ${c.steps.length} · ${amount} of waiting trimmed`.replace(/^ · /, '') },
      ];
    }),
  })),
}, null, 2)}\n`, 'utf8');

console.log(`video:    ${outAbs}`);
console.log(`timeline: ${timelineAbs}`);
console.log(`fragment: ${fragmentAbs}`);
process.exit(problems ? 2 : 0);
