# Slide-o-Matic Architecture

**Status:** Modular, post-refactor (January 2025)
**Philosophy:** Compression over complexity. Each module does one thing well.

---

## 🏗️ System Overview

Slide-o-Matic is a **vanilla JavaScript** presentation engine with voice AI, drag-drop editing, and theme management. The codebase is organized into focused modules that handle specific concerns, coordinated by `main.js`.

**Core principle:** `main.js` is the conductor, modules are the orchestra.

---

## 📁 Module Map

### Core Orchestration

#### `main.js` (3,590 lines)
**Purpose:** Application coordinator and presentation runtime

**Responsibilities:**
- Slide rendering (title, standard, quote, split, grid, pillars, gallery, typeface, image, graph)
- Navigation (keyboard + overview mode)
- Deck loading/saving (JSON import/export)
- Autolinks and lazy image loading
- Module initialization and context wiring

**Key exports:** None (entry point)

**Imports from:**
- `modules/theme-manager.js` - Theme operations
- `modules/voice-modes.js` - Voice recording
- `modules/keyboard-nav.js` - Keyboard shortcuts
- `modules/edit-drawer.js` - Slide editing UI
- `modules/drawer-base.js` - Drawer behaviors
- `modules/image-manager.js` - Image operations (via edit-drawer)
- `modules/base64-tokens.js` - JSON readability
- `modules/utils.js` - Shared utilities

**Context it provides:**
```javascript
{
  getCurrentIndex, getSlides, insertSlideAt, replaceSlideAt,
  setActiveSlide, updateSlide, validateSlides,
  showHudStatus, hideHudStatus, downloadDeck, downloadTheme,
  toggleOverview, exitOverview, moveOverviewCursorBy,
  toggleEditDrawer, toggleThemeDrawer,
  openSettingsModal, closeSettingsModal
}
```

---

### Feature Modules

#### `modules/voice-modes.js` (667 lines)
**Purpose:** Voice recording and AI slide/theme generation

**Responsibilities:**
- Microphone access and MediaRecorder management
- Audio blob → base64 conversion
- Gemini API integration (slide generation, theme generation, slide editing)
- Voice UI state (recording, processing, idle)
- API key storage and validation

**Key exports:**
```javascript
initVoiceButtons(context)      // Setup voice buttons
toggleVoiceRecording(mode)     // Start/stop recording ('add' or 'edit')
processVoiceToSlide(audioBlob) // Generate slide from audio
processVoiceToTheme(audioBlob) // Generate theme from audio
getGeminiApiKey()              // Retrieve API key
STORAGE_KEY_API                // localStorage key constant
```

**Dependencies:**
- `theme-manager.js` (applies generated themes)

**Used by:** `main.js`

**Voice button modes:**
- `'add'` - Create new slide after current
- `'edit'` - Modify current slide in-place

---

#### `modules/keyboard-nav.js` (215 lines)
**Purpose:** Centralized keyboard shortcut handling

**Responsibilities:**
- Global keydown listener
- Input field detection (skip shortcuts in text fields)
- Arrow key navigation (slides + overview mode)
- Shortcut dispatch to context callbacks
- Visual key feedback (flash on keypress)

**Key exports:**
```javascript
initKeyboardNav(context) // Setup keyboard handlers, returns cleanup function
```

**Keyboard shortcuts handled:**
- `←/→` - Previous/Next slide
- `Space` - Next slide
- `Home/End` - First/Last slide
- `O` - Toggle overview
- `I` - Toggle slide index
- `E` - Edit current slide
- `V` - Voice add slide
- `T` - Theme drawer
- `D` - Download deck
- `U` - Upload deck
- `N` - Speaker notes
- `S` - Settings
- `Escape` - Close modals/overview

**Dependencies:** None (pure context-based)

**Used by:** `main.js`

---

#### `modules/theme-manager.js` (295 lines)
**Purpose:** Theme loading, validation, and localStorage persistence

**Responsibilities:**
- Fetch and parse theme JSON
- Apply CSS custom properties to document root
- Normalize theme tokens (fill missing with defaults)
- Theme library (save/load/delete from localStorage)
- WCAG contrast checking
- Color parsing (hex, rgb, rgba via canvas)

**Key exports:**
```javascript
loadTheme(path)                      // Fetch and normalize theme
applyTheme(themeData)                // Apply tokens to DOM
validateTheme(theme)                 // Check for required tokens
saveThemeToLibrary(name, theme)      // Persist to localStorage
loadThemeLibrary()                   // Get saved themes
deleteThemeFromLibrary(name)         // Remove saved theme
getCurrentTheme()                    // Get active theme object
setCurrentTheme(theme, options)      // Set and persist theme
getCurrentThemePath()                // Get theme source path
checkContrast(fg, bg)                // WCAG contrast ratio
normalizeThemeTokens(theme)          // Fill missing tokens
LOCAL_THEME_SOURCE                   // Constant for local themes
```

**Required theme tokens:**
```javascript
color-bg, background-surface, background-overlay, background-opacity,
slide-bg, slide-border-color, slide-border-width, slide-shadow,
color-surface, color-surface-alt, color-accent,
badge-bg, badge-color, color-ink, color-muted,
border-width, gutter, radius,
font-sans, font-mono,
shadow-sm, shadow-md, shadow-lg, shadow-xl
```

**Dependencies:** None (self-contained)

**Used by:** `main.js`, `voice-modes.js`

---

#### `modules/edit-drawer.js` (376 lines)
**Purpose:** Slide editing UI and JSON synchronization

**Responsibilities:**
- Build quick-edit form fields based on slide type
- Sync quick-edit inputs → JSON textarea
- Generate image manager UI (delegated to image-manager.js)
- Save edited slide to deck
- Duplicate current slide
- Template insertion

**Key exports:**
```javascript
renderEditForm(context) // Build and render edit drawer contents
```

**Quick-edit fields by slide type:**
- `title` - eyebrow, title, subtitle
- `quote` - quote, attribution
- `standard/gallery/grid` - headline, body
- All types - Image manager (if images present)

**Dependencies:**
- `drawer-base.js` (drawer lifecycle)
- `image-manager.js` (image UI + operations)
- `base64-tokens.js` (prepare/restore slides)
- `utils.js` (formatBytes, escapeHtml)

**Used by:** `main.js`

---

#### `modules/image-manager.js` (256 lines)
**Purpose:** Image path collection, removal, and reordering

**Responsibilities:**
- Collect images from nested slide structures (media, items, pillars, split, etc.)
- Build image list UI for edit drawer
- Remove images by index (pure function, returns modified slide)
- Reorder images via drag-drop (pure function, swaps images)
- Setup remove button and drag-drop event handlers

**Key exports:**
```javascript
collectSlideImages(slide)                          // Flat array of image objects
collectImagePaths(slide)                           // Array of {path, image} entries
removeImageByIndex(imageIndex, slide)              // Pure: returns new slide
reorderSlideImages(fromIndex, toIndex, slide)      // Pure: returns new slide
buildImageManager(slide)                           // HTML string for image list
setupImageRemoveButtons({root, onRemove})          // Bind × button events
setupImageDragReorder({container, onReorder})      // Bind drag events
```

**Image path handling:**
Single source of truth via `collectImagePaths()`:
- `slide.image`
- `slide.media[].image`
- `slide.items[].image`
- `slide.left.image`, `slide.right.image`
- `slide.pillars[].image`

**Dependencies:**
- `utils.js` (formatBytes, escapeHtml)

**Used by:** `edit-drawer.js`, `main.js`

---

#### `modules/drawer-base.js` (163 lines)
**Purpose:** Shared drawer behavior (open/close/focus management)

**Responsibilities:**
- Drawer factory (`createDrawer`)
- Open/close animations
- Focus trap (tab key management)
- Focusable element detection
- Keyboard accessibility (Escape to close)

**Key exports:**
```javascript
createDrawer(config)               // Factory: returns drawer instance
openDrawer(drawer)                 // Open with animation + focus
closeDrawer(drawer)                // Close and restore focus
trapFocus(event, container)        // Handle Tab key in modal
getFocusableElements(container)    // Query focusable elements
focusFirstElement(container)       // Focus first interactive element
```

**Drawer config:**
```javascript
{
  id: 'drawer-id',
  side: 'left' | 'right',
  onOpen: () => {},     // Callback after open
  onClose: () => {},    // Callback after close
  trapFocus: true       // Enable tab trapping
}
```

**Dependencies:** None

**Used by:** `main.js` (edit drawer, theme drawer)

---

### Utility Modules

#### `modules/base64-tokens.js` (155 lines)
**Purpose:** Convert base64 images ↔ readable tokens for JSON editing

**Responsibilities:**
- Create human-readable tokens (`{{BASE64_IMAGE: filename, 576KB}}`)
- Detect token strings in JSON
- Replace all images in slide with tokens (for editing)
- Restore base64 data from tokens (after editing)
- Handle nested image locations

**Key exports:**
```javascript
createBase64Token(imageData)                      // Generate token string
isBase64Token(str)                                // Check if string is token
prepareSlideForEditing(slide)                     // Deep clone + replace images
restoreBase64FromTokens(editedSlide, originalSlide) // Restore base64 data
formatBytes(bytes)                                // File size formatting
```

**Token format:**
```javascript
// Before: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAA..."
// After:  "{{BASE64_IMAGE: screenshot.png, 576KB}}"
```

**Dependencies:** None

**Used by:** `edit-drawer.js`, `main.js`

---

#### `modules/utils.js` (68 lines)
**Purpose:** Shared utility functions

**Key exports:**
```javascript
formatBytes(bytes)       // Format file sizes (KB, MB, etc)
clamp(value, min, max)   // Constrain value to range
escapeHtml(str)          // Escape HTML entities
```

**Dependencies:** None

**Used by:** Multiple modules

---

### Supporting Files

#### `slide-index.js`
**Purpose:** Slide navigation sidebar (mini overview)

**Not part of refactor** - Existed before, imported by main.js

---

#### `lazy-images.js`
**Purpose:** Intersection Observer for lazy image loading

**Not part of refactor** - Existed before, imported by main.js

---

## 🔄 Data Flow

### Slide Editing Flow
```
User presses E
  → main.js calls openDrawer(editDrawerInstance)
  → edit-drawer.js renderEditForm(context)
    → base64-tokens.js prepareSlideForEditing(slide)
    → image-manager.js buildImageManager(slide)
    → image-manager.js setupImageRemoveButtons({root, onRemove})
  → User edits fields, clicks Save
  → edit-drawer.js syncQuickEditToJSON()
  → base64-tokens.js restoreBase64FromTokens(edited, original)
  → main.js replaceSlideAt(index)
```

### Voice-to-Slide Flow
```
User presses V (or clicks Add button)
  → keyboard-nav.js dispatches to context.toggleVoiceRecording('add')
  → voice-modes.js toggleVoiceRecording('add')
  → MediaRecorder starts, updates UI
  → User speaks, clicks Stop
  → voice-modes.js processVoiceToSlide(audioBlob)
    → Converts blob → base64
    → Calls Gemini API with prompt
    → Parses JSON response
    → context.insertSlideAt(index, slideData)
  → main.js renders new slide, updates HUD
```

### Theme Loading Flow
```
User selects theme from dropdown
  → main.js calls loadTheme(path)
  → theme-manager.js fetches JSON
  → theme-manager.js normalizeThemeTokens(theme)
  → theme-manager.js applyTheme(normalizedTheme)
    → Sets CSS custom properties on document.documentElement
  → theme-manager.js setCurrentTheme(theme, {source: path})
    → Saves to localStorage
```

---

## 🧩 Context Pattern

Modules don't directly manipulate DOM or global state. Instead, `main.js` passes **context objects** with callback functions:

### Voice Context
```javascript
{
  getCurrentIndex: () => number,
  getSlides: () => Slide[],
  insertSlideAt: (index, slide, options) => void,
  replaceSlideAt: (index) => void,
  updateSlide: (index, slide) => void,
  validateSlides: (slides) => void,
  showHudStatus: (message, type) => void,
  hideHudStatus: () => void,
  openSettingsModal: () => void,
  downloadTheme: (theme) => void
}
```

### Keyboard Context
```javascript
{
  isOverview: () => boolean,
  moveOverviewCursorBy: (dx, dy) => void,
  exitOverview: (index?) => void,
  toggleOverview: () => void,
  toggleEditDrawer: () => void,
  toggleVoiceRecording: (mode) => void,
  toggleThemeDrawer: () => void,
  setActiveSlide: (index) => void,
  getCurrentIndex: () => number,
  getSlideCount: () => number,
  downloadDeck: () => void,
  triggerDeckUpload: () => void,
  openSettingsModal: () => void,
  closeSettingsModal: () => void
}
```

**Why context objects?**
- No globals needed
- Easy to test (mock the context)
- Clear dependencies
- Modules stay pure

---

## 📊 Dependency Graph

```
main.js
├── theme-manager.js (self-contained)
├── utils.js (self-contained)
├── base64-tokens.js (self-contained)
├── keyboard-nav.js (self-contained)
├── voice-modes.js
│   └── theme-manager.js
├── drawer-base.js (self-contained)
├── image-manager.js
│   └── utils.js
└── edit-drawer.js
    ├── drawer-base.js
    ├── image-manager.js
    ├── base64-tokens.js
    └── utils.js
```

**No circular dependencies** ✅

---

## 🎯 Adding New Features

### Want to add a new slide type?
1. Add renderer to `main.js` (e.g., `renderMySlideType()`)
2. Register in `renderers` object
3. Add template to `getSlideTemplate()` if needed
4. Update `buildQuickEditFields()` in `edit-drawer.js` for custom fields
5. Update `collectImagePaths()` in `image-manager.js` if it has images

### Want to add a new keyboard shortcut?
1. Edit `modules/keyboard-nav.js`
2. Add key handler in `keydownHandler` function
3. Add callback to context object in `main.js` (if new behavior needed)

### Want to add a new voice feature?
1. Edit `modules/voice-modes.js`
2. Add prompt builder (e.g., `buildMyPrompt()`)
3. Add processor (e.g., `processVoiceToX()`)
4. Expose via exported function

### Want to add theme validation rules?
1. Edit `modules/theme-manager.js`
2. Update `REQUIRED_THEME_TOKENS`
3. Add logic to `validateTheme()` or `normalizeThemeTokens()`

---

## 🧪 Testing Strategy

**Current state:** No automated tests

**Recommended approach:**
1. **Integration testing** - Test main.js interactions (keyboard nav, slide creation)
2. **Unit testing** - Test pure functions first:
   - `collectImagePaths()` in image-manager.js
   - `normalizeThemeTokens()` in theme-manager.js
   - `prepareSlideForEditing()` in base64-tokens.js
3. **E2E testing** - Playwright/Cypress for voice recording flows

**Test when:**
- Users find bugs (write test to prevent regression)
- Adding complex features (test edge cases)
- Before major refactors (ensure behavior preserved)

---

## 📈 Codebase Metrics

| Metric | Value |
|--------|-------|
| Total lines | 5,785 |
| Main.js | 3,590 (62%) |
| Modules | 2,195 (38%) |
| Module count | 8 |
| Avg module size | 274 lines |
| Largest module | voice-modes.js (667 lines) |
| Smallest module | utils.js (68 lines) |
| Import statements | 9 |

**Compared to pre-refactor:**
- Main.js reduced by **32.8%** (5,344 → 3,590 lines)
- Total codebase grew by **8.2%** (overhead from module headers + exports)

---

## 🚀 Deployment Notes

**Browser requirements:**
- ES6 modules (import/export)
- MediaRecorder API (for voice features)
- IntersectionObserver (for lazy images)
- CSS custom properties

**Graceful degradation:**
- Voice features require MediaRecorder (fallback: disable buttons)
- Lazy images fallback to eager loading if IntersectionObserver missing

**Build process:**
None. Vanilla JS, no transpilation, no bundling. Deploy as-is.

---

## 🔮 Future Improvements

**Considered but deferred:**
- **Boot functions** - Wrap init logic (e.g., `bootKeyboardNav()`)
- **Unit tests** - Test pure functions in isolation
- **Theme contrast validator** - CLI/UI tool using `checkContrast()`
- **Module lazy loading** - Load voice-modes.js only when needed
- **Service worker** - Offline support for presentation mode

**Why deferred:** Ship first, optimize based on user feedback.

---

## 📚 Related Documentation

- `README.md` - User-facing features and setup
- `TODO.md` - Feature roadmap and priorities
- `REFACTOR_PROMPT.md` - Original refactor spec
- `VOICE_TO_SLIDE.md` - Voice feature documentation
- `SCHEMA_EXAMPLE.json` - Slide schema reference

---

**Last updated:** January 2025
**Contributors:** Pablo (pibulus) + Claude Code + Codex
**Philosophy:** Make it work, make it right, make it fast — in that order.
