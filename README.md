# Frequency Deck Webapp

Prototype web presentation that embraces the neo-brutalist / pastel-punk aesthetic from the design brief. It runs as a static site, so you can host it anywhere (Deno Deploy, Vercel, Netlify, GitHub Pages, etc.).

## Quick Start

1. Open `index.html` in your browser to preview locally.
2. Edit `slides.js` to replace the placeholder content with your real slide data.
3. Drop any images into an `images/` folder at the project root (create it if needed) and update the paths inside `slides.js`.

No build step is required—the app uses vanilla HTML/CSS/JS.

## Editing Slides

- The `slides` array in `slides.js` contains one object per slide.
- Supported `type` values:
  - `title`
  - `standard`
  - `quote`
  - `split` (two-column layout)
  - `grid` (album blind-test style)
  - `pillars` (four-up manifesto columns)
  - `gallery` (multi-card visual comparisons)
- Use inline `<code>` tags in copy blocks when you need monospace text.
- Optional properties such as `badge`, `footnote`, and `image` are documented in the placeholder slides.

Tip: keep your copy in small arrays (`body: [...]`) to control paragraph breaks.

## Styling & Theme

- Update the color palette and typography via CSS custom properties at the top of `styles.css`.
- The riso-like grain overlay lives in the `.grain-overlay` rules—tweak or remove it if you prefer a cleaner look.
- Add new slide layouts by wiring a renderer in `main.js` and corresponding styles in `styles.css`.

## Keyboard Controls

- `ArrowRight` or `Space`: next slide
- `ArrowLeft`: previous slide
- `O`: toggle overview grid (click a tile to jump to that slide)
- `Esc`: exit overview

## Deploying

Everything is static, so deployment is trivial:

```bash
# Example: deploy to Deno Deploy using `deployctl`
deployctl deploy --project=freq-deck --include=.
```

Any static host works—just upload the repository contents.

## Assets & Credits

- `images/pablo-photo-placeholder.svg` is a drop-in silhouette—replace it with your real portrait.
- Wikimedia/Unsplash sourced images include credit links inside each slide footnote—retain or replace them if you swap imagery.
- Custom SVG illustrations (`cover-*`, UI comparisons, IGOR-inspired block, waveform/noise tweaks) live under `images/` and are free to remix.

## Next Steps

1. Replace placeholder images in `slides.js` with assets that live in `images/`.
2. Flesh out the full 45-slide narrative using the provided slide types.
3. Run through the deck to fine-tune pacing, colors, and any “broken” alignments.
