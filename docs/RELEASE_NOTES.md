# Slide-o-Matic Release Notes

## Unreleased — 2026-11-07

- Decks can carry their own theme: `?slides=`, `?url=`, and `?data=` all accept `{ slides, theme }`.
- Long slides scroll inside the frame; a bottom fade marks the overflow and lifts when the reader reaches the end.
- Body copy supports callouts in object form (`{ callout, title, body }`) and string form (`!!`, `?!`, `??`, `>>`).
- Split-column prose is sized to the column rather than the viewport, so dense two-column slides read at a proper measure.
- Divider slides can opt into a large plate with `media-strip__plate`, separate from the opening title banner.
- Generated image prompts ask for dense, diagrammatic plates with axes, labels, and plotted data instead of abstract mood.
- `/collections.html` merges an optional `deck-collections.local.json` (gitignored) after the public collections, so private packs stay local.
- New `scroll` slide type: a long-form document page with a lead paragraph and `##` section headings.
- Scroll pages take a `two-column` variant for dense reference pages.
- `## Heading` lines in any body copy render as section subheadings.
- The HUD gains a Hide button matching the existing `H` shortcut, so the nav bar is discoverable to hide on touch.
- The HUD is now a stage control: **Overview · Radio · Edit · Hide** plus navigation. Home, Share and Help moved into the drawer, and clicking the slide counter jumps to the first slide.
- The edit drawer has two tabs: **Slide** (the current slide) and **Deck** (whole-deck settings, or press `S`). Theme moved to the top of the Slide tab.
- The Deck tab carries body weight (**Light / Regular / Heavy**), share, download/load JSON, theme shuffle, shortcuts, and the Gemini key.
- Body copy defaults to weight 500 and the Vaporwave theme now sets Space Mono, so thin hairlines are readable at projector distance.
- The top badge is in the layout flow instead of floating above it. On tall slides the headline used to start inside the badge box; it now keeps a consistent 40px-plus gap on every slide type.
- Column subheadings use a mix of the theme surface and the ink colour instead of pure surface, roughly 1.3:1 contrast before.
- The shortcut sheet is grouped by purpose (Move / Present / Make) in aligned columns instead of a ragged two-column grid.
- Overview is calmer: a paper wash behind the grid, larger thumbnails, and slide numbers in the bottom-right corner where they no longer sit on the copy.
- The AI slide and deck prompts now carry the house design rules: one idea per slide, headline length, body limits, scroll-page pacing, image punctuation, real quotes only, and the no-"you" voice.

## v1.0.1 - May 30, 2026

- Share modal now creates hosted Netlify `/s/...` links first, backed by Netlify Blobs.
- Static/local hosting still falls back to compressed client-side `?data=` links.
- Hosted shares preserve theme data and can externalize/recompress inline images through the existing asset pipeline.
- `/s/...` share URLs now hydrate from the path directly and load deck-shell assets from root-safe URLs.
- Service-worker cache bumped to `slideomatic-v1.0.1`.

## v1.0.0 - May 30, 2026

Slide-o-Matic v1 is the launch cut: a local-first, installable slide builder with fast editing, playful themes, Gemini-assisted creation, and practical export/share paths.

### What Ships

- Launcher with guide deck, blank deck, saved local deck shelf, upload, and paste import.
- Deck runtime with keyboard, touch, HUD, overview, slide index, speaker notes, and responsive mobile presentation flow.
- Edit drawer with slide content controls, layout switching, image manager, dictation, duplicate/delete, JSON export, and PDF export.
- Theme controls with presets, randomization, saved local themes, theme drawer, and AI theme generation.
- Gemini settings flow with direct Google AI Studio API key link and local-only key storage.
- Cheat console unlocked by `666` or `696969` for single-slide or starter-deck generation.
- AI image helpers for empty image slots, generated starter-deck imagery, and graph visualization.
- Client-side share links that encode slides + theme and create a local copy for the recipient.
- JSON backup/export/import as the reliable full-fidelity path for image-heavy decks.
- PWA manifest, service worker, icons, metadata, favicon, robots, sitemap, and Netlify headers/redirects.
- Split CSS files are root-absolute and pre-cached so the shell loads quietly and survives PWA/offline use.
- Accessibility pass for modal/drawer semantics, focus management, keyboard access, live regions, and contrast.

### Verification

- `npm run check`
- `npm run lint`
- `git diff --check`
- Local browser smoke for launcher, guide deck, blank deck/edit drawer, share, PDF/JSON export, PWA shell, metadata assets, and modal flows.
- Axe smoke with 0 violations across landing, paste/about modals, guide deck, hints, share modal, and cheat console.

### Known Post-Release Checks

- Real Gemini-key smoke on production: Settings test, `666` starter deck, image generation, graph generation, and voice/dictation.
- Real iPhone PWA install/reload/share pass on `https://slideomatic.app`.
- Optional Netlify Blob share flow remains in the repo for legacy/heavier asset paths, but the visible v1 Share UI uses client-side `?data=` links.
