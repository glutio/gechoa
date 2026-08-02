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
wrangler.toml      Cloudflare Workers (static assets) configuration
package.json       Scripts + wrangler dev dependency
```

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
