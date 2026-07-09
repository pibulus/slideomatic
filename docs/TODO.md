# Slide-o-Matic Post-v1 Roadmap

v1 is the shipped baseline. This file is now for non-blocking follow-up ideas, not launch blockers.

## Highest-Value Follow-Ups

1. **Production Gemini smoke**
   - Settings test with a real key.
   - `666` starter deck generation.
   - AI image generation and graph generation.
   - Voice-to-slide and prompt dictation.

2. **Real-device PWA pass**
   - Install from `https://slideomatic.app` on iPhone.
   - Open from home screen.
   - Create/edit a blank deck.
   - Reload, share, export JSON/PDF where supported, and confirm the cached shell feels sane.

3. **Share polish**
   - Consider an optional short-link backend for client-side `?data=` links.
   - Keep JSON backup as the full-fidelity image-heavy path.
   - Decide whether legacy Netlify Blob `/s/:slug` shares should stay supported long term.

4. **Templates and onboarding**
   - Add a small template picker beyond blank/guide.
   - Add 2-3 starter deck presets for common use cases.
   - Keep `guide.json` updated whenever a visible flow changes.

5. **Testing**
   - Add lightweight Playwright smoke scripts for launcher, deck, edit drawer, share, and accessibility checks.
   - Add unit tests around pure serialization helpers if share/import logic changes again.

## Deferred Ideas

- Better theme contrast preview inside the theme drawer.
- Optional account-free short-link storage for public sharing.
- Presenter mode with separate notes view.
- More graph/chart templates.
- Offline-first image handling improvements.
- Public gallery/collection curation if people actually use the thing.

## Keep True

- No login required for core use.
- Local saves stay local.
- Export paths must remain obvious.
- Mobile must stay usable, not merely “responsive.”
- Accessibility is part of the product, not a cleanup phase.
