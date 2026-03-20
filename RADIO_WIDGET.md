# Radio Widget — Standalone Extraction Plan

Blueprint for extracting the SomaFM/radio feature from Slideomatic into a
standalone, embeddable web component that can be dropped into any site.

---

## Source files in this repo

Everything you need lives in these files:

| File | What to grab |
|------|-------------|
| `modules/radio.js` | **Entire file.** Core audio state machine — zero external deps. |
| `modules/edit-drawer-forms.js` | `buildRadioSection()` function (~lines 470–510) — HTML template for the toggle + channel selector. |
| `modules/edit-drawer-forms.js` | `setupThemeRadioControls()` function (~lines 510–590) — event wiring for toggle + channel switching. |
| `css/edit-drawer.css` | `.theme-radio*` classes (~lines 531–652) — all visual styling for the radio component. |
| `css/accordion.css` | `.accordion--radio` — just the background tint (optional). |

---

## Target architecture

```
radio-widget/
├── src/
│   ├── radio-core.js        # Adapted from modules/radio.js
│   ├── radio-widget.js       # Web Component (Custom Element)
│   └── radio-widget.css      # Self-contained styles (no CSS var deps)
├── dist/
│   └── radio-widget.min.js   # Single-file bundle (JS + CSS injected)
├── demo/
│   └── index.html            # Drop-in demo page
├── README.md
└── package.json
```

---

## Key changes from Slideomatic version

### 1. Make the channel list configurable

Current `radio.js` hardcodes `FAVORITE_CHANNELS`. The standalone version
should accept channels via config:

```js
<radio-widget channels='[
  {
    "id": "kpab",
    "name": "KPAB.fm",
    "shortLabel": "KPAB",
    "description": "Your station, your vibe.",
    "stream": "https://kpab.fm/stream"
  },
  {
    "id": "groovesalad",
    "name": "Groove Salad",
    "shortLabel": "Groove Salad",
    "description": "Downtempo ambient grooves.",
    "stream": "https://ice4.somafm.com/groovesalad-128-mp3"
  }
]'></radio-widget>
```

Or via JS:

```js
const widget = document.querySelector('radio-widget');
widget.channels = [
  { id: 'kpab', name: 'KPAB.fm', stream: 'https://kpab.fm/stream', ... },
  ...
];
```

### 2. KPAB.fm integration

To add your AzuraCast station, you just need the direct stream URL. AzuraCast
exposes streams at predictable URLs:

- **MP3 stream:** `https://kpab.fm/radio/8000/radio.mp3` (or similar — check your AzuraCast admin under Station > Mount Points)
- **Now Playing API:** `https://kpab.fm/api/nowplaying/1` — returns JSON with current song title, artist, album art, listeners, etc.

The widget could optionally poll the Now Playing API to show what's currently
on air — a nice feature SomaFM streams don't easily offer.

### 3. Web Component wrapper

Wrap everything as a Custom Element so usage is just:

```html
<script src="https://unpkg.com/radio-widget/dist/radio-widget.min.js"></script>
<radio-widget></radio-widget>
```

Use Shadow DOM for style isolation so it works on any site without CSS conflicts.

### 4. Remove Slideomatic dependencies

The current UI relies on:
- Slideomatic's `custom-select` component → replace with a native `<select>` or build a minimal dropdown
- CSS custom properties (`--font-mono`, `--color-ink`, etc.) → inline or provide defaults
- `accordion` wrapper → not needed, the widget is always visible
- HUD status toasts → replace with a small built-in status indicator

### 5. localStorage key prefix

Current keys are `slideomatic.radio.*`. The standalone version should use a
configurable prefix (default `radio-widget.*`) so multiple instances on the
same domain don't collide.

---

## API surface (proposed)

```js
// Attributes (HTML)
channels      // JSON array of channel objects
default-channel  // ID of the channel to select on load
volume        // 0–1, default 0.8
storage-key   // localStorage prefix, default "radio-widget"
theme         // "light" | "dark" | "auto"

// Properties (JS)
widget.channels = [...]
widget.volume = 0.6
widget.currentChannel  // read-only
widget.isPlaying       // read-only

// Methods
widget.play(channelId?)
widget.pause()
widget.toggle()

// Events
widget.addEventListener('play', e => ...)
widget.addEventListener('pause', e => ...)
widget.addEventListener('channelchange', e => ...)
widget.addEventListener('error', e => ...)
```

---

## Prompt for Claude Code (desktop)

When you're ready to build it, give Claude Code something like this:

> Create a new repo called `radio-widget`. It's a standalone embeddable web
> radio player built as a Web Component (Custom Element with Shadow DOM).
>
> Reference the source files in `~/slideomatic/` — specifically
> `modules/radio.js` for the audio state machine, the `buildRadioSection()`
> and `setupThemeRadioControls()` functions in `modules/edit-drawer-forms.js`
> for the UI pattern, and the `.theme-radio*` styles in
> `css/edit-drawer.css`.
>
> See `~/slideomatic/RADIO_WIDGET.md` for the full extraction plan,
> target architecture, and proposed API.
>
> The default channel list should include my AzuraCast station KPAB.fm
> (stream URL: check https://kpab.fm) plus the SomaFM stations from
> radio.js. Make the channel list fully configurable via HTML attributes
> or JS properties.
>
> Ship it as a single JS file that can be loaded via a script tag.
> No build step required for development, but include a simple
> esbuild/rollup config for producing the minified dist bundle.

---

## After extraction

Once the standalone widget exists, you can optionally swap Slideomatic's
built-in radio to use it too:

```js
// In edit-drawer-forms.js, replace buildRadioSection() with:
import 'radio-widget';
const content = `<radio-widget channels='${JSON.stringify(channels)}'></radio-widget>`;
return buildAccordion('Radio', content, { modifier: ' accordion--radio', startOpen: false });
```

That way both repos stay in sync and you only maintain the radio logic in
one place.
