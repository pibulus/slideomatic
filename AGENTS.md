# Slide-o-Matic — Agent Context (`AGENTS.md`)

> Browser-native, local-first JSON slideshow engine (`https://slideomatic.app`).
> Vanilla ES modules + CSS custom properties + Netlify Functions/Edge Functions + Netlify Blobs. Zero build bundler.

## Quick Orientation

- **Shared vocabulary**: Read [`GLOSSARY.md`](./GLOSSARY.md) (`"gimme the gloss"`).
- **Full documentation map**: Start at [`docs/INDEX.md`](./docs/INDEX.md).
- **Runtime & data flow**: Read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).
- **API keys & Netlify sync**: Read [`docs/KEYS.md`](./docs/KEYS.md) (`~/.config/fleet/keys.env` -> `apikey sync slideomatic`).
- **Workspace & fleet rules**: Read `~/Projects/active/CLAUDE.md` and `~/.claude/AGENTS.md`.

## Commands

```bash
npm run dev      # Serve locally (static files; use `netlify dev` when testing functions)
npm test         # Run Node unit tests (netlify/functions + netlify/edge-functions)
npm run check    # Validate JSON decks, themes, catalog, templates, sw.js assets, and SEO portal
npm run lint     # Run ESLint across main.js, modules/, netlify/, scripts/
npm run smoke    # Run Puppeteer headless smoke suite
```

## Key Paths

- `index.html` — Public launcher, template/guide entry, local deck shelf, JSON import/paste.
- `deck.html` + `main.js` — Presentation shell, stage HUD, edit drawer (`E`), deck tab (`S`), overview (`O`), voice (`V`), cheat console (`666`).
- `collections.html` — Curated deck bundles (`deck-collections.json`, plus localhost-only `deck-collections.local.json`).
- `modules/` — Focused ES modules (`slide-rendering.js`, `edit-drawer.js`, `deck-persistence.js`, `share-modal.js`, `voice-modes.js`, etc.) and `modules/vendor/`.
- `css/` — Component stylesheets (`main.css`, `slides.css`, `edit-drawer.css`, `modals.css`, `variables.css`, etc.).
- `netlify/functions/` & `netlify/edge-functions/` — Blob-backed `/s/:slug` sharing, OG tag rewriting (`share-og.js`, `collection-og.js`), asset proxy, and Gemini proxy (`gemini.js` + `utils/spendGuard.js`).
- `sw.js` — Service worker (`SHELL_ASSETS` validated by `npm run check`; stamped at deploy by `scripts/stamp-sw-version.mjs`).
