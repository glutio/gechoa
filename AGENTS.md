# AGENTS.md — Glendale Estates Declaration Viewer

This repo is a static Cloudflare Worker site (`wrangler.toml` serves `./public`). Its
centerpiece is an **amended‑document viewer** at `/decl/` that renders the Glendale
Estates Condominium (GEC) Declaration together with every amendment, and can show
either the **current** consolidated text or an **inline redline** of how each section
changed over time.

This document explains the data model, the build pipeline, and — most importantly —
**how to onboard a new document** or **generalize the viewer** for future work.

---

## 1. Core principle

> **The JSON is raw data. The renderer applies operations deterministically.**

The data is a base document (the original 1980 Declaration) plus a chronological list
of **amendments**. Each amendment is a list of **operations** (`replace`, `delete`,
`append`, …) that target a node by id. Rendering a node means: start from its base
text, replay the operations in order to get `current`; in inline mode, visualize each
operation as struck/inserted text tagged with the amendment that made it.

There is **no diffing and no heuristics at render time.** The operation says exactly
what happened; the renderer just follows it. If a rendering looks wrong, the fix is
almost always in the *operation* (the `<!--op-->` directive in the source Markdown),
not in the renderer.

---

## 2. Repository layout

```
public/
  index.html                     Landing page (links to /decl/)
  styles.css, logo.svg, GEC.jpg  Landing assets
  decl/
    index.html                   Viewer shell: HTML + nav/TOC/favorites/mode JS
    styles.css                   Viewer styles (extracted)
    app.js                       Deterministic renderer (consumes window.DECL_DATA)
    data.js                      GENERATED — do not hand‑edit
tools/
  source/
    GEC-Declaration.txt          CANONICAL original text (pristine, unannotated)
    GEC-Declaration-Full.md      BUILD SOURCE: the canonical text in Markdown,
                                 annotated with <!--op--> directives
  build-data.js                  .md  ->  public/decl/data.js
  render-check.js                Headless jsdom render assertions (regression safety net)
  golden.json                    Golden snapshot of composed node text (regression baseline)
docs/
  legacy-decl.html               Archived earlier standalone viewer (reference only)
AGENTS.md                        This file
```

### Build & verify

```bash
node tools/build-data.js        # regenerate public/decl/data.js; prints COMPOSE VERIFY PASS/FAIL
node tools/render-check.js      # headless render assertions (must stay all‑PASS)
```

Regenerate the golden baseline **only** when a data change is intentional:

```bash
# PowerShell
$env:GEC_WRITE_GOLDEN='1'; node tools/build-data.js
```

`build-data.js` compares each composed node against `golden.json` and prints
`COMPOSE VERIFY: PASS/FAIL` plus a warnings count. `render-check.js` loads the built
data + `app.js` in jsdom and asserts ~10 concrete rendering facts. Keep both green.

Local preview: `npm run dev` (wrangler), then open `/decl/`.

---

## 3. Data model (`window.GEC_DOCS` / `window.DECL_DATA`)

`data.js` now assigns **`window.GEC_DOCS`** — a map of document key → document object
(`declaration`, `bylaws`, …) — and sets `window.DECL_DATA = window.GEC_DOCS['declaration']`
for back-compat. `app.js` picks the active document at load from `localStorage 'gec_doc'`
(validated against `GEC_DOCS`, default `declaration`), assigns it to `window.DECL_DATA`,
and exposes `window.GEC_ACTIVE_DOC`. Switching documents is **reload-based**: the shell
writes `localStorage.gec_doc` and calls `location.reload()` (the renderer is a stateful
IIFE whose derived vars are computed once at load).

Each document object is shaped roughly:

```jsonc
{
  "meta": { "title": "...", "subtitle": "..." },
  "sectionLabel": "SECTION",   // or "ARTICLE" for the Bylaws — used for section headers/TOC
  "amendments": [
    { "id": "1980", "year": 1980, "kind": "base" },
    { "id": "2001", "year": 2001, "label": "...", "kind": "modifying",
      "operations": [ /* Operation objects, see below */ ] },
    { "id": "2006", "year": 2006, "kind": "modifying", "operations": [ ... ] },
    { "id": "2016", "year": 2016, "kind": "additive",  "operations": [ ... ] }
  ],
  "sections":  [ /* base tree: nested nodes with id, num, md, children */ ],
  "appendices": [ ... ],
  "exhibits":  [ ... ]
}
```

A **node** has `id` (e.g. `12.4.5`), `md` (its Markdown text, `**bold heading**` +
body), and `children`. `app.js#composeData()` folds the amendment operations onto the
base tree, producing per node:

- `base` — original 1980 text (or `null` if the node was added later)
- `revisions[]` — `{ amend, md }` after each operation, in chronological order
- `current` — final consolidated text
- `addedBy` / `deletedBy` — amendment id, when applicable

### Operation objects

Every operation targets one node id and has a `type`:

| type                    | meaning                                                            |
| ----------------------- | ----------------------------------------------------------------- |
| `add`                   | Node did not exist in base; this text introduces it.              |
| `replace`               | Replace the node's **entire** text (heading + body).              |
| `delete`                | Remove the node entirely.                                         |
| `append`                | Append `text` to the end of the node.                            |
| `replace-sentence`      | Replace one sentence (`sentence` = 0‑based index or `"last"`).    |
| `insert-after-sentence` | Insert `text` immediately after sentence `sentence`.             |

Operations also carry `letter`/`intro` (the amendment paragraph they came from) for
provenance display. `text` is verbatim legal text — it is **never** retyped in code;
it comes from the source Markdown.

---

## 4. The `<!--op-->` directive convention (how to encode amendments)

The build source `tools/source/GEC-Declaration-Full.md` is the canonical text in
Markdown, **annotated** with invisible HTML‑comment directives. (The pristine,
unannotated original is kept alongside it as `tools/source/GEC-Declaration.txt`.) An
intelligent pass (you) reads the human amendment language ("The first sentence of
Section 12.4.5 is deleted and the following substituted…") and encodes it as a
deterministic directive. `build-data.js` then simply applies it — it does **not**
interpret prose.

Directive syntax, placed on its own line inside an amendment item (after the
`**Letter.**` prose, before/around the verbatim blockquote):

```
<!--op TYPE target=<id> [sentence=<n|last>] [key=val] [flag]-->
```

Directive types and required keys:

| Directive                 | Keys                          | Verbatim text source                    |
| ------------------------- | ----------------------------- | --------------------------------------- |
| `replace`                 | `target`                      | the numbered node / lead‑in blockquote  |
| `delete`                  | `target` (comma‑list allowed) | — (no text)                             |
| `append`                  | `target`                      | blockquote                              |
| `replace-sentence`        | `target`, `sentence`          | blockquote                              |
| `insert-after-sentence`   | `target`, `sentence`          | blockquote                              |

`sentence` is `0`‑based, or the keyword `last`. Sentence positions are resolved by
`splitSentences()` in `build-data.js`, a deterministic heading‑aware splitter (a bold
`**12.4.5**` label is held aside so its period doesn't start a sentence).

**Default pass:** an amendment item with numbered blockquote nodes and *no* directive
gets an automatic op per node — `replace` if the id already exists, else `add`. So you
only add a directive when the operation is something other than "replace/add this whole
numbered node" (i.e. sentence surgery, append, delete, or a lead‑in‑sourced replace).

### Worked examples

- *"The first sentence of Section 12.4.5 is deleted and a new first sentence
  substituted"* →
  ```
  <!--op replace-sentence target=12.4.5 sentence=0-->
  ```
  (verbatim new sentence sits in the adjacent blockquote)

- *"Section 10.2 is deleted and replaced with the following"* →
  ```
  <!--op replace target=10.2-->
  ```

- *"Sections 3.1 and 3.2 are hereby deleted"* →
  ```
  <!--op delete target=3.1,3.2-->
  ```

**Golden rule:** follow the operation literally. Do not optimize, merge, or word‑diff.
"Delete the whole section and substitute a new one" must render as the *whole* old
node struck and the *whole* new node inserted — never a clever word‑level merge.

---

## 5. Rendering modes (`app.js`)

Two global CSS modes on `<body>` (toggled by the viewer shell, not by JS re‑render):

- `mode-current` — clean consolidated final text (`current`). This is what the TOC
  anchors point at; the default reading view.
- `mode-inline` — research redline. `nodeProvenance()` attributes every token to the
  amendment that inserted/removed it, and `provenanceHTML()` emits struck (`del`) and
  inserted (`ins`) spans, each colored/tagged per amendment year.

**Presentation rule by operation:** whole‑node operations (`replace`, `delete`, `add`)
render as a whole struck block + whole inserted block — they are *not* shown inline
word‑by‑word (that produced "word salad"). Only span‑scoped operations
(`replace-sentence`, `insert-after-sentence`, `append`) change text inline while the
rest of the node stays plain.

The live render pipeline is:
`renderAll → renderSection → renderNodes → renderFlowNode → nodeProvenance →
segmentize → provenanceHTML` (+ `renderAppendix/renderExhibit/renderRelated →
renderBlocks/renderTable`). Everything else was legacy diff‑box code and has been
removed; keep `app.js` to this single deterministic path.

---

## 6. Onboarding a NEW document

1. Put the clean text as Markdown in `tools/source/<doc>.md`: original document first,
   then each amendment as a section with `**A.** … **B.** …` items and verbatim
   `> blockquote` text for any new/replacement language.
2. Annotate non‑default operations with `<!--op-->` directives (Section 4). If the
   document's section numbers restart per article/part (so bare "5." isn't globally
   unique), give each node a unique id with the `{#id}` marker at the start of the base
   bullet or amendment blockquote node (e.g. `{#III.5} **5. Quorum.** …`). The marker is
   stripped from the displayed heading — the heading stays verbatim.
3. Add a config entry to `DOC_CONFIGS` in `build-data.js` (parts source, `baseKey`,
   `amendmentsMeta`/`chrono`, `baseAmend`, `meta.title`/`meta.subtitle`, and
   `sectionLabel` — `"SECTION"`, `"ARTICLE"`, …). Build and iterate until that doc's
   `COMPOSE VERIFY: PASS` with 0 warnings. Each doc has its own golden
   (`golden-<doc>.json`); regenerate with `GEC_WRITE_GOLDEN=1`.
4. Register the doc in the shell picker: add its key→label in `DOC_LABELS` and
   key→pdf in `DOC_PDF` (`app.js`/`index.html`), and copy its PDF to
   `public/decl/<Doc>.pdf`. The picker (leftmost 📄 header button) lists every
   `GEC_DOCS` key; selecting one writes `localStorage.gec_doc` and reloads.
5. Add a few assertions to `render-check.js` for that document's tricky sections (open a
   second jsdom with `url` set + `localStorage.gec_doc` to render the non-default doc).
6. Commit the source `.md` (canonical), the generated `data.js`, the golden, and the PDF.

### Generalizing beyond year‑based amendments

Amendment ids are currently years (`2001`, `2006`, …) and ordering is chronological
(`CHRONO` in `build-data.js`). For documents whose revisions are **code‑based** (e.g.
`R1`, `2023-A`, ordinance numbers), the model still holds — an amendment id is just an
opaque, orderable key. To generalize:

- Treat `amend.id` as an opaque string; keep an explicit `order`/`seq` field instead of
  parsing a year, and sort operations by it.
- Color/tag mapping in `app.js` (`yearColor`/`amendColorCSS`) keys off the id — swap
  the year‑based palette for an id‑indexed palette.
- The directive syntax is already id‑agnostic; only the *sequence* metadata changes.

Keep the invariant: **raw data + first‑class operations in, deterministic layered
render out.**

---

## 7. Conventions & gotchas

- `data.js` is generated — never hand‑edit; change the `.md` + directives and rebuild.
  It emits `window.GEC_DOCS` (all docs) + `window.DECL_DATA` (the declaration, back-compat).
- Per-article numbering: use the `{#id}` marker to assign a globally-unique node id while
  keeping the displayed heading verbatim (Section 6). Ids may be roman (`III.5`, `XII.1`).
- Each document has its own compose golden (`golden.json`, `golden-bylaws.json`, …);
  `build-data.js` verifies each and only rewrites them under `GEC_WRITE_GOLDEN=1`.
- Legal text is authored **once** in the source Markdown; code never contains verbatim
  clause text.
- `stripNotes` collapses runs of spaces but preserves `\n`; a blockquote list line
  (`1. ` / `(a) `) is joined with a real newline so the renderer shows a genuine list
  (`mdInline` turns `\n` into `<br>`). Respect source line structure; don't detect
  lists heuristically.
- Windows/CRLF repo; Node ≥ 22. `render-check.js` needs `jsdom` (installed).
- Commit trailers used for AI‑assisted commits:
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
