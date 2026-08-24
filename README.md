# Glendale Estates Condominium

A simple, static informational landing page for the Glendale Estates Condominium
community. It is **not** an advertisement or a for-sale listing — it's intended to
become the local informational website for homeowners, vendors, and anyone dealing
with the HOA.

## Project layout

```
public/            Static site served by Cloudflare
  index.html       Landing page (single hero section)
  styles.css       Responsive styling
  GEC.jpg          Aerial image used as the hero background
  decl/            Declaration & amendments viewer (served at /decl/)
    index.html     Viewer shell (HTML + nav/TOC/favorites/mode JS)
    styles.css     Viewer styles
    app.js         Deterministic renderer (consumes window.DECL_DATA)
    data.js        GENERATED from tools/source — do not hand-edit
tools/             Build + verification for the viewer data
  source/          Canonical source text
    GEC-Declaration.txt       Pristine original text
    GEC-Declaration-Full.md   Same text in Markdown, annotated with <!--op--> directives
  build-data.js    Builds public/decl/data.js from the source
  render-check.js  Headless render assertions
  golden.json      Regression baseline
docs/              Archived reference material
AGENTS.md          How the viewer, data model, and directives work
wrangler.toml      Cloudflare Workers (static assets) configuration
package.json       Scripts + wrangler dev dependency
```

## The Declaration viewer

`/decl/` renders the GEC Declaration plus every amendment, in either a clean
**current** consolidated view or an **inline** redline. The data is raw
(1980 base + first-class amendment operations) and the renderer applies operations
deterministically. To rebuild after editing the source Markdown:

```sh
node tools/build-data.js     # regenerate public/decl/data.js (prints COMPOSE VERIFY)
node tools/render-check.js   # headless render assertions
```

See [AGENTS.md](AGENTS.md) for the data model, the `<!--op-->` directive convention,
and how to onboard a new document.

## Develop locally

Either open `public/index.html` directly in a browser (no build step), or run the
Cloudflare dev server to preview it exactly as it will be served:

```sh
npm install
npm run dev
```

Wrangler will print a local URL (typically <http://localhost:8787>).

## Deploy to Cloudflare

This is configured as a static-assets Worker (everything in `public/` is served
directly — no build step).

1. Install dependencies once: `npm install`
2. Authenticate: `npx wrangler login`
3. Deploy: `npm run deploy`

Wrangler will upload the contents of `public/` and give you a
`*.workers.dev` URL. You can attach a custom domain from the Cloudflare
dashboard afterward.

> Prefer Cloudflare Pages instead? You can also point a Pages project at this repo
> and set the **build output directory** to `public` with no build command.
