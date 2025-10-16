# Frequency Deck Webapp

Static slide deck engine with a neo-brutalist / pastel-punk aesthetic. The deck runs entirely in the browser, pulling its content and theme from JSON so you can swap stories or palettes without touching the render code.

---

## Quick Start

1. **Install a lightweight static server** (required because the app fetches JSON files):

   ```bash
   npm install -g serve   # or use npx serve .
   ```

2. **Run the server from the repo root** and open <http://localhost:3000> (or the port `serve` prints).

3. **Open the deck editor** at `/admin.html`, unlock it with the password (default `bonesoup`), tweak slides, then download the updated `slides.json`.

That's it—no build step, no frameworks.

---

## Key Files

| File | Purpose |
| --- | --- |
| `index.html` | Presentation shell. |
| `main.js` | Slide renderer, keyboard nav, modals, preloading, auto-linking. |
| `slides.json` | Source of truth for all slide content. |
| `theme.json` | CSS variable overrides (colors, spacing, fonts, shadows). |
| `autolinks.json` | Optional phrase → URL mappings for automatic hyperlinks. |
| `admin.html` / `admin.js` / `admin.css` | Browser-based slide editor with password gate. |
| `images/` | All deck imagery. Drop your own assets here. |

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

Edit `theme.json` to swap colors, typography, spacing, shadows, and border treatments. Values are applied as CSS variables on load, so you can maintain multiple theme files and rename the one you want to ship.

For larger visual changes, adjust `styles.css`. Notable sections:

- `.grain-overlay` – background grain & radial accents.
- `.slide--*` blocks – layout-specific styling.
- `.auto-link` – styling for generated hyperlinks.

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
