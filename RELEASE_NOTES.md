# Slide-o-Matic Release Notes

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
