#!/usr/bin/env node
// UAT workbench runner: serves a notebook-style UI and runs the notebook's cells FOR REAL,
// streaming their output to the browser and returning the evidence JSON the helpers wrote.
//
//   node server.mjs --notebook <uat-notebook.json> [--port 4317] [--host 127.0.0.1]
//
// Zero dependencies (Node 18+). The notebook is loaded once and never re-read; only its cells
// can run, and there is no endpoint that runs anything else. Outputs are never cached, replayed
// or edited: every run spawns the cell's command and streams what it prints.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { parseArgs } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELP = 'node server.mjs --notebook <uat-notebook.json> [--port 4317] [--host 127.0.0.1]';

let opts;
try {
  ({ values: opts } = parseArgs({
    options: {
      notebook: { type: 'string' },
      port: { type: 'string', default: '4317' },
      host: { type: 'string', default: '127.0.0.1' },
      help: { type: 'boolean', default: false },
    },
  }));
} catch (e) {
  console.error(`${e.message}\n${HELP}`);
  process.exit(2);
}
if (opts.help) { console.log(HELP); process.exit(0); }
if (!opts.notebook) { console.error(HELP); process.exit(2); }

const port = Number.parseInt(opts.port, 10);
const notebookPath = resolve(opts.notebook);
const notebookDir = realpathSync(dirname(notebookPath));
const raw = readFileSync(notebookPath);
const sha256 = createHash('sha256').update(raw).digest('hex');
let parsed;
try { parsed = JSON.parse(raw.toString('utf8')); } catch (e) { fail(`not valid JSON: ${e.message}`); }
const notebook = validate(parsed);
const cellsById = new Map(notebook.cells.map((c) => [c.id, c]));
const timeoutOf = (c) => Number(c.timeoutSeconds ?? 300);

function fail(message) {
  console.error(`notebook error: ${message}`);
  process.exit(2);
}

function validateRunnable(c, label) {
  if (!c || typeof c !== 'object') fail(`${label}: must be an object`);
  if (c.command !== undefined) {
    if (!Array.isArray(c.command) || c.command.length === 0 || !c.command.every((a) => typeof a === 'string')) {
      fail(`${label}: command must be a non-empty array of strings`);
    }
    if (c.shell !== undefined || c.script !== undefined) fail(`${label}: use either command or shell+script, not both`);
  } else {
    if (!['pwsh', 'bash'].includes(c.shell)) fail(`${label}: needs command (argv array) or shell ('pwsh'|'bash') + script`);
    if (typeof c.script !== 'string' || !c.script.trim()) fail(`${label}: script must be a non-empty string`);
  }
  if (c.cwd !== undefined && typeof c.cwd !== 'string') fail(`${label}: cwd must be a string`);
  if (c.env !== undefined && (typeof c.env !== 'object' || Array.isArray(c.env) || !Object.values(c.env).every((v) => typeof v === 'string'))) {
    fail(`${label}: env must be an object of strings`);
  }
  if (c.evidence !== undefined && (!Array.isArray(c.evidence) || !c.evidence.every((p) => typeof p === 'string'))) {
    fail(`${label}: evidence must be an array of paths`);
  }
  if (c.timeoutSeconds !== undefined && !(Number(c.timeoutSeconds) > 0)) fail(`${label}: timeoutSeconds must be a positive number`);
}

function nonNegative(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function validateCellExtras(c, label) {
  if (c.step !== undefined && (typeof c.step !== 'string' || !/^\S{1,64}$/.test(c.step))) fail(`${label}: step must be a string without spaces`);
  if (c.criterion !== undefined && (typeof c.criterion !== 'string' || !c.criterion)) fail(`${label}: criterion must be a non-empty string`);
  for (const k of ['readSeconds', 'holdSeconds']) {
    if (c[k] !== undefined && !nonNegative(c[k])) fail(`${label}: ${k} must be a number >= 0`);
  }
  const t = c.trimWait;
  if (t !== undefined && typeof t !== 'boolean') {
    if (!t || typeof t !== 'object' || Array.isArray(t)) fail(`${label}: trimWait must be true, false or { keepStart, keepEnd }`);
    for (const k of ['keepStart', 'keepEnd']) {
      if (t[k] !== undefined && !nonNegative(t[k])) fail(`${label}: trimWait.${k} must be a number of seconds >= 0`);
    }
  }
}

function validate(nb) {
  if (!nb || typeof nb !== 'object') fail('not a JSON object');
  if (!Array.isArray(nb.cells) || nb.cells.length === 0) fail('cells[] is required');
  nb.title = String(nb.title ?? basename(notebookPath));
  nb.subtitle = (Array.isArray(nb.subtitle) ? nb.subtitle : nb.subtitle ? [nb.subtitle] : []).map(String);
  nb.criteria = Array.isArray(nb.criteria) ? nb.criteria : [];
  const critIds = new Set();
  for (const [i, k] of nb.criteria.entries()) {
    if (!k || typeof k !== 'object' || typeof k.id !== 'string' || !k.id) fail(`criteria[${i}] needs a string id`);
    if (critIds.has(k.id)) fail(`duplicate criterion id ${k.id}`);
    critIds.add(k.id);
  }
  const ids = new Set();
  for (const [i, c] of nb.cells.entries()) {
    if (typeof c?.id !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(c.id)) fail(`cells[${i}].id must match [A-Za-z0-9_.-]{1,64}`);
    if (ids.has(c.id)) fail(`duplicate cell id ${c.id}`);
    ids.add(c.id);
    validateRunnable(c, `cell ${c.id}`);
    validateCellExtras(c, `cell ${c.id}`);
  }
  for (const c of nb.cells) {
    if (c.criterion && !nb.criteria.some((k) => k.id === c.criterion)) nb.criteria.push({ id: c.criterion, title: '' });
  }
  if (nb.setup !== undefined) validateRunnable(nb.setup, 'setup');
  return nb;
}

function displayOf(c) {
  if (c.script) return c.script;
  // Presentation only: very long arguments are shortened on screen, like the helpers do.
  const short = (a) => (a.length > 120 ? `${a.slice(0, 40)}… ‹${a.length} chars›` : a);
  return c.command.map((a) => short(/[\s"'$`]/.test(a) || a === '' ? JSON.stringify(a) : a)).join(' ');
}

// Display info only: env values and the hidden setup are never sent to the browser.
function publicNotebook() {
  return {
    title: notebook.title,
    subtitle: notebook.subtitle,
    sha256,
    file: basename(notebookPath),
    hasSetup: !!notebook.setup,
    setup: setupState.status,
    criteria: notebook.criteria.map((k) => ({
      id: String(k.id),
      title: String(k.title ?? ''),
      source: k.source ? String(k.source) : null,
      proof: k.proof ? String(k.proof) : null,
    })),
    cells: notebook.cells.map((c) => ({
      id: c.id,
      criterion: c.criterion ?? null,
      step: c.step ?? null,
      title: c.title ?? c.id,
      markdown: c.markdown ?? '',
      display: c.display ?? displayOf(c),
      runner: c.command ? 'exec' : c.shell,
      cwd: c.cwd ?? '.',
      timeoutSeconds: timeoutOf(c),
      readSeconds: c.readSeconds ?? null,
      holdSeconds: c.holdSeconds ?? null,
      trimWait: c.trimWait ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Running commands
// ---------------------------------------------------------------------------------------------

function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
  }
}

// Runs a cell (or the setup) and calls onOutput(text) for every chunk of stdout/stderr as it
// arrives. Resolves with { exitCode, durationMs, timedOut, output, spawnError }.
function runProcess(c, onOutput) {
  const cwd = resolve(notebookDir, c.cwd ?? '.');
  const env = { ...process.env, ...(c.env ?? {}), FORCE_COLOR: '1' };
  if (!c.env || !('NO_COLOR' in c.env)) delete env.NO_COLOR;
  const [file, args] = c.command
    ? [c.command[0], c.command.slice(1)]
    : c.shell === 'pwsh'
      // Force UTF-8 so ✓, · and other non-ASCII output are not mangled by the console code page.
      ? ['pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        `[Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; ${c.script}`]]
      : ['bash', ['-lc', c.script]];
  const started = performance.now();
  return new Promise((done) => {
    let output = '';
    let timedOut = false;
    let settled = false;
    let timer;
    const emit = (text) => {
      if (!text) return;
      output += text;
      onOutput(text);
    };
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done({ ...r, durationMs: Math.round(performance.now() - started), timedOut, output });
    };
    if (!existsSync(cwd)) {
      emit(`workbench: working directory not found: ${cwd}\n`);
      finish({ exitCode: null, spawnError: 'working directory not found' });
      return;
    }
    let child;
    try {
      child = spawn(file, args, {
        cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      emit(`workbench: could not start ${file}: ${e.message}\n`);
      finish({ exitCode: null, spawnError: e.message });
      return;
    }
    timer = setTimeout(() => {
      timedOut = true;
      emit(`\nworkbench: timed out after ${timeoutOf(c)}s; killing the process tree\n`);
      killTree(child);
    }, timeoutOf(c) * 1000);
    for (const stream of [child.stdout, child.stderr]) {
      const decoder = new StringDecoder('utf8');
      stream.on('data', (b) => emit(decoder.write(b)));
      stream.on('end', () => emit(decoder.end()));
    }
    child.on('error', (e) => {
      emit(`workbench: could not start ${file}: ${e.message}\n`);
      finish({ exitCode: null, spawnError: e.message });
    });
    child.on('close', (code) => finish({ exitCode: code }));
    // A cell may start a long-lived process (for example restarting the server under test) that
    // inherits the output pipes; 'close' would then wait for that process too. Settle shortly
    // after the cell's own process exits, giving buffered output a moment to drain.
    child.on('exit', (code) => setTimeout(() => {
      for (const stream of [child.stdout, child.stderr]) stream.destroy();
      finish({ exitCode: code });
    }, 1500));
  });
}

const setupState = { status: notebook.setup ? 'pending' : 'none', promise: null, exitCode: null };
function ensureSetup() {
  if (!notebook.setup) return Promise.resolve(true);
  if (!setupState.promise) {
    setupState.status = 'running';
    console.log('setup: running hidden setup');
    setupState.promise = runProcess(notebook.setup, () => {}).then((r) => {
      setupState.exitCode = r.exitCode;
      setupState.status = r.exitCode === 0 && !r.timedOut ? 'ok' : 'failed';
      console.log(`setup: ${setupState.status} (exit ${r.exitCode}, ${r.durationMs} ms)`);
      // Setup output never reaches the UI; it is printed here only when setup failed.
      if (setupState.status === 'failed') console.log(r.output.split('\n').slice(-30).map((l) => `  setup| ${l}`).join('\n'));
      return setupState.status === 'ok';
    });
  }
  return setupState.promise;
}

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// Markers start at column 0 (the helpers print them that way), so an indented echo of a marker
// inside a response body or a log line is never taken as a verdict.
const MARKER = /^UAT_STEP (\S+) (PASS|FAIL|ERROR|SHOWN)\s*$/;
const EVIDENCE_LINE = /^\s*evidence: (.+?)\s*$/;

function insideNotebookDir(p) {
  let real;
  try { real = realpathSync(p); } catch { return null; }
  const rel = relative(notebookDir, real);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return real;
}

function kindOf(p) {
  const name = p.toLowerCase();
  if (name.endsWith('.http.json')) return 'http';
  if (name.endsWith('.log.json')) return 'log';
  if (name.endsWith('.browser.json')) return 'browser';
  if (name.endsWith('.docs.json')) return 'docs';
  return 'other';
}

function readEvidence(paths, cwd, notBefore) {
  const out = [];
  const seen = new Set();
  for (const { path: p, declared } of paths) {
    const real = insideNotebookDir(resolve(cwd, p));
    if (!real) {
      out.push({ kind: kindOf(p), path: p, declared, data: null, error: 'missing or outside the notebook directory; not read' });
      continue;
    }
    if (seen.has(real)) continue;
    seen.add(real);
    const shown = relative(notebookDir, real).split('\\').join('/');
    const st = statSync(real);
    // Declared files (cell.evidence) must have been written by this run, never left over from an earlier one.
    if (declared && st.mtimeMs < notBefore) {
      out.push({ kind: kindOf(real), path: shown, declared, data: null, error: 'not written by this run; not shown' });
      continue;
    }
    if (st.size > 5 * 1024 * 1024) {
      out.push({ kind: kindOf(real), path: shown, declared, data: null, error: 'larger than 5 MB; not shown' });
      continue;
    }
    let data = null;
    let error;
    try { data = JSON.parse(readFileSync(real, 'utf8')); } catch (e) { error = `not valid JSON: ${e.message}`; }
    out.push({ kind: kindOf(real), path: shown, declared, data, ...(error ? { error } : {}) });
  }
  return out;
}

const running = new Set();

async function runCell(cell, res) {
  let open = true;
  res.on('close', () => { open = false; });
  const send = (event, data) => {
    if (open) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const startedAt = Date.now();
  // Declared evidence must be at least as new as this run (1 s slack for coarse file-system clocks).
  const notBefore = startedAt - 1000;
  send('start', { cellId: cell.id, step: cell.step ?? null, at: new Date(startedAt).toISOString() });
  console.log(`run:  ${cell.id}`);

  const setupOk = await ensureSetup();
  let result;
  if (!setupOk) {
    const text = `workbench: the notebook's hidden setup failed (exit ${setupState.exitCode}); this cell was not run. See the server console.\n`;
    send('output', { text });
    result = { exitCode: null, durationMs: 0, timedOut: false, output: text, setupFailed: true };
  } else {
    result = await runProcess(cell, (text) => send('output', { text }));
  }

  const markers = [];
  // Declared evidence first: when the same file is also printed as "evidence: <path>", the
  // declared entry (with its freshness check) is the one that is kept.
  const evidencePaths = (cell.evidence ?? []).map((p) => ({ path: p, declared: true }));
  for (const line of result.output.replace(ANSI, '').split(/\r?\n/)) {
    const m = MARKER.exec(line);
    if (m) markers.push({ step: m[1], verdict: m[2] });
    const e = EVIDENCE_LINE.exec(line);
    if (e) evidencePaths.push({ path: e[1], declared: false });
  }
  const evidence = readEvidence(evidencePaths, resolve(notebookDir, cell.cwd ?? '.'), notBefore);

  let verdict;
  let reason = null;
  if (result.timedOut) { verdict = 'ERROR'; reason = `timed out after ${timeoutOf(cell)}s`; }
  else if (result.setupFailed) { verdict = 'ERROR'; reason = 'hidden setup failed'; }
  else if (result.spawnError) { verdict = 'ERROR'; reason = result.spawnError; }
  else if (cell.step) {
    // The cell's verdict is its own step's marker (the outermost helper), never an inner one.
    // Several own markers must agree, and a PASS from a process that then exited non-zero is a
    // contradiction: both are ERROR, never "the last marker wins".
    const own = [...new Set(markers.filter((m) => m.step === cell.step).map((m) => m.verdict))];
    if (own.length === 0) { verdict = 'ERROR'; reason = `no "UAT_STEP ${cell.step}" marker in the output`; }
    else if (own.length > 1) { verdict = 'ERROR'; reason = `conflicting "UAT_STEP ${cell.step}" markers: ${own.join(', ')}`; }
    else if (own[0] !== 'FAIL' && result.exitCode !== 0) { verdict = 'ERROR'; reason = `${own[0]} marker but the cell exited with code ${result.exitCode}`; }
    else verdict = own[0];
    // A check whose declared evidence is missing or left over from an earlier run proves nothing.
    const badEvidence = evidence.find((e) => e.declared && e.error && e.error !== 'larger than 5 MB; not shown');
    if (verdict === 'PASS' && badEvidence) { verdict = 'ERROR'; reason = `declared evidence ${badEvidence.path}: ${badEvidence.error}`; }
  } else {
    // A cell without a step makes no claim: it only shows real output.
    verdict = result.exitCode === 0 ? 'SHOWN' : 'ERROR';
    if (verdict === 'ERROR') reason = `exited with code ${result.exitCode}`;
  }
  send('done', { cellId: cell.id, exitCode: result.exitCode, durationMs: result.durationMs, markers, verdict, reason, evidence });
  console.log(`done: ${cell.id} ${verdict} (exit ${result.exitCode}, ${result.durationMs} ms)`);
  if (open) res.end();
}

// ---------------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------------

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
};
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
if (!['127.0.0.1', 'localhost'].includes(opts.host)) allowedHosts.add(`${opts.host.includes(':') ? `[${opts.host}]` : opts.host}:${port}`);

function reply(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = createServer((req, res) => {
  // Host check defeats DNS rebinding; the Origin check below defeats cross-site POSTs.
  const host = (req.headers.host ?? '').toLowerCase();
  if (!allowedHosts.has(host)) return reply(res, 403, { error: 'host not allowed' });
  let url;
  try { url = new URL(req.url, `http://${host}`); } catch { return reply(res, 400, { error: 'bad url' }); }

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (url.pathname === '/api/notebook') return reply(res, 200, publicNotebook());
    const file = STATIC[url.pathname];
    if (file) return reply(res, 200, readFileSync(join(HERE, file[0])), file[1]);
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    return reply(res, 404, { error: 'not found' });
  }

  if (req.method === 'POST') {
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${host}`) return reply(res, 403, { error: 'cross-origin request rejected' });
    const m = /^\/api\/cells\/([^/]+)\/run$/.exec(url.pathname);
    if (!m) return reply(res, 404, { error: 'not found' });
    let id;
    try { id = decodeURIComponent(m[1]); } catch { return reply(res, 400, { error: 'bad cell id' }); }
    const cell = cellsById.get(id);
    if (!cell) return reply(res, 404, { error: 'no such cell in this notebook' });
    if (running.has(id)) return reply(res, 409, { error: `cell ${id} is already running` });
    req.resume();
    running.add(id);
    runCell(cell, res)
      .catch((e) => {
        console.error(`run ${id} failed: ${e.stack ?? e}`);
        if (!res.headersSent) reply(res, 500, { error: 'internal error' });
        else res.end();
      })
      .finally(() => running.delete(id));
    return undefined;
  }

  return reply(res, 405, { error: 'method not allowed' });
});

server.on('error', (e) => {
  console.error(`server error: ${e.message}`);
  process.exit(2);
});
server.listen(port, opts.host, () => {
  console.log(`notebook: ${notebookPath}`);
  console.log(`sha256:   ${sha256}`);
  console.log(`cells:    ${notebook.cells.map((c) => c.id).join(', ')}`);
  console.log(`workbench: http://${opts.host.includes(':') ? `[${opts.host}]` : opts.host}:${port}/`);
  // Hidden setup starts now so it is usually finished before the first cell; cells wait for it.
  ensureSetup();
});

const shutdown = () => { server.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
