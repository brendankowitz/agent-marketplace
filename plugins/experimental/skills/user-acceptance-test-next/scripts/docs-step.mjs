#!/usr/bin/env node
// One acceptance-test documentation step: show the lines a PR ADDED to each doc and assert that
// the key statements are there. Prints UAT_STEP <step> PASS|FAIL|ERROR for VHS or the workbench.
//
//   node docs-step.mjs --step AC9 --base <merge-base sha or @file> \
//     --check "docs/SemanticSearch.md::disabled\s+by default" \
//     --check "docs/SemanticSearch.md::8,192-token" --evidence evidence
//
// Paths are repository-relative (from the repo root, wherever this runs inside the repo). Lines
// are compared against the merge base of --base and --head (git's three-dot diff), renames are
// detected, and line-ending-only changes are ignored, so only text this change wrote counts. A
// paragraph moved from another file still counts as added; check its source by hand.
// Exit codes: 0 pass, 1 a statement is missing, 2 usage or git error (including a path that
// does not exist at --head).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values: o } = (() => {
  try {
    return parseArgs({
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
  } catch (e) {
    console.log(`✗ ${e.message}`);
    console.log('UAT_STEP ? ERROR');
    return process.exit(2);
  }
})();
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
  const file = spec.slice(0, i).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!spec.slice(i + 2).trim()) errorOut(`--check has an empty regex, which matches any line: ${spec}`);
  let re;
  try { re = new RegExp(spec.slice(i + 2), o.flags.replace(/[gy]/g, '')); } catch (e) { errorOut(`invalid regex in ${spec}: ${e.message}`); }
  if (!files.has(file)) files.set(file, []);
  files.get(file).push(re);
}

function git(args) {
  const r = spawnSync('git', ['-c', 'core.quotePath=false', '-c', 'diff.relative=false', '--no-pager', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) throw Object.assign(new Error(r.error?.message ?? `git exited ${r.status}`), { stderr: r.stderr });
  return { stdout: r.stdout, stderr: r.stderr };
}
// Diff the whole tree with rename detection, then keep each file's added lines. Limiting the diff
// to the file would hide a rename, and every line of a moved doc would count as "added".
let diff;
try {
  // -l0 lifts the rename limit: when git skips rename detection, a moved doc's old lines would count as added.
  const r = git(['diff', '-U0', '-M', '-l0', '--ignore-cr-at-eol', '--no-color', '--no-ext-diff', '--no-textconv',
    '--src-prefix=a/', '--dst-prefix=b/', `${base}...${o.head}`]);
  if (/rename detection/i.test(r.stderr)) errorOut(`git skipped rename detection: ${r.stderr.trim().split('\n')[0]}`);
  diff = r.stdout;
} catch (e) {
  errorOut(`git diff ${base}...${o.head} failed: ${(e.stderr || e.message).toString().trim().split('\n')[0]}`);
}
const addedByFile = new Map();
let current = null;
let inHunk = false;
for (const line of diff.split('\n')) {
  if (line.startsWith('diff --git ')) { current = null; inHunk = false; continue; }
  if (!inHunk && line.startsWith('+++ ')) {
    let p = line.slice(4).replace(/\t$/, '');
    if (p.startsWith('"')) { try { p = JSON.parse(p); } catch { /* keep as written */ } }
    current = p === '/dev/null' ? null : p.replace(/^b\//, '');
    if (current) addedByFile.set(current, []);
    continue;
  }
  if (line.startsWith('@@')) { inHunk = true; continue; }
  if (inHunk && current && line.startsWith('+')) addedByFile.get(current).push(line.slice(1).replace(/\r$/, ''));
}

const results = [];
const shown = [];
for (const [file, patterns] of files) {
  try { git(['cat-file', '-e', `${o.head}:${file}`]); } catch { errorOut(`${file} does not exist at ${o.head} (paths are relative to the repository root)`); }
  const added = addedByFile.get(file) ?? [];
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
