#!/usr/bin/env node
// Assemble a user-acceptance-test video from a manifest: title card, then per criterion a
// chapter card, its evidence clips (with a caption bar), and a verdict card, then a summary.
// Writes a chaptered MP4, decodes it fully, extracts inspection frames, and writes
// <output>.chapters.md plus <output>.result.json. Requires ffmpeg and ffprobe with drawtext.
//
// Usage: node assemble-uat-video.mjs <manifest.json> [--keep-work]
// Exit codes: 0 video written and verified, 2 bad input or ffmpeg failure.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';

const VERDICTS = {
  PASS: '#2ea043',
  FAIL: '#f85149',
  BLOCKED: '#d29922',
  'NOT RUN': '#8b949e',
};
const BG = '#0d1117';
const FG = '#e6edf3';
const MUTED = '#8b949e';
const ACCENT = '#58a6ff';
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);

function fail(message) {
  console.error(`assemble-uat-video: ${message}`);
  process.exit(2);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) fail(`${cmd} could not start: ${r.error.message}`);
  if (r.status !== 0 && !opts.allowFail) {
    fail(`${cmd} ${args.join(' ')}\nexited ${r.status}\n${(r.stderr || '').split('\n').slice(-25).join('\n')}`);
  }
  return r;
}

function ffmpeg(args, cwd) {
  return run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd });
}

function probeDuration(file) {
  const r = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  const d = parseFloat(r.stdout.trim());
  if (!Number.isFinite(d) || d <= 0) fail(`could not read duration of ${file}`);
  return d;
}

function findFont(manifestFont) {
  const candidates = [
    manifestFont,
    process.env.UAT_FONT,
    'C:/Windows/Fonts/CascadiaMono.ttf',
    'C:/Windows/Fonts/consola.ttf',
    '/System/Library/Fonts/Menlo.ttc',
    '/System/Library/Fonts/Monaco.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
    '/usr/share/fonts/dejavu-sans-mono-fonts/DejaVuSansMono.ttf',
    '/usr/share/fonts/TTF/DejaVuSansMono.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
  ].filter(Boolean);
  const found = candidates.find((f) => existsSync(f));
  if (!found) fail('no monospace font found; set "font" in the manifest or the UAT_FONT environment variable to a .ttf/.ttc path');
  return found;
}

// Quote a path for use inside an ffmpeg filter option value.
function filterPath(p) {
  return `'${p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''")}'`;
}

function ffColor(hex) {
  return `0x${hex.replace('#', '')}`;
}

// The font is monospace, so 0.6em per character is a safe width estimate.
function wrap(text, fontSize, maxWidth, maxLines) {
  const perLine = Math.max(10, Math.floor(maxWidth / (fontSize * 0.6)));
  if (maxLines === 1) {
    const one = String(text).replace(/\r?\n/g, ' ');
    return [one.length <= perLine ? one : `${one.slice(0, perLine - 1)}…`];
  }
  const lines = [];
  for (const para of String(text).split(/\r?\n/)) {
    if (para.length <= perLine) { lines.push(para); continue; } // keep column alignment
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > perLine) {
        if (line) { lines.push(line); line = ''; }
        lines.push(w.slice(0, perLine));
        w = w.slice(perLine);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= perLine) line += ` ${w}`;
      else { lines.push(line); line = w; }
    }
    lines.push(line);
  }
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, perLine - 1)}…`;
    return kept;
  }
  return lines;
}

class Layout {
  constructor(ctx) {
    this.ctx = ctx;
    this.filters = [];
    this.y = Math.round(ctx.height * 0.16);
  }

  text(str, { size, color = FG, gapAfter = 0.35, maxLines = 4 }) {
    const { ctx } = this;
    const px = Math.round(size * ctx.scale);
    const left = Math.round(ctx.width * 0.08);
    for (const line of wrap(str, px, ctx.width - left * 2, maxLines)) {
      const file = ctx.textFile(line);
      this.filters.push(
        `drawtext=fontfile=${ctx.fontArg}:textfile=${file}:expansion=none:fontsize=${px}:fontcolor=${ffColor(color)}:x=${left}:y=${this.y}`,
      );
      this.y += Math.round(px * 1.3);
    }
    this.y += Math.round(px * gapAfter);
  }

  rule(color = ACCENT) {
    const { ctx } = this;
    const left = Math.round(ctx.width * 0.08);
    const h = Math.max(4, Math.round(6 * ctx.scale));
    this.filters.push(`drawbox=x=${left}:y=${this.y}:w=${Math.round(ctx.width * 0.12)}:h=${h}:color=${ffColor(color)}:t=fill`);
    this.y += Math.round(40 * ctx.scale);
  }
}

function renderCard(ctx, name, seconds, build) {
  const layout = new Layout(ctx);
  build(layout);
  const out = join(ctx.work, `${name}.mp4`);
  const vf = layout.filters.length ? `${layout.filters.join(',')},format=yuv420p` : 'format=yuv420p';
  ffmpeg([
    '-f', 'lavfi', '-i', `color=c=${ffColor(BG)}:s=${ctx.width}x${ctx.height}:r=${ctx.fps}:d=${seconds}`,
    '-vf', vf, ...ctx.encode, out,
  ], ctx.work);
  return out;
}

function normalizeClip(ctx, name, item, caption) {
  const src = resolve(ctx.baseDir, item.path);
  if (!existsSync(src)) fail(`evidence file not found: ${src}`);
  const out = join(ctx.work, `${name}.mp4`);
  const { width: W, height: H } = ctx;
  const barH = caption ? Math.round(64 * ctx.scale) : 0;
  let vf = `scale=${W}:${H - barH}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:0:color=${ffColor(BG)},fps=${ctx.fps}`;
  if (caption) {
    const size = Math.round(30 * ctx.scale);
    const file = ctx.textFile(wrap(caption, size, W - Math.round(W * 0.06), 1)[0]);
    vf += `,drawbox=x=0:y=${H - barH}:w=${W}:h=${barH}:color=${ffColor('#161b22')}:t=fill`;
    vf += `,drawtext=fontfile=${ctx.fontArg}:textfile=${file}:expansion=none:fontsize=${size}:fontcolor=${ffColor(FG)}:x=${Math.round(W * 0.03)}:y=${H - barH}+(${barH}-text_h)/2`;
  }
  vf += ',format=yuv420p';
  const isImage = IMAGE_EXT.has(extname(src).toLowerCase());
  const input = isImage
    ? ['-loop', '1', '-framerate', String(ctx.fps), '-t', String(item.seconds ?? 5), '-i', src]
    : [...(item.startSeconds ? ['-ss', String(item.startSeconds)] : []), '-i', src];
  const limit = !isImage && item.seconds ? ['-t', String(item.seconds)] : [];
  ffmpeg([...input, ...limit, '-vf', vf, '-an', ...ctx.encode, out], ctx.work);
  return out;
}

function loadManifest(manifestPath) {
  const abs = resolve(manifestPath);
  if (!existsSync(abs)) fail(`manifest not found: ${abs}`);
  let m;
  try { m = JSON.parse(readFileSync(abs, 'utf8')); } catch (e) { fail(`manifest is not valid JSON: ${e.message}`); }
  if (!m.title) fail('manifest needs "title"');
  if (!Array.isArray(m.chapters) || m.chapters.length === 0) fail('manifest needs a non-empty "chapters" array');
  const ids = new Set();
  for (const [i, c] of m.chapters.entries()) {
    if (!c.id || !c.title) fail(`chapter ${i} needs "id" and "title"`);
    if (ids.has(c.id)) fail(`duplicate chapter id ${c.id}`);
    ids.add(c.id);
    c.verdict = String(c.verdict ?? '').toUpperCase();
    if (!(c.verdict in VERDICTS)) fail(`chapter ${c.id} verdict must be one of ${Object.keys(VERDICTS).join(', ')}`);
    c.evidence = (c.evidence ?? []).map((e) => (typeof e === 'string' ? { path: e } : e));
    if (c.evidence.length === 0 && (c.verdict === 'PASS' || c.verdict === 'FAIL')) {
      fail(`chapter ${c.id} is ${c.verdict} but has no evidence; PASS and FAIL need recorded evidence`);
    }
  }
  return { m, baseDir: dirname(abs) };
}

function main() {
  const args = process.argv.slice(2);
  const keepWork = args.includes('--keep-work');
  const manifestPath = args.find((a) => !a.startsWith('--'));
  if (!manifestPath) fail('usage: node assemble-uat-video.mjs <manifest.json> [--keep-work]');
  const { m, baseDir } = loadManifest(manifestPath);

  if (!/\bdrawtext\b/.test(run('ffmpeg', ['-hide_banner', '-filters']).stdout)) {
    fail('this ffmpeg build has no drawtext filter (it needs libfreetype). Install a full build: "winget install Gyan.FFmpeg" on Windows, the homebrew-ffmpeg tap on macOS, or the distro ffmpeg package on Linux.');
  }

  const output = resolve(baseDir, m.output ?? 'uat.mp4');
  const stem = basename(output, extname(output));
  const work = join(dirname(output), `.${stem}-work`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  const width = m.width ?? 1920;
  const height = m.height ?? 1080;
  const fps = m.fps ?? 30;
  const font = findFont(m.font && (isAbsolute(m.font) ? m.font : resolve(baseDir, m.font)));
  let textCount = 0;
  const ctx = {
    baseDir, work, width, height, fps,
    scale: height / 1080,
    fontArg: filterPath(font),
    encode: ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(m.crf ?? 23), '-pix_fmt', 'yuv420p', '-r', String(fps)],
    textFile(text) {
      // Text goes through files (relative to ffmpeg's cwd) so it needs no filtergraph escaping.
      const name = `t${String(++textCount).padStart(4, '0')}.txt`;
      writeFileSync(join(work, name), text, 'utf8');
      return name;
    },
  };
  const cardSeconds = m.cardSeconds ?? 3;
  const segments = [];

  segments.push({
    label: 'title',
    file: renderCard(ctx, '000-title', m.titleSeconds ?? 5, (l) => {
      l.text('USER ACCEPTANCE TEST', { size: 30, color: ACCENT, gapAfter: 0.2 });
      l.rule();
      l.text(m.title, { size: 64, gapAfter: 0.4, maxLines: 3 });
      for (const s of [].concat(m.subtitle ?? [])) l.text(s, { size: 32, color: MUTED, gapAfter: 0.1, maxLines: 2 });
      l.y += Math.round(30 * ctx.scale);
      for (const c of m.chapters.slice(0, 8)) l.text(`${c.id}  ${c.title}`, { size: 30, gapAfter: 0, maxLines: 1 });
      if (m.chapters.length > 8) l.text(`… and ${m.chapters.length - 8} more`, { size: 30, color: MUTED, maxLines: 1 });
    }),
  });

  m.chapters.forEach((c, ci) => {
    const n = String(ci + 1).padStart(2, '0');
    segments.push({
      label: `${c.id}-card`, chapterId: c.id,
      file: renderCard(ctx, `${n}-0-card`, cardSeconds, (l) => {
        l.text(`${c.id} · criterion ${ci + 1} of ${m.chapters.length}`, { size: 32, color: ACCENT, gapAfter: 0.2 });
        l.rule();
        l.text(c.title, { size: 56, gapAfter: 0.5, maxLines: 4 });
        if (c.source) l.text(`Source: ${c.source}`, { size: 30, color: MUTED, gapAfter: 0.1, maxLines: 2 });
        if (c.proof) l.text(`Proof: ${c.proof}`, { size: 30, color: MUTED, gapAfter: 0.1, maxLines: 2 });
      }),
    });
    c.evidence.forEach((e, ei) => {
      const caption = e.caption === undefined ? `${c.id} · ${c.title}` : e.caption;
      segments.push({
        label: `${c.id}-evidence-${ei + 1}`, chapterId: c.id,
        file: normalizeClip(ctx, `${n}-${ei + 1}-evidence`, e, caption),
      });
    });
    segments.push({
      label: `${c.id}-verdict`, chapterId: c.id,
      file: renderCard(ctx, `${n}-9-verdict`, cardSeconds, (l) => {
        l.y = Math.round(ctx.height * 0.3);
        l.text(c.id, { size: 36, color: MUTED, gapAfter: 0.1 });
        l.text(c.verdict, { size: 120, color: VERDICTS[c.verdict], gapAfter: 0.3 });
        if (c.note) l.text(c.note, { size: 34, maxLines: 4 });
      }),
    });
  });

  if (m.summary !== false) {
    segments.push({
      label: 'summary',
      file: renderCard(ctx, '999-summary', m.summarySeconds ?? 6, (l) => {
        l.text('RESULTS', { size: 30, color: ACCENT, gapAfter: 0.2 });
        l.rule();
        const counts = Object.keys(VERDICTS)
          .map((v) => [v, m.chapters.filter((c) => c.verdict === v).length])
          .filter(([, k]) => k);
        l.text(counts.map(([v, k]) => `${k} ${v}`).join('   '), { size: 48, gapAfter: 0.5 });
        for (const c of m.chapters.slice(0, 12)) {
          l.text(`${c.verdict.padEnd(9)}${c.id.padEnd(7)}${c.title}`, { size: 30, color: VERDICTS[c.verdict], gapAfter: 0, maxLines: 1 });
        }
        if (m.chapters.length > 12) l.text(`… and ${m.chapters.length - 12} more`, { size: 30, color: MUTED, maxLines: 1 });
      }),
    });
  }

  // Every segment shares codec, size, fps and pixel format, so stream copy is safe.
  writeFileSync(join(work, 'concat.txt'), `${segments.map((s) => `file '${basename(s.file)}'`).join('\n')}\n`, 'utf8');
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'joined.mp4'], work);

  let t = 0;
  for (const s of segments) { s.start = t; s.duration = probeDuration(s.file); t += s.duration; }
  const chapters = [{ id: 'intro', title: 'Overview', start: 0 }];
  for (const c of m.chapters) {
    const first = segments.find((s) => s.chapterId === c.id);
    chapters.push({ id: c.id, title: `${c.id} ${c.verdict}: ${c.title}`, start: first.start, verdict: c.verdict });
  }
  const summarySeg = segments.find((s) => s.label === 'summary');
  if (summarySeg) chapters.push({ id: 'summary', title: 'Results', start: summarySeg.start });
  const esc = (s) => s.replace(/[=;#\\\n]/g, (ch) => (ch === '\n' ? ' ' : `\\${ch}`));
  let meta = `;FFMETADATA1\ntitle=${esc(m.title)}\n`;
  chapters.forEach((ch, i) => {
    const end = i + 1 < chapters.length ? chapters[i + 1].start : t;
    meta += `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(ch.start * 1000)}\nEND=${Math.round(end * 1000)}\ntitle=${esc(ch.title)}\n`;
  });
  writeFileSync(join(work, 'chapters.txt'), meta, 'utf8');
  mkdirSync(dirname(output), { recursive: true });
  ffmpeg(['-i', 'joined.mp4', '-i', 'chapters.txt', '-map_metadata', '1', '-map_chapters', '1', '-c', 'copy', '-movflags', '+faststart', output], work);

  // Verify: a full decode must be clean and the dimensions must match.
  const decode = run('ffmpeg', ['-hide_banner', '-v', 'error', '-i', output, '-f', 'null', '-'], { allowFail: true });
  const decodeErrors = (decode.stderr || '').trim();
  if (decode.status !== 0 || decodeErrors) fail(`full decode of ${output} reported errors:\n${decodeErrors}`);
  const dims = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', output]).stdout.trim();
  if (dims !== `${width},${height}`) fail(`output is ${dims}, expected ${width},${height}`);
  const total = probeDuration(output);

  // Inspection frames: the middle of every segment, plus 1s before the end of each evidence clip.
  const framesDir = join(dirname(output), `${stem}-frames`);
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  const frames = [];
  segments.forEach((s, i) => {
    const points = [['mid', s.start + s.duration / 2]];
    if (s.label.includes('evidence') && s.duration > 2) points.push(['end', s.start + s.duration - 1]);
    for (const [tag, at] of points) {
      const f = join(framesDir, `${String(i).padStart(3, '0')}-${s.label}-${tag}.png`);
      ffmpeg(['-ss', at.toFixed(3), '-i', output, '-frames:v', '1', f]);
      frames.push(f);
    }
  });

  const stamp = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  const md = ['| Time | Chapter |', '|---|---|', ...chapters.map((ch) => `| ${stamp(ch.start)} | ${ch.title} |`)].join('\n');
  writeFileSync(`${output}.chapters.md`, `${md}\n`, 'utf8');
  const sizeBytes = statSync(output).size;
  const result = {
    output, width, height, durationSeconds: Number(total.toFixed(2)), sizeBytes,
    chapters: chapters.map((ch) => ({ ...ch, start: Number(ch.start.toFixed(2)) })),
    segments: segments.map((s) => ({ label: s.label, start: Number(s.start.toFixed(2)), duration: Number(s.duration.toFixed(2)) })),
    framesDir, frames,
  };
  writeFileSync(`${output}.result.json`, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  if (!keepWork) rmSync(work, { recursive: true, force: true });

  console.log(`video:    ${output}`);
  console.log(`duration: ${stamp(total)} (${result.durationSeconds}s), ${width}x${height}, ${(sizeBytes / 1048576).toFixed(1)} MB`);
  console.log('decode:   clean');
  console.log(`frames:   ${frames.length} in ${framesDir}`);
  console.log(`chapters: ${output}.chapters.md`);
  console.log('');
  console.log(md);
}

main();
