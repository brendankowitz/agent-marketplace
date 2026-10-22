#!/usr/bin/env node
// Records the UAT workbench with Playwright: opens the notebook UI served by server.mjs, then for
// each cell focuses it, holds for reading time, really clicks its Run button, waits for the real
// run to finish, and holds on the results. Writes the video, a timeline (seconds from video
// start) and a manifest fragment for scripts/assemble-uat-video.mjs.
//
//   node record.mjs --url http://127.0.0.1:4317 --out clips/workbench.webm --timeline workbench-timeline.json
//                   [--cells id1,id2] [--hold 6] [--width 1920 --height 1080] [--overview 3] [--headed]
//
// Run it from a directory where `playwright` is installed (npm install playwright); it is resolved
// from the current working directory, so the skill directory needs no node_modules.
// Exit codes: 0 the recording completed (whatever the verdicts), 2 the recording itself failed.

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
    timeline.push({ cellId: id, criterion: cell.criterion, step: cell.step, title: cell.title, verdict, exitCode, focusAt, runAt, doneAt, endAt: cellEnd });
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
try { await context?.close(); } catch { /* already closed */ }
await browser.close();

if (video && !fatal) {
  mkdirSync(path.dirname(outAbs), { recursive: true });
  rmSync(outAbs, { force: true });
  const src = await video.path();
  try { renameSync(src, outAbs); } catch { copyFileSync(src, outAbs); }
}
rmSync(rawDir, { recursive: true, force: true });
if (fatal) process.exit(2);

const RANK = { PASS: 1, ERROR: 2, FAIL: 3 };
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
    ch = { id: key, title: notebook.criteriaTitles[key] ?? '', verdict: null, cells: [], start: t.focusAt, end: t.endAt };
    chapters.push(ch);
  }
  ch.cells.push(`${t.cellId}: ${t.verdict ?? 'NO RESULT'}`);
  ch.end = Math.max(ch.end, t.endAt);
  ch.start = Math.min(ch.start, t.focusAt);
  // A cell that never finished counts as ERROR for its criterion, never as "no opinion".
  const v = t.verdict ?? 'ERROR';
  if (v !== 'SHOWN' && (RANK[v] ?? 0) > (RANK[ch.verdict] ?? 0)) ch.verdict = v;
}
writeFileSync(fragmentAbs, `${JSON.stringify({
  note: 'Paste each chapter\'s evidence item into the matching chapter of manifest.json. verdict is the worst UAT_STEP verdict of the chapter\'s cells; check it against the evidence before using it.',
  chapters: chapters.map((c) => ({
    id: c.id,
    title: c.title,
    verdict: c.verdict ?? (c.cells.length ? 'SHOWN' : null),
    cells: c.cells,
    evidence: [{ path: outRel, startSeconds: round(c.start), seconds: round(c.end - c.start), caption: '' }],
  })),
}, null, 2)}\n`, 'utf8');

console.log(`video:    ${outAbs}`);
console.log(`timeline: ${timelineAbs}`);
console.log(`fragment: ${fragmentAbs}`);
process.exit(problems ? 2 : 0);
