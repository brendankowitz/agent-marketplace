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
// Exit codes: 0 written, 2 refused: bad input; a step that ERRORed, never finished or was not
// recorded in this take; a fragment verdict its steps don't support; or a fragment recorded from
// a different notebook. Fix the step and re-record, or mark that criterion BLOCKED by hand.

import { createHash } from 'node:crypto';
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

const { values: o } = (() => {
  try {
    return parseArgs({
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
  } catch (e) { return fail(e.message); }
})();
if (!o.notebook || !o.fragment) fail('--notebook and --fragment are required');
const nb = readJson(o.notebook, 'notebook');
const frag = readJson(o.fragment, 'fragment');
const say = readJson(o.narration, 'narration') ?? {};
const voice = readJson(o.voice, 'voice');
if (Object.keys(say).length && !voice) console.warn('workbench-manifest: narration given without --voice; the video will be silent');
if (!Array.isArray(nb?.cells)) fail('notebook has no cells[]');
if (!Array.isArray(frag?.chapters) || frag.chapters.length === 0) fail('fragment has no chapters');
if (!frag.baseDir) fail('fragment has no baseDir (re-record with this version of record.mjs)');
const nbHash = createHash('sha256').update(readFileSync(resolve(o.notebook))).digest('hex');
if (!frag.notebook?.sha256) fail('fragment has no notebook sha256 (re-record with this version of record.mjs)');
if (frag.notebook.sha256 !== nbHash) {
  fail('the fragment was recorded from a different version of the notebook; re-record, or pass the notebook that was recorded');
}
for (const [key, v] of [['criteria', say.criteria], ['steps', say.steps]]) {
  if (v !== undefined && (!v || typeof v !== 'object' || Array.isArray(v))) fail(`narration.${key} must be an object`);
}
for (const [id, v] of Object.entries(say.criteria ?? {})) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`narration.criteria.${id} must be an object { card, verdict, note }`);
}

const outDir = dirname(resolve(o.out));
const criteria = new Map((nb.criteria ?? []).map((k) => [String(k.id), k]));
const usedSteps = new Set();
const problems = [];
const RANK = { PASS: 1, FAIL: 3 };
const firstVerdictWord = (s) => {
  const w = /\b(pass|passes|passed|passing|fail|fails|failed|failing|failure|failures)\b/i.exec(s)?.[1].toLowerCase();
  return w ? (w.startsWith('pass') ? 'PASS' : 'FAIL') : null;
};

// Every notebook cell that belongs to a criterion must be in this take: a step that was never
// recorded cannot count as passed. Cells without a criterion only show context and make no claim,
// so they get no chapter in the video.
const loose = new Set(nb.cells.filter((cell) => !cell.criterion).map((cell) => cell.id));
for (const id of loose) console.warn(`workbench-manifest: cell ${id} has no criterion; it is left out of the video`);
const recorded = new Set(frag.chapters.flatMap((c) => (c.stepEvidence ?? []).map((s) => s.cellId)));
for (const cell of nb.cells.filter((x) => x.criterion)) {
  if (!recorded.has(cell.id)) problems.push(`${cell.criterion ?? cell.id}: cell ${cell.id} is not in this take (record the whole notebook, or mark that criterion BLOCKED by hand)`);
}

const chapters = frag.chapters.filter((c) => !loose.has(c.id)).map((c) => {
  const k = criteria.get(c.id) ?? {};
  const steps = c.stepEvidence ?? [];
  if (steps.length === 0) problems.push(`${c.id}: no stepEvidence in the fragment (re-record with this version of record.mjs)`);
  // Both halves of a trimmed wait carry the step's verdict; check every item, count each step once.
  for (const s of steps) {
    if (!['PASS', 'FAIL', 'SHOWN'].includes(s.verdict)) problems.push(`${c.id}: step ${s.cellId} is ${s.verdict ?? 'missing a verdict'}`);
  }
  const judged = steps.filter((s) => s.part !== 'wait-end' && (s.verdict === 'PASS' || s.verdict === 'FAIL')).map((s) => s.verdict);
  const verdict = judged.length ? judged.reduce((w, v) => (RANK[v] > RANK[w] ? v : w)) : null;
  if (!verdict) problems.push(`${c.id}: no step made a PASS/FAIL claim`);
  else if (c.verdict !== verdict) problems.push(`${c.id}: fragment says ${c.verdict} but its steps say ${verdict}`);
  const passed = judged.filter((v) => v === 'PASS').length;
  const text = say.criteria?.[c.id] ?? {};
  for (const [k, v] of Object.entries(text)) {
    if (typeof v !== 'string') problems.push(`narration.criteria.${c.id}.${k} must be a string`);
  }
  // Narration must agree with the verdict the steps produced, so stale text from an earlier take
  // can never announce PASS over a FAIL card (or the other way round): the first verdict word in
  // the spoken verdict (required), the note and the card (when they have one) must match.
  for (const field of ['verdict', 'note', 'card']) {
    if (!verdict || typeof text[field] !== 'string') continue;
    const said = firstVerdictWord(text[field]);
    if (field === 'verdict' ? said !== verdict : said && said !== verdict) {
      problems.push(`narration.criteria.${c.id}.${field} must say "${verdict === 'PASS' ? 'passes' : 'fails'}" before any other verdict word, but the steps say ${verdict}`);
    }
  }
  return {
    id: c.id,
    title: k.title ?? c.title,
    ...(k.source ? { source: k.source } : {}),
    ...(k.proof ? { proof: k.proof } : {}),
    verdict,
    note: text.note ?? `${passed} of ${judged.length} checked step${judged.length === 1 ? '' : 's'} passed`,
    ...(text.card ? { narration: text.card } : {}),
    ...(text.verdict ? { verdictNarration: text.verdict } : {}),
    evidence: steps.map((s) => {
      const key = s.part === 'wait-end' ? `${s.cellId}#end` : s.cellId;
      if (say.steps?.[key]) usedSteps.add(key);
      return {
        // Fragment paths are relative to the directory the recorder ran in (baseDir); re-base them
        // on the manifest's directory.
        path: relative(outDir, resolve(frag.baseDir, s.path)).replace(/\\/g, '/'),
        startSeconds: s.startSeconds,
        seconds: s.seconds,
        caption: s.caption ?? '',
        ...(say.steps?.[key] ? { narration: say.steps[key] } : {}),
      };
    }),
  };
});
for (const key of Object.keys(say.criteria ?? {})) {
  if (!frag.chapters.some((c) => c.id === key)) problems.push(`narration.criteria.${key} matches no criterion in this take`);
}
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
