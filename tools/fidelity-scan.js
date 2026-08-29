// fidelity-scan.js — id-aligned bidirectional diff between the viewer's base
// (original-1980) node text in data.js and the authoritative vision
// transcription GEC-Declaration.txt. Read-only analysis.
//
// Parses the ORIGINAL declaration body of the .txt (after the prepended
// amendments + TOC) into id -> text, then word-diffs each base node against it.
// Reports, per id: words present in .txt but MISSING from the viewer (drops,
// e.g. 12.5.1) and words present in the viewer but NOT in .txt (additions,
// e.g. synthetic headings). Also lists ids present in one side only.
const fs = require('fs');
const path = require('path');

const dataRaw = fs.readFileSync(path.join(__dirname, '..', 'public', 'decl', 'data.js'), 'utf8');
const DATA = JSON.parse(dataRaw.replace(/^[^=]*=\s*/, '').replace(/;\s*$/, ''));
const TXT_LINES = fs.readFileSync(path.join(__dirname, 'source', 'GEC-Declaration.txt'), 'utf8').split(/\r?\n/);

// --- 1. isolate the original 1980 declaration body ---------------------------
let bodyStart = 0;
for (let i = 0; i < TXT_LINES.length; i++) {
  if (/^\s*SECTION 1\s*-\s*DEFINITIONS/i.test(TXT_LINES[i])) { bodyStart = i; break; }
}
const body = TXT_LINES.slice(bodyStart);

// --- 2. parse body into id -> raw text ---------------------------------------
const NUMLINE = /^\s*(\d+(?:\.\d+)+)\s+(\S.*)$/;   // dotted id + text (1.1, 12.5.1)
const SECTION = /^\s*SECTION\s+\d+/i;
const txtMap = {};
let curId = null, buf = [];
function flush() { if (curId) { txtMap[curId] = (txtMap[curId] ? txtMap[curId] + ' ' : '') + buf.join(' ').trim(); } buf = []; }
for (const line of body) {
  if (SECTION.test(line)) { flush(); curId = null; continue; }
  const m = line.match(NUMLINE);
  if (m) { flush(); curId = m[1]; buf.push(m[1] + ' ' + m[2]); }
  else if (curId) { buf.push(line.trim()); }
}
flush();

// --- 3. collect base nodes from data.js --------------------------------------
const baseNodes = {};
function walk(n) {
  if (n && n.id && n.base) baseNodes[n.id] = n.base;
  (n.nodes || n.children || []).forEach(walk);
}
(DATA.sections || []).forEach(walk);

// --- 4. normalization + word diff --------------------------------------------
function words(s) {
  return String(s == null ? '' : s)
    .replace(/\*\*/g, ' ').replace(/[_*#>`]/g, ' ')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .toLowerCase().trim().split(/\s+/).filter(Boolean);
}
function diff(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const dropped = [], added = [];
  let i = 0, j = 0, dRun = [], aRun = [];
  const pushD = () => { if (dRun.length) { dropped.push(dRun.join(' ')); dRun = []; } };
  const pushA = () => { if (aRun.length) { added.push(aRun.join(' ')); aRun = []; } };
  while (i < n && j < m) {
    if (a[i] === b[j]) { pushD(); pushA(); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { dRun.push(a[i++]); }
    else { aRun.push(b[j++]); }
  }
  while (i < n) dRun.push(a[i++]);
  while (j < m) aRun.push(b[j++]);
  pushD(); pushA();
  return { dropped, added };
}

// --- 5. compare --------------------------------------------------------------
const ids = new Set([...Object.keys(baseNodes), ...Object.keys(txtMap)]);
const onlyNode = [], onlyTxt = [], diffs = [];
for (const id of ids) {
  const hasN = baseNodes[id] != null, hasT = txtMap[id] != null;
  if (hasN && !hasT) { onlyNode.push(id); continue; }
  if (!hasN && hasT) { onlyTxt.push(id); continue; }
  const d = diff(words(txtMap[id]), words(baseNodes[id]));
  if (d.dropped.length || d.added.length) diffs.push({ id, ...d });
}
const sortIds = a => a.sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));

console.log('=== ID-ALIGNED FIDELITY DIFF: data.js base  vs  GEC-Declaration.txt (original body) ===');
console.log('base nodes: ' + Object.keys(baseNodes).length + ' | txt body sections parsed: ' + Object.keys(txtMap).length);
console.log('nodes with word-level differences: ' + diffs.length);
console.log('ids only in viewer (not parsed from txt): ' + JSON.stringify(sortIds(onlyNode)));
console.log('ids only in txt (missing from viewer)   : ' + JSON.stringify(sortIds(onlyTxt)));
console.log('');
diffs.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
for (const d of diffs) {
  console.log('--- ' + d.id + ' ---');
  d.dropped.forEach(r => console.log('   DROPPED (in txt, missing from viewer): ' + r.slice(0, 220)));
  d.added.forEach(r => console.log('   ADDED   (in viewer, not in txt)       : ' + r.slice(0, 220)));
}
