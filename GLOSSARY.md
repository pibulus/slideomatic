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
- **admin.html** – Password-gated slide editor (default password `bonesoup`). Useful when editing decks without hand-editing JSON.
- **collections.html** – Simple UI for showing curated deck bundles (e.g., “Design Starter”).
- **README.md** – Canonical onboarding (install, dev commands, saving/export info). Should match the current UI feature set.
- **SHARING_OPTIMIZATIONS.md** – Netlify Blob/share architecture. Share HUD button is currently hidden but the doc remains for when we re-enable it.
- **VOICE_TO_SLIDE.md** / **ARCHITECTURE.md** / **REFACTOR_PROMPT.md** – Supporting design docs for voice features, module boundaries, and improvement prompts.

## Concepts

- **Edit Drawer** – Toggles with `E`. Houses content inputs, layout switcher, media manager, duplicate/delete controls, and the PDF exporter.
- **Theme Drawer** – Toggles with `T`. Randomize palettes, tweak layers, save presets, stream SomaFM, and run the AI theme helper (Gemini).
- **Deck Autosaves** – Stored in `localStorage` under `slideomatic_deck_overrides:*`. Clear keys when you need a blank state.
- **Cheat Console** – Type IDDQD, IDKFA, or ABRACADABRA to open. Generate single slides or full 8-slide starter decks with AI. Starter decks include working links, discussion questions, and auto-generated images — designed as research springboards, not finished presentations.
- **AI Image Generation** – Empty image slots show a `✨` button in the edit drawer. Gemini decides: search for a photo or generate a risograph-style illustration matched to the current theme. Also runs automatically after starter deck generation.
- **SomaFM Toggle** – Drawer-only switch that pipes curated radio while editing—purely for vibe control.
