# Frequency Deck Webapp

Static slide deck engine with a neo-brutalist / pastel-punk aesthetic. The deck runs entirely in the browser, pulling its content and theme from JSON so you can swap stories or palettes without touching the render code.

---

## Quick Start

1. **Install dependencies** (static server + validation helpers):

   ```bash
   npm install
   ```

2. **Run the local server**:

   ```bash
   npm run dev
   ```

   Then open <http://localhost:3000/index.html> (or the port printed). Pick a deck and launch it (default deck lives at `/deck.html`).

3. **Open the deck editor** at `/admin.html`, unlock it with the password (default `bonesoup`), tweak slides, then download the updated `slides.json`.

That's it—no build step, no frameworks.

---

## Key Files

| File | Purpose |
| --- | --- |
| `index.html` | Deck library hub. Lists available slide/theme combinations. |
| `deck.html` | Presentation shell that renders the selected deck. |
| `main.js` | Slide renderer, keyboard nav, modals, preloading, auto-linking. |
| `slides.json` | Default slide content. |
| `theme.json` | Default theme (colors, spacing, shadows, background layers, slide chrome). |
| `themes/*.json` | Optional theme variants (loaded via `?theme=` query param). |
| `catalog.json` | Deck catalog used by the index page. |
| `autolinks.json` | Optional phrase → URL mappings for automatic hyperlinks. |
| `admin.html` / `admin.js` / `admin.css` | Browser-based slide editor with password gate. |
| `images/` | All deck imagery. Drop your own assets here. |

---

## Development Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Serves the repo locally using `serve`. Required for JSON fetches. |
| `npm run check` | Validates `slides.json`, theme files, catalog entries, and optional autolinks. |
| `deck.html?slides=foo.json&theme=themes/bar.json` | Manual check for alternate slide/theme combos. |
| `admin.html?slides=foo.json` | Opens the editor for a non-default slide file. |

---

## Editing Slides

### Option A – In-browser editor (recommended)

1. Visit `/admin.html` while the local server is running.
2. Enter the password (default `bonesoup`). Change it in `admin.js > ADMIN_PASSWORD` and redeploy if needed.
3. Expand a slide card, edit text, colors, image paths, or arrays. Fields update live in memory.
4. Click **Download slides.json** to export your changes. Replace the existing `slides.json` with the downloaded file.

### Option B – Manual editing

Edit `slides.json` directly. Each slide is a JSON object. Supported `type` values:

- `title`
- `standard`
- `quote`
- `split`
- `grid`
- `pillars`
- `gallery`

Use arrays for multi-paragraph copy (`"body": ["Paragraph 1", "Paragraph 2"]`). The renderer handles rich text (basic HTML) and auto-links.

Validation happens at runtime—if a slide is missing required fields you'll see a descriptive error slide.

---

## Autolinks (optional)

Add recurring terms to `autolinks.json` to automatically wrap them with links. Example:

```json
[
  { "term": "Tyler, the Creator", "search": "Tyler the Creator" }
]
```

- Omitting `urlTemplate` or `url` defaults to a Google Image search for the `search` value (or the term itself if `search` is absent).
- Set `"openInNewTab": false` to keep navigation in the same tab.
- Manual HTML links in `slides.json` still work if you prefer full control.

---

## Theming

Edit `theme.json` to swap colors, typography, spacing, shadows, and background texture. For variations, drop additional files into `themes/` and load them with `?theme=<name>` (e.g., `?theme=noir` loads `themes/noir.json`). You can also pass a direct file path like `?theme=themes/sunset.json`.

**Example:**

- `/?theme=noir` → loads `themes/noir.json`.
- `/index.html?theme=alternate.json` → loads `alternate.json` from the project root.

| Token | Result |
| --- | --- |
| `color-bg` | Base canvas colour (also used when slide background is solid). |
| `background-surface` | Optional global gradient/mesh (e.g. layered `radial-gradient(...)`). |
| `background-overlay` | Optional grain/noise overlay (accepts gradients or `url(...)`). |
| `background-opacity` | Opacity applied to the overlay layer (0–1). |
| `slide-bg` | Slide card fill (supports rgba or gradients). |
| `slide-border-color`, `slide-border-width` | Frame colour/weight for each slide. |
| `slide-shadow` | Box-shadow applied to slides. |
| `color-surface`, `color-surface-alt`, `color-accent` | Accent colour family used throughout slides. |
| `font-sans`, `font-mono` | Font stacks for body/headings and monospace accents. |
| `border-width`, `radius`, `shadow-*` | Frame treatments for cards and images. |
| `gutter` | Global slide padding. |

Swap `theme.json` for instant vibe changes; keep alternate files handy and rename them before deployment.

---

## Multiple Decks / Variants

- List decks in `catalog.json`; each entry can point to a different slides JSON and theme JSON.
- Launch a deck by visiting `deck.html?slides=path/to.json&theme=my-theme.json` (the index page builds these URLs for you).
- To edit a non-default deck, open `/admin.html?slides=path/to.json`.
- If you omit a parameter, the deck falls back to `slides.json` and `theme.json`.

---

## Keyboard Controls

- `→` / `Space` – Next slide
- `←` – Previous slide
- `Home` / `End` – Jump to first / last slide
- `O` – Toggle overview grid (click to jump)
- `Esc` – Exit overview

---

## Performance Notes

- Slides are rendered up front but hidden until shown, keeping GPU/CPU usage low while you navigate.
- Images load lazily and are prefetched a slide or two ahead for smooth transitions.
- `content-visibility` is enabled so off-screen slides stay cheap even with long decks.

---

## Deploying

Because every asset is static, any static host works (Vercel, Netlify, GitHub Pages, S3, etc.). Ensure your host serves JSON files correctly. Example with `serve` for testing:

```bash
npx serve .
```

---

## Changing the Admin Password

Open `admin.js` and update the `ADMIN_PASSWORD` constant. The password is stored locally in `localStorage`, so users with access to the repo should know not to commit secret credentials—treat this as a convenience layer, not hardened security.

---

## Troubleshooting

- **Deck shows “Unable to load slides”** – ensure you’re serving over HTTP (not using `file://`) and `slides.json` is valid JSON.
- **Admin editor stuck on loading** – same as above; confirm `slides.json` is reachable.
- **Auto-links missing** – confirm `autolinks.json` is valid JSON and the term matches the exact casing/spacing you expect.

---

## Shortcuts for Common Tasks

- Swap imagery by replacing files in `images/` and updating the corresponding `src` fields in `slides.json`.
- Clone the deck with a new theme by copying `theme.json`, editing, and renaming it before deployment.
- Remove or tailor auto-links by editing `autolinks.json` or leaving it empty.

Enjoy building new worlds. 💀✨
