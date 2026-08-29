// Headless render sanity check: load data.js + app.js in jsdom, render, assert.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const pub = path.join(__dirname, '..', 'public', 'decl');
const data = fs.readFileSync(path.join(pub, 'data.js'), 'utf8');
const app = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="docRoot"></div><nav id="toc"></nav></body></html>', {
  runScripts: 'outside-only', pretendToBeVisual: true,
});
const { window } = dom;
window.matchMedia = window.matchMedia || function () { return { matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }; };
const errs = [];
window.addEventListener('error', e => errs.push(e.message));

window.eval(data);
window.eval(app);
if (typeof window.renderAll === 'function') window.renderAll();
window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

const doc = window.document.getElementById('docRoot');
const html = doc ? doc.innerHTML : '';
const body = html.replace(/<[^>]+>/g, ' ');

function assert(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; }

console.log('JS errors:', errs.length);
errs.forEach(e => console.log('  ! ' + e));
assert(html.length > 5000, 'document rendered (' + html.length + ' chars)');
assert(/No Trade or Business/.test(body), '9.1 "No Trade or Business" lead-in present');
assert(/Three \(3\) members of the Board of Directors shall constitute a quorum/.test(body), '12.4.5 sentence replaced');
assert(/Board of Directors of five \(5\) persons/.test(body), '12.4 shows five (5) persons (2006)');
assert(/RCW 64\.34\.364/.test(body), '14.9 third-sentence replacement present');
const strong = (html.match(/<strong>/g) || []).length;
assert(strong > 100, 'strong tags present (' + strong + ')');
const stray = (body.match(/\*\*/g) || []).length;
if (stray) { let idx = 0, c = 0; while ((idx = body.indexOf('**', idx)) >= 0 && c < 10) { console.log('  STRAY: ...' + body.slice(idx - 70, idx + 30).replace(/\s+/g, ' ') + '...'); idx += 2; c++; } }
assert(stray === 0, 'no stray ** in rendered body (' + stray + ')');

const del = (html.match(/class="[^"]*del[^"]*"|<del\b/g) || []).length;
const ins = (html.match(/class="[^"]*ins[^"]*"|<ins\b/g) || []).length;
console.log('inline redline markers -> del:', del, 'ins:', ins);
assert(del > 0 && ins > 0, 'inline redline del/ins markers present');

// 9.2.1.1's embedded ordered list must render as line breaks, not inline.
const br = (html.match(/<br>/g) || []).length;
console.log('br count:', br);
assert(br > 20, 'list newlines rendered as <br> (' + br + ')');
const nStart = html.indexOf('Attributes Of Value');
const seg = html.slice(nStart, nStart + 2200);
const brNum = seg.match(/<br>\d+\./g) || [];
console.log('9.2.1.1 <br>N. markers:', JSON.stringify(brNum));
assert(brNum.length >= 6, '9.2.1.1 list items 1..6 on their own lines');

// --- BYLAWS (second document) ---
console.log('\n--- BYLAWS ---');
const dom2 = new JSDOM('<!DOCTYPE html><html><body><div id="docRoot"></div><nav id="toc"></nav></body></html>', {
  runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://localhost/',
});
const w2 = dom2.window;
w2.matchMedia = w2.matchMedia || function () { return { matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }; };
const errs2 = [];
w2.addEventListener('error', e => errs2.push(e.message));
try { w2.localStorage.setItem('gec_doc', 'bylaws'); } catch (_) {}
w2.eval(data);
w2.eval(app);
if (typeof w2.renderAll === 'function') w2.renderAll();

console.log('JS errors:', errs2.length);
errs2.forEach(e => console.log('  ! ' + e));
assert(w2.GEC_ACTIVE_DOC === 'bylaws', 'active doc is bylaws (' + w2.GEC_ACTIVE_DOC + ')');
const bHtml = w2.document.getElementById('docRoot').innerHTML;
const bBody = bHtml.replace(/<[^>]+>/g, ' ');
assert(bHtml.length > 5000, 'bylaws rendered (' + bHtml.length + ' chars)');
assert(/ARTICLE\s+III/i.test(bBody), 'bylaws uses ARTICLE label');
assert(/BYLAWS OF GLENDALE ESTATES/i.test(bBody), 'bylaws main heading is doc-specific');
assert(/A five \(5\) person Board of Directors/.test(bBody), 'IV.1 shows five (5) person board (2006)');
assert(/Step One - Pick A Hearing Board/.test(bBody), 'XII.1 (2001-added) present');
// TOC labels must keep the heading's leading word (regression: "Step"/"Other" were
// mis-stripped as enumerators, yielding "One - ..." / "Details").
const xii14 = w2.document.getElementById('sub-XII-14');
assert(xii14 && xii14.getAttribute('data-toc-label') === 'XII.14 Other Details',
  'XII.14 toc-label is "XII.14 Other Details" (' + (xii14 && xii14.getAttribute('data-toc-label')) + ')');
const xii1 = w2.document.getElementById('sub-XII-1');
assert(xii1 && /^XII\.1 Step One - Pick A Hearing Board/.test(xii1.getAttribute('data-toc-label') || ''),
  'XII.1 toc-label keeps "Step One" (' + (xii1 && xii1.getAttribute('data-toc-label')) + ')');
// Headingless intro node (XII.0) gets a prose-snippet label, not a bare number.
const xii0 = w2.document.getElementById('sub-XII-0');
assert(xii0 && /^XII\.0 This procedure establishes/.test(xii0.getAttribute('data-toc-label') || ''),
  'XII.0 toc-label has prose snippet (' + (xii0 && xii0.getAttribute('data-toc-label')) + ')');
const bStray = (bBody.match(/\*\*/g) || []).length;
assert(bStray === 0, 'no stray ** in bylaws body (' + bStray + ')');

