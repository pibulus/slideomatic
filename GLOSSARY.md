# Slide-o-Matic Glossary (80/20)

- **main.js** – Orchestrator that wires modules together (init, modals, voice, share flows). Avoid adding heavy logic here—route through modules instead.
- **modules/state.js** – Central store for shared mutable state plus setter helpers. Anything cross-module should live here, not as bare globals.
- **modules/dom-refs.js** – Single source of truth for key DOM nodes (slides root, HUD counters, progress bar).
- **modules/hud.js** – Toast/HUD notification system with `showHudStatus`/`hideHudStatus` helpers and toast lifecycle management.
- **modules/deck-persistence.js** – Deck loading/saving utilities (localStorage, share params, deck IDs) with hook-based UI callbacks.
- **modules/navigation.js** – Overview mode + slide navigation (setActiveSlide, HUD updates, resize handler, overview focus state).
- **modules/slide-actions.js** – Mutation layer for slide insert/remove/replace, reload, download/upload; keeps DOM + state in sync.
- **modules/theme-drawer.js** – Theme drawer UI (open/close, dropdown sync, random + AI generation, theme saving) plus related color helpers.
- **modules/settings-modal.js** – Gemini API settings modal (open/close, listener wiring, save/test/clear logic, status banner updates).
- **modules/voice-modes.js** – Voice recording + AI slide/theme generation. Supplies hooks for HUD + modal interactions.
- **slides.json** – Minimal default deck so validators/tests don’t fail when no user deck is present.
