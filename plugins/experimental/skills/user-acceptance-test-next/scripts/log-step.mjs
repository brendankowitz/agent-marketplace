#!/usr/bin/env node
// One acceptance-test log step for a terminal recording: remember where a log file ends,
// optionally run a command (the action under test), then show only the NEW log lines that
// match a pattern and assert how many appeared. Finishes with a marker line a VHS tape can
// wait on:  UAT_STEP <step> PASS|FAIL|ERROR
//
//   node log-step.mjs --step AC3 --file app.log --pattern "PatientCreated" --run node http-step.mjs ...
//
// Exit codes: 0 pass, 1 assertion failed (or the command failed), 2 usage error.

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const HELP = `node log-step.mjs --step AC3 --file <log> --pattern <regex> [options] [--run command args...]

  --step <id>             criterion id, used in the marker line (required)
  --file <path>           log file the system under test writes to (required)
  --pattern <regex>       JavaScript regex a new line must match (required)
  --flags <flags>         regex flags (default i)
  --expect-count <spec>   how many matching new lines: N, >=N or <=N (default >=1; use 0 to prove absence)
  --timeout <seconds>     how long to wait for matches after the command (default 15). Only >=N
                          stops early; N, <=N and 0 wait the full timeout so late lines count
  --context <n>           also show n non-matching new lines before each match (default 0)
  --max <n>               display at most n matching lines (default 10)
  --allow-command-failure do not fail the step when the command exits non-zero
  --evidence <dir>        write <step>-<n>.log.json with the verdict and matched lines
  --no-color              disable ANSI colors
  --run command args...   the action to run between the snapshot and the check; everything after
                          --run is the command (no shell; pass an executable such as node or curl)`;

const argv = process.argv.slice(2);
// "--run" separates the action; a bare "--" also works, but PowerShell drops "--" when it is
// passed through a function such as uat-log, so documentation uses --run.
const sep = argv.findIndex((a) => a === '--run' || a === '--');
const ownArgs = sep === -1 ? argv : argv.slice(0, sep);
const command = sep === -1 ? [] : argv.slice(sep + 1);

let opts;
try {
  ({ values: opts } = parseArgs({
    args: ownArgs,
    options: {
      step: { type: 'string' },
      file: { type: 'string' },
      pattern: { type: 'string' },
      flags: { type: 'string', default: 'i' },
      'expect-count': { type: 'string', default: '>=1' },
      timeout: { type: 'string', default: '15' },
      context: { type: 'string', default: '0' },
      max: { type: 'string', default: '10' },
      'allow-command-failure': { type: 'boolean', default: false },
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
const c = { dim: paint('2'), bold: paint('1'), red: paint('31'), green: paint('32'), yellow: paint('33'), blue: paint('34'), magenta: paint('35') };

const step = opts.step;
function errorOut(message) {
  console.log(c.red(`✗ ${message}`));
  console.log(`UAT_STEP ${step ?? '?'} ERROR`);
  process.exit(2);
}
if (!step || !opts.file || !opts.pattern) { console.error(HELP); errorOut('--step, --file and --pattern are required'); }

let regex;
try { regex = new RegExp(opts.pattern, opts.flags.replace(/[gy]/g, '')); } catch (e) { errorOut(`invalid --pattern: ${e.message}`); }
const m = /^(>=|<=)?\s*(\d+)$/.exec(opts['expect-count'].trim());
if (!m) errorOut(`--expect-count must be N, >=N or <=N: ${opts['expect-count']}`);
const [, op = '=', countText] = m;
const wanted = Number.parseInt(countText, 10);
const countOk = (n) => (op === '>=' ? n >= wanted : op === '<=' ? n <= wanted : n === wanted);
const file = resolve(opts.file);
const sizeOf = () => (existsSync(file) ? statSync(file).size : 0);

function readFrom(offset) {
  const size = sizeOf();
  if (size <= offset) return '';
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size - offset);
    readSync(fd, buf, 0, buf.length, offset);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

const start = sizeOf();
let commandFailed = false;
if (command.length) {
  const r = spawnSync(command[0], command.slice(1), { stdio: 'inherit' });
  if (r.error) errorOut(`could not run ${command[0]}: ${r.error.message}`);
  commandFailed = r.status !== 0;
}

console.log(c.bold(c.blue(`── ${step} log: ${opts.file} ${'─'.repeat(Math.max(4, 50 - step.length - opts.file.length))}`)));
console.log(c.dim(`  new lines matching /${opts.pattern}/${opts.flags}, expecting ${op === '=' ? '' : op}${wanted}`));

// Wait for matches. Only ">=N" can stop early; an exact count, an upper bound or absence waits the
// full timeout, otherwise a duplicate arriving later would be missed and falsely PASS.
const deadline = Date.now() + Number.parseFloat(opts.timeout) * 1000;
const waitFull = op !== '>=';
let lines = [];
let matches = [];
for (;;) {
  lines = readFrom(start).split(/\r?\n/).filter((l) => l.length);
  matches = lines.map((l, i) => [i, l]).filter(([, l]) => regex.test(l));
  if (!waitFull && matches.length >= wanted) break;
  if (Date.now() >= deadline) break;
  await new Promise((r) => setTimeout(r, 250));
}

const context = Number.parseInt(opts.context, 10);
const max = Number.parseInt(opts.max, 10);
const shown = new Set();
for (const [i] of matches.slice(0, max)) {
  for (let k = Math.max(0, i - context); k < i; k++) {
    if (!shown.has(k)) { console.log(c.dim(`  ${lines[k]}`)); shown.add(k); }
  }
  if (!shown.has(i)) { console.log(`  ${c.magenta(lines[i])}`); shown.add(i); }
}
if (matches.length > max) console.log(c.dim(`  … ${matches.length - max} more matching lines`));
if (matches.length === 0) console.log(c.dim(`  (no matching lines among ${lines.length} new lines)`));

const results = [{ check: `${matches.length} matching new line(s), expected ${op === '=' ? '' : op}${wanted}`, pass: countOk(matches.length) }];
if (command.length) {
  results.push({ check: `command ${commandFailed ? 'exited non-zero' : 'succeeded'}`, pass: !commandFailed || opts['allow-command-failure'] });
}
for (const r of results) console.log(r.pass ? c.green(`✓ ${r.check}`) : c.red(`✗ ${r.check}`));
const verdict = results.every((r) => r.pass) ? 'PASS' : 'FAIL';
if (opts.evidence) {
  const dir = resolve(opts.evidence);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${step}-${Date.now()}.log.json`);
  writeFileSync(file, `${JSON.stringify({
    step, verdict, at: new Date().toISOString(), logFile: resolve(opts.file),
    pattern: opts.pattern, flags: opts.flags, expectCount: opts['expect-count'], timeoutSeconds: Number(opts.timeout),
    command: command.length ? command : null, commandFailed,
    newLineCount: lines.length, matches: matches.map(([, l]) => l), assertions: results,
  }, null, 2)}\n`, 'utf8');
  console.log(c.dim(`  evidence: ${file}`));
}
console.log(verdict === 'PASS' ? c.green(c.bold(`UAT_STEP ${step} PASS`)) : c.red(c.bold(`UAT_STEP ${step} FAIL`)));
process.exit(verdict === 'PASS' ? 0 : 1);
