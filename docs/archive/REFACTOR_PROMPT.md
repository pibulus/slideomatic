# Slide-o-Matic Refactor: Compression & Modularity Pass

## Context
You're working on Slide-o-Matic, a vanilla JS presentation engine with voice AI, drag-drop editing, and theme management. The app works great but main.js has grown to 5.3k lines and has clear module boundaries waiting to be extracted. This refactor is about **compression, clarity, and future-proofing** — not fixing bugs.

## Current State
- **main.js**: 5344 lines, 176 functions, zero tech debt markers
- **Architecture**: Vanilla JS, no frameworks, progressive enhancement
- **Key systems**: Base64 token editing, path-based image handling, drawer UI, voice modes, theme management
- **Pain points**:
  - Image path logic duplicated in 4+ places
  - Theme management code scattered throughout main.js
  - Voice features mixed with core presentation logic
  - Drawer patterns repeated (edit drawer, theme drawer)

## Goal
Extract logical modules from main.js into separate files that are:
1. **Self-contained** - Clear inputs/outputs, no hidden dependencies
2. **Reusable** - Shared utilities don't duplicate logic
3. **Maintainable** - Future devs can understand boundaries at a glance
4. **Zero behavior change** - Everything works exactly the same after refactor

## Proposed Module Structure

### Core Modules (Extract from main.js)

#### 1. `modules/image-manager.js` (~250 lines)
**Purpose**: All image path collection, manipulation, and UI management

**Extract these functions**:
- `collectSlideImages(slide)` - Returns flat array of images
- `collectImagePaths(slide)` - NEW - Returns array of `{ path: [], image: {} }` objects
- `removeImageByIndex(imageIndex, currentSlide)` - Pure function, returns modified slide
- `reorderSlideImages(fromIndex, toIndex, currentSlide)` - Pure function, returns modified slide
- `buildImageManager(slide)` - HTML generation for image list
- `setupImageRemoveButtons()` - Event binding
- `setupImageDragReorder()` - Event binding
- `getDragAfterElement(container, y)` - Drag utility

**Exports**:
```javascript
export {
  collectSlideImages,
  collectImagePaths,
  removeImageByIndex,
  reorderSlideImages,
  buildImageManager,
  setupImageRemoveButtons,
  setupImageDragReorder
};
```

**Key improvement**: Create `collectImagePaths()` that's used by BOTH remove and reorder logic. DRY principle.

---

#### 2. `modules/theme-manager.js` (~300 lines)
**Purpose**: Theme loading, validation, localStorage persistence, contrast checking

**Extract these functions**:
- `loadTheme(themePath)` - Async theme loading
- `applyTheme(themeData)` - Applies theme tokens to document
- `validateTheme(themeData)` - Checks for required tokens
- `normalizeThemeTokens(theme)` - From theme-utils.js, move here
- `saveThemeToLibrary(name, theme)` - localStorage save
- `loadThemeLibrary()` - Returns array of saved themes
- `deleteThemeFromLibrary(name)` - Remove saved theme
- `getCurrentTheme()` - Returns active theme object
- `checkContrast(fg, bg)` - WCAG contrast checking
- All theme library localStorage constants

**Exports**:
```javascript
export {
  loadTheme,
  applyTheme,
  validateTheme,
  saveThemeToLibrary,
  loadThemeLibrary,
  deleteThemeFromLibrary,
  getCurrentTheme,
  checkContrast
};
```

**Key improvement**: Theme state becomes self-contained. main.js just calls `loadTheme()` and `applyTheme()`.

---

#### 3. `modules/voice-modes.js` (~350 lines)
**Purpose**: All voice recording, AI generation (slides + themes), Gemini API integration

**Extract these functions**:
- `initVoiceButtons()` - Setup voice UI
- `startVoiceRecording(mode)` - 'slide' or 'theme'
- `stopVoiceRecording()` - Stop and process
- `processVoiceToSlide(audioBlob)` - Gemini API for slide generation
- `processVoiceToTheme(audioBlob)` - Gemini API for theme generation
- `transcribeAudio(audioBlob)` - Audio to text
- `generateSlideFromText(text)` - Text to slide JSON
- `generateThemeFromText(text)` - Text to theme JSON
- All voice UI state management
- All Gemini API constants/config

**Exports**:
```javascript
export {
  initVoiceButtons,
  startVoiceRecording,
  stopVoiceRecording,
  processVoiceToSlide,
  processVoiceToTheme
};
```

**Key improvement**: Voice features completely isolated. Can be disabled/swapped without touching main.js.

---

#### 4. `modules/base64-tokens.js` (~150 lines)
**Purpose**: Base64 ↔ token conversion for readable JSON editing

**Extract these functions**:
- `createBase64Token(imageData)` - Generate token string
- `isBase64Token(str)` - Check if string is token
- `replaceBase64WithToken(imageObj)` - Convert image object
- `prepareSlideForEditing(slide)` - Deep clone + replace all images
- `restoreBase64InImage(editedImage, originalImage)` - Restore single image
- `restoreBase64FromTokens(editedSlide, originalSlide)` - Restore all images
- `formatBytes(bytes)` - File size utility

**Exports**:
```javascript
export {
  createBase64Token,
  isBase64Token,
  prepareSlideForEditing,
  restoreBase64FromTokens,
  formatBytes
};
```

**Key improvement**: Token system is self-documenting and testable.

---

#### 5. `modules/drawer-base.js` (~150 lines)
**Purpose**: Shared drawer behavior (open/close/focus/keyboard)

**Extract these functions**:
- `createDrawer(config)` - Factory for drawer instances
  - Config: `{ id, side: 'left'|'right', onOpen, onClose, trapFocus: true }`
- `openDrawer(drawer)` - Generic open with animation
- `closeDrawer(drawer)` - Generic close with cleanup
- `trapFocus(event, container)` - Shared focus trap
- `getFocusableElements(container)` - Shared utility
- `focusFirstElement(container)` - Shared utility

**Exports**:
```javascript
export {
  createDrawer,
  openDrawer,
  closeDrawer,
  trapFocus,
  getFocusableElements,
  focusFirstElement
};
```

**Key improvement**: Edit drawer and theme drawer share code. Easy to add new drawers (speaker notes, settings, etc).

---

#### 6. `modules/edit-drawer.js` (~200 lines)
**Purpose**: Edit drawer specific logic (quick-edit fields, JSON sync, save)

**Extract these functions**:
- `renderEditForm(currentSlide, currentIndex)` - Build drawer HTML
- `buildQuickEditFields(slide)` - Generate quick-edit UI
- `buildTextField(id, label, value)` - Form field builder
- `buildTextArea(id, label, value)` - Form field builder
- `setupQuickEditSync()` - Bind input handlers
- `syncQuickEditToJSON()` - Form → JSON sync
- `saveCurrentSlide()` - Save edited slide
- `duplicateCurrentSlide()` - Clone slide

**Depends on**:
- `drawer-base.js` for open/close
- `image-manager.js` for image list UI
- `base64-tokens.js` for prepare/restore

**Exports**:
```javascript
export {
  renderEditForm,
  saveCurrentSlide,
  duplicateCurrentSlide
};
```

---

#### 7. `modules/keyboard-nav.js` (~100 lines)
**Purpose**: All keyboard shortcut handling

**Extract these functions**:
- `initKeyboardNav(callbacks)` - Setup all keyboard handlers
- `handleKeydown(event, state)` - Main keyboard dispatcher
- Individual key handlers (arrow keys, O, V, T, E, D, U, etc)

**Exports**:
```javascript
export {
  initKeyboardNav
};
```

**Key improvement**: Keyboard shortcuts documented in one place, easy to customize.

---

## Implementation Plan

### Step 1: Create module files with exports (no-op first)
1. Create `modules/` directory
2. Create each `.js` file with empty exports
3. Import all modules in main.js (verify no errors)

### Step 2: Extract pure functions first (low risk)
1. Start with `base64-tokens.js` (no side effects)
2. Move functions, test that slide editing still works
3. Then `image-manager.js` (mostly pure functions)
4. Test drag-drop and remove buttons

### Step 3: Extract stateful modules (careful)
1. `theme-manager.js` - Test theme switching
2. `voice-modes.js` - Test voice recording
3. `drawer-base.js` - Abstract shared drawer logic
4. `edit-drawer.js` - Refactor to use drawer-base
5. `keyboard-nav.js` - Extract last (touches everything)

### Step 4: Consolidate utilities
1. Create `modules/utils.js` for shared helpers:
   - `clamp(value, min, max)`
   - `formatBytes(bytes)`
   - `escapeHtml(str)`
   - Any other small utilities

### Step 5: Update main.js imports
```javascript
// At top of main.js
import { loadTheme, applyTheme, saveThemeToLibrary } from './modules/theme-manager.js';
import { prepareSlideForEditing, restoreBase64FromTokens } from './modules/base64-tokens.js';
import { collectSlideImages, setupImageRemoveButtons, setupImageDragReorder } from './modules/image-manager.js';
import { initVoiceButtons, processVoiceToSlide, processVoiceToTheme } from './modules/voice-modes.js';
import { renderEditForm, saveCurrentSlide, duplicateCurrentSlide } from './modules/edit-drawer.js';
import { initKeyboardNav } from './modules/keyboard-nav.js';
```

### Step 6: Test everything
- [ ] Slide navigation (arrows, home, end)
- [ ] Overview mode (O key)
- [ ] Voice to slide (V key)
- [ ] Voice to theme (T key)
- [ ] Edit drawer (E key) with quick-edit fields
- [ ] Image remove buttons
- [ ] Image drag-reorder
- [ ] Theme switching
- [ ] Theme library (save/load from localStorage)
- [ ] Slide duplication
- [ ] Deck download/upload
- [ ] All keyboard shortcuts

---

## Critical Rules

### 1. **No Behavior Changes**
Every feature must work identically before and after. This is pure refactor.

### 2. **Pure Functions Where Possible**
Make functions take inputs and return outputs. Example:
```javascript
// ❌ Bad (mutates global state)
function removeImageByIndex(imageIndex) {
  slides[currentIndex] = modifiedSlide;
}

// ✅ Good (pure function)
function removeImageByIndex(imageIndex, slide) {
  return modifiedSlide;
}
```

### 3. **Single Responsibility**
Each module should do ONE thing. If a module feels like it does two things, split it.

### 4. **Dependency Direction**
- `main.js` imports from modules (never the reverse)
- Modules can import from other modules (image-manager.js can import base64-tokens.js)
- Avoid circular dependencies

### 5. **Preserve Code Style**
- Epic comment dividers (`// ===...`)
- camelCase function names
- Descriptive variable names
- No emojis in code comments (only in user-facing strings)

### 6. **Document Module Boundaries**
Add a header comment to each module:
```javascript
// ═══════════════════════════════════════════════════════════════════════════
// Image Manager Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Handles all image operations:
// - Collecting images from nested slide structures
// - Removing images by index
// - Reordering images via drag-drop
// - Generating image manager UI
//
// Dependencies: base64-tokens.js (for image metadata)
// Used by: edit-drawer.js, main.js
//
// ═══════════════════════════════════════════════════════════════════════════
```

---

## Success Criteria

After refactor, we should have:
- ✅ **main.js under 3000 lines** (from 5344)
- ✅ **7-8 focused modules** in `modules/` directory
- ✅ **Zero behavior changes** - everything works the same
- ✅ **Shared logic consolidated** - Image path collection happens once
- ✅ **Clear separation of concerns** - Easy to find/modify features
- ✅ **Future-proof** - Adding new slide types or features is easier
- ✅ **Easy to understand** - New devs can grok the structure quickly

---

## Final Notes

This is a **compression pass**, not a rewrite. The goal is to make the codebase:
1. **Easier to navigate** - "Where's the voice code?" → `modules/voice-modes.js`
2. **Easier to test** - Pure functions can be tested in isolation
3. **Easier to extend** - Adding new features doesn't bloat main.js
4. **Easier to maintain** - Module boundaries are obvious

The app already works great. This refactor is about **celebrating that success** by making it elegant under the hood, not fixing problems.

Think of it like cleaning up after a great jam session — the music was fire, now we're just organizing the cables so the next session is even better.

**Ship this refactor, then we can commit both physically and metaphysically.** 🎸✨
