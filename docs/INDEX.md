# Slide-o-Matic Docs Index

Start here when the repo has been cold for a while. Root keeps `README.md`
(product + dev guide), `GLOSSARY.md` (fast vocabulary), and `AGENTS.md`
(agent working notes); everything else lives in this folder.

## Current Docs

- `ARCHITECTURE.md` — current runtime/module map, data flow, accessibility contract, and release checklist.
- `VOICE_TO_SLIDE.md` — Gemini key setup, voice generation, cheat-console flow.
- `LOCAL_TESTING.md` — local smoke testing, including when to use `npm run dev` vs `netlify dev`.
- `SHARING_OPTIMIZATIONS.md` — legacy/optional Netlify Blob sharing architecture notes.
- `RADIO_WIDGET.md` — SomaFM radio-dock extraction blueprint.
- `KEYS.md` — fleet key system: how the Gemini key is rotated and synced to Netlify.
- `TODO.md` — post-v1 roadmap and non-blocking follow-up ideas.

## Reference / Historical Docs

- `RELEASE_NOTES.md` — v1.0.x release notes.
- `LAUNCH_AUDIT.md` — v1 release audit, fixed issues, verification, and post-release smoke list.
- `FABLE-AUDIT.md` / `NEXT-STEPS.md` — July 2026 deep-audit report and its follow-ups.
- `REFACTOR_PROMPT.md` — old refactor planning prompt, not current runtime truth.
- `SCHEMA_EXAMPLE.json` — inline deck schema example.

## Core Data Files (repo root)

- `slides.json` — starter/welcome deck.
- `guide.json` — guide/how-to deck.
- `demo-deck.json` — brand/visual demo deck ("How to Get Got").
- `design-resources.json` — design resources deck.
- `templates/*.json` — the four starter templates.
- `theme.json`, `themes/*.json` — theme tokens.
- `catalog.json`, `deck-collections.json` — launcher and collection data.
- `slides-screenshots.json` — generated QA deck (`scripts/generate-image-deck.mjs`).
