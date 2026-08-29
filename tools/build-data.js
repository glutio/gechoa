// ============================================================================
// build-data.js  —  Parse GEC-Declaration-Full.md into structured window.DECL_DATA
// Model: 1980 base nodes + chronological amendment operations -> per-node revisions.
// Output: public/decl/data.js
// ============================================================================
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'decl', 'data.js');

let warnings = [];
const warn = m => warnings.push(m);

// ---- deterministic, heading-aware sentence splitter -------------------------
// Amendments address text positionally ("the first/second/third/last sentence").
// This splits a node's markdown into sentences so those references resolve to an
// exact index — no fuzzy find. A leading bold heading (**N.N Title.**) is held
// aside so its internal period never starts a new sentence; it re-attaches to the
// first sentence. A boundary is a . ! ? followed by whitespace + capital / ( / bold
// star / quote, where the char before the period is NOT a digit (guards decimals,
// section refs like 12.4.1, and citations like RCW 64.32.200(2)).
function splitSentences(md) {
  if (!md) return [];
  var prefix = '';
  var h = md.match(/^\s*\*\*[^*]+\*\*\s*/);
  if (h) { prefix = h[0]; md = md.slice(h[0].length); }
  var out = [], buf = '';
  for (var i = 0; i < md.length; i++) {
    var c = md[i]; buf += c;
    if (c === '.' || c === '!' || c === '?') {
      var rest = md.slice(i + 1), prev = md[i - 1] || '';
      if (/^\s+[A-Z(*"]/.test(rest) && !/\d/.test(prev)) {
        out.push(buf.trim()); buf = '';
        while (i + 1 < md.length && /\s/.test(md[i + 1])) i++;
      }
    }
  }
  if (buf.trim()) out.push(buf.trim());
  if (out.length) out[0] = (prefix + out[0]).trim();
  else if (prefix.trim()) out.push(prefix.trim());
  return out;
}
// Resolve a sentence selector (0-based index or 'last') against a text.
function sentenceAt(md, sel) {
  var ss = splitSentences(md);
  var idx = sel === 'last' ? ss.length - 1 : sel;
  return { list: ss, idx: idx, text: ss[idx] };
}

// ---- strip trailing italic parenthetical editorial notes: *(Note: ...)* ----
function stripNotes(s) {
  // remove ALL editorial italic parenthetical notes  *(Note: ...)* / *(Deleted ...)*  anywhere in the string
  return s.replace(/\s*\*\([^*]*\*/g, '').replace(/[ \t]{2,}/g, ' ').trim();
}

// ---- split into PARTS ----
function loadParts(mdText) {
  const parts = {};
  let curPart = null;
  const lines = mdText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^# PART ([IV]+):\s*(.+)$/);
    if (m) { curPart = m[1]; parts[curPart] = { title: m[2].trim(), lines: [] }; continue; }
    if (curPart) parts[curPart].lines.push(lines[i]);
  }
  return parts;
}

// ---- parse recording metadata block (lines like  **Key:** value ) ----
function parseMeta(L) {
  const meta = {};
  for (const line of L) {
    if (/^### /.test(line)) break;
    const m = line.match(/^\*\*([^:*]+):\*\*\s*(.*?)\s*$/);
    if (m) meta[m[1].trim()] = m[2].trim();
  }
  return meta;
}

// ---- parse PART V base into sections + appendices ----
function parseBase(L) {
  const sections = [];
  const appendices = [];
  let sec = null, mode = 'sec';
  let lastByDepth = {}, lastNumeric = null;

  function pushNode(node, depth) {
    node.children = [];
    if (depth === 0) sec.nodes.push(node);
    else { const p = lastByDepth[depth - 1]; (p ? p.children : sec.nodes).push(node); }
    lastByDepth[depth] = node;
    Object.keys(lastByDepth).forEach(d => { if (+d > depth) delete lastByDepth[d]; });
  }

  for (let i = 0; i < L.length; i++) {
    const line = L[i];
    const secM = line.match(/^### SECTION ([\dIVXLCDM]+):\s*(.+)$/);
    const appM = line.match(/^### APPENDIX "?([A-C])"?[:\s]*(.*)$/);
    if (secM) { sec = { num: secM[1], title: secM[2].trim(), preamble: '', nodes: [], kind: 'section' }; sections.push(sec); lastByDepth = {}; lastNumeric = null; mode = 'sec'; continue; }
    if (appM) { sec = { num: appM[1], title: appM[2].trim(), rawLines: [], kind: 'appendix' }; appendices.push(sec); mode = 'app'; continue; }
    if (!sec) continue;
    if (mode === 'app') { sec.rawLines.push(line); continue; }
    if (/^---\s*$/.test(line) || line.trim() === '') continue;

    const bm = line.match(/^(\s*)\*\s+(.*)$/);
    if (bm) {
      const depth = Math.floor(bm[1].length / 2);
      let rawContent = bm[2].trim();
      // Optional explicit id marker  {#III.5}  — sets a unique (article-scoped) id
      // while the displayed heading stays verbatim. Used by docs (e.g. Bylaws) whose
      // section numbers restart per article, so bare "5." is not globally unique.
      let explicitId = null;
      const idm = rawContent.match(/^\{#([^}]+)\}\s*/);
      if (idm) { explicitId = idm[1].trim(); rawContent = rawContent.slice(idm[0].length); }
      const content = stripNotes(rawContent);
      if (!content) continue;
      let id = null, num = null, kind = 'num';
      if (explicitId) { id = explicitId; num = explicitId; }
      else {
        const nm = content.match(/^\*\*\(?(\d+(?:\.\d+)*)\.?\)?/);
        if (nm) { num = nm[1]; id = num; }
        else {
          const lm = content.match(/^\((\w+)\)/);
          if (lm) { kind = 'letter'; const par = lastNumeric ? lastNumeric.id : sec.num; id = par + '(' + lm[1] + ')'; num = '(' + lm[1] + ')'; }
        }
      }
      const node = { id, num, md: content, kind };
      pushNode(node, depth);
      if (kind === 'num') lastNumeric = node;
      continue;
    }
    const txt = stripNotes(line.trim());
    if (txt) sec.preamble = (sec.preamble ? sec.preamble + ' ' : '') + txt;
  }
  return { sections, appendices };
}

// ---- parse an appendix's raw lines into ordered blocks ----
function parseAppendixBlocks(rawLines) {
  const blocks = [];
  let i = 0;
  const L = rawLines;
  while (i < L.length) {
    const line = L[i];
    if (/^---\s*$/.test(line) || line.trim() === '') { i++; continue; }
    let m;
    if ((m = line.match(/^####\s+(.*)$/))) { blocks.push({ type: 'subhead', text: stripNotes(m[1].trim()) }); i++; continue; }
    if (/^\|/.test(line)) { const rows = []; while (i < L.length && /^\|/.test(L[i])) { rows.push(L[i]); i++; } blocks.push(parseTable(rows)); continue; }
    if (/^>/.test(line)) { const items = []; while (i < L.length && /^>/.test(L[i])) { items.push(stripNotes(L[i].replace(/^>\s?/, '').trim())); i++; } blocks.push({ type: 'blockquote', items: items.filter(Boolean) }); continue; }
    if (/^\*\s+/.test(line)) { const items = []; while (i < L.length && /^\*\s+/.test(L[i])) { items.push(stripNotes(L[i].replace(/^\*\s+/, '').trim())); i++; } blocks.push({ type: 'ul', items }); continue; }
    blocks.push({ type: 'p', md: stripNotes(line.trim()) });
    i++;
  }
  return blocks;
}

function parseTable(rows) {
  const cells = rows.map(r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
  const body = cells.filter(r => !r.every(c => /^:?-+:?$/.test(c) || c === ''));
  const header = body.shift() || [];
  const out = [];
  for (const r of body) {
    const nonEmpty = r.filter(c => c !== '');
    if (nonEmpty.length === 1 && /^\*\*.*\*\*$/.test(nonEmpty[0])) out.push({ group: nonEmpty[0].replace(/\*\*/g, '') });
    else out.push({ cells: r });
  }
  return { type: 'table', header, rows: out };
}

// ---- parse amendment PART (I/II/III) ----
function parseExhibits(L, amend, year) {
  const out = [];
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(/^###\s+EXHIBIT\b.*$/i);
    if (!m) continue;
    const letterM = L[i].match(/EXHIBIT\s+"?([A-Z])"?/i);
    const letter = letterM ? letterM[1].toUpperCase() : String(out.length + 1);
    const label = L[i].replace(/^###\s+/, '').trim();
    const seg = [];
    let j = i + 1;
    for (; j < L.length; j++) {
      if (/^#{1,3}\s/.test(L[j]) || /^---\s*$/.test(L[j])) break;
      seg.push(L[j]);
    }
    out.push({ id: 'exhibit-' + letter.toLowerCase() + '-' + year, amend, year, letter, label, blocks: parseAppendixBlocks(seg) });
    i = j - 1;
  }
  return out;
}

// Parse an amendment operation directive:  <!--op TYPE key=val key=val flag-->
// The MD carries these invisible comments (added by an intelligent pass over the
// clean amendment prose); the build just applies them. Verbatim text is never
// retyped here — it comes from the adjacent blockquote.
function parseDirective(s) {
  const parts = s.trim().split(/\s+/);
  const d = { type: parts[0] };
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq < 0) { d[parts[i]] = true; continue; }
    const k = parts[i].slice(0, eq), v = parts[i].slice(eq + 1);
    if (k === 'sentence') d.sentence = (v === 'last' ? 'last' : parseInt(v, 10));
    else d[k] = v;
  }
  return d;
}

function parseAmendment(L) {
  const meta = parseMeta(L);
  let start = L.findIndex(x => /^### Text of Amendment/.test(x));
  if (start < 0) start = 0;
  const body = L.slice(start + 1);
  const items = [];
  for (let i = 0; i < body.length; i++) {
    const m = body[i].match(/^\*\*([A-Z])(?:\s*&\s*([A-Z]))?\.\*\*\s*(.*)$/);
    if (m) items.push({ letters: m[2] ? [m[1], m[2]] : [m[1]], start: i, first: m[3] });
  }
  const parsed = [];
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    const end = k + 1 < items.length ? items[k + 1].start : body.length;
    const block = body.slice(it.start, end);
    let intro = it.first;
    const bq = [], directives = [];
    for (let j = 1; j < block.length; j++) {
      const l = block[j];
      const dm = l.match(/^<!--\s*op\s+(.+?)\s*-->\s*$/);
      if (dm) { directives.push(parseDirective(dm[1])); continue; }
      if (/^>/.test(l)) bq.push(l);
      else if (bq.length === 0 && l.trim() && !/^---/.test(l)) intro += ' ' + l.trim();
    }
    const nodes = [];
    let cur = null, lead = '';
    for (const l of bq) {
      const t = l.replace(/^>\s?/, '');
      // Optional explicit id marker {#XII.1} (see parseBase); strips from display.
      let markId = null, tt = t;
      const idm = tt.match(/^\{#([^}]+)\}\s*/);
      if (idm) { markId = idm[1].trim(); tt = tt.slice(idm[0].length); }
      const nm = markId ? null : tt.match(/^\*\*\(?(\d+(?:\.\d+)*)\.?\)?/);
      if (markId) { cur = { id: markId, md: stripNotes(tt.trim()) }; nodes.push(cur); continue; }
      if (nm) { cur = { id: nm[1], md: stripNotes(tt.trim()) }; nodes.push(cur); continue; }
      // A blockquote line that is a markdown list item ("1. " / "(a) " / "· ") is a
      // genuine line break in the source. Preserve it as a newline in the node text so
      // the renderer can present a real list; ordinary continuation lines flow with a
      // space. Deterministic: respect the source's line structure, do not detect lists.
      const isListLine = /^(\d+\.|\([A-Za-z]+\)|[·•‣])\s+\S/.test(tt);
      if (cur && tt.trim()) cur.md = stripNotes((cur.md + (isListLine ? '\n' : ' ') + tt.trim()).trim());
      else if (!cur && tt.trim()) lead = stripNotes((lead + ' ' + tt.trim()).trim());
    }
    parsed.push({ letters: it.letters, intro: intro.replace(/\s+/g, ' ').trim(), nodes, lead, directives });
  }
  return { meta, items: parsed };
}

// ============================================================================
// buildDoc(cfg) — build one document (base + chronological amendments) into the
// window-data shape. Runs once per document; the Declaration output is unchanged.
//   cfg = { parts, baseKey, relatedKey, amendmentsMeta, chrono, baseAmend,
//           meta:{title,subtitle}, sectionLabel }
// ============================================================================
function buildDoc(cfg) {
  const parts = cfg.parts;
  warnings = [];
// ---- build base tree ----
const base = parseBase(parts[cfg.baseKey].lines);
base.appendices.forEach(a => { a.blocks = parseAppendixBlocks(a.rawLines); delete a.rawLines; });

const flat = {};
base.sections.forEach(s => (function w(ns) { ns.forEach(n => { if (n.id) flat[n.id] = n; if (n.children) w(n.children); }); })(s.nodes));
base.sections.forEach(s => { if (s.nodes.length === 0 && s.preamble) { const n = { id: s.num, num: s.num, md: s.preamble, kind: 'sectionBody', children: [] }; s.nodes.push(n); flat[s.num] = n; s.preamble = ''; } });
Object.values(flat).forEach(n => { n.base = n.md; n.revisions = [{ amend: cfg.baseAmend.id, md: n.md }]; });

const amendmentsMeta = cfg.amendmentsMeta;
const CHRONO = cfg.chrono;

const workMd = {};
Object.values(flat).forEach(n => { workMd[n.id] = n.md; });

function parentIdOf(id) {
  if (/\(\w+\)$/.test(id)) return id.replace(/\([^)]*\)$/, '');
  const dot = id.lastIndexOf('.');
  return dot > 0 ? id.slice(0, dot) : null;
}
function sectionOfId(id) { return id.split('.')[0].replace(/\(.*/, ''); }

function ensureNode(id, amend) {
  if (flat[id]) return flat[id];
  const node = { id, num: id, md: '', kind: 'num', children: [], revisions: [], addedBy: amend, base: null };
  flat[id] = node;
  const pid = parentIdOf(id);
  if (pid && flat[pid]) flat[pid].children.push(node);
  else { const sec = base.sections.find(s => s.num === sectionOfId(id)); if (sec) sec.nodes.push(node); else warn('add: no parent/section for ' + id); }
  return node;
}

// Apply one directive to the working text and emit the corresponding first-class op(s).
// Text source: a numbered node in THIS item whose id == target supplies verbatim text;
// otherwise the item's unnumbered lead-in blockquote does. We never retype legal text.
// Returns { ops, consumed } — consumed lists node ids whose text was taken (so the
// default numbered-node pass skips them).
function applyDirective(d, aid, letter, intro, item) {
  const ops = [];
  if (d.type === 'delete') {
    const targets = String(d.target || '').split(',').map(s => s.trim()).filter(Boolean);
    targets.forEach(id => {
      const n = flat[id];
      if (!n) { warn('directive delete: missing ' + id); return; }
      n.deletedBy = aid; n.revisions.push({ amend: aid, md: null, deleted: true });
      ops.push({ letter, intro, type: 'delete', target: id });
    });
    return { ops, consumed: [] };
  }
  const id = d.target;
  const n = flat[id];
  if (!n) { warn('directive ' + d.type + ': missing target ' + id); return { ops, consumed: [] }; }
  const tn = item.nodes.find(x => x.id === id);
  const text = tn ? tn.md : item.lead;
  if (!text) { warn('directive ' + d.type + ' ' + id + ': no text source'); return { ops, consumed: [] }; }
  let md = workMd[id] != null ? workMd[id] : (n.base || '');
  const consumed = tn ? [id] : [];
  if (d.type === 'replace-sentence') {
    const r = sentenceAt(md, d.sentence);
    if (r.text == null || md.indexOf(r.text) < 0) warn('replace-sentence[' + d.sentence + '] resolve failed in ' + id);
    else md = md.replace(r.text, text);
    ops.push({ letter, intro, type: 'replace-sentence', target: id, sentence: d.sentence, text });
  } else if (d.type === 'insert-after-sentence') {
    const r = sentenceAt(md, d.sentence);
    if (r.text == null || md.indexOf(r.text) < 0) warn('insert-after-sentence[' + d.sentence + '] resolve failed in ' + id);
    else md = md.replace(r.text, r.text + ' ' + text);
    ops.push({ letter, intro, type: 'insert-after-sentence', target: id, sentence: d.sentence, text });
  } else if (d.type === 'append') {
    md = md + ' ' + text;
    ops.push({ letter, intro, type: 'append', target: id, text });
  } else if (d.type === 'replace') {
    md = text;
    ops.push({ letter, intro, type: 'replace', target: id, text });
  } else { warn('unknown directive type ' + d.type); return { ops, consumed: [] }; }
  workMd[id] = md;
  n.revisions.push({ amend: aid, md });
  return { ops, consumed };
}

const amendmentsOut = [];

// Tag ops that form a subtree action: a top parent op whose target is an ancestor of
// other op targets in the SAME item. The top parent gets subtree:true; every descendant
// op gets partOf:<parentTarget>. Only the outermost parent is flagged.
function tagSubtreeOps(ops) {
  ops.forEach(p => {
    const kids = ops.filter(o => o !== p && o.target.startsWith(p.target + '.'));
    if (!kids.length) return;
    const hasAncestor = ops.some(o => o !== p && p.target.startsWith(o.target + '.'));
    if (hasAncestor) return;
    p.subtree = true;
    kids.forEach(k => { k.partOf = p.target; });
  });
}
for (const aid of CHRONO) {
  const info = amendmentsMeta[aid];
  const P = parseAmendment(parts[info.part].lines);
  const operations = [];
  for (const item of P.items) {
    const letter = item.letters.join(' & ');
    const intro = item.intro;
    const itemOps = [];
    const consumed = new Set();
    // 1. Directives (AI-encoded semantics) run first, consuming any numbered node
    //    whose verbatim text they use.
    for (const d of (item.directives || [])) {
      const r = applyDirective(d, aid, letter, intro, item);
      itemOps.push(...r.ops);
      r.consumed.forEach(id => consumed.add(id));
    }
    // 2. Default path for remaining numbered nodes: replace-if-exists, else add.
    const defaultOps = [];
    for (const bn of item.nodes) {
      if (consumed.has(bn.id)) continue;
      if (flat[bn.id]) {
        const n = flat[bn.id]; n.revisions.push({ amend: aid, md: bn.md }); workMd[bn.id] = bn.md;
        defaultOps.push({ letter, intro, type: 'replace', target: bn.id, text: bn.md });
      } else {
        const n = ensureNode(bn.id, aid); n.md = bn.md; n.base = null; n.revisions = [{ amend: aid, md: bn.md }]; n.addedBy = aid; workMd[bn.id] = bn.md;
        defaultOps.push({ letter, intro, type: 'add', target: bn.id, text: bn.md });
      }
    }
    // A single item may act on a whole SUBTREE (parent replace + descendant nodes) —
    // mark the top parent subtree:true and link descendants via partOf so the renderer
    // presents them as one unit instead of a replace + N detached adds.
    tagSubtreeOps(defaultOps);
    itemOps.push(...defaultOps);
    // 3. Sanity: an item with no directives, no nodes, and no boilerplate intro is unhandled.
    if (!(item.directives || []).length && !item.nodes.length) {
      if (!/take effect|Dated|ATTEST|Notary/i.test(intro)) warn('unhandled item ' + info.part + ' ' + letter + ' :: ' + intro.slice(0, 70));
    }
    if (item.lead && !(item.directives || []).some(d => d.target && (d.type === 'append' || d.type === 'replace-sentence' || d.type === 'insert-after-sentence' || d.type === 'replace'))) {
      warn('unconsumed lead-in for item ' + info.part + ' ' + letter + ' :: ' + item.lead.slice(0, 60));
    }
    operations.push(...itemOps);
  }
  const anyExisting = operations.some(o => o.type !== 'add');
  amendmentsOut.push({ id: aid, year: info.year, label: info.label, short: info.short, kind: anyExisting ? 'modifying' : 'additive', recording: P.meta, operations });
}

// ---- amendment exhibits (e.g., Exhibit "B" to 2001 Amendment) ----
const exhibitsOut = [];
for (const aid of CHRONO) {
  const info = amendmentsMeta[aid];
  exhibitsOut.push(...parseExhibits(parts[info.part].lines, aid, info.year));
}

// ---- 1992 related document (PART IV) ----
function parse1992(L) {
  const meta = parseMeta(L);
  const blocks = [];
  let inGP = false;
  for (const line of L) {
    if (/^### General Provisions/.test(line)) { inGP = true; blocks.push({ type: 'subhead', text: 'General Provisions' }); continue; }
    if (/^---/.test(line) || line.trim() === '' || /^# /.test(line) || /^###/.test(line)) continue;
    if (/^\*\*[^:]+:\*\*/.test(line) && !inGP) continue;
    const bm = line.match(/^\*\s+\*\*([A-Z])\.\*\*\s*(.*)$/);
    if (bm) { blocks.push({ type: 'li', letter: bm[1], md: stripNotes(bm[2].trim()) }); continue; }
    blocks.push({ type: 'p', md: stripNotes(line.trim()) });
  }
  return { id: '1992', year: 1992, label: '1992 Short Plat Covenants', kind: 'related', recording: meta, blocks };
}
const related = cfg.relatedKey && parts[cfg.relatedKey] ? [parse1992(parts[cfg.relatedKey].lines)] : [];

// ---- finalize tree ----
function numKey(id) { return (id || '').split(/[.()]/).filter(Boolean).map(x => x.padStart(4, '0')).join('.'); }
function finalize(nodes) {
  nodes.sort((a, b) => numKey(a.id) < numKey(b.id) ? -1 : numKey(a.id) > numKey(b.id) ? 1 : 0);
  for (const n of nodes) {
    const revs = [];
    for (const r of n.revisions) { const prev = revs[revs.length - 1]; if (prev && prev.md === r.md && !r.deleted) continue; revs.push(r); }
    n.revisions = revs;
    n.current = n.deletedBy ? null : ((revs.filter(r => !r.deleted).slice(-1)[0] || {}).md || null);
    if (n.children && n.children.length) finalize(n.children); else delete n.children;
    delete n.md;
  }
}
base.sections.forEach(s => finalize(s.nodes));

// ---- raw emit: nodes carry only {id,num,kind,base,children}; changes live in operations ----
function emitRawNode(n) {
  const o = { id: n.id, num: n.num, kind: n.kind, base: (n.base === undefined ? null : n.base) };
  if (n.children && n.children.length) o.children = n.children.map(emitRawNode);
  return o;
}

// ---- assemble + emit ----
const DECL = {
  meta: {
    title: cfg.meta.title,
    subtitle: cfg.meta.subtitle,
    heading: cfg.meta.heading,
    generated: new Date().toISOString().slice(0, 10),
  },
  sectionLabel: cfg.sectionLabel || 'SECTION',
  amendments: [
    { id: cfg.baseAmend.id, year: cfg.baseAmend.year, label: cfg.baseAmend.label, short: cfg.baseAmend.short, kind: 'base', recording: parseMeta(parts[cfg.baseKey].lines) },
    ...amendmentsOut.map(a => ({ id: a.id, year: a.year, label: a.label, short: a.short, kind: a.kind, recording: a.recording, operations: a.operations })),
  ],
  sections: base.sections.map(s => ({ num: s.num, title: s.title, preamble: s.preamble || '', nodes: s.nodes.map(emitRawNode) })),
  appendices: base.appendices.map(a => ({ num: a.num, title: a.title, blocks: a.blocks })),
  exhibits: exhibitsOut,
  related,
};

  const totalNodes = Object.keys(flat).length;
  const added = Object.values(flat).filter(n => n.addedBy).length;
  const deleted = Object.values(flat).filter(n => n.deletedBy).length;
  return {
    DECL,
    composed: composeForVerify(DECL.sections, DECL.amendments),
    warnings: warnings.slice(),
    stats: { sections: base.sections.length, appendices: base.appendices.length, totalNodes, added, deleted, flat },
  };
}

// ---- COMPOSE VERIFICATION: reconstruct revisions from raw base+operations and compare to golden ----
// This mirrors composeData() in the runtime renderer — proving JSON is complete & renderer-derivable.
function composeForVerify(sections, amendments) {
  const fl = {};
  (function idx(l) { l.forEach(n => { fl[n.id] = n; if (n.children) idx(n.children); }); })(sections.flatMap(s => s.nodes));
  const baseId = amendments[0].id;
  Object.values(fl).forEach(n => { n._revs = (n.base != null) ? [{ amend: baseId, md: n.base }] : []; n._added = null; n._deleted = null; });
  const work = {};
  Object.values(fl).forEach(n => { if (n.base != null) work[n.id] = n.base; });
  amendments.slice(1).forEach(a => {
    (a.operations || []).forEach(op => {
      const n = fl[op.target];
      if (!n) { warn('verify compose: missing target ' + op.target); return; }
      if (op.type === 'delete') { n._deleted = a.id; n._revs.push({ amend: a.id, md: null, deleted: true }); return; }
      let md;
      if (op.type === 'add') { md = op.text; n._added = a.id; }
      else if (op.type === 'replace') { md = op.text; }
      else if (op.type === 'replace-sentence') { const c = work[op.target] || ''; const r = sentenceAt(c, op.sentence); if (r.text == null || c.indexOf(r.text) < 0) warn('verify sentence missing ' + op.target); md = c.replace(r.text, op.text); }
      else if (op.type === 'insert-after-sentence') { const c = work[op.target] || ''; const r = sentenceAt(c, op.sentence); if (r.text == null || c.indexOf(r.text) < 0) warn('verify after-sentence missing ' + op.target); md = c.replace(r.text, r.text + ' ' + op.text); }
      else if (op.type === 'append') { md = (work[op.target] || '') + ' ' + op.text; }
      else { warn('verify unknown op ' + op.type); return; }
      n._revs.push({ amend: a.id, md }); work[op.target] = md;
    });
  });
  const out = {};
  Object.values(fl).forEach(n => {
    const revs = [];
    for (const r of n._revs) { const p = revs[revs.length - 1]; if (p && p.md === r.md && !r.deleted) continue; revs.push(r); }
    out[n.id] = {
      revs: revs.map(r => ({ a: r.amend, d: !!r.deleted, md: r.md })),
      current: n._deleted ? null : ((revs.filter(r => !r.deleted).slice(-1)[0] || {}).md || null),
      addedBy: n._added, deletedBy: n._deleted,
    };
  });
  return out;
}
// ============================================================================
// DRIVER — build each configured document, emit window.GEC_DOCS, verify goldens.
// ============================================================================
function verifyGolden(goldenPath, composed) {
  if (process.env.GEC_WRITE_GOLDEN === '1') {
    fs.writeFileSync(goldenPath, JSON.stringify(composed, null, 0), 'utf8');
    console.log('COMPOSE VERIFY: golden regenerated (' + Object.keys(composed).length + ' nodes)');
    return;
  }
  if (!fs.existsSync(goldenPath)) { console.log('COMPOSE VERIFY: (no golden ' + path.basename(goldenPath) + ' — skipped)'); return; }
  const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
  const allIds = new Set([...Object.keys(golden), ...Object.keys(composed)]);
  let mism = 0;
  for (const id of allIds) {
    const g = golden[id], c = composed[id];
    if (!g) { warn('verify: extra node ' + id); mism++; continue; }
    if (!c) { warn('verify: missing node ' + id); mism++; continue; }
    if (JSON.stringify(g) !== JSON.stringify(c)) { mism++; if (mism <= 12) warn('verify mismatch [' + id + ']\n    G: ' + JSON.stringify(g).slice(0, 180) + '\n    C: ' + JSON.stringify(c).slice(0, 180)); }
  }
  console.log('COMPOSE VERIFY: ' + (mism === 0 ? 'PASS' : 'FAIL (' + mism + ' mismatches)') + ' over ' + allIds.size + ' nodes');
}

const DOC_CONFIGS = [
  {
    key: 'declaration',
    md: process.env.GEC_MD || path.join(__dirname, 'source', 'GEC-Declaration-Full.md'),
    golden: path.join(__dirname, 'golden.json'),
    baseKey: 'V', relatedKey: 'IV',
    baseAmend: { id: '1980', year: 1980, label: '1980 Original Declaration', short: 'Original (1980)' },
    meta: { title: 'Glendale Estates, A Condominium', subtitle: 'Declaration & Recorded Amendments', heading: 'DECLARATION FOR GLENDALE ESTATES, A CONDOMINIUM' },
    sectionLabel: 'SECTION',
    amendmentsMeta: {
      '2001': { part: 'III', year: 2001, label: '2001 Amendment No. 1', short: 'Amendment No. 1 (2001)' },
      '2006': { part: 'II', year: 2006, label: '2006 Amendment No. 2', short: 'Amendment No. 2 (2006)' },
      '2016': { part: 'I', year: 2016, label: '2016 Amendment (Loan Authority)', short: 'Amendment (2016)' },
    },
    chrono: ['2001', '2006', '2016'],
    spot: ['1.1', '12.4', '12.4.5', '14.9', '1.26', '12.5.14', '19.7.2', '25', '9.2'],
  },
  {
    key: 'bylaws',
    md: path.join(__dirname, 'source', 'GEC-Bylaws-Full.md'),
    golden: path.join(__dirname, 'golden-bylaws.json'),
    baseKey: 'V', relatedKey: null,
    baseAmend: { id: '1980', year: 1980, label: '1980 Original Bylaws', short: 'Original (1980)' },
    meta: { title: 'Glendale Estates, A Condominium', subtitle: 'Bylaws & Recorded Amendments', heading: 'BYLAWS OF GLENDALE ESTATES CONDOMINIUM ASSOCIATION' },
    sectionLabel: 'ARTICLE',
    amendmentsMeta: {
      '2001': { part: 'II', year: 2001, label: '2001 First Amendment', short: 'First Amendment (2001)' },
      '2006': { part: 'I', year: 2006, label: '2006 Second Amendment', short: 'Second Amendment (2006)' },
    },
    chrono: ['2001', '2006'],
    spot: ['III.5', 'IV.1', 'V.8', 'VII.2', 'X', 'XI.1', 'XII.1'],
  },
];

const GEC_DOCS = {};
for (const cfg of DOC_CONFIGS) {
  if (!fs.existsSync(cfg.md)) { console.log('=== SKIP ' + cfg.key + ' (no source ' + path.basename(cfg.md) + ') ==='); continue; }
  cfg.parts = loadParts(fs.readFileSync(cfg.md, 'utf8'));
  const res = buildDoc(cfg);
  GEC_DOCS[cfg.key] = res.DECL;
  console.log('\n=== ' + cfg.key.toUpperCase() + ' ===');
  console.log('sections:', res.stats.sections, '| appendices:', res.stats.appendices, '| total nodes:', res.stats.totalNodes, '| added:', res.stats.added, '| deleted:', res.stats.deleted);
  console.log('amendments:', res.DECL.amendments.map(a => a.id + '(' + a.kind + ')').join(', '));
  verifyGolden(cfg.golden, res.composed);
  console.log('--- spot checks (current text) ---');
  (cfg.spot || []).forEach(id => {
    const n = res.stats.flat[id];
    console.log('[' + id + '] revs=' + (n ? n.revisions.map(r => r.amend).join('>') : '?') + '  ' + (n && n.current ? n.current.slice(0, 85) : '(deleted/none)'));
  });
  if (res.warnings.length) { console.log('--- warnings (' + res.warnings.length + ') ---'); res.warnings.forEach(w => console.log('  ! ' + w)); }
}

const defaultDoc = GEC_DOCS.declaration ? 'declaration' : Object.keys(GEC_DOCS)[0];
fs.writeFileSync(OUT,
  '// AUTO-GENERATED by tools/build-data.js — do not edit by hand.\n' +
  'window.GEC_DOCS = ' + JSON.stringify(GEC_DOCS, null, 2) + ';\n' +
  'window.DECL_DATA = window.GEC_DOCS[' + JSON.stringify(defaultDoc) + '];\n',
  'utf8');
console.log('\n=== BUILD COMPLETE ===');
console.log('docs:', Object.keys(GEC_DOCS).join(', '), '| default:', defaultDoc);
console.log('output:', OUT, '(' + (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB)');
