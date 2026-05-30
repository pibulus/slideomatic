# Slide-o-matic 🎬

Voice-powered slide deck engine with a neo-brutalist / pastel-punk aesthetic. Create presentations with JSON, the edit drawer, voice, or the AI cheat console; save locally; share compressed links; and install it as a small PWA.

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

3. **Open the main builder** at `/deck.html` or start from `/index.html`. Press `E` to edit, `?` for shortcuts, and `S` to add a Gemini key.

That's it—no build step, no frameworks.

For the current launch state, read `LAUNCH_AUDIT.md`.

---

## Key Files

| File | Purpose |
| --- | --- |
| `index.html` | Deck library hub. Lists available slide/theme combinations. |
| `deck.html` | Presentation shell that renders the selected deck. |
| `main.js` | Runtime orchestrator that wires deck loading, modules, HUD, drawers, and navigation. |
| `modules/` | Focused runtime modules for rendering, persistence, drawers, image handling, AI, sharing, and PWA setup. |
| `slides.json` | Default slide content. |
| `theme.json` | Default theme (colors, spacing, shadows, background layers, slide chrome). |
| `themes/*.json` | Optional theme variants (loaded via `?theme=` query param). |
| `catalog.json` | Deck catalog used by the index page. |
| `autolinks.json` | Optional phrase → URL mappings for automatic hyperlinks. |
| `manifest.webmanifest` / `sw.js` / `icons/` | PWA install shell. |
| `admin.html` / `admin.js` / `admin.css` | Browser-based slide editor with password gate. |
| `netlify/functions/` | Optional/legacy Blob share + asset endpoints. |
| `images/` | All deck imagery. Drop your own assets here. |

---

## Development Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Serves the repo locally using `serve`. Required for JSON fetches. |
| `npm run check` | Validates `slides.json`, theme files, catalog entries, and optional autolinks. |
| `npm run lint` | Runs ESLint on source files. |
| `deck.html?slides=foo.json&theme=themes/bar.json` | Manual check for alternate slide/theme combos. |
| `admin.html?slides=foo.json` | Opens the editor for a non-default slide file. |

---

## Saving & Exporting

- **Autosave:** Every deck you touch is cached locally under `slideomatic_deck_overrides:*`. Clear these keys in devtools if you want a blank slate.
- **JSON:** Press `D` (or the drawer button) to download the current deck. Press `U` to upload any exported JSON. Keep a `_schema` slide at the top if you want inline documentation.
- **PDF:** Use the **Download PDF** button inside the edit drawer—this runs `scripts/export-pdf.mjs` under the hood and writes to `/exports`.
- **Voice & Notes:** The mic icon in the HUD lets you narrate slides hands‑free while you build. Great for quick reviews.
- **Sharing:** The HUD Share button generates a compressed client-side `?data=` link containing the slides and current theme. Large inline data images are stripped from that URL to keep it usable; export JSON for image-heavy decks.
- **PWA:** `manifest.webmanifest`, `sw.js`, and app icons are wired for install on desktop/mobile. Do a real iPhone install pass before calling production fully done.

Old `?url=`, `?data=`, and legacy `?share=` parameters still load decks if you need to sideload JSON manually or maintain old links.

---

## Documenting Your Deck Format

You can add a `_schema` slide at the top of `slides.json` to document your format inline. The renderer will ignore it:

```json
[
  {
    "type": "_schema",
    "note": "This slide is ignored - use it to document your deck",
    "availableTypes": ["title", "standard", "quote", "split", "grid", "pillars", "gallery", "graph", "typeface", "image"],
    "fontPresets": ["sans", "mono", "grotesk", "jetbrains", "pixel"],
    "tip": "Add any documentation fields you want here"
  },
  {
    "type": "title",
    "title": "Your First Real Slide",
    ...
  }
]
```

See `SCHEMA_EXAMPLE.json` for a complete documentation template.

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
- `graph` (AI-generated infographic/graph image)
- `typeface` (font showcase)
- `image` (full-bleed visual with optional caption overlay)

### Auto Badges & Slide Numbers

Each slide shows a badge in the upper-left corner. Set `"badge": "Slide 2B"` to control the copy. If you omit `badge`, the runtime now auto-labels the slide as `+ Slide N` based on its position. Disable the fallback with `"autoBadge": false` when you want a bare slide without any tag.

### Full-Bleed Image Slides

Use the `image` type when an asset should take over the whole frame:

```json
{
  "type": "image",
  "image": {
    "src": "images/live-crowd.jpg",
    "alt": "Crowd under violet lighting"
  },
  "caption": "Live at the Observatory — April 2024"
}
```

Options:

- `"caption"` – optional overlay at the bottom-left.
- `"image": { "objectFit": "contain", "objectPosition": "center top" }` – fine-tune how the image is sized/anchored.
- `"image": { "border": false }` – removes the default frame when using non-full-bleed slides.
- `"image": { "orientation": "portrait" }` – overrides automatic orientation detection (`portrait`, `landscape`, or `square`).
- `"autoBadge": false` – hide the default badge entirely.

Use arrays for multi-paragraph copy (`"body": ["Paragraph 1", "Paragraph 2"]`). The renderer handles rich text (basic HTML) and auto-links.

### Missing Image Helpers

If you define an `image` object without a `src`, the deck now renders a small “Search” button that opens a Google Images tab based on the slide’s `alt` (or label) text. Handy for quickly sourcing artwork while building the story.
Images automatically tag themselves as landscape/portrait/square once loaded, and you can override with `image.orientation` if you want to lock a layout in place.

### Rapid Screenshot Decks

Need a slideshow from a folder of screenshots? Run the helper script:

```bash
node scripts/generate-image-deck.mjs --dir images/screenshots --out slides-screenshots.json
```

- Images are sorted by modified time (oldest → newest).
- Each file becomes a full-bleed `image` slide with a generated caption.
- Launch via `deck.html?slides=slides-screenshots.json`.
- Add `--dry-run` to preview the JSON or `--help` for more options.

Validation happens at runtime—if a slide is missing required fields you'll see a descriptive error slide.

### Font Control

Add a `font` field to any slide to override the theme's default font:

**Presets:**
- `"font": "sans"` - Inter (default body font)
- `"font": "mono"` - Space Mono (monospace)
- `"font": "grotesk"` - Space Grotesk (geometric sans)
- `"font": "jetbrains"` - JetBrains Mono (code font)
- `"font": "pixel"` - Press Start 2P (retro)

**Custom fonts:**
- `"font": "Comic Sans MS"` - Use any system/web font
- `"font": "Georgia"` - Serif example

Example:
```json
{
  "type": "quote",
  "quote": "This quote is in pixel font",
  "attribution": "Retro vibes",
  "font": "pixel"
}
```

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
- `?` – Show keyboard shortcuts help
- `V` – **Voice-to-slide** (record audio, AI generates slide)
- `T` – **Randomize theme** (instantly generates a new random theme variation)
- `E` – Edit current slide (includes all theme controls)
- `D` – Export deck as JSON
- `U` – Upload deck from JSON
- `S` – Settings (configure Gemini API key)
- `I` – Toggle slide index
- `N` – Toggle speaker notes

### 🎙️ Voice-to-Slide
Press `V` or click the voice button in the HUD to generate slides using AI. Describe what you want and Gemini creates the slide. See [VOICE_TO_SLIDE.md](VOICE_TO_SLIDE.md) for setup and examples.

### 🕹️ AI Starter Deck (Cheat Codes!)
Type `IDDQD`, `IDKFA`, or `ABRACADABRA` anywhere in the deck view to open the AI Cheat Console. Describe a topic and Gemini builds an 8-slide starter deck with:
- Real facts, names, dates, and working links (Wikipedia, YouTube, publications)
- Discussion questions that double as research prompts
- AI-generated images for each slide (generated automatically after the deck appears)
- Presenter notes with rabbit holes and tangents to explore

The deck is designed as a **research springboard** — good enough to present today, but with enough visible threads that you naturally want to pull on them and make the deck your own.

### ✨ AI Image Generation
When a slide has an empty image slot, click the `✨` button in the edit drawer. Gemini decides whether to search for a stock photo or generate a custom illustration in risograph style, matched to your current theme colours.

The AI cheat console also tries to fill empty image slots after generating a starter deck.

### 🎨 Theme Controls
Press `E` to open the edit drawer where you'll find all theme controls:
- **Select themes** from presets (Default, Gameboy, Vaporwave, Slack) or your saved library
- **Randomize** themes with one click (or press `T` for instant randomization)
- **AI Theme Generation** — describe the vibe and Gemini creates a full theme
- **Save themes** to your personal library for quick access later

---

## Performance Notes

- Slides are rendered up front but hidden until shown, keeping GPU/CPU usage low while you navigate.
- Images load lazily and are prefetched a slide or two ahead for smooth transitions.
- `content-visibility` is enabled so off-screen slides stay cheap even with long decks.

---

## Deploying

Because every core asset is static, any static host works (Netlify, Vercel, GitHub Pages, S3, etc.). Ensure your host serves JSON, webmanifest, JS modules, and the service worker from the site root. Example with `serve` for testing:

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
