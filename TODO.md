# Slide-O-Matic Feature Roadmap 🎬

## Priority Matrix: Max Value / Min Effort

### 🚀 Phase 1: Quick Wins (High Value, Low Effort)
**Ship these first - biggest bang for buck**

#### ✅ 1. Theme Switcher in HUD (30min)
- **Value**: Instant visual variety, feels magic
- **Effort**: Minimal - just dropdown + theme loading already exists
- **Implementation**: Single-line HUD dropdown with theme presets (slack/vaporwave/gameboy)
- **Files**: `deck.html` (HUD), `main.js` (theme switching logic)

#### ✅ 2. Slight Slide Transparency (5min)
- **Value**: More depth, shows background gradients
- **Effort**: Trivial - one CSS change
- **Implementation**: `slide-bg` opacity from 0.88 → 0.82 OR add subtle backdrop-blur
- **Files**: `theme.json` templates

#### ✅ 3. Speaker Notes (N key) (45min)
- **Value**: Pro feature, essential for presenters
- **Effort**: Low - modal overlay with notes field per slide
- **Implementation**: Add `notes` field to slide schema, N key toggles overlay
- **Files**: `main.js` (keyboard handler), `styles.css` (notes overlay)

---

### 🎨 Phase 2: Core Features (High Value, Medium Effort)

#### ✅ 4. Theme Editor Drawer (2hrs)
- **Value**: Power users can customize without leaving app
- **Effort**: Medium - mirror slide editor drawer pattern
- **Implementation**: Left-side drawer with JSON editor + live preview
- **Reference**: Current right-side slide editor as template
- **Files**: `deck.html`, `styles.css`, `main.js`

#### ✅ 5. Save Favorite Themes to localStorage (1.5hrs)
- **Value**: Users build personal theme library
- **Effort**: Medium - localStorage + UI for saved themes
- **Implementation**: "Save Theme" button in editor → localStorage → show in dropdown
- **Reference**: `active/apps/conversation_mapper` theme saving system
- **Files**: New `theme-manager.js` module

#### ✅ 6. AI Graph Generation (3hrs)
- **Value**: Unique feature, eliminates chart-making friction
- **Effort**: Medium - Gemini Image API integration
- **Implementation**:
  - New slide class: `graph`
  - Metadata → Gemini Imagen 3 prompt
  - Style: "risograph print style" + theme colors injected
  - Check if Flash 2.5 Experimental supports Imagen 3
- **Files**: `main.js` (new renderer), API integration

---

### 🌟 Phase 3: Polish & Delight (Medium Value, Low-Medium Effort)

#### ✅ 7. Smart Theme Randomizer (2hrs)
- **Value**: Discovery, playful, inspires creativity
- **Effort**: Medium - color theory + taste algorithms
- **Implementation**: Adapt `juicy_themes` color generator with constraints
- **Files**: New `theme-generator.js` module
- **Constraints**:
  - Contrast ratios for accessibility
  - Harmonious palettes (triadic/complementary)
  - Avoid clashing neons

#### ✅ 8. Redesigned Index Page (2.5hrs)
- **Value**: Professional first impression
- **Effort**: Medium - HTML/CSS overhaul
- **Implementation**:
  - Hero section with "New Deck" CTA
  - Grid of saved decks (from localStorage)
  - Remove per-theme deck sections
  - Modern Slide-O-Matic branding
- **Files**: `index.html`, `index.css`

#### ✅ 9. Footer + Ko-fi + About (30min)
- **Value**: Community building, support link
- **Effort**: Low - copy pattern from asciifier-web
- **Implementation**: Simple footer with Ko-fi button, Pablo link, GitHub
- **Reference**: `active/apps/asciifier-web` footer
- **Files**: `index.html`, `index.css`

#### ✅ 10. Intro Modal (1hr)
- **Value**: Onboarding, sets expectations
- **Effort**: Low-Medium - modal component + localStorage flag
- **Implementation**: First-visit modal explaining voice controls, shortcuts
- **Reference**: `active/apps/asciifier-web` or `active/apps/talktype`
- **Files**: `deck.html`, `styles.css`, `main.js`

---

### 🔮 Phase 4: Advanced (High Value, High Effort)

#### ✅ 11. AI Theme Generator (3hrs)
- **Value**: Zero-friction theme creation
- **Effort**: High - Gemini API + color extraction + validation
- **Implementation**:
  - Voice/text prompt → Gemini generates theme JSON
  - Use schema example like slide generation
  - Accessible from theme editor drawer
- **Files**: `main.js`, theme generation API integration

---

## Implementation Order (80/20 Sequencing)

### Sprint 1: Instant Gratification (2hrs)
1. ✅ Slight slide transparency
2. ✅ Theme switcher dropdown in HUD
3. ✅ Speaker notes (N key)
4. ✅ Footer/Ko-fi

**Result**: App feels 50% more polished, users can present professionally

---

### Sprint 2: Power Features (6hrs)
5. ✅ Theme editor drawer
6. ✅ Save favorite themes
7. ✅ AI graph generation
8. ✅ Intro modal

**Result**: Core value prop complete, users can customize everything

---

### Sprint 3: Polish & Discovery (5hrs)
9. ✅ Smart theme randomizer
10. ✅ Redesigned index page
11. ✅ AI theme generator (if time allows)

**Result**: Shippable product with personality and pro features

---

## Technical Notes

### Gemini API Requirements
- **Flash 2.5 Experimental** supports Imagen 3 Fast (text-to-image)
- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:generateImages`
- Graph generation prompt template:
  ```
  Create a [landscape/portrait] graph showing [description].
  Style: Risograph print aesthetic.
  Color palette: [inject theme colors from JSON].
  Clean, minimal, data-focused.
  ```

### LocalStorage Schema
```javascript
// Saved themes
{
  "slideomatic_themes": [
    { "name": "Sunset Vibes", "theme": {...} },
    { "name": "Corporate Blue", "theme": {...} }
  ],
  "slideomatic_decks": [
    { "name": "Q4 Review", "slides": [...], "theme": {...} }
  ]
}
```

### Theme Randomizer Constraints
- Minimum contrast ratio: 4.5:1 (WCAG AA)
- Palette types: monochromatic, analogous, triadic, complementary
- Avoid: pure black/white combos, neon overload
- Reference: `juicy_themes` color generation algorithms

---

## Completed (Post-Sprint)

- ✅ **AI Starter Deck Generation** — Cheat console (IDDQD/IDKFA/ABRACADABRA) generates 8-slide research springboard decks with real links, discussion questions, and presenter notes
- ✅ **Auto Image Generation for Decks** — After starter deck creation, AI generates images for all slides with empty image slots
- ✅ **AI Image Generation in Edit Drawer** — `✨` button on empty image slots triggers Gemini to search or generate illustrations
- ✅ **Landing Page Tightened** — Removed 100vh hero, compressed spacing so demo decks are visible faster
- ✅ **Design Resources Deck Cleanup** — Removed 7 broken links, replaced with working alternatives, reordered for better flow

## Next Steps

1. **PWA setup** — manifest.json, service worker, icons, Apple meta tags for home screen install
2. **Mobile testing** — verify starter deck flow and image generation on phone/tablet
3. **Test AI features end-to-end** — verify cheat console, image gen, and voice features with live Gemini API key

---

*Let's ship this with personality and soul* 🎸
