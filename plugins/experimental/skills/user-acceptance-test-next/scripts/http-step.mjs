#!/usr/bin/env node
// One acceptance-test HTTP step for a terminal recording: send a real request, print the
// exchange readably with secrets redacted, assert on the response, save nonsecret evidence,
// and finish with a marker line a VHS tape can wait on:  UAT_STEP <step> PASS|FAIL|ERROR
// (or SHOWN for a display-only step run with --no-assert, which gives no verdict).
//
// Exit codes: 0 every assertion passed (or SHOWN), 1 an assertion failed or the request was sent
// but no complete response came back (timeout, reset), 2 usage error or could not connect.
// Requires Node 18+ (global fetch). Run with --help for options.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const HELP = `node http-step.mjs --step AC1 --method PUT --url <url> [options]

  --step <id>               criterion id, used in the marker line (required)
  --method <verb>           HTTP method (default GET)
  --url <url|@file>         request URL (required); @file reads a URL saved by an earlier --save
  --header "Name: value"    request header (repeatable)
  --body <text|@file>       request body, inline or from a file
  --bearer-env <VAR>        send "Authorization: Bearer <value of VAR>"; never printed
  --expect-status <codes>   accepted status codes, comma separated (e.g. 201 or 200,204)
  --expect-body <text>      response body must contain text (repeatable)
  --reject-body <text>      response body must NOT contain text, e.g. a secret or echoed input (repeatable)
  --expect-json <path><op><value>
                            check a JSON value (repeatable). op: = != > >= < <= ~= (regex).
                            Paths: a.b, a[0].b, a.length, filters a[name=status].valueCode.
                            value may be @file (saved by --save), e.g. entry[0].resource.id!=@first.txt
                            At least one --expect-* or --reject-body is required, unless --no-assert is given.
  --no-assert               display-only supporting step: no verdict, ends with UAT_STEP <step> SHOWN
  --select <paths>          show only these response fields, comma separated
  --show-header <name>      response header to display (repeatable)
  --max-lines <n>           truncate displayed bodies after n lines (default 30)
  --timeout <seconds>       request timeout (default 30)
  --poll <seconds>          for async APIs: re-send every --poll-interval seconds until every
                            assertion passes or <seconds> have passed (e.g. a job reaching Completed)
  --poll-interval <seconds> delay between polls (default 2)
  --save <path>=<file>      write the JSON value at path to a file for later steps (repeatable),
                            e.g. link[relation=next].url=next-page.txt
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
      save: { type: 'string', multiple: true, default: [] },
      'poll-interval': { type: 'string', default: '2' },
      evidence: { type: 'string' },
      'no-color': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  }));
} catch (e) {
  console.error(`${e.message}\n\n${HELP}`);
  console.log('UAT_STEP ? ERROR');
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
function readAtFile(value) {
  // "@file" reads a value saved by an earlier step (--save). Used only by --url and
  // --expect-json; --expect-body / --reject-body are always literal text (e.g. "@odata.nextLink").
  if (typeof value !== 'string' || !value.startsWith('@')) return { text: value, fromFile: false };
  const file = resolve(value.slice(1));
  if (!existsSync(file)) errorOut(`value file not found: ${file}`);
  return { text: readFileSync(file, 'utf8').trim(), fromFile: true };
}
if (opts.url.startsWith('@')) opts.url = readAtFile(opts.url).text;
const hasAssertions = !!opts['expect-status'] || opts['expect-body'].length > 0 || opts['reject-body'].length > 0 || opts['expect-json'].length > 0;
if (!hasAssertions && !opts['no-assert']) {
  errorOut('no assertions given: pass --expect-status, --expect-body, --reject-body or --expect-json (or --no-assert for a display-only step)');
}
// An empty expectation matches every response, so it can only be a mistake (often an unset variable).
for (const k of ['expect-body', 'reject-body']) {
  if (opts[k].some((v) => v === '')) errorOut(`--${k} is empty; it would match any body`);
}
if (opts['expect-status'] && !opts['expect-status'].split(',').every((s) => /^\d{3}$/.test(s.trim()))) {
  errorOut(`--expect-status must be 3-digit codes, comma separated: ${opts['expect-status']}`);
}
const num = (name, min) => {
  const v = Number(opts[name]);
  if (!Number.isFinite(v) || v < min) errorOut(`--${name} must be a number >= ${min}: ${opts[name]}`);
  return v;
};
const maxLines = num('max-lines', 1);
const timeoutMs = num('timeout', 0.001) * 1000;
// Parse and validate every --expect-json before sending anything, so a typo is an ERROR (exit 2)
// rather than a crash after the request.
// Assertion paths: segments joined by dots, with [n] indexes and [name=value] filters.
const PATH_SYNTAX = /^(?:[^.[\]=!<>~]+|\[[^\]=]+=[^\]]*\]|\[\d+\])(?:\.[^.[\]=!<>~]+|\[[^\]=]+=[^\]]*\]|\[\d+\])*$/;
const expectations = opts['expect-json'].map((exp) => {
  const parts = splitExpectation(exp);
  if (!parts || !parts[0]) errorOut(`--expect-json must be <path><op><value> with op one of = != > >= < <= ~=: ${exp}`);
  const [path, op, rawValue] = parts;
  if (!PATH_SYNTAX.test(path)) errorOut(`--expect-json path is malformed (use a.b, a[0].b, a[name=x].b): ${path}`);
  const { text: value } = readAtFile(rawValue);
  if (op === '~=') {
    try { new RegExp(value); } catch (e) { errorOut(`invalid regex in --expect-json ${exp}: ${e.message}`); }
  }
  return { path, op, rawValue };
});

// Paths: a.b, a[0].b, a.length, and array filters a[name=status].value (first element whose
// property equals the text), which covers FHIR Parameters and Bundle.link lookups.
function getPath(obj, path) {
  const re = /\[([^\]=]+)=([^\]]*)\]|\[(\d+)\]|([^.[\]]+)/g;
  let v = obj;
  for (let m; (m = re.exec(path));) {
    if (v === undefined || v === null) return undefined;
    if (m[1] !== undefined) {
      if (!Array.isArray(v)) return undefined;
      v = v.find((x) => x !== null && typeof x === 'object' && x[m[1]] !== undefined && String(x[m[1]]) === m[2]);
    } else {
      v = v[m[3] !== undefined ? Number(m[3]) : m[4]];
    }
  }
  return v;
}
// Split "path<op>value" at the first operator outside [...], so filters may contain "=".
function splitExpectation(exp) {
  let depth = 0;
  for (let i = 0; i < exp.length; i++) {
    const ch = exp[i];
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    else if (depth === 0) {
      const two = exp.slice(i, i + 2);
      if (['!=', '>=', '<=', '~='].includes(two)) return [exp.slice(0, i), two, exp.slice(i + 2)];
      if (['=', '>', '<'].includes(ch)) return [exp.slice(0, i), ch, exp.slice(i + 1)];
    }
  }
  return null;
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
  if (opts.body.startsWith('@')) {
    try { body = readFileSync(resolve(opts.body.slice(1)), 'utf8'); } catch (e) { errorOut(`could not read --body file: ${e.message}`); }
  } else body = opts.body;
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

const pollSeconds = opts.poll ? num('poll', 0.001) : 0;
if (pollSeconds && !hasAssertions) errorOut('--poll needs at least one assertion to wait for');
const pollDeadline = Date.now() + pollSeconds * 1000;
const pollInterval = num('poll-interval', 0.05) * 1000;

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
  // Stop when the next attempt would start after the deadline, so a late success never counts.
  if (!pollSeconds || evaluate().every((r) => r.pass) || Date.now() + pollInterval > pollDeadline) break;
  const pending = evaluate().filter((r) => !r.pass).map((r) => r.check).join('; ');
  console.log(c.dim(`← ${response.status} ${response.statusText} (attempt ${attempt}; waiting for: ${pending.length > 110 ? `${pending.slice(0, 107)}…` : pending})`));
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

const results = evaluate();
for (const spec of opts.save) {
  const i = spec.lastIndexOf('=');
  if (i <= 0) errorOut(`--save must be path=file: ${spec}`);
  const value = parsed.ok ? getPath(parsed.value, spec.slice(0, i)) : undefined;
  if (value === undefined) {
    results.push({ check: `${spec.slice(0, i)} present (to save)`, pass: false });
  } else {
    try {
      writeFileSync(resolve(spec.slice(i + 1)), typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
    } catch (e) {
      errorOut(`could not save ${spec.slice(0, i)} to ${spec.slice(i + 1)}: ${e.message}`);
    }
    console.log(c.dim(`  saved ${spec.slice(0, i)} → ${spec.slice(i + 1)}`));
  }
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

// All assertions against the current response; also used by --poll to decide when to stop.
function evaluate() {
  const out = [];
  const json = tryJson(text);
  if (opts['expect-status']) {
    const ok = opts['expect-status'].split(',').map((s) => Number.parseInt(s.trim(), 10));
    out.push({ check: `status ${response.status} in [${ok.join(', ')}]`, pass: ok.includes(response.status) });
  }
  for (const needle of opts['expect-body']) {
    out.push({ check: `body contains ${JSON.stringify(needle)}`, pass: text.includes(needle) });
  }
  for (const needle of opts['reject-body']) {
    const shown = needle.length > 40 ? `${JSON.stringify(needle.slice(0, 16))}… (${needle.length} chars)` : JSON.stringify(needle);
    out.push({ check: `body does not contain ${shown}`, pass: !text.includes(needle) });
  }
  for (const { path, op, rawValue } of expectations) {
    const { text: raw } = readAtFile(rawValue);
    if (op === '~=' && raw === '') errorOut(`--expect-json ${path}~= has an empty pattern, which matches anything`);
    const got = json.ok ? getPath(json.value, path) : undefined;
    // When the actual value is a string, compare as text (unless the expectation is a quoted JSON
    // string), so ids such as "123" match a literal 123 or a value saved by --save.
    const want = typeof got === 'string' && !raw.trim().startsWith('"') ? raw : tryJson(raw).ok ? JSON.parse(raw) : raw;
    const gotText = got === undefined ? 'absent' : JSON.stringify(got);
    let pass;
    if (op === '=') pass = got !== undefined && JSON.stringify(got) === JSON.stringify(want);
    else if (op === '!=') pass = got !== undefined && JSON.stringify(got) !== JSON.stringify(want);
    else if (op === '~=') pass = got !== undefined && new RegExp(String(want)).test(typeof got === 'string' ? got : JSON.stringify(got));
    else {
      // Only real numbers (or numeric strings) compare; null, "", booleans and arrays fail.
      const a = toNumber(got);
      const b = toNumber(want);
      pass = Number.isFinite(a) && Number.isFinite(b)
        && (op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b : a <= b);
    }
    out.push({ check: `${path} ${op} ${JSON.stringify(want)} (got ${gotText})`, pass });
  }
  return out;
}

function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return Number.NaN;
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
