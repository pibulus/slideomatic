# Slide-o-Matic Launch Audit

Last updated: 2026-05-30

## Status

Slide-o-Matic is launch-usable as a static, local-first slide builder. The core launcher, deck runtime, edit drawer, share modal, keyboard help, cheat console, and PWA shell all load locally without browser console errors.

## Fixed In This Audit

- Merged the remaining Claude branch into `main` so the latest drawer/share/radio work is not stranded off-branch.
- Made `npm run lint` usable by ignoring generated Netlify output and vendored bundles.
- Fixed validator drift by adding `graph` to `scripts/validate.mjs`.
- Fixed edit drawer accordion hydration so intended default-open sections stay open.
- Raised HUD and close-button hit targets to at least `44x44`.
- Fixed Netlify asset cleanup to call `delete-asset` with the payload the function expects.
- Added PWA setup: manifest, service worker, icons, Apple install meta, and registration module.

## Verified

```bash
npm run check
npm run lint
```

Browser smoke, using system Chrome through Puppeteer:

- `index.html` desktop and mobile load with no page errors.
- `deck.html` loads with no page errors.
- Edit drawer opens on desktop/mobile with Theme and Content expanded.
- Mobile visible HUD/drawer controls are at least `44x44`.
- Share modal opens from the HUD and generates from the current deck state.
- Cheat console opens with `666`.
- Manifest and service worker resolve and register on localhost.

## Residual Risks

- Live Gemini flows still need a real API-key pass: Settings test, `666` starter deck, auto image generation, graph generation, and voice recording.
- Real iPhone PWA install still needs a physical-device pass after deployment.
- Netlify Blob share functions remain in the repo for legacy/optional asset/share flows, while the default Share UI now generates compressed client-side `?data=` links.
- Root docs were refreshed, but `REFACTOR_PROMPT.md` is historical and should not be treated as current architecture.

## Suggested Launch Smoke

1. Deploy `main`.
2. Open `https://slideomatic.app` on desktop and iPhone.
3. Install to home screen on iPhone.
4. Open a blank deck, edit title/body, navigate, export JSON, and generate a Share link.
5. Add Gemini key, test connection, type `666`, generate an 8-slide starter deck, and confirm images fill in.
6. Reload installed PWA and confirm the deck still loads.
