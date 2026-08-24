/* Data-driven renderer for the Glendale Estates declaration viewer.
   Consumes window.DECL_DATA (data.js) and builds the DOM the viewer shell
   the reusable navigation/TOC/favorites/diff code expects. */
(function () {
  'use strict';
  var D = window.DECL_DATA;
  if (!D) { console.error('DECL_DATA not loaded'); return; }

  /* ---------- compose: raw (base + operations) -> per-node revision timeline ----------
     JSON is raw data; the renderer applies each amendment operation in order to build
     the layered history. Each revision records the operation that produced it so the
     inline redline can *follow the operation* (delete/replace/append/segment/add). */
  function composeData(data) {
    var flat = {};
    (function idx(list) { (list || []).forEach(function (n) { flat[n.id] = n; if (n.children) idx(n.children); }); })(
      (data.sections || []).reduce(function (acc, s) { return acc.concat(s.nodes || []); }, [])
    );
    var ams = data.amendments || [];
    var baseId = ams.length ? ams[0].id : '1980';
    var work = {};
    Object.keys(flat).forEach(function (id) {
      var n = flat[id];
      n.revisions = (n.base != null) ? [{ amend: baseId, md: n.base, op: { type: 'base' } }] : [];
      n.addedBy = null; n.deletedBy = null;
      if (n.base != null) work[id] = n.base;
    });
    ams.slice(1).forEach(function (a) {
      (a.operations || []).forEach(function (op) {
        var n = flat[op.target];
        if (!n) { console.warn('composeData: missing target ' + op.target); return; }
        if (op.subtree) n.subtreeRoot = a.id;
        if (op.partOf) n.partOf = op.partOf;
        if (op.type === 'delete') {
          n.deletedBy = a.id;
          n.revisions.push({ amend: a.id, md: null, deleted: true, op: { type: 'delete', prev: work[op.target] || null } });
          return;
        }
        var md, meta;
        if (op.type === 'add') { md = op.text; n.addedBy = a.id; meta = { type: 'add' }; }
        else if (op.type === 'replace') { md = op.text; meta = { type: 'replace', prev: work[op.target] || null }; }
        else if (op.type === 'replace-sentence') { var cr = work[op.target] || ''; var sr = sentenceText(cr, op.sentence); md = (sr != null) ? cr.replace(sr, op.text) : cr; meta = { type: 'replace-sentence', sentence: op.sentence, text: op.text }; }
        else if (op.type === 'insert-after-sentence') { var cin = work[op.target] || ''; var sin = sentenceText(cin, op.sentence); md = (sin != null) ? cin.replace(sin, sin + ' ' + op.text) : cin + ' ' + op.text; meta = { type: 'insert-after-sentence', sentence: op.sentence, text: op.text }; }
        else if (op.type === 'append') { var ca = work[op.target] || ''; md = ca + ' ' + op.text; meta = { type: 'append', text: op.text }; }
        else { console.warn('composeData: unknown op ' + op.type); return; }
        n.revisions.push({ amend: a.id, md: md, op: meta });
        work[op.target] = md;
      });
    });
    Object.keys(flat).forEach(function (id) {
      var n = flat[id], revs = [];
      n.revisions.forEach(function (r) { var p = revs[revs.length - 1]; if (p && p.md === r.md && !r.deleted) return; revs.push(r); });
      n.revisions = revs;
      var live = revs.filter(function (r) { return !r.deleted; });
      n.current = n.deletedBy ? null : ((live[live.length - 1] || {}).md || null);
    });
  }
  composeData(D);

  var AM = D.amendments || [];
  var YR = {}, LBL = {};
  AM.forEach(function (a) { YR[a.id] = a.year; LBL[a.id] = a.label; });
  // Base (earliest) amendment — generic, never a hardcoded year.
  var BASE = AM[0] || { id: '', year: '' };
  var BASE_ID = BASE.id;
  var LATEST_YEAR = Math.max.apply(null, AM.map(function (a) { return a.year; }));
  var NODE_BY_BOX = {};

  /* ---------- text helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escQ(s) { return esc(s).replace(/"/g, '&quot;'); }
  function mdInline(s) {
    var h = esc(s);
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // A newline in the source is a real line break (e.g. an ordered/lettered list in an
    // amendment blockquote). Respect it deterministically instead of flowing inline.
    h = h.replace(/[ \t]*\n[ \t]*/g, '<br>');
    return h;
  }
  function dashId(id) {
    return String(id).replace(/[^A-Za-z0-9]+/g, '-').replace(/-+$/, '');
  }

  /* ---------- word-level redline (LCS) ---------- */

  /* ---------- node helpers ---------- */
  function nonDeletedRevs(node) {
    return (node.revisions || []).filter(function (r) { return !r.deleted && r.md; });
  }
  function isAmended(node) {
    return !!(node.addedBy || node.deletedBy) || nonDeletedRevs(node).length > 1;
  }

  /* ---------- toc-node labelling ---------- */
  function headingText(md) {
    var m = String(md || '').match(/^\*\*(.+?)\*\*/);
    var h = m ? m[1] : '';
    h = h.replace(/\*/g, '')
         .replace(/^\s*\(?[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*\)?[.:)]?\s*/, '')
         .trim().replace(/[.:]\s*$/, '');
    return h;
  }

  /* ================================================================
     FLOWING RENDERER (Current / Inline modes) — single DOM per node.
     JSON stays raw (base + operations); provenance is derived here so
     each surviving/removed word can be attributed to the amendment
     that introduced / removed it. Two global CSS modes (body class)
     switch between the clean Current text and the Inline research view.
     ================================================================ */

  var AMEND_YEARS = AM.slice(1).map(function (a) { return a.year; })
    .filter(function (y, i, arr) { return arr.indexOf(y) === i; })
    .sort(function (x, y) { return x - y; });
  // Matte, muted amendment colors (readable on white). First three are the
  // established 2001/2006/2016 hues; the rest extend the set for documents with
  // more amendment layers. Ordered for maximum hue separation between adjacent
  // amendments. Intentionally no bright, purple, or brown tones.
  var AMEND_PALETTE = [
    '#46688f', // dusty blue
    '#4e7a5e', // sage green
    '#9c5566', // dusty rose
    '#b0705f', // muted coral
    '#4a8080', // muted teal
    '#a05f85', // dusty magenta
    '#6b8e5a', // moss green
    '#5c6f9c', // muted indigo
    '#a85a5a', // brick red
    '#4d8a72', // seafoam
    '#607d8b', // blue-gray
    '#8f8a4f'  // muted olive
  ];
  function yearColor(y) {
    var i = AMEND_YEARS.indexOf(y);
    return AMEND_PALETTE[(i < 0 ? 0 : i) % AMEND_PALETTE.length];
  }
  function amendColorCSS() {
    return AMEND_YEARS.map(function (y) { return '.amend-y' + y + '{--amc:' + yearColor(y) + ';}'; }).join('\n');
  }
  function buildLegend() {
    if (!AMEND_YEARS.length) return '';
    var items = AMEND_YEARS.map(function (y) {
      return '<span class="legend-item"><span class="legend-swatch" style="background:' + yearColor(y) + '"></span>' + esc(y) + '</span>';
    }).join('');
    return '<div id="amendLegend" class="amend-legend">'
      + '<span class="legend-label">Amendment colors:</span>' + items
      + '</div>';
  }

  function tokensOf(md) {
    var s = String(md == null ? '' : md).replace(/\r/g, '');
    s = s.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
    if (!s) return [];
    // Word tokens, plus standalone '\n' tokens so line breaks survive the provenance
    // (redline) pass and reach mdInline. Amendment ops never address the '\n' tokens;
    // they only carry the source's list structure through to rendering.
    var out = [];
    s.split('\n').forEach(function (line, i) {
      if (i > 0) out.push('\n');
      line.split(' ').forEach(function (t) { if (t) out.push(t); });
    });
    return out;
  }

  // Deterministic, heading-aware sentence splitter — MUST match tools/build-data.js.
  // Amendment ops address text by sentence index; the renderer resolves that index
  // by splitting the live text the same way (no fuzzy find). A leading bold heading
  // is held aside so its period never splits, then re-attached to sentence 0.
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
  function sentenceText(md, sel) {
    var ss = splitSentences(md);
    var idx = sel === 'last' ? ss.length - 1 : sel;
    return ss[idx];
  }

  // Split a leading bold heading (**...**) from the plain body so markdown never
  // straddles a diff boundary. Headings are diffed atomically; bodies word-by-word.

  // Fold the revision timeline into per-token provenance over the FULL node text
  // (heading + body). Each item: {tok, alive, origin:'base'|'ins'|'del', year, fb}.
  // The DIFF STRATEGY simply follows the amendment operation:
  //   replace / delete / add  -> whole block: the entire old section (title+body)
  //                              is struck and the entire new section highlighted;
  //                              never word-diffed. Each block is a complete
  //                              markdown fragment, so bold (**...**) stays balanced.
  //   replace-sentence         -> resolve the amendment's sentence index against the
  //                              live text, strike exactly that sentence and drop the
  //                              new text in its place (deterministic, no find).
  //   append / insert-after-sentence -> insert the operation's text at the end / right
  //                              after the addressed sentence; surrounding text kept.
  function nodeProvenance(node) {
    var revs = node.revisions || [];
    var items = [];
    if (!revs.length) return items;
    var baseIsAdd = (node.base == null);
    var first = revs[0], fy = YR[first.amend];
    tokensOf(first.md).forEach(function (t) {
      items.push({ tok: t, alive: true, origin: baseIsAdd ? 'ins' : 'base', year: fy, fb: baseIsAdd });
    });
    for (var r = 1; r < revs.length; r++) {
      var rev = revs[r], y = YR[rev.amend];
      if (rev.deleted) {
        items.forEach(function (it) { if (it.alive) { it.alive = false; it.origin = 'del'; it.year = y; it.fb = true; } });
        continue;
      }
      var newToks = tokensOf(rev.md);
      var opType = (rev.op && rev.op.type) || 'replace';
      // Sentence replacement: the amendment addresses a sentence by position
      // ("the first/second/third/last sentence"). Resolve that index against the
      // live text, strike exactly that sentence's tokens, and drop `text` in its
      // place. Deterministic — no fuzzy find.
      if ((opType === 'replace-sentence' || opType === 'insert-after-sentence') && rev.op) {
        var aIx = [];
        for (var kk = 0; kk < items.length; kk++) if (items[kk].alive) aIx.push(kk);
        var aTok = aIx.map(function (ix) { return items[ix].tok; });
        var sents = splitSentences(aTok.join(' '));
        var sidx = rev.op.sentence === 'last' ? sents.length - 1 : rev.op.sentence;
        if (sents.length && sidx >= 0 && sidx < sents.length) {
          var start = 0;
          for (var ss = 0; ss < sidx; ss++) start += tokensOf(sents[ss]).length;
          var slen = tokensOf(sents[sidx]).length;
          var endItem = aIx[start + slen - 1];
          var insToks = tokensOf(rev.op.text);
          if (opType === 'replace-sentence') {
            for (var q = start; q < start + slen; q++) {
              var itd = items[aIx[q]]; itd.alive = false; itd.origin = 'del'; itd.year = y;
            }
          }
          var outS = [];
          for (var pos = 0; pos < items.length; pos++) {
            outS.push(items[pos]);
            if (pos === endItem) insToks.forEach(function (t) { outS.push({ tok: t, alive: true, origin: 'ins', year: y }); });
          }
          items = outS;
          continue;
        }
        // sentence index out of range -> whole-block replace (safe fallback).
        opType = 'replace';
      }
      // Whole-block replacement: strike the entire live text, insert the new text.
      if (opType === 'replace') {
        items.forEach(function (it) { if (it.alive) { it.alive = false; it.origin = 'del'; it.year = y; it.fb = true; } });
        newToks.forEach(function (t) { items.push({ tok: t, alive: true, origin: 'ins', year: y, fb: true }); });
        continue;
      }
      // Append: the operation's text is added to the end; everything else is kept.
      if (opType === 'append' && rev.op) {
        tokensOf(rev.op.text).forEach(function (t) { items.push({ tok: t, alive: true, origin: 'ins', year: y }); });
        continue;
      }
      // Any other/unknown op: treat as a whole-block replacement (safe, no diffing).
      items.forEach(function (it) { if (it.alive) { it.alive = false; it.origin = 'del'; it.year = y; it.fb = true; } });
      newToks.forEach(function (t) { items.push({ tok: t, alive: true, origin: 'ins', year: y, fb: true }); });
    }
    return items;
  }

  // Group provenance items into contiguous spans. A span is a stacked block when
  // its tokens come from a whole-block operation (fb); localized edits stay inline.
  function segmentize(items) {
    var segs = [];
    items.forEach(function (it) {
      var kind = it.alive ? (it.origin === 'base' ? 'eq' : 'ins') : 'del';
      var year = kind === 'eq' ? null : it.year;
      var last = segs[segs.length - 1];
      if (last && last.kind === kind && last.year === year) { last.toks.push(it.tok); if (it.fb) last.block = true; }
      else segs.push({ kind: kind, year: year, toks: [it.tok], block: !!it.fb });
    });
    return segs;
  }

  function provenanceHTML(segs) {
    return segs.map(function (s) {
      var inner = mdInline(s.toks.join(' '));
      if (s.kind === 'eq') return inner;
      var tag = s.kind === 'ins' ? 'ins' : 'del';
      var blk = s.block ? ' amend-block' : '';
      var chip = '<sup class="amend-chip">' + esc(s.year) + '</sup>';
      return '<' + tag + ' class="amend-' + s.kind + ' amend-y' + s.year + blk + '" data-year="' + esc(s.year) + '">'
        + inner + chip + '</' + tag + '>';
    }).join(' ');
  }

  // One node -> one flowing paragraph with a permanent anchor. Unamended nodes
  // render verbatim (preserving paragraph breaks); amended nodes render provenance.
  function renderFlowNode(node, depth) {
    if (!node.revisions || !node.revisions.length) return '';
    var indent = depth > 0 ? ' style="margin-left:' + (depth * 22) + 'px;"' : '';
    var pid = 'sub-' + dashId(node.id);
    var deleted = !!node.deletedBy;
    var classes = [];
    var dataAttr = '';
    if (!deleted && node.num && node.kind === 'num') {
      classes.push('toc-node');
      var lbl = descLabel(node, node.current || (node.revisions[0] && node.revisions[0].md) || '');
      dataAttr = ' data-toc-label="' + escQ(lbl) + '"';
    }
    if (!isAmended(node)) {
      var md = node.current || (node.revisions[0] && node.revisions[0].md) || '';
      if (!md) return '';
      return String(md).split(/\n\n+/).map(function (p, idx) {
        var id = idx === 0 ? pid : pid + '-' + idx;
        var c = idx === 0 && classes.length ? ' class="' + classes.join(' ') + '"' : '';
        var d = idx === 0 ? dataAttr : '';
        return '<p id="' + id + '"' + c + d + indent + '>' + mdInline(p) + '</p>';
      }).join('\n');
    }
    classes.push('amend-node');
    if (deleted) classes.push('node-deleted');
    var inner = provenanceHTML(segmentize(nodeProvenance(node)));
    return '<p id="' + pid + '" class="' + classes.join(' ') + '"' + dataAttr + indent + '>' + inner + '</p>';
  }

  /* ---------- node renderer (legacy box pipeline; unused, kept for reference) ---------- */

  /* ---------- subtree substitution / add (one amendment item replaced or added a whole
     parent-plus-descendants block; render it as ONE unit, not a replace + N adds) ---------- */
  // The full new subtree as paragraphs: parent heading, then each descendant (indented).
  // `withToc` marks descendant paragraphs so they appear once in the TOC (current pane only).

  // TOC label for a subtree descendant: number plus any heading or leading prose.
  function descLabel(node, md) {
    var t = headingText(md);
    if (!t) {
      var m = String(md).match(/^\*\*[^*]+\*\*\s*(.+)$/);
      if (m) t = m[1].replace(/\*/g, '').trim();
    }
    var lbl = node.num + (t ? ' ' + t : '');
    return lbl.length > 72 ? lbl.slice(0, 70) + '\u2026' : lbl;
  }

  // Redline for a subtree root: substitution -> old block struck + new subtree inserted;
  // pure add -> new subtree inserted (green). Reusable for any target year via `cutoff`.

  function renderNodes(nodes, depth) {
    var h = '';
    var arr = nodes || [];
    for (var i = 0; i < arr.length; i++) {
      var n = arr[i];
      h += renderFlowNode(n, depth) + '\n';
      if (n.children && n.children.length) h += renderNodes(n.children, depth + 1);
    }
    return h;
  }

  /* ---------- section renderer ---------- */
  function sectionBadge(sec) {
    var yrs = {};
    (function walk(ns) {
      ns.forEach(function (n) {
        (n.revisions || []).forEach(function (r) { if (r.amend !== BASE_ID) yrs[YR[r.amend]] = 1; });
        if (n.addedBy) yrs[YR[n.addedBy]] = 1;
        if (n.deletedBy) yrs[YR[n.deletedBy]] = 1;
        if (n.children) walk(n.children);
      });
    })(sec.nodes || []);
    var arr = Object.keys(yrs).sort();
    if (!arr.length) return '';
    return '<span class="badge badge-amended">Amended ' + arr.join(' &amp; ') + '</span>';
  }

  function renderSection(sec) {
    var secId = 'sec-' + sec.num;
    var h = '<section class="doc-section" id="' + secId + '">';
    h += '<div class="section-header"><h2><span>SECTION ' + esc(sec.num) + ': ' + esc(sec.title) + '</span>'
      + '<button class="star-btn" data-target="' + secId + '" data-title="' + escQ('Section ' + sec.num + ': ' + sec.title) + '">\u2605</button></h2>'
      + sectionBadge(sec) + '</div>';
    h += '<div class="section-body">';
    if (sec.preamble) h += '<p>' + mdInline(sec.preamble) + '</p>';
    h += renderNodes(sec.nodes, 0);
    h += '</div></section>';
    return h;
  }

  /* ---------- appendix / related block renderer ---------- */
  // A parking-style table stored as two side-by-side 3-column groups (same header
  // repeated) is flattened into a single group and sorted by unit number.
  function flattenDoubledTable(t) {
    var hdr = t.header || [];
    var n = hdr.length;
    if (n < 4 || n % 2 !== 0) return null;
    var half = n / 2;
    for (var k = 0; k < half; k++) if (hdr[k] !== hdr[half + k]) return null;
    var data = [];
    (t.rows || []).forEach(function (r) {
      if (r.group != null) return;
      var c = r.cells || [];
      [c.slice(0, half), c.slice(half, n)].forEach(function (g) {
        if (!g.length) return;
        if (g.every(function (x) { return !x; })) return;              // filler
        if (/^\*\*.*\*\*$/.test(g[0]) && g.slice(1).every(function (x) { return !x; })) return; // BLDG header
        data.push({ cells: g });
      });
    });
    if (!data.length) return null;
    function unitKey(u) {
      var m = String(u).match(/([A-Za-z]+)\D*(\d+)/);
      return m ? [m[1].toUpperCase(), parseInt(m[2], 10)] : [String(u).toUpperCase(), 0];
    }
    data.sort(function (a, b) {
      var ka = unitKey(a.cells[0]), kb = unitKey(b.cells[0]);
      return ka[0] < kb[0] ? -1 : ka[0] > kb[0] ? 1 : ka[1] - kb[1];
    });
    return { type: 'table', header: hdr.slice(0, half), rows: data };
  }

  function renderTable(t) {
    var flat = flattenDoubledTable(t);
    if (flat) t = flat;
    var cols = (t.header || []).length || 1;
    var h = '<table class="data-table"><thead><tr>'
      + (t.header || []).map(function (x) { return '<th>' + mdInline(x) + '</th>'; }).join('')
      + '</tr></thead><tbody>';
    (t.rows || []).forEach(function (r) {
      if (r.group != null) {
        h += '<tr><td colspan="' + cols + '" style="background:#f1f5f9; font-weight:bold;">' + mdInline(r.group) + '</td></tr>';
      } else {
        h += '<tr>' + (r.cells || []).map(function (c) { return '<td>' + mdInline(c) + '</td>'; }).join('') + '</tr>';
      }
    });
    return h + '</tbody></table>';
  }

  function renderBlocks(blocks) {
    var h = '', liBuf = [];
    function flushLi() {
      if (liBuf.length) {
        h += '<ul>' + liBuf.map(function (x) { return '<li>' + mdInline(x) + '</li>'; }).join('') + '</ul>';
        liBuf = [];
      }
    }
    (blocks || []).forEach(function (b) {
      if (b.type === 'li') { liBuf.push(b.md); return; }
      flushLi();
      if (b.type === 'p') h += '<p>' + mdInline(b.md) + '</p>';
      else if (b.type === 'subhead') h += '<h3 class="appendix-subhead">' + mdInline(b.text) + '</h3>';
      else if (b.type === 'ul') h += '<ul>' + (b.items || []).map(function (x) { return '<li>' + mdInline(x) + '</li>'; }).join('') + '</ul>';
      else if (b.type === 'blockquote') h += '<div class="legal-quote">' + (b.items || []).map(function (x) { return '<p>' + mdInline(x) + '</p>'; }).join('') + '</div>';
      else if (b.type === 'table') h += renderTable(b);
    });
    flushLi();
    return h;
  }

  function renderAppendix(ap) {
    var id = 'appendix-' + String(ap.num).toLowerCase();
    return '<section class="doc-section" id="' + id + '">'
      + '<div class="section-header"><h2><span>APPENDIX "' + esc(ap.num) + '": ' + esc(ap.title) + '</span>'
      + '<button class="star-btn" data-target="' + id + '" data-title="' + escQ('Appendix ' + ap.num + ': ' + ap.title) + '">\u2605</button></h2></div>'
      + '<div class="section-body">' + renderBlocks(ap.blocks) + '</div></section>';
  }

  function renderExhibit(ex) {
    var id = ex.id;
    return '<section class="doc-section" id="' + id + '">'
      + '<div class="section-header"><h2><span>' + esc(ex.label) + '</span>'
      + '<button class="star-btn" data-target="' + id + '" data-title="' + escQ(ex.label) + '">\u2605</button></h2>'
      + '<span class="badge badge-amended">' + ex.year + ' Amendment</span></div>'
      + '<div class="section-body">' + renderBlocks(ex.blocks) + '</div></section>';
  }

  function renderRelated(r) {
    var id = 'related-' + r.year;
    var rec = '';
    if (r.recording) {
      rec = '<table class="data-table"><tbody>' + Object.keys(r.recording).map(function (k) {
        return '<tr><th style="text-align:left; width:200px;">' + esc(k) + '</th><td>' + esc(r.recording[k]) + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
    return '<section class="doc-section" id="' + id + '">'
      + '<div class="section-header"><h2><span>' + esc(r.label) + '</span>'
      + '<button class="star-btn" data-target="' + id + '" data-title="' + escQ(r.label) + '">\u2605</button></h2>'
      + '<span class="badge" style="background:#6366f1;color:#fff;">Related ' + r.year + '</span></div>'
      + '<div class="section-body">' + rec + renderBlocks(r.blocks) + '</div></section>';
  }

  /* ---------- top-level render ---------- */
  window.renderAll = function renderAll() {
    var root = document.getElementById('docRoot');
    if (!root) return;
    var h = '<style id="amendColors">' + amendColorCSS() + '</style>';
    h += '<h1 class="doc-title">DECLARATION FOR GLENDALE ESTATES, A CONDOMINIUM</h1>';
    h += '<div class="doc-subtitle">' + esc((D.meta && D.meta.subtitle) || '') + '</div>';
    h += buildLegend();
    (D.sections || []).forEach(function (s) { h += renderSection(s); });
    (D.appendices || []).forEach(function (a) { h += renderAppendix(a); });
    (D.exhibits || []).forEach(function (e) { h += renderExhibit(e); });
    (D.related || []).forEach(function (r) { h += renderRelated(r); });
    root.innerHTML = h;

    root.querySelectorAll('.star-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite(btn.getAttribute('data-target'), btn.getAttribute('data-title'));
      });
    });
  };

  /* ---------- reusable redline pane rebuild (layer amendments up to a target year) ---------- */
})();
