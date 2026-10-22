#!/usr/bin/env node
// One acceptance-test documentation step: show the lines a PR ADDED to each doc and assert that
// the key statements are there. Prints UAT_STEP <step> PASS|FAIL|ERROR for VHS or the workbench.
//
//   node docs-step.mjs --step AC9 --base <merge-base sha or @file> \
//     --check "docs/SemanticSearch.md::disabled\s+by default" \
//     --check "docs/SemanticSearch.md::8,192-token" --evidence evidence
//
// Paths are repository-relative (from the repo root, wherever this runs inside the repo).
// Exit codes: 0 pass, 1 a statement is missing, 2 usage or git error.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values: o } = parseArgs({
  options: {
    step: { type: 'string' },
    base: { type: 'string' },
    head: { type: 'string', default: 'HEAD' },
    check: { type: 'string', multiple: true, default: [] },
    flags: { type: 'string', default: 'i' },
    evidence: { type: 'string' },
    'no-color': { type: 'boolean', default: false },
  },
});
const useColor = !o['no-color'] && !process.env.NO_COLOR && (process.stdout.isTTY || !!process.env.FORCE_COLOR);
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = { dim: paint('2'), bold: paint('1'), red: paint('31'), green: paint('32'), blue: paint('34') };
const step = o.step;
function errorOut(message) {
  console.log(c.red(`✗ ${message}`));
  console.log(`UAT_STEP ${step ?? '?'} ERROR`);
  process.exit(2);
}
if (!step || !o.base || o.check.length === 0) errorOut('--step, --base and at least one --check "path::regex" are required');
let base = o.base;
if (base.startsWith('@')) {
  const f = resolve(base.slice(1));
  if (!existsSync(f)) errorOut(`base file not found: ${f}`);
  base = readFileSync(f, 'utf8').trim();
}

// Group checks by file, keeping their order.
const files = new Map();
for (const spec of o.check) {
  const i = spec.indexOf('::');
  if (i <= 0) errorOut(`--check must be "path::regex": ${spec}`);
  const file = spec.slice(0, i);
  let re;
  try { re = new RegExp(spec.slice(i + 2), o.flags.replace(/[gy]/g, '')); } catch (e) { errorOut(`invalid regex in ${spec}: ${e.message}`); }
  if (!files.has(file)) files.set(file, []);
  files.get(file).push(re);
}

const results = [];
const shown = [];
for (const [file, patterns] of files) {
  let diff;
  try {
    diff = execFileSync('git', ['--no-pager', 'diff', '-U0', base, o.head, '--', `:(top)${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    errorOut(`git diff failed for ${file}: ${(e.stderr || e.message).toString().trim().split('\n')[0]}`);
  }
  const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
  console.log(`${c.bold(c.blue(`── ${file}`))} ${c.dim(`(+${added.length} lines added by this change)`)}`);
  for (const re of patterns) {
    const hit = added.find((l) => re.test(l));
    const check = `${file} adds a line matching /${re.source}/`;
    if (hit) {
      const t = hit.trim();
      console.log(`  ${c.green('✓')} ${t.length > 120 ? `${t.slice(0, 117)}…` : t}`);
      shown.push({ file, pattern: re.source, line: t });
    } else {
      console.log(`  ${c.red(`✗ no added line matches /${re.source}/`)}`);
    }
    results.push({ check, pass: !!hit });
  }
}
const verdict = results.every((r) => r.pass) ? 'PASS' : 'FAIL';
if (o.evidence) {
  const dir = resolve(o.evidence);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${step}-${Date.now()}.docs.json`);
  writeFileSync(file, `${JSON.stringify({ step, verdict, at: new Date().toISOString(), base, head: o.head, matches: shown, assertions: results }, null, 2)}\n`, 'utf8');
  console.log(c.dim(`  evidence: ${file}`));
}
console.log(verdict === 'PASS' ? c.green(c.bold(`UAT_STEP ${step} PASS`)) : c.red(c.bold(`UAT_STEP ${step} FAIL`)));
process.exit(verdict === 'PASS' ? 0 : 1);
