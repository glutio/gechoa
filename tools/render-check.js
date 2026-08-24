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
