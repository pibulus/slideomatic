# Slide-o-Matic v1 Launch Audit

Last updated: 2026-05-30

## Status

Slide-o-Matic is v1 launch-ready as a static, local-first slide builder. The launcher, guide deck, deck runtime, edit drawer, theme controls, share/export flows, keyboard/touch navigation, accessibility basics, cheat console, Gemini settings flow, metadata, and PWA shell all verify locally.

The production deploy path is a normal push to `main` for the Netlify-connected repo. No build step is required.

Post-v1 patch: the visible Share modal now creates Netlify-hosted `/s/...` links first and falls back to compressed client-side `?data=` links when functions are unavailable.

## Fixed For v1

- Consolidated work onto `main` and cleared stale local stashes.
- Made `npm run check` and `npm run lint` pass cleanly.
- Reworked the launcher into a clearer start flow with guide, blank deck, saved decks, upload, paste import, and about modal.
- Polished desktop/mobile spacing, drawers, HUD touch targets, modal sizing, and responsive deck flow.
- Hardened local saves, JSON import/export, PDF export, share link generation, and shared-deck local copy behavior.
- Hooked the visible Share UI to the existing Netlify Blob share service, with static-host fallback to `?data=` links.
- Preserved themes through local decks, JSON backup, upload, paste, and share links.
- Added Gemini prompt/body dictation with `gemini-2.5-flash-lite` and direct Google AI Studio API key links.
- Updated guide deck tone/content and fixed guide deck imagery.
- Cleaned metadata, OG/Twitter cards, favicon, robots, sitemap, manifest, Netlify headers, and crawler rules.
- Removed PostHog/Jina references after repo scan; none remain in app files.
- Added the accessibility pass: dialog semantics, `inert`/`aria-hidden` state, focus traps, focus restore, keyboard image preview, HUD slider ARIA, live regions, and contrast fixes.
- Cleaned split CSS imports and pre-cached drawer/runtime CSS for quiet PWA/offline loading.
- Bumped package/cache release signals to v1.0.1 for the hosted-share patch.

## Verified

```bash
npm run check
npm run lint
git diff --check
```

Browser/Puppeteer smoke covered:

- Landing page desktop/mobile.
- Paste/about modals.
- Guide deck load.
- Blank deck edit flow.
- Edit/theme drawers.
- HUD keyboard/touch navigation.
- Share modal hosted URL generation and client-side fallback URL generation.
- JSON backup/export/import paths.
- PDF export path.
- Settings modal API-key UI.
- Cheat console unlock with `666`.
- Image preview modal.
- PWA manifest/service worker/icon assets.
- Metadata/favicons/robots/sitemap heads.

Axe smoke returned 0 violations for:

- Landing page.
- Paste modal.
- About modal.
- Guide deck.
- Keyboard hints modal.
- Share modal.
- Cheat console.

## Known Post-Release Checks

These are not local blockers for v1, but they should be checked on the live domain:

1. Real Gemini key: Settings test, `666` starter deck, AI image generation, graph generation, voice-to-slide, and prompt dictation.
2. Real iPhone PWA: install from `https://slideomatic.app`, reload from home screen, edit a blank deck, share/export, and confirm the cached shell behaves.
3. Production share sanity: generate a share link on desktop, open it in another browser/device, confirm it becomes a local copy.
4. Netlify hosted share path: create a `/s/:slug` link on production, open it in another browser/device, and confirm it becomes a local copy.

## Ship Notes

- Default Share UI is hosted `/s/...` when Netlify functions are available, with client-side `?data=` fallback. Inline `data:` images are externalized/recompressed for hosted shares and replaced with placeholders only in fallback URL shares; JSON backup remains the full-fidelity offline path.
- Netlify Blob functions are active production infrastructure for hosted share records and uploaded image assets.
- `admin.html` is a convenience editor, not a hardened admin product.
- `REFACTOR_PROMPT.md` and `RADIO_WIDGET.md` are historical/reference docs, not v1 runtime truth.
