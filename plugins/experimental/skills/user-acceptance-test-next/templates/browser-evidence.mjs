// Browser evidence recorder for one acceptance criterion (Playwright, any OS).
//
// Copy this file into the UAT working directory, rewrite SCENARIO for the criterion, then:
//   npm init -y && npm install playwright && npx playwright install chromium
//   node browser-evidence.mjs --step AC4 --base-url http://localhost:5173 --out clips --evidence evidence --api "/api/"
//
// It records a real browser session to <out>/<step>.webm with an on-screen caption bar, element
// highlights, and (with --api) a live panel of matching network calls, then writes
// <evidence>/<step>.browser.json (checks, network calls, console errors) and ends with the
// marker line  UAT_STEP <step> PASS|FAIL|ERROR.  Exit codes: 0 pass, 1 a check failed, 2 error.
//
// Rules: drive the real application; never stub responses (page.route) or inject fake DOM to
// make a check pass. Log in offscreen and pass --storage-state; never type secrets on camera.

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

// ---------------------------------------------------------------------------------------------
// SCENARIO: replace with the steps for this criterion. Show the starting state, perform the
// action, then pause on the result. Every claim the video makes must go through check().
// ---------------------------------------------------------------------------------------------
const SCENARIO = async ({ page, ui, check }) => {
  await ui.caption('AC4 · An "Export" button appears on the patient list');
  await page.goto('/');
  await ui.pause(1500);

  const button = page.getByRole('button', { name: 'Export' });
  await check('Export button is visible', () => button.waitFor({ state: 'visible', timeout: 10_000 }));
  await ui.highlight(button, 'New: Export button');
  await ui.pause(2000);

  const exported = page.waitForResponse((r) => r.url().includes('/api/export'), { timeout: 15_000 });
  await button.click();
  await check('Export request returns 200', async () => {
    const r = await exported;
    if (r.status() !== 200) throw new Error(`status ${r.status()}`);
  });
  await ui.pause(2000);
};
// ---------------------------------------------------------------------------------------------

// Setup problems are the step's ERROR (exit 2 with a marker), never a crash a caller reads as FAIL.
const setupError = (message) => {
  console.error(message);
  console.log(`UAT_STEP ${process.argv.includes('--step') ? process.argv[process.argv.indexOf('--step') + 1] : '?'} ERROR`);
  process.exit(2);
};
let opts;
try {
  ({ values: opts } = parseArgs({
  options: {
    step: { type: 'string' },
    'base-url': { type: 'string' },
    out: { type: 'string', default: 'clips' },
    evidence: { type: 'string', default: 'evidence' },
    api: { type: 'string' },
    'storage-state': { type: 'string' },
    width: { type: 'string', default: '1600' },
    height: { type: 'string', default: '900' },
    headed: { type: 'boolean', default: false },
    'slow-mo': { type: 'string', default: '150' },
  },
  }));
} catch (e) { setupError(e.message); }
if (!opts.step) setupError('--step is required');
const step = opts.step;
const size = { width: Number(opts.width), height: Number(opts.height) };
const outDir = resolve(opts.out);
const evidenceDir = resolve(opts.evidence);
const rawDir = join(outDir, `.raw-${step}`);
mkdirSync(rawDir, { recursive: true });
mkdirSync(evidenceDir, { recursive: true });

const checks = [];
const network = [];
const consoleErrors = [];
let apiPattern = null;
try { apiPattern = opts.api ? new RegExp(opts.api) : null; } catch (e) { setupError(`invalid --api: ${e.message}`); }
class StopScenario extends Error {}

let browser;
let context;
try {
  browser = await chromium.launch({ headless: !opts.headed, slowMo: Number(opts['slow-mo']) });
  context = await browser.newContext({
  baseURL: opts['base-url'],
  viewport: size,
  deviceScaleFactor: 1,
  recordVideo: { dir: rawDir, size },
  ...(opts['storage-state'] ? { storageState: resolve(opts['storage-state']) } : {}),
  });
} catch (e) {
  await browser?.close();
  setupError(`could not start the browser: ${e.message.split('\n')[0]}`);
}
const page = await context.newPage();

// Overlays live in a closed shadow root: Playwright locators do not pierce closed shadow roots,
// so caption, highlight-label and network-panel text can never satisfy (or collide with) a
// check's getByText/getByRole. They are pointer-events:none, so they never intercept clicks,
// and they are re-applied after each navigation.
await context.addInitScript(() => {
  let root = null;
  Object.defineProperty(window, '__uatOverlayRoot', {
    enumerable: false,
    value: () => {
      if (root && root.host.isConnected) return root;
      const host = document.createElement('uat-overlay');
      host.setAttribute('aria-hidden', 'true');
      Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none' });
      root = host.attachShadow({ mode: 'closed' });
      document.documentElement.appendChild(host);
      return root;
    },
  });
});
let currentCaption = null;
// An overlay can fail while a page navigates; log it, since a missing caption changes what the video shows.
const overlay = (fn, arg) => page.evaluate(fn, arg).catch((e) => console.error(`overlay not drawn: ${String(e.message ?? e).split('\n')[0]}`));
const drawCaption = (c) => overlay(({ text, color }) => {
  const root = window.__uatOverlayRoot();
  let el = root.getElementById('caption');
  if (!el) {
    el = document.createElement('div');
    el.id = 'caption';
    Object.assign(el.style, {
      position: 'fixed', left: '0', right: '0', bottom: '0',
      font: '600 22px/1.4 ui-monospace, Consolas, Menlo, monospace', color: '#e6edf3',
      background: 'rgba(13,17,23,0.92)', padding: '12px 24px', borderTop: '3px solid #58a6ff',
    });
    root.appendChild(el);
  }
  el.textContent = text;
  el.style.borderTopColor = color;
}, c);
const drawNetwork = () => overlay((rows) => {
  const root = window.__uatOverlayRoot();
  let el = root.getElementById('network');
  if (!el) {
    el = document.createElement('div');
    el.id = 'network';
    Object.assign(el.style, {
      position: 'fixed', right: '16px', top: '16px', maxWidth: '46%',
      font: '14px/1.5 ui-monospace, Consolas, Menlo, monospace', color: '#e6edf3', whiteSpace: 'pre',
      background: 'rgba(13,17,23,0.88)', padding: '10px 14px', borderRadius: '8px', border: '1px solid #30363d',
    });
    root.appendChild(el);
  }
  el.textContent = `network\n${rows.join('\n')}`;
}, network.slice(-6).map((n) => `${n.method.padEnd(6)} ${n.status} ${n.path}`.slice(0, 90)));

page.on('load', async () => {
  if (currentCaption) await drawCaption(currentCaption);
  if (apiPattern && network.length) await drawNetwork();
});
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('response', async (r) => {
  if (!apiPattern || !apiPattern.test(r.url())) return;
  const u = new URL(r.url());
  network.push({ method: r.request().method(), url: r.url(), path: u.pathname + u.search, status: r.status(), at: new Date().toISOString() });
  await drawNetwork();
});

const ui = {
  pause: (ms) => page.waitForTimeout(ms),
  caption: async (text, color = '#58a6ff') => { currentCaption = { text, color }; await drawCaption(currentCaption); },
  async highlight(locator, label) {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error(`cannot highlight ${label}: element has no box`);
    await overlay(({ b, text }) => {
      const wrap = document.createElement('div');
      wrap.className = 'highlight';
      Object.assign(wrap.style, {
        position: 'fixed', left: `${b.x - 6}px`, top: `${b.y - 6}px`, width: `${b.width + 12}px`, height: `${b.height + 12}px`,
        border: '3px solid #f0883e', borderRadius: '6px', boxShadow: '0 0 0 4000px rgba(0,0,0,0.25)',
      });
      const tag = document.createElement('div');
      tag.textContent = text;
      Object.assign(tag.style, {
        position: 'absolute', left: '-3px', top: '-34px', background: '#f0883e', color: '#0d1117', whiteSpace: 'nowrap',
        font: '600 16px/1 ui-monospace, Consolas, Menlo, monospace', padding: '7px 10px', borderRadius: '4px',
      });
      wrap.appendChild(tag);
      window.__uatOverlayRoot().prepend(wrap);
    }, { b: box, text: label });
  },
  clearHighlights: () => overlay(() => window.__uatOverlayRoot().querySelectorAll('.highlight').forEach((e) => e.remove())),
};

let pendingChecks = 0;
async function check(name, fn) {
  pendingChecks++;
  try {
    await fn();
    checks.push({ check: name, pass: true });
    console.log(`✓ ${name}`);
  } catch (e) {
    checks.push({ check: name, pass: false, error: String(e.message ?? e).split('\n')[0] });
    console.log(`✗ ${name}: ${checks.at(-1).error}`);
    await ui.caption(`✗ ${step} · ${name}: ${checks.at(-1).error}`.slice(0, 160), '#f85149');
    await ui.pause(3000);
    throw new StopScenario();
  } finally {
    pendingChecks--;
  }
}

let verdict = 'PASS';
let error = null;
try {
  await SCENARIO({ page, ui, check });
  if (checks.length === 0) throw new Error('scenario made no check() calls; a verdict needs at least one');
  if (pendingChecks) throw new Error('a check() was not awaited; await every check so the verdict includes it');
  // A failed check whose StopScenario the scenario caught (try/catch, .catch, allSettled) still fails.
  if (checks.some((x) => !x.pass)) throw new StopScenario();
  await ui.clearHighlights();
  await ui.caption(`✓ ${step} PASS · ${checks.length} check(s)`, '#2ea043');
  await ui.pause(1500);
} catch (e) {
  if (e instanceof StopScenario) verdict = 'FAIL';
  else { verdict = 'ERROR'; error = String(e.stack ?? e); console.error(error); }
}

const video = page.video();
await page.close();
await context.close();
await browser.close();

const clip = join(outDir, `${step}.webm`);
if (video) {
  rmSync(clip, { force: true });
  renameSync(await video.path(), clip);
}
rmSync(rawDir, { recursive: true, force: true });
writeFileSync(join(evidenceDir, `${step}.browser.json`), `${JSON.stringify({
  step, verdict, at: new Date().toISOString(), baseUrl: opts['base-url'] ?? null, video: clip, checks, network, consoleErrors, error,
}, null, 2)}\n`, 'utf8');
console.log(`video: ${clip}`);
console.log(`UAT_STEP ${step} ${verdict}`);
process.exit(verdict === 'PASS' ? 0 : verdict === 'FAIL' ? 1 : 2);
