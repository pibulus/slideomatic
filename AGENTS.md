# Repository Guidelines

## Project Structure & Module Organization
- `index.html` / `index.css` – deck library landing page fed by `catalog.json`.
- `deck.html` + `main.js` – slideshow runtime that renders the chosen `slides.json` with the selected theme.
- `admin.html`, `admin.js`, `admin.css` – password-gated editor for live slide edits and JSON export.
- `slides.json` (or alternates referenced in `catalog.json`) – slide data; keep assets under `images/`.
- `theme.json` plus `themes/*.json` – UI tokens (colors, gradients, slide chrome). `autolinks.json` defines reusable link mappings.

## Build, Test, and Development Commands
- `npx serve .` (or `npm install -g serve`) – start a local static server so `fetch` calls for JSON succeed.
- `deck.html?slides=foo.json&theme=themes/bar.json` – quick manual verification of alternate decks/themes.
- `admin.html?slides=foo.json` – load the editor for a non-default slides file.

## Coding Style & Naming Conventions
- JavaScript/JSON use two-space indentation; prefer trailing commas omitted in JSON.
- Keep slide keys terse (`type`, `badge`, `body`). Use kebab-case filenames for images/assets.
- Theme tokens are lowercase with hyphens (e.g., `background-surface`). Reuse existing variable names for consistency.

## Testing Guidelines
- No automated tests yet. Manually verify:
  - Deck renders without console errors in `deck.html`.
  - Overview mode scrolls and badges appear correctly.
  - Editor loads/save cycle for edited JSON (download+replace).
  - Optional: test alternate themes via query params.

## Commit & Pull Request Guidelines
- Commit messages: start with imperative verb (e.g., `Add noir theme variant`, `Fix split badge rendering`). One logical change per commit when possible.
- Pull requests should include:
  - Summary of changes and motivation.
  - Any new/updated JSON files (slides, themes, catalog) with validation that deck loads.
  - Screenshots or GIFs when modifying visuals.
  - Note if manual QA steps were performed (`deck.html`, `admin.html`).

## Additional Tips
- When adding decks, update both `catalog.json` and provide matching `slides`/`theme` assets.
- Use the new quote syntax (`"Quote" — Name`) to trigger styled blocks automatically.
- Keep slide backgrounds semi-transparent so global gradients stay visible.
