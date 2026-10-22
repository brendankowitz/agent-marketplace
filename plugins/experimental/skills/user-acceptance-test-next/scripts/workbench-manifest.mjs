#!/usr/bin/env node
// Build the assembler manifest for a workbench take: one chapter per criterion, one evidence item
// per step (from the recorder's manifest fragment, including any trimmed waits), with titles,
// sources and proofs from the notebook and narration from a narration file written AFTER the run.
//
//   node workbench-manifest.mjs --notebook uat-notebook.json \
//     --fragment clips/workbench.webm.manifest-fragment.json \
//     [--narration narration.json] [--voice voice.json] [--music "Demo Loop.mp3"] \
//     [--output uat.mp4] [--out manifest.json]
//
// narration.json (all optional):
//   { "title": "…", "summary": "…",
//     "criteria": { "AC1": { "card": "…", "verdict": "…", "note": "…" } },
//     "steps": { "<cellId>": "…", "<cellId>#end": "spoken over the part after a trimmed wait" } }
//
// Exit codes: 0 written, 2 refused (bad input, or a criterion whose steps ERRORed or never
// finished: fix the step and re-record, or mark that criterion BLOCKED by hand).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

function fail(message) {
  console.error(`workbench-manifest: ${message}`);
  process.exit(2);
}
const readJson = (p, what) => {
  if (!p) return null;
  const abs = resolve(p);
  if (!existsSync(abs)) fail(`${what} not found: ${abs}`);
  try { return JSON.parse(readFileSync(abs, 'utf8')); } catch (e) { return fail(`${what} is not valid JSON: ${e.message}`); }
};

const { values: o } = parseArgs({
  options: {
    notebook: { type: 'string' },
    fragment: { type: 'string' },
    narration: { type: 'string' },
    voice: { type: 'string' },
    music: { type: 'string' },
    output: { type: 'string', default: 'uat.mp4' },
    out: { type: 'string', default: 'manifest.json' },
  },
});
if (!o.notebook || !o.fragment) fail('--notebook and --fragment are required');
const nb = readJson(o.notebook, 'notebook');
const frag = readJson(o.fragment, 'fragment');
const say = readJson(o.narration, 'narration') ?? {};
const voice = readJson(o.voice, 'voice');
if (say && Object.keys(say).length && !voice) console.warn('workbench-manifest: narration given without --voice; the video will be silent');

const outDir = dirname(resolve(o.out));
const fragDir = dirname(resolve(o.fragment));
const criteria = new Map((nb.criteria ?? []).map((k) => [String(k.id), k]));
const usedSteps = new Set();
const problems = [];

const chapters = (frag.chapters ?? []).map((c) => {
  const k = criteria.get(c.id) ?? {};
  const steps = c.stepEvidence ?? c.evidence ?? [];
  const verdicts = steps.filter((s) => s.part !== 'wait-end').map((s) => s.verdict);
  if (verdicts.some((v) => v === 'ERROR' || v === 'NO RESULT')) {
    problems.push(`${c.id}: a step is ERROR or never finished (${c.cells.join(', ')})`);
  }
  if (!['PASS', 'FAIL'].includes(c.verdict)) problems.push(`${c.id}: verdict ${c.verdict} (no step made a PASS/FAIL claim)`);
  const judged = verdicts.filter((v) => v === 'PASS' || v === 'FAIL');
  const passed = judged.filter((v) => v === 'PASS').length;
  const text = say.criteria?.[c.id] ?? {};
  return {
    id: c.id,
    title: k.title ?? c.title,
    ...(k.source ? { source: k.source } : {}),
    ...(k.proof ? { proof: k.proof } : {}),
    verdict: c.verdict,
    note: text.note ?? `${passed} of ${judged.length} checked step${judged.length === 1 ? '' : 's'} passed`,
    ...(text.card ? { narration: text.card } : {}),
    ...(text.verdict ? { verdictNarration: text.verdict } : {}),
    evidence: steps.map((s) => {
      const key = s.part === 'wait-end' ? `${s.cellId}#end` : s.cellId;
      if (say.steps?.[key]) usedSteps.add(key);
      return {
        // Fragment paths are relative to the directory the recorder ran in (baseDir); re-base them
        // on the manifest's directory.
        path: relative(outDir, resolve(frag.baseDir ?? dirname(fragDir), s.path)).replace(/\\/g, '/'),
        startSeconds: s.startSeconds,
        seconds: s.seconds,
        caption: s.caption ?? '',
        ...(say.steps?.[key] ? { narration: say.steps[key] } : {}),
      };
    }),
  };
});
if (problems.length) fail(`refusing to build a manifest:\n  ${problems.join('\n  ')}`);
for (const key of Object.keys(say.steps ?? {})) {
  if (!usedSteps.has(key)) console.warn(`workbench-manifest: narration for "${key}" matches no step in this take`);
}

const manifest = {
  title: nb.title,
  subtitle: nb.subtitle ?? [],
  output: o.output,
  ...(voice ? { voice } : {}),
  ...(o.music ? { music: { path: relative(outDir, resolve(o.music)).replace(/\\/g, '/') } } : {}),
  ...(say.title ? { titleNarration: say.title } : {}),
  ...(say.summary ? { summaryNarration: say.summary } : {}),
  chapters,
};
writeFileSync(resolve(o.out), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
const items = chapters.reduce((n, c) => n + c.evidence.length, 0);
console.log(`manifest: ${resolve(o.out)} · ${chapters.length} chapters · ${items} evidence items · ${chapters.map((c) => `${c.id}=${c.verdict}`).join(' ')}`);
