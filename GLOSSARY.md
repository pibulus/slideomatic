# Slide-o-Matic Glossary (80/20)

## Runtime & Modules

- **main.js** – Orchestrator that wires modules together (init, modals, voice modes, drawer wiring). Keep this thin—push real logic into modules.
- **modules/state.js** – Central store for shared mutable state plus setter helpers. Anything cross-module should live here, not as bare globals.
- **modules/dom-refs.js** – Single source of truth for key DOM nodes (slides root, HUD counters, progress bar).
- **modules/hud.js** – Toast/HUD notification system with `showHudStatus`/`hideHudStatus` helpers and toast lifecycle management.
- **modules/deck-persistence.js** – Deck loading/saving utilities (localStorage, share params, deck IDs) with hook-based UI callbacks.
- **modules/navigation.js** – Overview mode + slide navigation (setActiveSlide, HUD updates, resize handler, overview focus state).
- **modules/slide-actions.js** – Mutation layer for slide insert/remove/replace, reload, download/upload; keeps DOM + state in sync.
- **modules/theme-drawer.js** – Theme drawer UI (open/close, dropdown sync, random + AI generation, theme saving) plus related color helpers.
- **modules/settings-modal.js** – Gemini API settings modal (open/close, listener wiring, save/test/clear logic, status banner updates).
- **modules/voice-modes.js** – Voice recording + AI slide/theme generation. Supplies hooks for HUD + modal interactions.

## Decks & Content

- **guide.json** – Interactive “how-to” deck that walks users through shortcuts, drawer controls, and cheat hints. Great reference when adding new UX affordances.
- **design-resources.json** – Curated “Free Design Resources” deck used as a showcase/demo. Keep the vibe aligned with blog posts and any public embeds.
- **slides.json** – Minimal default deck so validators/tests don’t fail when no user deck is present.
- **slides-screenshots.json** – Auto-generated deck for screenshot folders (built via `scripts/generate-image-deck.mjs`). Handy for QA.
- **catalog.json / deck-collections.json** – Data models listing available decks + groupings surfaced on `index.html` and `collections.html`.

## Surfaces & Docs

- **index.html** – Home hub / deck launcher. CTA copy and typography tweaks happen here.
- **deck.html** – Presentation shell that renders a deck JSON + optional theme.
- **admin.html** – Legacy password-gated slide editor. The current hash ships for `bonesoup`; change `ADMIN_PASSWORD_HASH` in `admin.js` before treating it as anything beyond a convenience tool.
- **collections.html** – Simple UI for showing curated deck bundles (e.g., “Design Starter”).
- **README.md** – Canonical onboarding (install, dev commands, saving/export info). Should match the current UI feature set.
- **SHARING_OPTIMIZATIONS.md** – Netlify Blob/share architecture. Default production Share UI creates hosted `/s/...` links and falls back to compressed client-side `?data=` links.
- **manifest.webmanifest / sw.js / icons/** – PWA install shell for home-screen usage.
- **LAUNCH_AUDIT.md** – Current audit state, fixed issues, verification, and residual launch risks.
- **docs/** – All supporting docs; start at `docs/INDEX.md`.

## Concepts

- **Edit Drawer** – Toggles with `E`. Houses content inputs, layout switcher, media manager, duplicate/delete controls, and the PDF exporter.
- **Theme Controls** – Theme selection, randomization, saved themes, and AI theme generation. `T` randomizes the current theme; deeper controls live in the edit/theme drawer flow.
- **Deck Autosaves** – Stored in `localStorage` under `slideomatic_deck_overrides:*`. Clear keys when you need a blank state.
- **Cheat Console** – Type 666 or 696969 to open. Generate single slides or full 8-slide starter decks with AI. Starter decks include working links, discussion questions, and auto-generated images — designed as research springboards, not finished presentations.
- **AI Image Generation** – Empty image slots show a `✨` button in the edit drawer. Gemini decides: search for a photo or generate a risograph-style illustration matched to the current theme. Also runs automatically after starter deck generation.
- **Hosted Share Links** – HUD Share tries a Netlify Blob-backed `/s/...` link first. Recipients get a local copy when they open it.
- **Client-side Share Links** – Static-host fallback where HUD Share encodes slides + theme into a compressed `?data=` URL. Good for text/light decks; use JSON export for heavy image decks.
- **Radio Dock** – Floating bottom-left SomaFM pill (`modules/radio-dock.js`); works while presenting and hides with the HUD (H key).
- **v1.0.0** – Launch baseline: static app, local-first decks, share/export, PWA shell, Gemini helpers, and accessibility pass.
- **v1.0.1** – Share patch: visible Share UI now uses hosted `/s/...` links first, with client-side `?data=` fallback.
