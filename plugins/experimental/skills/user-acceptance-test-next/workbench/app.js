// UAT workbench UI: renders the notebook, runs cells through the local runner (server.mjs),
// streams their real output, and renders the evidence the helpers wrote as cards.
// Vanilla JS, no network assets. Automation API for the recorder: window.uat.
'use strict';

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // ERROR ranks worst: a step that produced no result must not hide behind another step's FAIL.
  const RANK = { PASS: 1, FAIL: 2, ERROR: 3 };
  const ICON = { PASS: '✓', FAIL: '✗', ERROR: '!', SHOWN: '•', running: '', pending: '', BLOCKED: '!' };

  let nb = null;
  const cells = new Map(); // id -> { info, el, state, verdict, exitCode, durationMs, markers, reason, waiters }
  let readyResolve;
  const readyPromise = new Promise((r) => { readyResolve = r; });

  // -------------------------------------------------------------------------------------------
  // ANSI SGR -> HTML spans (classes only; the CSP forbids inline styles)
  // -------------------------------------------------------------------------------------------
  const PALETTE = [
    [0, 0, 0], [205, 49, 49], [13, 188, 121], [229, 229, 16], [36, 114, 200], [188, 63, 188], [17, 168, 205], [229, 229, 229],
    [102, 102, 102], [241, 76, 76], [35, 209, 139], [245, 245, 67], [59, 142, 234], [214, 112, 214], [41, 184, 219], [255, 255, 255],
  ];
  const nearest = (r, g, b) => {
    let best = 0;
    let bestD = Infinity;
    PALETTE.forEach(([pr, pg, pb], i) => {
      const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  };
  const from256 = (n) => {
    if (n < 16) return n;
    if (n >= 232) { const v = 8 + (n - 232) * 10; return nearest(v, v, v); }
    const i = n - 16;
    const lv = (x) => (x === 0 ? 0 : 55 + x * 40);
    return nearest(lv(Math.floor(i / 36)), lv(Math.floor(i / 6) % 6), lv(i % 6));
  };

  class Ansi {
    constructor() { this.carry = ''; this.reset(); }
    reset() { this.bold = false; this.dim = false; this.italic = false; this.underline = false; this.fg = null; this.bg = null; }
    sgr(params) {
      const codes = params === '' ? [0] : params.split(/[;:]/).map((p) => (p === '' ? 0 : Number(p)));
      for (let i = 0; i < codes.length; i++) {
        const c = codes[i];
        if (c === 0) this.reset();
        else if (c === 1) this.bold = true;
        else if (c === 2) this.dim = true;
        else if (c === 3) this.italic = true;
        else if (c === 4) this.underline = true;
        else if (c === 22) { this.bold = false; this.dim = false; }
        else if (c === 23) this.italic = false;
        else if (c === 24) this.underline = false;
        else if (c >= 30 && c <= 37) this.fg = c - 30;
        else if (c >= 90 && c <= 97) this.fg = 8 + c - 90;
        else if (c === 39) this.fg = null;
        else if (c >= 40 && c <= 47) this.bg = c - 40;
        else if (c >= 100 && c <= 107) this.bg = 8 + c - 100;
        else if (c === 49) this.bg = null;
        else if (c === 38 || c === 48) {
          let color = null;
          if (codes[i + 1] === 5) { color = from256(codes[i + 2] ?? 0); i += 2; }
          else if (codes[i + 1] === 2) { color = nearest(codes[i + 2] ?? 0, codes[i + 3] ?? 0, codes[i + 4] ?? 0); i += 4; }
          if (c === 38) this.fg = color; else this.bg = color;
        }
      }
    }
    span(text) {
      if (!text) return '';
      const cls = [];
      if (this.bold) cls.push('a-b');
      if (this.dim) cls.push('a-d');
      if (this.italic) cls.push('a-i');
      if (this.underline) cls.push('a-u');
      if (this.fg !== null) cls.push(`fg-${this.fg}`);
      if (this.bg !== null) cls.push(`bg-${this.bg}`);
      return cls.length ? `<span class="${cls.join(' ')}">${esc(text)}</span>` : esc(text);
    }
    push(chunk) {
      let text = this.carry + chunk;
      this.carry = '';
      const lastEsc = text.lastIndexOf('\x1b');
      if (lastEsc !== -1) {
        const tail = text.slice(lastEsc);
        const complete = /^\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/.test(tail);
        if (!complete && tail.length < 64) { this.carry = tail; text = text.slice(0, lastEsc); }
      }
      text = text.replace(/\r+\n/g, '\n').replace(/\r/g, '');
      const re = /\x1b\[([0-?]*)[ -/]*([@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
      let out = '';
      let last = 0;
      let m;
      while ((m = re.exec(text))) {
        out += this.span(text.slice(last, m.index));
        last = re.lastIndex;
        if (m[2] === 'm') this.sgr(m[1]);
      }
      return out + this.span(text.slice(last));
    }
  }

  // -------------------------------------------------------------------------------------------
  // Minimal safe markdown
  // -------------------------------------------------------------------------------------------
  function inline(src) {
    return String(src).split(/(`[^`]+`)/).map((part) => {
      if (/^`[^`]+`$/.test(part)) return `<code>${esc(part.slice(1, -1))}</code>`;
      return part.split(/(\[[^\]]+\]\(https?:\/\/[^\s)]+\))/).map((seg) => {
        const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(seg);
        if (link) return `<a href="${esc(link[2])}" target="_blank" rel="noopener noreferrer">${emph(esc(link[1]))}</a>`;
        return emph(esc(seg));
      }).join('');
    }).join('');
  }
  const emph = (s) => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, '$1<em>$2</em>');

  function markdown(src) {
    const lines = String(src ?? '').replace(/\r/g, '').split('\n');
    const out = [];
    const isList = (l) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(l);
    const isBlock = (l) => /^(#{1,4})\s/.test(l) || /^```/.test(l) || isList(l) || /^>\s?/.test(l);
    for (let i = 0; i < lines.length;) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      let m;
      if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
        const level = Math.min(6, m[1].length + 2);
        out.push(`<h${level}>${inline(m[2])}</h${level}>`);
        i++;
      } else if (/^```/.test(line)) {
        const body = [];
        for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
        i++;
        out.push(`<pre class="md-code"><code>${esc(body.join('\n'))}</code></pre>`);
      } else if (isList(line)) {
        const ordered = /^\s*\d+[.)]/.test(line);
        const items = [];
        for (; i < lines.length && isList(lines[i]); i++) items.push(lines[i].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''));
        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      } else if (/^>\s?/.test(line)) {
        const body = [];
        for (; i < lines.length && /^>\s?/.test(lines[i]); i++) body.push(lines[i].replace(/^>\s?/, ''));
        out.push(`<blockquote>${inline(body.join(' '))}</blockquote>`);
      } else {
        const body = [];
        for (; i < lines.length && lines[i].trim() && !isBlock(lines[i]); i++) body.push(lines[i].trim());
        out.push(`<p>${inline(body.join(' '))}</p>`);
      }
    }
    return out.join('');
  }

  // -------------------------------------------------------------------------------------------
  // Evidence rendering helpers
  // -------------------------------------------------------------------------------------------
  const shorten = (v, max = 100, keep = 24) => (v.length > max ? { text: `${v.slice(0, keep)}…`, extra: `‹${v.length} chars›` } : { text: v, extra: '' });

  function jsonHtml(text) {
    return esc(text).replace(
      /(&quot;(?:\\.|[^&\\]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g,
      (all, str, colon, lit, num) => {
        if (str) return colon ? `<span class="j-key">${str}</span>${colon}` : `<span class="j-str">${str}</span>`;
        if (lit) return `<span class="j-lit">${lit}</span>`;
        if (num) return `<span class="j-num">${num}</span>`;
        return all;
      },
    );
  }

  // Pretty body block: JSON is indented and highlighted; long bodies and long lines are cut on screen.
  function bodyBlock(body, maxLines) {
    const pre = h('pre', 'body');
    if (body === null || body === undefined || body === '') {
      pre.classList.add('empty');
      pre.textContent = '(empty body)';
      return pre;
    }
    let text = typeof body === 'string' ? body : JSON.stringify(body);
    let isJson = false;
    try { text = JSON.stringify(JSON.parse(text), null, 2); isJson = true; } catch { /* not JSON */ }
    let lines = text.replace(/\r/g, '').split('\n');
    const more = lines.length > maxLines ? lines.length - maxLines : 0;
    lines = lines.slice(0, maxLines).map((l) => (l.length > 160 ? `${l.slice(0, 120)}… ‹${l.length} chars›` : l));
    const joined = lines.join('\n');
    pre.innerHTML = isJson ? jsonHtml(joined) : esc(joined);
    if (more) pre.insertAdjacentHTML('beforeend', `\n<span class="more">… ${more} more line${more === 1 ? '' : 's'} (full body in evidence)</span>`);
    return pre;
  }

  function assertionsList(assertions) {
    const ul = h('ul', 'assertions');
    for (const a of assertions ?? []) {
      const li = h('li', a.pass ? 'ok' : 'bad');
      li.append(h('span', 'mark', a.pass ? '✓' : '✗'), h('span', 'check', a.check));
      if (a.error) li.append(h('span', 'err', a.error));
      ul.append(li);
    }
    return ul;
  }

  function cardHead(kind, label, data, path) {
    const head = h('div', 'card-head');
    head.append(h('span', `kind kind-${kind}`, label));
    if (data?.step) head.append(h('span', 'card-step', data.step));
    if (path) head.append(h('span', 'card-path', path));
    if (data?.verdict) head.append(h('span', `mini-verdict v-${data.verdict}`, `${ICON[data.verdict] ?? ''} ${data.verdict}`));
    return head;
  }

  function statusClass(s) {
    if (s >= 200 && s < 300) return 's2';
    if (s >= 300 && s < 400) return 's3';
    return 's4';
  }

  function httpCard(ev) {
    const d = ev.data;
    const card = h('div', 'card card-http');
    card.append(cardHead('http', 'HTTP', d, ev.path));
    const grid = h('div', 'http-grid');

    const req = h('div', 'pane pane-req');
    req.append(h('div', 'pane-label', 'Request'));
    const line = h('div', 'req-line');
    line.append(h('span', `method m-${(d.request?.method ?? 'GET').toUpperCase()}`, d.request?.method ?? 'GET'), h('span', 'url', d.request?.url ?? ''));
    req.append(line);
    const headers = Object.entries(d.request?.headers ?? {});
    if (headers.length) {
      const table = h('table', 'headers');
      for (const [k, v] of headers) {
        const tr = h('tr');
        const td = h('td', 'hv');
        const s = shorten(String(v));
        td.append(document.createTextNode(s.text));
        if (s.extra) td.append(h('span', 'chars', ` ${s.extra}`));
        if (String(v) === '‹redacted›') td.classList.add('redacted');
        tr.append(h('td', 'hk', k), td);
        table.append(tr);
      }
      req.append(table);
    }
    if (d.request?.body !== null && d.request?.body !== undefined) req.append(bodyBlock(d.request.body, 12));
    grid.append(req);

    const resp = h('div', 'pane pane-resp');
    resp.append(h('div', 'pane-label', 'Response'));
    if (d.response) {
      const row = h('div', 'status-row');
      row.append(h('span', `status-badge ${statusClass(d.response.status)}`, `${d.response.status} ${d.response.statusText ?? ''}`.trim()));
      row.append(h('span', 'duration', `${d.durationMs ?? '?'} ms`));
      resp.append(row);
      resp.append(bodyBlock(d.response.body, 16));
    } else {
      const row = h('div', 'status-row');
      row.append(h('span', 'status-badge s4', 'No complete response'), h('span', 'duration', `${d.durationMs ?? '?'} ms`));
      resp.append(row);
    }
    grid.append(resp);
    card.append(grid);
    if (d.assertions?.length) card.append(assertionsList(d.assertions));
    else if (d.verdict === 'SHOWN') card.append(h('div', 'note', 'Supporting request: display only, no assertion, no verdict.'));
    return card;
  }

  function highlightLine(line, re) {
    const full = String(line);
    const cut = full.length > 300 ? full.slice(0, 260) : full;
    let html = '';
    if (re) {
      let last = 0;
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
      let m;
      while ((m = g.exec(cut)) && m[0].length) {
        html += esc(cut.slice(last, m.index)) + `<mark>${esc(m[0])}</mark>`;
        last = m.index + m[0].length;
      }
      html += esc(cut.slice(last));
    } else html = esc(cut);
    if (cut !== full) html += `<span class="chars">… ‹${full.length} chars›</span>`;
    return html;
  }

  function logCard(ev) {
    const d = ev.data;
    const card = h('div', 'card card-log');
    const file = String(d.logFile ?? '').split(/[\\/]/).pop();
    card.append(cardHead('log', 'LOG', d, ev.path));
    const meta = h('div', 'log-meta');
    const item = (label, value, cls) => {
      const s = h('span', 'meta-item');
      s.append(h('span', 'meta-label', label), h('span', cls ?? 'meta-value', value));
      meta.append(s);
    };
    item('file', file || '?', 'meta-value mono');
    item('pattern', `/${d.pattern ?? ''}/${d.flags ?? ''}`, 'meta-value mono');
    item('expected', String(d.expectCount ?? '>=1'), 'meta-value mono');
    item('new lines', String(d.newLineCount ?? 0), 'meta-value mono');
    card.append(meta);
    let re = null;
    try { re = new RegExp(d.pattern, String(d.flags ?? '').replace(/[gy]/g, '')); } catch { re = null; }
    const box = h('div', 'log-lines');
    const matches = d.matches ?? [];
    if (!matches.length) box.append(h('div', 'log-empty', `(no matching lines among ${d.newLineCount ?? 0} new lines)`));
    for (const l of matches.slice(0, 10)) {
      const div = h('div', 'log-line');
      div.innerHTML = highlightLine(l, re);
      box.append(div);
    }
    if (matches.length > 10) box.append(h('div', 'more', `… ${matches.length - 10} more matching lines`));
    card.append(box);
    card.append(assertionsList(d.assertions));
    return card;
  }

  function browserCard(ev) {
    const d = ev.data;
    const card = h('div', 'card card-browser');
    card.append(cardHead('browser', 'BROWSER', d, ev.path));
    const grid = h('div', 'http-grid');
    const left = h('div', 'pane');
    left.append(h('div', 'pane-label', 'Checks'), assertionsList(d.checks));
    const right = h('div', 'pane');
    right.append(h('div', 'pane-label', 'Network'));
    const table = h('table', 'net');
    for (const n of (d.network ?? []).slice(-10)) {
      const tr = h('tr');
      let path = n.path;
      if (!path) { try { const u = new URL(n.url); path = u.pathname + u.search; } catch { path = n.url; } }
      tr.append(h('td', `method m-${n.method}`, n.method), h('td', `net-status ${statusClass(n.status)}`, n.status), h('td', 'net-path', path));
      table.append(tr);
    }
    if (!(d.network ?? []).length) right.append(h('div', 'note', 'No matching network calls.'));
    else right.append(table);
    if ((d.consoleErrors ?? []).length) right.append(h('div', 'note bad', `${d.consoleErrors.length} console error(s)`));
    grid.append(left, right);
    card.append(grid);
    if (d.error) card.append(h('div', 'note bad', String(d.error).split('\n')[0]));
    return card;
  }

  function docsCard(ev) {
    const d = ev.data;
    const card = h('div', 'card card-log');
    card.append(cardHead('log', 'DOCS', d, ev.path));
    const box = h('div', 'log-lines');
    for (const m of (d.matches ?? []).slice(0, 10)) {
      const div = h('div', 'log-line');
      div.innerHTML = `<span class="chars">${esc(m.file)}</span> ${highlightLine(m.line, (() => { try { return new RegExp(m.pattern, 'i'); } catch { return null; } })())}`;
      box.append(div);
    }
    if (!(d.matches ?? []).length) box.append(h('div', 'log-empty', '(no added line matched)'));
    card.append(box);
    card.append(assertionsList(d.assertions));
    return card;
  }

  function otherCard(ev) {
    const card = h('div', 'card card-other');
    card.append(cardHead('other', 'EVIDENCE', ev.data, ev.path));
    if (ev.error || !ev.data) card.append(h('div', 'note bad', ev.error ?? 'no data'));
    else card.append(bodyBlock(JSON.stringify(ev.data), 16));
    return card;
  }

  function evidenceCard(ev) {
    if (!ev.data) return otherCard(ev);
    if (ev.kind === 'http') return httpCard(ev);
    if (ev.kind === 'log') return logCard(ev);
    if (ev.kind === 'browser') return browserCard(ev);
    if (ev.kind === 'docs') return docsCard(ev);
    return otherCard(ev);
  }

  // -------------------------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------------------------
  function verdictPill(status, cls = 'pill') {
    const p = h('span', `${cls} v-${status}`);
    if (status === 'running') p.append(h('span', 'spinner'), h('span', null, 'RUNNING'));
    else p.textContent = status === 'pending' ? 'PENDING' : `${ICON[status] ?? ''} ${status}`.trim();
    return p;
  }

  function criterionStatus(id) {
    const own = [...cells.values()].filter((c) => c.info.criterion === id);
    if (own.some((c) => c.state === 'running')) return 'running';
    // A criterion is only decided once every one of its cells has a result; an unknown verdict
    // counts as ERROR.
    if (!own.every((c) => c.verdict)) return 'pending';
    const judged = own.filter((c) => c.verdict !== 'SHOWN');
    if (judged.length) {
      return judged.map((c) => (c.verdict in RANK ? c.verdict : 'ERROR')).reduce((w, v) => (RANK[v] > RANK[w] ? v : w));
    }
    return own.length ? 'SHOWN' : 'pending';
  }

  function countsInto(target) {
    target.replaceChildren();
    const tally = { PASS: 0, FAIL: 0, ERROR: 0, pending: 0 };
    for (const k of nb.criteria) {
      const s = criterionStatus(k.id);
      if (s in tally) tally[s]++;
      else tally.pending++;
    }
    target.append(h('span', 'count-total', `${nb.criteria.length} criteria`));
    for (const [k, n] of Object.entries(tally)) {
      if (k === 'pending' && n === 0) continue;
      const c = h('span', `count v-${k}`);
      c.append(h('span', 'count-n', n), h('span', 'count-l', k === 'pending' ? 'pending' : k));
      target.append(c);
    }
  }

  function refreshStatus() {
    for (const k of nb.criteria) {
      const li = $(`[data-criterion="${CSS.escape(k.id)}"]`);
      if (!li) continue;
      const s = criterionStatus(k.id);
      li.dataset.status = s;
      li.querySelector('.crit-top .pill').replaceWith(verdictPill(s));
    }
    for (const step of document.querySelectorAll('.crit-step')) {
      const c = cells.get(step.dataset.stepCell);
      if (!c) continue;
      const s = c.state === 'running' ? 'running' : c.verdict ?? 'pending';
      step.dataset.status = s;
      step.querySelector('.cs-mark').textContent = s === 'pending' ? '○' : s === 'running' ? '◐' : (ICON[s] ?? '•');
    }
    countsInto($('#counts'));
    if (!$('#summary').hidden) renderSummary();
  }

  function renderCell(info) {
    const sec = h('section', 'cell');
    sec.id = `cell-${info.id}`;
    sec.dataset.cell = info.id;
    sec.dataset.state = 'idle';

    const head = h('header', 'cell-head');
    if (info.criterion) head.append(h('span', 'chip', info.criterion));
    if (info.stepCount > 1) head.append(h('span', 'step-chip', `Step ${info.stepNo} of ${info.stepCount}`));
    head.append(h('h2', 'cell-title', info.title));
    const right = h('div', 'cell-head-right');
    if (info.step) right.append(h('span', 'step-label', `step ${info.step}`));
    const badge = h('span', 'verdict-badge v-idle', 'NOT RUN');
    right.append(badge);
    head.append(right);
    sec.append(head);

    if (info.markdown) {
      const md = h('div', 'md');
      md.innerHTML = markdown(info.markdown);
      sec.append(md);
    }

    const code = h('div', 'code');
    const gutter = h('div', 'gutter');
    const btn = h('button', 'run-btn');
    btn.type = 'button';
    btn.dataset.run = info.id;
    btn.setAttribute('aria-label', `Run ${info.title}`);
    btn.append(h('span', 'run-icon'), h('span', 'run-label', 'Run'));
    btn.addEventListener('click', (e) => {
      ripple(btn, e);
      runCell(info.id);
    });
    gutter.append(btn);
    const body = h('div', 'code-body');
    const bar = h('div', 'code-bar');
    bar.append(h('span', 'runner', info.runner === 'exec' ? 'exec' : info.runner), h('span', 'cwd', `cwd ${info.cwd}`));
    const status = h('span', 'run-status', '');
    bar.append(status);
    const pre = h('pre', 'cmd');
    const lines = String(info.display).replace(/\r\n?/g, '\n').replace(/\x1b/g, '␛').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '�').split('\n');
    pre.innerHTML = lines.map((l, i) => `<span class="prompt">${i === 0 ? '›' : ' '}</span>${highlightCmd(l)}`).join('\n');
    body.append(bar, pre);
    code.append(gutter, body);
    sec.append(code);

    const out = h('div', 'output');
    out.hidden = true;
    const summaryRow = h('div', 'out-summary');
    const cards = h('div', 'cards');
    const det = h('details', 'console');
    const sum = h('summary');
    sum.append(h('span', 'console-title', 'Console'), h('span', 'console-meta', ''));
    const term = h('pre', 'term');
    det.append(sum, term);
    out.append(summaryRow, cards, det);
    sec.append(out);

    return { sec, badge, btn, status, out, summaryRow, cards, det, term, consoleMeta: sum.querySelector('.console-meta') };
  }

  function highlightCmd(line) {
    // Light, presentation-only highlighting of the displayed command.
    return esc(line)
      .replace(/(^|\s)(--?[A-Za-z][\w-]*)/g, '$1<span class="c-flag">$2</span>')
      .replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, '<span class="c-str">$1</span>')
      .replace(/^(\s*)([\w./\\-]+)/, '$1<span class="c-cmd">$2</span>');
  }

  function ripple(btn) {
    btn.classList.remove('pressed');
    void btn.offsetWidth;
    btn.classList.add('pressed');
    setTimeout(() => btn.classList.remove('pressed'), 600);
  }

  function setBadge(c, status) {
    c.ui.badge.className = `verdict-badge v-${status}`;
    c.ui.badge.replaceChildren();
    if (status === 'running') c.ui.badge.append(h('span', 'spinner'), h('span', null, 'RUNNING'));
    else c.ui.badge.textContent = `${ICON[status] ?? ''} ${status}`.trim();
  }

  // -------------------------------------------------------------------------------------------
  // Running a cell
  // -------------------------------------------------------------------------------------------
  function runCell(id) {
    const c = cells.get(id);
    if (!c) return Promise.reject(new Error(`no cell ${id}`));
    if (c.state === 'running') return c.promise;
    c.promise = doRun(c);
    return c.promise;
  }

  async function doRun(c) {
    const ui = c.ui;
    Object.assign(c, { state: 'running', verdict: null, exitCode: null, durationMs: null, markers: [], reason: null });
    ui.sec.dataset.state = 'running';
    ui.sec.classList.remove('has-cards');
    ui.btn.disabled = true;
    setBadge(c, 'running');
    ui.out.hidden = false;
    ui.cards.replaceChildren();
    ui.summaryRow.replaceChildren();
    ui.term.replaceChildren();
    ui.det.open = true;
    ui.consoleMeta.textContent = 'streaming…';
    const ansi = new Ansi();
    const t0 = performance.now();
    const tick = setInterval(() => { ui.status.textContent = `running · ${((performance.now() - t0) / 1000).toFixed(1)} s`; }, 100);
    ui.status.className = 'run-status running';
    refreshStatus();

    let done = null;
    let lineCount = 0;
    const append = (text) => {
      lineCount += (text.match(/\n/g) ?? []).length;
      ui.term.insertAdjacentHTML('beforeend', ansi.push(text));
      ui.term.scrollTop = ui.term.scrollHeight;
    };
    try {
      const res = await fetch(`/api/cells/${encodeURIComponent(c.info.id)}/run`, { method: 'POST' });
      if (!res.ok || !res.body) {
        let msg = `${res.status} ${res.statusText}`;
        try { msg = (await res.json()).error ?? msg; } catch { /* keep status */ }
        throw new Error(`runner refused: ${msg}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = 'message';
          let data = '';
          for (const l of block.split('\n')) {
            if (l.startsWith('event: ')) event = l.slice(7);
            else if (l.startsWith('data: ')) data += l.slice(6);
          }
          const payload = data ? JSON.parse(data) : {};
          if (event === 'output') append(payload.text);
          else if (event === 'done') done = payload;
        }
      }
      if (!done) throw new Error('the runner closed the stream before the cell finished');
    } catch (e) {
      append(`\n${e.message}\n`);
      done = { exitCode: null, durationMs: Math.round(performance.now() - t0), markers: [], verdict: 'ERROR', reason: e.message, evidence: [] };
    } finally {
      clearInterval(tick);
    }
    finish(c, done, lineCount);
    return { verdict: c.verdict, exitCode: c.exitCode };
  }

  function finish(c, done, lineCount) {
    const ui = c.ui;
    Object.assign(c, { state: 'done', verdict: done.verdict, exitCode: done.exitCode, durationMs: done.durationMs, markers: done.markers ?? [], reason: done.reason });
    setBadge(c, done.verdict);
    ui.btn.disabled = false;
    ui.status.className = `run-status v-${done.verdict}`;
    ui.status.textContent = `exit ${done.exitCode ?? '—'} · ${(done.durationMs / 1000).toFixed(2)} s`;

    const row = ui.summaryRow;
    row.append(verdictPill(done.verdict, 'out-verdict'));
    for (const m of done.markers ?? []) {
      const chip = h('span', `marker v-${m.verdict}`);
      chip.append(h('span', 'marker-k', 'UAT_STEP'), h('span', 'marker-step', m.step), h('strong', null, m.verdict));
      row.append(chip);
    }
    if (done.reason) row.append(h('span', 'reason', done.reason));

    const evidence = done.evidence ?? [];
    for (const ev of evidence) ui.cards.append(evidenceCard(ev));
    const hasCards = evidence.some((e) => e.data);
    ui.sec.classList.toggle('has-cards', hasCards);
    ui.consoleMeta.textContent = `${lineCount} line${lineCount === 1 ? '' : 's'} · raw output`;
    ui.det.open = !hasCards;
    ui.sec.dataset.state = 'done';
    refreshStatus();
    for (const w of c.waiters.splice(0)) w({ verdict: c.verdict, exitCode: c.exitCode });
  }

  // -------------------------------------------------------------------------------------------
  // Presenter / automation helpers
  // -------------------------------------------------------------------------------------------
  const main = () => $('#main');

  async function settleScroll(maxMs = 1800) {
    const el = main();
    let last = -1;
    let stable = 0;
    const end = performance.now() + maxMs;
    while (performance.now() < end) {
      await sleep(50);
      if (Math.abs(el.scrollTop - last) < 1) { if (++stable >= 4) break; } else stable = 0;
      last = el.scrollTop;
    }
  }

  async function focus(id) {
    const c = cells.get(id);
    if (!c) throw new Error(`no cell ${id}`);
    document.querySelectorAll('.cell.focused').forEach((e) => e.classList.remove('focused'));
    c.ui.sec.classList.add('focused');
    // Sidebar: expand the active criterion's steps and mark the current one.
    document.querySelectorAll('.crit.active').forEach((e) => e.classList.remove('active'));
    document.querySelectorAll('.crit-step.current').forEach((e) => e.classList.remove('current'));
    if (c.info.criterion) $(`[data-criterion="${CSS.escape(c.info.criterion)}"]`)?.classList.add('active');
    $(`[data-step-cell="${CSS.escape(id)}"]`)?.classList.add('current');
    keepInSidebarView(c.info.criterion, id);
    stepToast(c.info);
    main().scrollTo({ top: Math.max(0, c.ui.sec.offsetTop - 28), behavior: 'smooth' });
    await settleScroll();
  }

  // Scroll the sidebar (its own scroll container) so the active criterion, and its current
  // step, stay visible; lower criteria would otherwise expand below the fold.
  function keepInSidebarView(criterion, cellId) {
    const box = document.querySelector('.side-section');
    const crit = criterion && $(`[data-criterion="${CSS.escape(criterion)}"]`);
    if (!box || !crit) return;
    const step = $(`[data-step-cell="${CSS.escape(cellId)}"]`);
    const rel = (el) => el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    const top = rel(crit) - 12;
    const bottom = rel(crit) + crit.offsetHeight + 12;
    let target = box.scrollTop;
    if (bottom > box.scrollTop + box.clientHeight) target = bottom - box.clientHeight;
    if (top < target) target = top;
    // A tall criterion that cannot fit entirely: at least keep the current step in view.
    if (step && rel(step) + step.offsetHeight > target + box.clientHeight) target = rel(step) + step.offsetHeight + 12 - box.clientHeight;
    box.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }

  // A short cue when the recording moves to a new step, so viewers see the transition.
  let toastTimer = null;
  function stepToast(info) {
    const t = $('#step-toast');
    if (!t || !info.criterion) return;
    t.replaceChildren(h('span', 'chip', info.criterion));
    if (info.stepCount > 1) t.append(h('span', 'toast-step', `Step ${info.stepNo} of ${info.stepCount}`));
    t.append(h('span', 'toast-title', info.title));
    t.hidden = false;
    t.classList.remove('shown');
    requestAnimationFrame(() => t.classList.add('shown'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.remove('shown'); setTimeout(() => { t.hidden = true; }, 350); }, 2600);
  }

  // Brings the cell's results into view without hiding the start of the output.
  async function reveal(id) {
    const c = cells.get(id);
    if (!c) throw new Error(`no cell ${id}`);
    const el = main();
    const bottom = c.ui.sec.offsetTop + c.ui.sec.offsetHeight;
    const viewBottom = el.scrollTop + el.clientHeight;
    if (bottom + 28 <= viewBottom) return;
    const wanted = bottom - el.clientHeight + 28;
    // The sticky cell header covers the top of the viewport, so keep the output start below it.
    const outTop = c.ui.sec.offsetTop + c.ui.out.offsetTop - c.ui.sec.querySelector('.cell-head').offsetHeight - 16;
    el.scrollTo({ top: Math.max(el.scrollTop, Math.min(wanted, outTop)), behavior: 'smooth' });
    await settleScroll();
  }

  function waitDone(id) {
    const c = cells.get(id);
    if (!c) return Promise.reject(new Error(`no cell ${id}`));
    if (c.state === 'done') return Promise.resolve({ verdict: c.verdict, exitCode: c.exitCode });
    return new Promise((r) => c.waiters.push(r));
  }

  function caption(text) {
    const cap = $('#caption');
    if (text === null || text === undefined || text === '') { cap.hidden = true; return; }
    $('#caption-text').textContent = String(text);
    cap.hidden = false;
  }

  function renderSummary() {
    $('#summary-title').textContent = nb.title;
    countsInto($('#summary-counts'));
    const list = $('#summary-list');
    list.replaceChildren();
    for (const k of nb.criteria) {
      const li = h('li', 'summary-item');
      const s = criterionStatus(k.id);
      li.dataset.status = s;
      const top = h('div', 'summary-top');
      top.append(h('span', 'chip', k.id), h('span', 'summary-crit', k.title), verdictPill(s, 'pill pill-lg'));
      li.append(top);
      const sub = h('div', 'summary-cells');
      for (const c of [...cells.values()].filter((x) => x.info.criterion === k.id)) {
        const row = h('span', `summary-cell v-${c.verdict ?? 'pending'}`);
        row.append(h('span', 'sc-mark', c.verdict ? (ICON[c.verdict] ?? '•') : '○'), h('span', null, c.info.title));
        sub.append(row);
      }
      li.append(sub);
      list.append(li);
    }
  }

  async function showSummary() {
    renderSummary();
    const s = $('#summary');
    s.hidden = false;
    requestAnimationFrame(() => s.classList.add('shown'));
    await sleep(500);
  }
  function hideSummary() {
    const s = $('#summary');
    s.classList.remove('shown');
    s.hidden = true;
  }

  function state() {
    const out = { title: nb?.title, sha256: nb?.sha256, cells: {}, criteria: {} };
    for (const [id, c] of cells) out.cells[id] = { state: c.state, verdict: c.verdict, exitCode: c.exitCode, durationMs: c.durationMs, markers: c.markers, reason: c.reason };
    for (const k of nb?.criteria ?? []) out.criteria[k.id] = criterionStatus(k.id);
    return out;
  }

  window.uat = {
    ready: () => readyPromise,
    cells: () => (nb?.cells ?? []).map((c) => ({ ...c })),
    focus,
    reveal,
    run: (id) => {
      const btn = document.querySelector(`[data-run="${CSS.escape(id)}"]`);
      if (!btn) return Promise.reject(new Error(`no cell ${id}`));
      // Wait for the run this click starts, never a previous result of the same cell.
      const c = cells.get(id);
      const next = new Promise((r) => c.waiters.push(r));
      btn.click();
      return next;
    },
    waitDone,
    caption,
    showSummary,
    hideSummary,
    state,
  };

  // -------------------------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------------------------
  async function boot() {
    const res = await fetch('/api/notebook', { cache: 'no-store' });
    nb = await res.json();
    document.title = `${nb.title} · UAT workbench`;
    $('#nb-title').textContent = nb.title;
    const sub = $('#nb-subtitle');
    for (const line of nb.subtitle) sub.append(h('div', 'subtitle-line', line));

    const list = $('#criteria');
    for (const k of nb.criteria) {
      const li = h('li', 'crit');
      li.dataset.criterion = k.id;
      li.dataset.status = 'pending';
      const top = h('div', 'crit-top');
      top.append(h('span', 'chip', k.id), verdictPill('pending'));
      li.append(top);
      if (k.title) li.append(h('div', 'crit-title', k.title));
      list.append(li);
    }
    const meta = $('#nb-meta');
    meta.append(h('div', null, `${nb.file} · ${nb.cells.length} cells`), h('div', 'mono', `sha256 ${nb.sha256.slice(0, 16)}…`));
    if (nb.hasSetup) meta.append(h('div', null, 'hidden setup runs before the first cell'));

    const container = $('#cells');
    // Number each criterion's cells so multi-step criteria read "AC5 · Step 2 of 2".
    const perCriterion = new Map();
    for (const info of nb.cells) {
      if (!info.criterion) continue;
      if (!perCriterion.has(info.criterion)) perCriterion.set(info.criterion, []);
      perCriterion.get(info.criterion).push(info);
    }
    for (const group of perCriterion.values()) {
      group.forEach((info, i) => { info.stepNo = i + 1; info.stepCount = group.length; });
    }
    for (const k of nb.criteria) {
      const group = perCriterion.get(k.id) ?? [];
      if (group.length < 2) continue;
      const steps = h('ol', 'crit-steps');
      for (const info of group) {
        const li = h('li', 'crit-step');
        li.dataset.stepCell = info.id;
        li.dataset.status = 'pending';
        li.append(h('span', 'cs-mark', '○'), h('span', 'cs-no', String(info.stepNo)), h('span', 'cs-title', info.title));
        steps.append(li);
      }
      $(`[data-criterion="${CSS.escape(k.id)}"]`).append(steps);
    }
    nb.cells.forEach((info) => {
      const ui = renderCell(info);
      container.append(ui.sec);
      cells.set(info.id, { info, ui, state: 'idle', verdict: null, exitCode: null, durationMs: null, markers: [], reason: null, waiters: [] });
    });
    refreshStatus();
    if (document.fonts?.ready) await document.fonts.ready;
    document.body.classList.add('ready');
    readyResolve();
  }

  boot().catch((e) => {
    $('#nb-title').textContent = `Could not load the notebook: ${e.message}`;
  });
})();
