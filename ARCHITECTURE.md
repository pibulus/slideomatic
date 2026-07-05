# Slide-o-Matic Architecture

**Status:** v1.0.1 static app, share flow patched May 30, 2026
**Shape:** Vanilla JS modules, JSON decks, local-first persistence, no build step.

Slide-o-Matic is a browser-native slideshow builder. `main.js` boots the deck runtime, then delegates focused work to modules under `modules/`. The app can run from any static host, with optional Netlify functions kept for legacy/heavier share flows.

---

## Entry Points

| Surface | Role |
| --- | --- |
| `index.html` | Public launcher, guide/blank entry, local deck shelf, JSON upload/paste, about modal. |
| `deck.html` + `main.js` | Presentation/runtime shell: load, render, edit, navigate, share, export, voice, and PWA behavior. |
| `collections.html` | Curated deck bundle surface using `deck-collections.json`. |
| `admin.html` + `admin.js` | Legacy password-gated JSON slide editor. Useful, but not the main v1 editing path. |
| `branding/index.html` | Branded/static resource page. |
| `netlify/functions/*` | Hosted `/s/...` share records, Blob image assets, asset cleanup, and fallback-compatible legacy `?share=` loading. |

---

## Runtime Flow

1. `deck.html` loads CSS, modal/drawer shells, `main.js`, and vendor image compression.
2. `main.js` registers hooks with persistence, navigation, edit, theme, share, voice, and slide-action modules.
3. `deck-persistence.js` resolves the source:
   - `#deck=` local saved deck
   - `#slides=guide`
   - `/s/:slug` / `?share=` hosted Netlify share record
   - `?data=` compressed fallback share payload
   - legacy `?url=`
   - fallback `slides.json`
4. Slides are validated, rendered through `slide-rendering.js`, and activated by `navigation.js`.
5. User edits go through `edit-drawer.js` and `slide-actions.js`; local saves are written under `slideomatic_deck_overrides:*`.
6. Export/share paths serialize the current slides + theme through `slide-actions.js`, `pdf-export.js`, and `share-modal.js`.

---

## Module Boundaries

| Module | Owns |
| --- | --- |
| `state.js` | Shared mutable runtime state and setters. |
| `dom-refs.js` | Cached references for slide root, HUD counters, and progress bar. |
| `navigation.js` | Slide activation, overview mode, HUD progress/counters, preloading. |
| `keyboard-nav.js` / `touch-nav.js` | Keyboard shortcuts and swipe/touch navigation. |
| `slide-rendering.js` | DOM construction for slide types, badges, graph/image hooks, slide ARIA labels. |
| `slide-actions.js` | Insert/replace/delete/reload/download deck operations. |
| `edit-drawer.js` | Main editor UI, autosave, duplicate/delete, PDF/JSON export buttons, dictation fields. |
| `edit-drawer-forms.js` | HTML builders for drawer sections and controls. |
| `drawer-base.js` | Shared drawer lifecycle, focus trap, focus restore, `inert`/ARIA state. |
| `theme-manager.js` | Theme load/apply/save, token normalization, contrast helpers. |
| `theme-drawer.js` | Theme drawer/dropdown, random themes, AI theme prompts, saved theme library. |
| `share-modal.js` | Netlify hosted `/s/...` share links, compressed `?data=` fallback links, and JSON backup action. |
| `share-password-modal.js` | Legacy locked-share prompt. |
| `voice-modes.js` | Gemini proxy plumbing, API key storage, voice-to-slide recording (V key), prompt dictation/transcription. |
| `cheat-codes.js` | Numeric cheat unlocks (`666`, `696969`) and AI starter deck console. |
| `image-render.js` | Slide images, placeholders, image preview modal, generated graph image rendering. |
| `image-upload.js` | Drop/paste/compress/upload image pipeline. |
| `image-ai.js` | Gemini image search/generation decisions and graph visualization prompts. |
| `slide-image-ui.js` | Edit-drawer image list, alt fields, remove/replace/reorder/AI buttons. |
| `onboarding.js` / `settings-modal.js` / `speaker-notes.js` / `slide-index.js` | Focused modal/overlay features. |

---

## Data Model

Decks are JSON arrays or objects with `{ slides, theme, meta }`.

Common slide types:

- `title`
- `standard`
- `quote`
- `split`
- `grid`
- `pillars`
- `gallery`
- `image`
- `graph`
- `typeface`

Important data files:

- `slides.json` - tiny default deck.
- `guide.json` - v1 onboarding guide deck.
- `design-resources.json` / `demo-deck.json` - richer demo/reference decks.
- `theme.json`, `themes/*.json` - theme tokens.
- `catalog.json`, `deck-collections.json` - launcher and collection metadata.
- `autolinks.json` - optional phrase-to-link mappings.

See `SCHEMA_EXAMPLE.json` for a deck-format reference.

---

## Persistence, Sharing, Export

- **Autosave:** `localStorage` keys under `slideomatic_deck_overrides:*`.
- **Last deck:** `slideomatic:last-deck`.
- **Saved themes:** localStorage theme library managed by `theme-manager.js`.
- **Hosted share:** `share-modal.js` posts slides + theme to `netlify/functions/share.js`, which stores a share record in Netlify Blobs and returns `/s/:slug`. Shares (and their externalized image assets) expire 90 days after their last view; loading a share refreshes both. The daily `cleanup-shares` cron sweeps expired records.
- **Fallback share:** if functions are unavailable, `share-modal.js` compresses slides + theme into a `?data=` URL; opening it creates a local `#deck=` copy.
- **Large inline images:** hosted shares externalize/recompress them where possible. Fallback URL shares replace inline `data:` images with placeholders to keep links usable. JSON backup keeps full fidelity.
- **JSON export/import:** available from keyboard (`D`/`U`), edit drawer, Share modal, launcher upload, and launcher paste.
- **PDF export:** edit drawer uses `html2canvas` + `jsPDF` through `pdf-export.js`.
- **Blob assets:** `upload-asset`, `asset`, and `delete-asset` support uploaded slide images. Deleted assets can remain publicly cacheable at the edge until cache expiry, so deletion is storage cleanup first.

---

## AI + Voice

- All Gemini calls route through the server-side proxy (`netlify/functions/gemini.js`), which falls back to the shared app key (`GEMINI_API_KEY` env var) so AI features work without any setup.
- A visitor's own key (Settings, stored in browser localStorage) is passed through as `userKey` and takes precedence — their quota, their risk.
- Text generation and transcription use the rolling `gemini-flash-latest` alias; image generation uses `gemini-3.1-flash-image` (allow-listed in the proxy).
- AI image and graph helpers use Gemini generation endpoints through `image-ai.js`.
- The cheat console opens with `666` or `696969`, then can generate a single slide or an 8-slide starter deck.
- Voice-to-slide is the V key; recording state surfaces as sticky toasts. Recordings cap at 5 minutes.

---

## Accessibility + UX Contract

v1 expects these to stay true:

- Drawers/modals set `aria-hidden` and `inert` correctly when closed.
- Open dialogs trap focus and restore focus on close.
- HUD progress is keyboard-operable and exposes slider ARIA.
- Slide images and image preview are keyboard-operable.
- Status text that changes uses live regions.
- Touch targets in core controls stay at least 44px.

The current release was smoke-tested with axe across launcher, paste/about modals, guide deck, hints, share, and cheat console.

---

## Deployment Notes

No bundling or transpilation. Deploy the repo root.

Required host behavior:

- Serve JS modules with correct MIME type.
- Serve JSON and `manifest.webmanifest`.
- Serve `sw.js` from root with `Service-Worker-Allowed: /`.
- Preserve hash/query URLs for `deck.html`.

`netlify.toml` already sets the static publish root, no-build command, service worker headers, crawler headers, and `/s/:slug` legacy redirects.

---

## Release Checklist

Before tagging a release:

```bash
npm run check
npm run lint
git diff --check
```

Recommended browser smoke:

- Launcher desktop/mobile.
- Guide deck.
- Blank deck -> edit -> save -> reload.
- Share link + JSON backup.
- PDF export.
- Settings modal + Gemini key test when a real key is available.
- Cheat console (`666`) starter deck when a real key is available.
- Installed PWA on a real phone when shipping a production URL.

---

## Related Docs

- `README.md` - product overview and user workflows.
- `LAUNCH_AUDIT.md` - v1 release audit and verification.
- `RELEASE_NOTES.md` - release notes.
- `VOICE_TO_SLIDE.md` - Gemini and voice details.
- `LOCAL_TESTING.md` - deeper local smoke scenarios.
- `SHARING_OPTIMIZATIONS.md` - optional/legacy Blob share architecture.

**Contributors:** Pablo + Claude Code + Codex.
