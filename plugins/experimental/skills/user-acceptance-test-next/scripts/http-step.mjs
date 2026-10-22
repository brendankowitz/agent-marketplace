#!/usr/bin/env node
// One acceptance-test HTTP step for a terminal recording: send a real request, print the
// exchange readably with secrets redacted, assert on the response, save nonsecret evidence,
// and finish with a marker line a VHS tape can wait on:  UAT_STEP <step> PASS|FAIL|ERROR
// (or SHOWN for a display-only step run with --no-assert, which gives no verdict).
//
// Exit codes: 0 every assertion passed (or SHOWN), 1 an assertion failed or the request was sent
// but no complete response came back (timeout, reset), 2 usage error or could not connect.
// Requires Node 18+ (global fetch). Run with --help for options.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const HELP = `node http-step.mjs --step AC1 --method PUT --url <url> [options]

  --step <id>               criterion id, used in the marker line (required)
  --method <verb>           HTTP method (default GET)
  --url <url>               request URL (required)
  --header "Name: value"    request header (repeatable)
  --body <text|@file>       request body, inline or from a file
  --bearer-env <VAR>        send "Authorization: Bearer <value of VAR>"; never printed
  --expect-status <codes>   accepted status codes, comma separated (e.g. 201 or 200,204)
  --expect-body <text>      response body must contain text (repeatable)
  --reject-body <text>      response body must NOT contain text, e.g. a secret or echoed input (repeatable)
  --expect-json <path=val>  JSON value at path must equal val, e.g. id.length=64 (repeatable)
                            At least one --expect-* is required, unless --no-assert is given.
  --no-assert               display-only supporting step: no verdict, ends with UAT_STEP <step> SHOWN
  --select <paths>          show only these response fields, comma separated
  --show-header <name>      response header to display (repeatable)
  --max-lines <n>           truncate displayed bodies after n lines (default 30)
  --timeout <seconds>       request timeout (default 30)
  --poll <seconds>          for async APIs: re-send every --poll-interval seconds until the status is
                            one of --expect-status or <seconds> have passed (needs --expect-status)
  --poll-interval <seconds> delay between polls (default 2)
  --evidence <dir>          write <step>-<n>.http.json with the redacted exchange
  --no-color                disable ANSI colors`;

const SECRET_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'api-key', 'ocp-apim-subscription-key', 'x-functions-key']);

let opts;
try {
  ({ values: opts } = parseArgs({
    options: {
      step: { type: 'string' },
      method: { type: 'string', default: 'GET' },
      url: { type: 'string' },
      header: { type: 'string', multiple: true, default: [] },
      body: { type: 'string' },
      'bearer-env': { type: 'string' },
      'expect-status': { type: 'string' },
      'expect-body': { type: 'string', multiple: true, default: [] },
      'reject-body': { type: 'string', multiple: true, default: [] },
      'expect-json': { type: 'string', multiple: true, default: [] },
      'no-assert': { type: 'boolean', default: false },
      select: { type: 'string' },
      'show-header': { type: 'string', multiple: true, default: [] },
      'max-lines': { type: 'string', default: '30' },
      timeout: { type: 'string', default: '30' },
      poll: { type: 'string' },
      'poll-interval': { type: 'string', default: '2' },
      evidence: { type: 'string' },
      'no-color': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  }));
} catch (e) {
  console.error(`${e.message}\n\n${HELP}`);
  process.exit(2);
}
if (opts.help) { console.log(HELP); process.exit(0); }

const useColor = !opts['no-color'] && !process.env.NO_COLOR && (process.stdout.isTTY || !!process.env.FORCE_COLOR);
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = { dim: paint('2'), bold: paint('1'), red: paint('31'), green: paint('32'), yellow: paint('33'), blue: paint('34'), cyan: paint('36') };

const step = opts.step;
function errorOut(message) {
  console.log(c.red(`✗ ${message}`));
  console.log(`UAT_STEP ${step ?? '?'} ERROR`);
  process.exit(2);
}
if (!step) { console.error(HELP); errorOut('--step is required'); }
if (!opts.url) errorOut('--url is required');
const hasAssertions = !!opts['expect-status'] || opts['expect-body'].length > 0 || opts['reject-body'].length > 0 || opts['expect-json'].length > 0;
if (!hasAssertions && !opts['no-assert']) {
  errorOut('no assertions given: pass --expect-status, --expect-body or --expect-json (or --no-assert for a display-only step)');
}
const maxLines = Number.parseInt(opts['max-lines'], 10);
const timeoutMs = Number.parseFloat(opts.timeout) * 1000;

function parsePath(path) {
  return path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
}
function getPath(obj, path) {
  return parsePath(path).reduce((v, k) => (v === undefined || v === null ? undefined : v[k]), obj);
}
function tryJson(text) {
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false }; }
}
function limit(text) {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return `${lines.slice(0, maxLines).join('\n')}\n${c.dim(`… ${lines.length - maxLines} more lines (full body in evidence)`)}`;
}
function indent(text) {
  return text.split('\n').map((l) => `  ${l}`).join('\n');
}
function pretty(text) {
  const j = tryJson(text);
  return j.ok ? JSON.stringify(j.value, null, 2) : text;
}

const headers = new Headers();
// Header names as the caller wrote them: fetch sends them with this case, but Headers.entries()
// lowercases, so display and evidence use this list instead.
const sentHeaders = [];
for (const h of opts.header) {
  const i = h.indexOf(':');
  if (i <= 0) errorOut(`header must be "Name: value": ${h}`);
  headers.append(h.slice(0, i).trim(), h.slice(i + 1).trim());
  sentHeaders.push([h.slice(0, i).trim(), h.slice(i + 1).trim()]);
}
if (opts['bearer-env']) {
  const token = process.env[opts['bearer-env']];
  if (!token) errorOut(`environment variable ${opts['bearer-env']} is empty or unset`);
  headers.set('Authorization', `Bearer ${token}`);
}
let body;
if (opts.body !== undefined) {
  body = opts.body.startsWith('@') ? readFileSync(resolve(opts.body.slice(1)), 'utf8') : opts.body;
}
const method = opts.method.toUpperCase();
if (opts['bearer-env']) sentHeaders.push(['Authorization', '‹redacted›']);
const redact = (pairs) => pairs.map(([k, v]) => [k, SECRET_HEADERS.has(k.toLowerCase()) ? '‹redacted›' : v]);
const shownHeaders = (h) => redact([...h.entries()]);
// Long request header values (limit tests) are shortened on screen only; evidence keeps them whole.
const shortValue = (v) => (v.length > 100 ? `${v.slice(0, 24)}… ${c.yellow(`‹${v.length} chars›`)}` : v);

console.log(c.bold(c.blue(`── ${step} ${'─'.repeat(Math.max(4, 60 - step.length))}`)));
console.log(`${c.cyan('→')} ${c.bold(method)} ${opts.url}`);
for (const [k, v] of redact(sentHeaders)) console.log(c.dim(`  ${k}: ${shortValue(v)}`));
if (body !== undefined) console.log(indent(limit(pretty(body))));

const pollSeconds = opts.poll ? Number.parseFloat(opts.poll) : 0;
const wantStatus = opts['expect-status'] ? opts['expect-status'].split(',').map((s) => Number.parseInt(s.trim(), 10)) : null;
if (pollSeconds && !wantStatus) errorOut('--poll needs --expect-status');
const pollDeadline = Date.now() + pollSeconds * 1000;
const pollInterval = Number.parseFloat(opts['poll-interval']) * 1000;

let started;
let response;
let text;
for (let attempt = 1; ; attempt++) {
  started = performance.now();
  try {
    response = await fetch(opts.url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    text = await response.text();
  } catch (e) {
    const code = e.cause?.code ?? '';
    const detail = `${e.name === 'TimeoutError' ? `no response within ${opts.timeout}s` : e.message}${code ? ` (${code})` : e.cause?.message ? ` (${e.cause.message})` : ''}`;
    // Could not reach the service at all: the step or environment is broken, not the product.
    const CONNECT = /^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|CERT_HAS_EXPIRED|ERR_TLS_CERT_ALTNAME_INVALID)$/;
    if (CONNECT.test(code)) errorOut(`could not connect: ${detail}`);
    // The request was sent but no complete response came back (timeout, reset, crash). When
    // preflight showed the service healthy, that is a product failure, so it is recorded as FAIL.
    const results = [{ check: `complete response received: ${detail}`, pass: false }];
    console.log(c.red(`✗ ${results[0].check}`));
    writeEvidence({ verdict: 'FAIL', durationMs: Math.round(performance.now() - started), response: null, assertions: results });
    console.log(c.red(c.bold(`UAT_STEP ${step} FAIL`)));
    process.exit(1);
  }
  if (!pollSeconds || wantStatus.includes(response.status) || Date.now() >= pollDeadline) break;
  console.log(c.dim(`← ${response.status} ${response.statusText} (attempt ${attempt}; polling until ${wantStatus.join('/')})`));
  await new Promise((r) => setTimeout(r, pollInterval));
}
const ms = Math.round(performance.now() - started);

const statusColor = response.status < 300 ? c.green : response.status < 400 ? c.yellow : c.red;
console.log(`${c.cyan('←')} ${statusColor(c.bold(`${response.status} ${response.statusText}`))} ${c.dim(`(${ms} ms)`)}`);
for (const name of opts['show-header']) {
  const v = response.headers.get(name);
  const shown = v === null ? c.dim('(absent)') : SECRET_HEADERS.has(name.toLowerCase()) ? '‹redacted›' : v;
  console.log(`  ${name}: ${shown}`);
}
const parsed = tryJson(text);
if (opts.select) {
  console.log(c.dim('  selected response fields:'));
  if (!parsed.ok) console.log(indent(c.yellow('(response body is not JSON)')));
  for (const p of opts.select.split(',').map((s) => s.trim()).filter(Boolean)) {
    const v = parsed.ok ? getPath(parsed.value, p) : undefined;
    console.log(`  ${c.bold(p)}: ${v === undefined ? c.dim('(absent)') : JSON.stringify(v)}`);
  }
} else if (text.length) {
  console.log(indent(limit(pretty(text))));
} else {
  console.log(c.dim('  (empty body)'));
}

const results = [];
if (opts['expect-status']) {
  const ok = opts['expect-status'].split(',').map((s) => Number.parseInt(s.trim(), 10));
  results.push({ check: `status ${response.status} in [${ok.join(', ')}]`, pass: ok.includes(response.status) });
}
for (const needle of opts['expect-body']) {
  results.push({ check: `body contains ${JSON.stringify(needle)}`, pass: text.includes(needle) });
}
for (const needle of opts['reject-body']) {
  const shown = needle.length > 40 ? `${JSON.stringify(needle.slice(0, 16))}… (${needle.length} chars)` : JSON.stringify(needle);
  results.push({ check: `body does not contain ${shown}`, pass: !text.includes(needle) });
}
for (const exp of opts['expect-json']) {
  const i = exp.indexOf('=');
  if (i <= 0) errorOut(`--expect-json must be path=value: ${exp}`);
  const path = exp.slice(0, i);
  const raw = exp.slice(i + 1);
  const want = tryJson(raw).ok ? JSON.parse(raw) : raw;
  const got = parsed.ok ? getPath(parsed.value, path) : undefined;
  results.push({ check: `${path} = ${JSON.stringify(want)} (got ${got === undefined ? 'absent' : JSON.stringify(got)})`, pass: JSON.stringify(got) === JSON.stringify(want) });
}
if (results.length === 0) {
  // --no-assert: a supporting display step that makes no claim.
  writeEvidence({ verdict: 'SHOWN', durationMs: ms, response: responseRecord(), assertions: [] });
  console.log(c.bold(`UAT_STEP ${step} SHOWN`));
  process.exit(0);
}
for (const r of results) console.log(r.pass ? c.green(`✓ ${r.check}`) : c.red(`✗ ${r.check}`));
const verdict = results.every((r) => r.pass) ? 'PASS' : 'FAIL';
writeEvidence({ verdict, durationMs: ms, response: responseRecord(), assertions: results });

console.log(verdict === 'PASS' ? c.green(c.bold(`UAT_STEP ${step} PASS`)) : c.red(c.bold(`UAT_STEP ${step} FAIL`)));
process.exit(verdict === 'PASS' ? 0 : 1);

function responseRecord() {
  return { status: response.status, statusText: response.statusText, headers: Object.fromEntries(shownHeaders(response.headers)), body: text };
}

function writeEvidence({ verdict: v, durationMs, response: resp, assertions }) {
  if (!opts.evidence) return;
  const dir = resolve(opts.evidence);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${step}-${Date.now()}.http.json`);
  const record = {
    step, verdict: v, at: new Date().toISOString(), durationMs,
    request: { method, url: opts.url, headers: Object.fromEntries(redact(sentHeaders)), body: body ?? null },
    response: resp, assertions,
  };
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.log(c.dim(`  evidence: ${file}`));
}
