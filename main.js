import {
  loadTheme,
  applyTheme,
  validateTheme,
  saveThemeToLibrary,
  loadThemeLibrary,
  deleteThemeFromLibrary,
  getCurrentTheme,
  setCurrentTheme,
  getCurrentThemePath,
  checkContrast,
  LOCAL_THEME_SOURCE,
  normalizeThemeTokens,
} from './modules/theme-manager.js';
import { formatBytes, clamp, fileToBase64, escapeHtml, safeParse, deriveDeckName, deepClone } from './modules/utils.js';
import { showHudStatus, hideHudStatus } from './modules/hud.js';
import { prepareSlideForEditing, restoreBase64FromTokens } from './modules/base64-tokens.js';
import { registerLazyImage, loadLazyImage } from './lazy-images.js';
import { renderEditForm } from './modules/edit-drawer.js';
import {
  createDrawer,
  openDrawer,
  closeDrawer,
} from './modules/drawer-base.js';
import {
  initVoiceButtons,
  toggleVoiceRecording,
  getGeminiApiKey,
  STORAGE_KEY_API,
} from './modules/voice-modes.js';
import { initKeyboardNav } from './modules/keyboard-nav.js';
import {
  openSettingsModal,
  closeSettingsModal,
  showApiKeyStatus,
} from './modules/settings-modal.js';
import {
  initSlideIndex,
  toggleSlideIndex,
  closeSlideIndex,
  refreshSlideIndex,
  updateSlideIndexHighlight,
} from './slide-index.js';
import {
  loadSlides,
  persistSlides,
  generateDeckId,
  registerDeckPersistenceHooks,
} from './modules/deck-persistence.js';
import { slidesRoot, currentCounter, totalCounter, progressBar } from './modules/dom-refs.js';
import {
  insertSlideAt,
  removeSlideAt,
  replaceSlideAt,
  downloadDeck,
  handleDeckUpload,
  reloadDeck,
  registerSlideActionHooks,
} from './modules/slide-actions.js';
import {
  initThemeDrawer,
  toggleThemeDrawer,
  openThemeDrawer,
  closeThemeDrawer,
  syncThemeSelectUI,
} from './modules/theme-drawer.js';
import {
  slides,
  setSlides,
  slideElements,
  setSlideElements,
  currentIndex,
  setCurrentIndex,
  isOverview,
  setOverview,
  autoLinkConfigs,
  setAutoLinkConfigs,
  overviewRowCount,
  setOverviewRowCount,
  overviewColumnCount,
  setOverviewColumnCount,
  overviewCursor,
  setOverviewCursor,
  lastOverviewHighlight,
  setLastOverviewHighlight,
  isThemeDrawerOpen,
  setThemeDrawerOpen,
  themeDrawerInstance,
  setThemeDrawerInstance,
  slideScrollPositions,
  DECK_STORAGE_PREFIX,
  LAST_DECK_KEY,
  deckStorageKey,
  setDeckStorageKey,
  deckPersistFailureNotified,
  setDeckPersistFailureNotified,
  activeDeckId,
  setActiveDeckId,
  isNewDeckRequest,
  setNewDeckRequest,
  isEditDrawerOpen,
  setEditDrawerOpen,
  editDrawerInstance,
  setEditDrawerInstance,
} from './modules/state.js';
import {
  registerNavigationHooks,
  toggleOverview,
  enterOverview,
  exitOverview,
  updateOverviewButton,
  updateOverviewLayout,
  highlightOverviewSlide,
  moveOverviewCursorBy,
  handleResize,
  setActiveSlide,
  updateTotalCounter,
  updateHud,
  handleSlideClick,
} from './modules/navigation.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  DEBUG: false, // Set to true to enable debug logging

  // Image handling
  IMAGE: {
    MAX_BYTES: 2 * 1024 * 1024,        // 2MB maximum file size
    TARGET_BYTES: 900 * 1024,          // 900KB target for compression
    DIMENSION_STEPS: [1920, 1600, 1440, 1280, 1024, 800],
    QUALITY_STEPS: [0.82, 0.72, 0.62, 0.54, 0.46, 0.38],
  },

  // Auto-save (handled in edit-drawer module)
  AUTO_SAVE_DELAY_MS: 1000,

  // Overview mode
  OVERVIEW: {
    MAX_ROWS: 3,
  },
};

// Backward compatibility - keep original constants for now
const DEBUG = CONFIG.DEBUG;
const MAX_IMAGE_BYTES = CONFIG.IMAGE.MAX_BYTES;
const TARGET_IMAGE_BYTES = CONFIG.IMAGE.TARGET_BYTES;

// Helper for debug logging
const debug = (...args) => CONFIG.DEBUG && console.log('[Slideomatic]', ...args);

// ═══════════════════════════════════════════════════════════════════════════
// DOM REFERENCES
// ═══════════════════════════════════════════════════════════════════════════

const urlParams = new URLSearchParams(window.location.search);
// Also check hash params (for servers that strip query strings)
const hashParams = new URLSearchParams(window.location.hash.slice(1));

// Helper to get param from search OR hash
function getParam(name) {
  return urlParams.get(name) || hashParams.get(name);
}

const requestedDeck = getParam('deck');
console.log('[Init] ==================== DECK.HTML LOADING ====================');
console.log('[Init] Full URL:', window.location.href);
console.log('[Init] Search params:', window.location.search);
console.log('[Init] Hash:', window.location.hash);
console.log('[Init] Requested deck (from search):', urlParams.get('deck'));
console.log('[Init] Requested deck (from hash):', hashParams.get('deck'));
console.log('[Init] Final requested deck:', requestedDeck);
console.log('[Init] =========================================================');

const renderers = {
  title: renderTitleSlide,
  standard: renderStandardSlide,
  quote: renderQuoteSlide,
  split: renderSplitSlide,
  grid: renderGridSlide,
  pillars: renderPillarsSlide,
  gallery: renderGallerySlide,
  typeface: renderTypefaceSlide,
  image: renderImageSlide,
  graph: renderGraphSlide,
};

registerDeckPersistenceHooks({
  getParam,
  showHudStatus,
  hideHudStatus,
  showSaveStatus,
  updateDeckNameDisplay,
  getSlideTemplate,
  applySharedTheme: applySharedThemeFromShare,
});

registerNavigationHooks({
  closeThemeDrawer,
  getEditDrawerContext,
  renderEditForm,
  toggleSpeakerNotes,
});

registerSlideActionHooks({
  showHudStatus,
  hideHudStatus,
  createSlide: (slide, index) => createSlide(slide, index, renderers),
  renderEmptyState,
});

function applySharedThemeFromShare(themeData) {
  if (!themeData || typeof themeData !== 'object') return;
  try {
    setCurrentTheme(themeData, { source: LOCAL_THEME_SOURCE });
    applyTheme(themeData);
    syncThemeSelectUI();
  } catch (error) {
    console.warn('Failed to apply shared theme payload', error);
  }
}

window.addEventListener('resize', handleResize);

// ═══════════════════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

if (requestedDeck) {
  if (requestedDeck === 'new') {
    setNewDeckRequest(true);
    setActiveDeckId(generateDeckId());
    setDeckStorageKey(null); // Clear cache so getDeckStorageKey() rebuilds with new ID
    console.log('[Init] New deck request, generated ID:', activeDeckId);
    urlParams.set('deck', activeDeckId);
    const nextSearch = urlParams.toString();
    const nextUrl = `${window.location.pathname}?${nextSearch}${window.location.hash ?? ''}`;
    if (window.history && typeof window.history.replaceState === 'function') {
      window.history.replaceState({}, '', nextUrl);
    }
  } else {
    setActiveDeckId(requestedDeck);
    setDeckStorageKey(null); // Clear cache so getDeckStorageKey() rebuilds with deck ID
    console.log('[Init] Loading existing deck, ID:', activeDeckId);
  }
}

// ================================================================
// Theme Library - localStorage persistence
// ================================================================


// ═══════════════════════════════════════════════════════════════════════════
// DECK INITIALIZATION & LOADING
// ═══════════════════════════════════════════════════════════════════════════
// Main entry point and deck setup orchestration
// ═══════════════════════════════════════════════════════════════════════════

let isInitializing = false;
let isInitialized = false;

if (!isInitializing && !isInitialized) {
  isInitializing = true;
  console.log('[Init] Starting initDeckWithTheme - FIRST TIME');
  initDeckWithTheme();
} else {
  console.warn('[Init] Attempted double initialization - BLOCKED');
}

// Note: Main initialization logic is in initDeckWithTheme() at bottom of file
// (old initDeck() removed to avoid duplication)

async function loadAndApplyTheme() {
  const params = new URLSearchParams(window.location.search);
  const themeParamProvided = params.has('theme');
  const storedTheme = getCurrentTheme();
  if (storedTheme && !themeParamProvided) {
    applyTheme(storedTheme);
    if (!getCurrentThemePath()) {
      setCurrentTheme(storedTheme, { source: LOCAL_THEME_SOURCE });
    }
    syncThemeSelectUI();
    return;
  }

  const themePath = resolveThemePath();
  try {
    const theme = await loadTheme(themePath);
    applyTheme(theme);
    setCurrentTheme(theme, { source: themePath });
    syncThemeSelectUI();
  } catch (error) {
    console.warn('Unable to load custom theme, using defaults.', error);
  }
}

function resolveThemePath() {
  const themeParam = getParam("theme");
  if (!themeParam) return "theme.json";
  if (themeParam.endsWith(".json")) {
    return themeParam;
  }
  if (themeParam.includes("/")) {
    return `${themeParam}.json`;
  }
  return `themes/${themeParam}.json`;
}

function initDeckName() {
  const deckNameEl = document.getElementById('deck-name');
  const deckNameText = document.getElementById('deck-name-text');
  if (!deckNameEl || !deckNameText) return;

  // Update deck name display
  updateDeckNameDisplay();

  // Click to rename
  deckNameEl.addEventListener('click', renameDeck);
}

function updateDeckNameDisplay() {
  const deckNameEl = document.getElementById('deck-name');
  const deckNameText = document.getElementById('deck-name-text');
  if (!deckNameText || !deckNameEl) return;

  let name = 'Untitled deck';

  if (activeDeckId) {
    // Get name from localStorage
    try {
      const key = `${DECK_STORAGE_PREFIX}${encodeURIComponent(activeDeckId)}`;
      const payload = JSON.parse(localStorage.getItem(key) || '{}');
      name = payload.meta?.name || deriveDeckName(slides);
    } catch (error) {
      name = deriveDeckName(slides);
    }
  } else {
    name = deriveDeckName(slides);
  }

  // Hide deck name if it's untitled
  if (name === 'Untitled deck') {
    deckNameEl.hidden = true;
  } else {
    deckNameEl.hidden = false;
    deckNameText.textContent = name;
  }

  document.title = `${name} — Slide-o-Matic`;
}

function renameDeck() {
  if (!activeDeckId) {
    showHudStatus('Save as copy first to rename', 'info');
    setTimeout(hideHudStatus, 2000);
    return;
  }

  const currentName = document.getElementById('deck-name-text')?.textContent || 'Untitled deck';
  const newName = window.prompt('Rename deck:', currentName);

  if (!newName || newName.trim() === '' || newName === currentName) return;

  try {
    const key = `${DECK_STORAGE_PREFIX}${encodeURIComponent(activeDeckId)}`;
    const payload = JSON.parse(localStorage.getItem(key) || '{}');
    payload.meta = {
      ...(payload.meta || {}),
      name: newName.trim(),
      updatedAt: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(payload));
    updateDeckNameDisplay();
    showHudStatus('✓ Deck renamed', 'success');
    setTimeout(hideHudStatus, 1500);
  } catch (error) {
    console.error('Failed to rename deck:', error);
    showHudStatus('⚠️ Unable to rename', 'error');
    setTimeout(hideHudStatus, 2000);
  }
}

let saveStatusTimeout = null;

function initSaveStatus() {
  // Save status is updated by showSaveStatus() function
}

function showSaveStatus(state = 'saved') {
  const saveStatus = document.getElementById('save-status');
  const saveText = saveStatus?.querySelector('.hud__save-text');
  if (!saveStatus || !saveText) return;

  clearTimeout(saveStatusTimeout);

  if (state === 'saving') {
    saveText.textContent = 'Saving...';
    saveStatus.setAttribute('data-state', 'saving');
    saveStatus.hidden = false;
  } else if (state === 'saved') {
    saveText.textContent = 'Saved';
    saveStatus.setAttribute('data-state', 'saved');
    saveStatus.hidden = false;

    // Auto-hide after 2 seconds
    saveStatusTimeout = setTimeout(() => {
      saveStatus.hidden = true;
      saveStatus.removeAttribute('data-state');
    }, 2000);
  }
}

// deriveDeckName() now imported from utils.js

async function loadAutoLinks() {
  try {
    const response = await fetch("autolinks.json", { cache: "no-store" });
    if (!response.ok) return;
    const links = await response.json();
    if (!Array.isArray(links)) return;
    autoLinkConfigs = links
      .filter((link) => Boolean(link?.term))
      .map((link) => ({
        term: link.term,
        search: link.search,
        url: link.url,
        urlTemplate: link.urlTemplate,
        openInNewTab: link.openInNewTab !== false,
        regex: new RegExp(escapeRegExp(link.term), "gi"),
      }));
  } catch (error) {
    console.warn("Unable to load autolinks.json", error);
    autoLinkConfigs = [];
  }
}

function renderLoadError(error) {
  const message = document.createElement("section");
  message.className = "slide slide--error is-active";
  message.innerHTML = `
    <h2>Unable to load slides</h2>
    <p>Please refresh the page or contact the deck owner.</p>
    ${error ? `<pre>${error.message}</pre>` : ""}
  `;
  slidesRoot.appendChild(message);
}

function renderEmptyState() {
  const message = document.createElement("section");
  message.className = "slide slide--empty is-active";
  message.innerHTML = `
    <h2>No slides available</h2>
    <p>Add slide data to <code>slides.json</code> to render this deck.</p>
  `;
  slidesRoot.appendChild(message);
}

function validateSlides(data) {
  if (!Array.isArray(data)) {
    throw new Error("Slides data must be an array.");
  }

  const allowedTypes = new Set([
    "title",
    "standard",
    "quote",
    "split",
    "grid",
    "pillars",
    "gallery",
    "graph",
    "typeface",
    "image",
    "_schema"  // Special type for documentation - ignored during render
  ]);

  data.forEach((slide, index) => {
    if (!slide || typeof slide !== "object") {
      throw new Error(`Slide ${index} is not an object.`);
    }

    const originalType = slide.type;
    const normalizedType =
      typeof originalType === "string" && originalType.trim()
        ? originalType.trim()
        : "standard";

    if (!allowedTypes.has(normalizedType)) {
      console.warn(
        `Slide ${index} has unsupported type "${normalizedType}". Falling back to "standard".`
      );
      slide.type = "standard";
    } else {
      slide.type = normalizedType;
    }

    if (slide.type === "split") {
      if (!slide.left || !slide.right) {
        throw new Error(`Slide ${index} (${slide.badge ?? slide.headline ?? "Split slide"}) is missing left/right content.`);
      }
    }

    if (slide.type === "pillars") {
      if (!Array.isArray(slide.pillars) || slide.pillars.length === 0) {
        throw new Error(`Slide ${index} (${slide.badge ?? slide.headline ?? "Pillars slide"}) requires a non-empty pillars array.`);
      }
    }

    if (slide.type === "gallery") {
      if (!Array.isArray(slide.items) || slide.items.length === 0) {
        throw new Error(`Slide ${index} (${slide.badge ?? slide.headline ?? "Gallery slide"}) requires a non-empty items array.`);
      }
    }

    if (slide.type === "image") {
      if (!slide.image || typeof slide.image !== "object" || !slide.image.src) {
        throw new Error(`Slide ${index} (${slide.badge ?? slide.headline ?? "Image slide"}) requires an image.src value.`);
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE CONSTRUCTION & DOM HELPERS
// ═══════════════════════════════════════════════════════════════════════════
// Functions for building slide DOM elements and sub-components
// ═══════════════════════════════════════════════════════════════════════════

function createSlide(slide, index, rendererMap) {
  const type = slide.type ?? "standard";
  const section = document.createElement("section");
  section.className = `slide slide--${type}`;
  section.dataset.index = index;
  section.setAttribute("aria-hidden", "true");

  if (slide.image) {
    debug('createSlide - Slide has image:', {
      index,
      srcPrefix: slide.image.src?.substring(0, 50),
      hasImage: !!slide.image,
      hasSrc: !!slide.image.src
    });
  }

  // Apply font preset or custom font
  if (slide.font) {
    const fontFamily = resolveFontFamily(slide.font);
    if (fontFamily) {
      section.style.fontFamily = fontFamily;
    }
  }

  const renderer = rendererMap[type] ?? renderStandardSlide;
  renderer(section, slide);

  const directBadge = Array.from(section.children).some((child) =>
    child.classList?.contains("badge")
  );
  const badgeDisabled =
    slide.badge === false || slide.autoBadge === false;
  const manualBadgeValue =
    typeof slide.badge === "string"
      ? slide.badge.trim()
      : typeof slide.badge === "number"
      ? String(slide.badge)
      : "";

  if (!directBadge && !badgeDisabled) {
    if (manualBadgeValue) {
      section.insertBefore(
        createBadge(manualBadgeValue),
        section.firstChild ?? null
      );
    } else if (slide.autoBadge !== false) {
      const autoBadge = createBadge(`+ Slide ${index + 1}`);
      autoBadge.dataset.badgeAuto = "true";
      section.insertBefore(autoBadge, section.firstChild ?? null);
    }
  }

  const content = document.createElement('div');
  content.className = 'slide__content';

  const nodes = [];
  while (section.firstChild) {
    nodes.push(section.removeChild(section.firstChild));
  }

  nodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('badge')) {
      section.appendChild(node);
    } else {
      content.appendChild(node);
    }
  });

  section.appendChild(content);

  const rootBadge = section.querySelector(':scope > .badge');
  if (rootBadge) {
    attachSlideHomeBadge(rootBadge);
  }

  return section;
}

function resolveFontFamily(font) {
  const presets = {
    sans: '"Inter", "Helvetica Neue", Arial, sans-serif',
    mono: '"Space Mono", "IBM Plex Mono", monospace',
    grotesk: '"Space Grotesk", sans-serif',
    jetbrains: '"JetBrains Mono", monospace',
    pixel: '"Press Start 2P", monospace',
  };

  // Check if it's a preset
  const lowerFont = font.toLowerCase();
  if (presets[lowerFont]) {
    return presets[lowerFont];
  }

  // Otherwise use as custom font (wrap in quotes if not already)
  if (font.includes('"') || font.includes("'")) {
    return font;
  }
  return `"${font}", sans-serif`;
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE TYPE RENDERERS
// ═══════════════════════════════════════════════════════════════════════════
// Each function below renders a specific slide type. All receive:
// - section: the DOM element to populate
// - slide: the slide data object
//
// Available types: title, standard, image, quote, split, grid, pillars,
//                  gallery, graph, typeface
// ═══════════════════════════════════════════════════════════════════════════

function renderTitleSlide(section, slide) {
  if (slide.eyebrow) {
    section.appendChild(createBadge(slide.eyebrow));
  }

  if (slide.title) {
    const title = document.createElement("h1");
    title.textContent = slide.title;
    section.appendChild(title);
  }

  if (slide.subtitle) {
    const subtitle = document.createElement("p");
    subtitle.className = "title__subtitle";
    setRichContent(subtitle, slide.subtitle);
    section.appendChild(subtitle);
  }

  if (Array.isArray(slide.media) && slide.media.length > 0) {
    section.appendChild(createMediaStrip(slide.media));
  }

  if (slide.footnote) {
    section.appendChild(createFootnote(slide.footnote));
  }
}

function renderStandardSlide(section, slide) {
  if (slide.headline) {
    const headline = document.createElement("h2");
    setRichContent(headline, slide.headline);
    section.appendChild(headline);
  }

  appendBody(section, slide.body);

  if (slide.image) {
    section.appendChild(createImage(slide.image));
  }

  if (slide.footnote) {
    section.appendChild(createFootnote(slide.footnote));
  }
}

function renderImageSlide(section, slide) {
  section.classList.add("slide--image");

  if (!slide.image || !slide.image.src) {
    const warning = document.createElement("p");
    warning.className = "slide__error";
    warning.textContent = "Image slide requires an image with a src.";
    section.appendChild(warning);
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "slide__image-wrapper";

  const imageElement = createImage(slide.image, "slide__image slide__image--full", {
    orientationTarget: section,
  });
  wrapper.appendChild(imageElement);

  if (slide.caption) {
    const caption = document.createElement("div");
    caption.className = "slide__image-caption";
    setRichContent(caption, slide.caption);
    wrapper.appendChild(caption);
  }

  section.appendChild(wrapper);
}

function renderQuoteSlide(section, slide) {
  section.classList.add("slide--quote");

  // Support both 'quote' and 'headline' for the main quote text
  const quoteText = slide.quote ?? slide.headline ?? "";
  const quote = document.createElement("blockquote");
  setRichContent(quote, quoteText);
  section.appendChild(quote);

  // Support both 'attribution' and 'body' for the attribution/subtext
  const attributionText = slide.attribution ?? slide.body;
  if (attributionText) {
    const cite = document.createElement("cite");
    setRichContent(cite, attributionText);
    section.appendChild(cite);
  }
}

function renderSplitSlide(section, slide) {
  section.classList.add("slide--split");
  const variants = Array.isArray(slide.variant)
    ? slide.variant
    : slide.variant
    ? [slide.variant]
    : [];
  variants.forEach((variant) => {
    if (!variant) return;
    section.classList.add(`slide--split--${variant}`);
  });

  const leftColumn = document.createElement("div");
  leftColumn.className = "slide__column slide__column--left";
  const rightColumn = document.createElement("div");
  rightColumn.className = "slide__column slide__column--right";

  renderColumn(leftColumn, slide.left);
  renderColumn(rightColumn, slide.right);

  section.append(leftColumn, rightColumn);
}

function renderGridSlide(section, slide) {
  section.classList.add("slide--grid");

  if (slide.headline) {
    const headline = document.createElement("h2");
    setRichContent(headline, slide.headline);
    section.appendChild(headline);
  }

  appendBody(section, slide.body);

  if (Array.isArray(slide.items)) {
    const grid = document.createElement("div");
    grid.className = "grid";

    slide.items.forEach((item) => {
      const figure = document.createElement("figure");
      if (item.image) {
        figure.appendChild(createImage(item.image));
      } else if (item.color) {
        const swatch = createColorBlock(item);
        figure.appendChild(swatch);
      }
      if (item.label) {
        const caption = document.createElement("figcaption");
        setRichContent(caption, item.label);
        figure.appendChild(caption);
      }
      grid.appendChild(figure);
    });

    section.appendChild(grid);
  }

  if (slide.footnote) {
    section.appendChild(createFootnote(slide.footnote));
  }
}

function renderPillarsSlide(section, slide) {
  section.classList.add("slide--pillars");

  if (slide.headline) {
    const headline = document.createElement("h2");
    setRichContent(headline, slide.headline);
    section.appendChild(headline);
  }

  appendBody(section, slide.body);

  if (slide.image) {
    section.appendChild(createImage(slide.image));
  }

  if (Array.isArray(slide.pillars)) {
    const wrapper = document.createElement("div");
    wrapper.className = "pillars";

    slide.pillars.forEach((pillar) => {
      const card = document.createElement("article");
      card.className = "pillar";

      if (pillar.image) {
        const imageData =
          typeof pillar.image === "string"
            ? { src: pillar.image, alt: pillar.title || "" }
            : pillar.image;
        const img = createImage(imageData, "pillar__image");
        card.appendChild(img);
      }

      if (pillar.title) {
        const heading = document.createElement("h3");
        setRichContent(heading, pillar.title);
        card.appendChild(heading);
      }

      const pillarCopy =
        pillar.copy ??
        pillar.text ??
        pillar.body ??
        pillar.description ??
        null;

      if (pillarCopy) {
        const copyLines = Array.isArray(pillarCopy) ? pillarCopy : [pillarCopy];
        copyLines.forEach((line) => {
          if (!line) return;
          const text = document.createElement("p");
          setRichContent(text, line);
          card.appendChild(text);
        });
      }

      wrapper.appendChild(card);
    });

    section.appendChild(wrapper);
  }

  if (slide.footnote) {
    section.appendChild(createFootnote(slide.footnote));
  }
}

function renderGallerySlide(section, slide) {
  section.classList.add("slide--gallery");

  if (slide.headline) {
    const headline = document.createElement("h2");
    setRichContent(headline, slide.headline);
    section.appendChild(headline);
  }

  appendBody(section, slide.body);

  if (Array.isArray(slide.items)) {
    const gallery = document.createElement("div");
    gallery.className = "gallery";

    slide.items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "gallery__item";

      if (item.image) {
        card.appendChild(createImage(item.image, "gallery__image"));
      } else if (item.color) {
        card.appendChild(createColorBlock(item, "gallery__color"));
      }

      if (item.label) {
        const label = document.createElement("span");
        label.className = "gallery__label";
        setRichContent(label, item.label);
        card.appendChild(label);
      }

      if (item.copy) {
        const copyLines = Array.isArray(item.copy) ? item.copy : [item.copy];
        copyLines.forEach((line) => {
          if (!line) return;
          const text = document.createElement("p");
          text.className = "gallery__copy";
          setRichContent(text, line);
          card.appendChild(text);
        });
      }

      gallery.appendChild(card);
    });

    section.appendChild(gallery);
  }

  if (slide.footnote) {
    section.appendChild(createFootnote(slide.footnote));
  }
}

function renderGraphSlide(section, slide) {
  const content = document.createElement("div");
  content.className = "slide__content";

  // Title
  if (slide.title) {
    const title = document.createElement("h2");
    title.textContent = slide.title;
    content.appendChild(title);
  }

  // Description (optional, shows what the graph is about)
  if (slide.description && !slide.imageData) {
    const description = document.createElement("p");
    description.className = "graph-description";
    description.textContent = slide.description;
    content.appendChild(description);
  }

  // Graph container
  const graphContainer = document.createElement("div");
  graphContainer.className = "graph-container";

  if (slide.imageData) {
    // Show cached generated image
    const img = document.createElement("img");
    img.className = "graph-image";
    img.src = slide.imageData;
    img.alt = slide.description || "Generated graph";
    img.dataset.orientation = normalizeOrientation(slide.orientation);

    const regenerateBtn = document.createElement("button");
    regenerateBtn.className = "graph-regenerate-btn";
    regenerateBtn.textContent = "🔄 Regenerate";
    regenerateBtn.addEventListener("click", () => generateGraphImage(slide, graphContainer));

    graphContainer.appendChild(img);
    graphContainer.appendChild(regenerateBtn);
  } else {
    // Show generate button placeholder
    const placeholder = document.createElement("div");
    placeholder.className = "graph-placeholder";

    const icon = document.createElement("div");
    icon.className = "graph-placeholder__icon";
    icon.textContent = "📊";

    const text = document.createElement("div");
    text.className = "graph-placeholder__text";
    text.textContent = slide.description || "Generate a graph";

    const generateBtn = document.createElement("button");
    generateBtn.className = "graph-generate-btn";
    generateBtn.textContent = "Generate Graph";
    generateBtn.addEventListener("click", () => generateGraphImage(slide, graphContainer));

    placeholder.append(icon, text, generateBtn);
    graphContainer.appendChild(placeholder);
  }

  content.appendChild(graphContainer);
  section.appendChild(content);
  return section;
}

function renderTypefaceSlide(section, slide) {
  section.classList.add("slide--typeface");

  if (slide.headline) {
    const headline = document.createElement("h2");
    setRichContent(headline, slide.headline);
    section.appendChild(headline);
  }

  if (slide.image) {
    section.appendChild(createImage(slide.image));
  }

  // Support both 'fonts' (detailed) and 'samples' (simple) array formats
  const fontArray = slide.fonts || slide.samples;
  if (Array.isArray(fontArray)) {
    const wrapper = document.createElement("div");
    wrapper.className = "typeface-grid";

    fontArray.forEach((font) => {
      const card = document.createElement("article");
      card.className = "typeface-card";

      // Handle both formats: {name, font, sample} and {font, text}
      const fontFamily = font.font;
      const displayText = font.text || font.sample || slide.sample || "The quick brown fox jumps over the lazy dog";

      if (font.name) {
        const label = document.createElement("span");
        label.className = "typeface-card__label";
        label.textContent = font.name;
        card.appendChild(label);
      }

      const sample = document.createElement("p");
      sample.className = "typeface-card__sample";
      sample.style.fontFamily = fontFamily;
      if (font.weight) sample.style.fontWeight = font.weight;
      sample.textContent = displayText;
      card.appendChild(sample);

      if (font.note) {
        const note = document.createElement("span");
        note.className = "typeface-card__note";
        note.textContent = font.note;
        card.appendChild(note);
      }

      wrapper.appendChild(card);
    });

    section.appendChild(wrapper);
  }

  appendBody(section, slide.body);

  if (slide.footnote) {
    section.appendChild(createFootnote(slide.footnote));
  }
}

function renderColumn(column, data = {}) {
  if (!data) return;
  const imageNode = data.image ? createImage(data.image) : null;
  const imageFirst = Boolean(data.imageFirst || data.imagePosition === "top");

  if (data.badge) {
    column.appendChild(createBadge(data.badge));
  }
  if (data.headline) {
    const headline = document.createElement("h3");
    setRichContent(headline, data.headline);
    column.appendChild(headline);
  }

  if (imageFirst && imageNode) {
    column.appendChild(imageNode);
  }

  appendBody(column, data.body);

  if (!imageFirst && imageNode) {
    column.appendChild(imageNode);
  }

  if (data.footnote) {
    column.appendChild(createFootnote(data.footnote));
  }
}

function appendBody(container, body) {
  if (!body) return;
  const copy = Array.isArray(body) ? body : [body];
  copy.forEach((text) => {
    if (!text) return;
    const quoteElement = maybeCreateQuoteElement(text);
    if (quoteElement) {
      container.appendChild(quoteElement);
      return;
    }
    const paragraph = document.createElement("p");
    setRichContent(paragraph, text);
    container.appendChild(paragraph);
  });
}

function createBadge(label) {
  const badge = document.createElement("span");
  badge.className = "badge";
  setRichContent(badge, label);
  return badge;
}

function attachSlideHomeBadge(badge) {
  if (badge.dataset.navHomeBound === "true") return;
  badge.dataset.navHomeBound = "true";
  badge.setAttribute('role', 'link');
  badge.tabIndex = 0;
  badge.addEventListener('click', handleHomeBadgeClick);
  badge.addEventListener('keydown', handleHomeBadgeKeydown);
}

function handleHomeBadgeClick(event) {
  if (event.defaultPrevented) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigateToDeckHome();
}

function handleHomeBadgeKeydown(event) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    navigateToDeckHome();
  }
}

function navigateToDeckHome() {
  window.location.href = "index.html";
}

function createImage(image, className = "slide__image", options = {}) {
  if (!image || !image.src) {
    debug('createImage - No src, creating placeholder');
    return createImagePlaceholder(image, className);
  }
  const img = document.createElement("img");
  img.className = className;
  const actualSrc = image.src;
  const modalSrc = image.modalSrc ?? actualSrc;
  const shouldLazyLoad = typeof actualSrc === "string" && !actualSrc.startsWith("data:");

  debug('createImage - Creating image:', {
    srcPrefix: actualSrc.substring(0, 50),
    shouldLazyLoad,
    isBase64: actualSrc.startsWith('data:')
  });

  img.alt = image.alt ?? "";
  img.dataset.modalSrc = modalSrc;
  if (image.alt) {
    img.dataset.modalAlt = image.alt;
  }
  if (image.loading) {
    img.loading = image.loading;
  } else {
    img.loading = "lazy";
  }
  img.decoding = image.decoding ?? "async";
  if (shouldLazyLoad) {
    registerLazyImage(img, actualSrc);
  } else {
    debug('createImage - Setting base64 src directly');
    img.src = actualSrc;
  }
  if (image.aspectRatio) {
    img.style.aspectRatio = image.aspectRatio;
  }
  if (image.objectFit) {
    img.style.objectFit = image.objectFit;
  }
  if (image.objectPosition) {
    img.style.objectPosition = image.objectPosition;
  }
  if (image.fullBleed) {
    img.classList.add("slide__image--full");
  }
  if (image.border === false) {
    img.classList.add("slide__image--borderless");
  }
  const orientationTarget = options.orientationTarget;
  const rawOrientation =
    typeof image.orientation === "string" ? image.orientation.trim() : image.orientation;
  const explicitOrientation = normalizeOrientation(rawOrientation);
  const orientationLocked =
    image.lockOrientation === true ||
    (typeof rawOrientation === "string" && /!$/.test(rawOrientation));
  const applyOrientation = (orientation) => {
    if (!orientation) return;
    img.dataset.orientation = orientation;
    if (orientationTarget) {
      orientationTarget.dataset.orientation = orientation;
    }
  };
  if (explicitOrientation) {
    applyOrientation(explicitOrientation);
  }
  const updateOrientationFromNatural = () => {
    const orientation = deriveOrientationFromDimensions(
      img.naturalWidth,
      img.naturalHeight
    );
    if (!orientation) return;
    if (!explicitOrientation || (!orientationLocked && orientation !== explicitOrientation)) {
      applyOrientation(orientation);
    }
  };
  if (img.complete && img.naturalWidth && img.naturalHeight) {
    updateOrientationFromNatural();
  } else {
    img.addEventListener("load", updateOrientationFromNatural, { once: true });
  }
  // Make images clickable to view full size
  img.style.cursor = 'pointer';
  return img;
}

function createImagePlaceholder(image = {}, className = "slide__image") {
  const baseClasses = String(className)
    .split(/\s+/)
    .filter(Boolean);

  // Create wrapper container
  const wrapper = document.createElement("div");
  wrapper.className = [...baseClasses, "image-placeholder-wrapper"].join(" ");

  const placeholder = document.createElement("button");
  placeholder.type = "button";
  placeholder.className = "image-placeholder";

  const query =
    image.alt ||
    image.search ||
    image.label ||
    image.caption ||
    image.query ||
    "";
  const trimmedQuery = query.trim();

  const icon = document.createElement("span");
  icon.className = "image-placeholder__icon";
  icon.textContent = "🔍";

  const text = document.createElement("span");
  text.className = "image-placeholder__text";
  text.textContent = trimmedQuery
    ? `Search "${trimmedQuery}" or drag & drop`
    : "Drag & drop or paste image";

  placeholder.append(icon, text);

  // Track event listeners for cleanup
  const listeners = [];

  // Click handler for Google Image Search
  if (trimmedQuery) {
    placeholder.dataset.searchQuery = trimmedQuery;
    placeholder.setAttribute("aria-label", `Search images for ${trimmedQuery} or drag and drop`);
    const clickHandler = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const url = buildImageSearchUrl(trimmedQuery);
      window.open(url, "_blank", "noopener");
    };
    placeholder.addEventListener("click", clickHandler);
    listeners.push({ element: placeholder, event: 'click', handler: clickHandler });
  } else {
    placeholder.setAttribute(
      "aria-label",
      "Drag and drop or paste an image"
    );
  }

  // Drag & drop handlers
  const dragoverHandler = (event) => {
    event.preventDefault();
    event.stopPropagation();
    placeholder.classList.add("image-placeholder--dragover");
    text.textContent = "Drop to add image";
  };
  placeholder.addEventListener("dragover", dragoverHandler);
  listeners.push({ element: placeholder, event: 'dragover', handler: dragoverHandler });

  const dragleaveHandler = (event) => {
    event.preventDefault();
    event.stopPropagation();
    placeholder.classList.remove("image-placeholder--dragover");
    text.textContent = trimmedQuery
      ? `Search "${trimmedQuery}" or drag & drop`
      : "Drag & drop or paste image";
  };
  placeholder.addEventListener("dragleave", dragleaveHandler);
  listeners.push({ element: placeholder, event: 'dragleave', handler: dragleaveHandler });

  const dropHandler = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    placeholder.classList.remove("image-placeholder--dragover");

    const files = Array.from(event.dataTransfer.files);
    const imageFile = files.find(f => f.type.startsWith("image/"));

    if (imageFile) {
      try {
        await handleImageUpload(imageFile, placeholder, image);
      } catch (error) {
        console.error('Drop upload failed:', error);
        showHudStatus(`Upload failed: ${error.message}`, 'error');
        setTimeout(hideHudStatus, 3000);
      }
    }
  };
  placeholder.addEventListener("drop", dropHandler);
  listeners.push({ element: placeholder, event: 'drop', handler: dropHandler });

  // Store reference to the original image object
  placeholder._imageRef = image;

  wrapper.appendChild(placeholder);

  // Only show AI button when there's NO query
  if (!trimmedQuery) {
    const aiBtn = document.createElement("button");
    aiBtn.type = "button";
    aiBtn.className = "image-placeholder__magic-btn";
    aiBtn.textContent = "🪄";
    aiBtn.title = "Generate image with AI";
    aiBtn.setAttribute("aria-label", "Generate image with AI");

    const aiClickHandler = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await askAIForImage(placeholder, image);
    };
    aiBtn.addEventListener("click", aiClickHandler);
    listeners.push({ element: aiBtn, event: 'click', handler: aiClickHandler });

    wrapper.appendChild(aiBtn);
  }

  // Store reference on wrapper
  wrapper._imageRef = image;

  // Add cleanup function to remove all event listeners
  wrapper.cleanup = () => {
    listeners.forEach(({ element, event, handler }) => {
      element?.removeEventListener(event, handler);
    });
    listeners.length = 0;
  };

  return wrapper;
}

function buildImageSearchUrl(query) {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("tbm", "isch");
  url.searchParams.set("q", query);
  return url.toString();
}

// ================================================================
// AI Image Suggestions - Helper Functions
// ================================================================

/**
 * Get Gemini API key with user prompt if missing
 * @returns {string|null} API key or null if not set
 */
function requireGeminiApiKey() {
  const apiKey = localStorage.getItem(STORAGE_KEY_API);
  if (!apiKey) {
    showHudStatus('⚠️ Please set your Gemini API key in Settings (S key)', 'error');
    setTimeout(() => {
      hideHudStatus();
      openSettingsModal();
    }, 2000);
    return null;
  }
  return apiKey;
}

/**
 * Extract slide context from a placeholder element
 * @param {HTMLElement} placeholderElement - The placeholder element
 * @returns {Object} Slide context with headline, body, type, etc.
 */
function extractSlideContext(placeholderElement) {
  const slideElement = placeholderElement.closest('.slide');
  const slideIndex = slideElement ? slideElements.indexOf(slideElement) : -1;
  const slide = slideIndex >= 0 ? slides[slideIndex] : {};

  return {
    slideIndex,
    slide,
    headline: slide.headline || slide.title || '',
    body: Array.isArray(slide.body) ? slide.body.join(' ') : (slide.body || ''),
    slideType: slide.type || 'standard'
  };
}

// ================================================================
// AI Image Suggestions
// ================================================================

async function askAIForImage(placeholderElement, imageConfig = {}) {
  const apiKey = requireGeminiApiKey();
  if (!apiKey) return;

  const context = extractSlideContext(placeholderElement);
  const { headline, body, slideType } = context;

  showHudStatus('🤔 Deciding...', 'info');

  try {
    // First, ask AI to decide: search or generate?
    const decisionPrompt = `You're helping find the perfect image for a presentation slide.

Slide content:
- Type: ${slideType}
- Headline: ${headline}
- Body: ${body}

Decide whether this slide needs:
A) A real photograph/stock image (respond with "SEARCH: [refined query]")
B) A custom illustration (respond with "GENERATE")

Guidelines:
- Use SEARCH for: real people, specific places, products, concrete things
- Use GENERATE for: concepts, abstract ideas, data visualization, creative illustrations

Respond with ONLY one of these formats, nothing else:
SEARCH: [your refined query here]
or
GENERATE`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: decisionPrompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 100,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const result = await response.json();
    const decision = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!decision) {
      throw new Error('No decision returned from AI');
    }

    // Parse decision
    if (decision.toUpperCase().startsWith('SEARCH:')) {
      // Extract search query
      const query = decision.replace(/^SEARCH:\s*/i, '').trim();
      hideHudStatus();

      // Open Google Images with suggested query
      const url = buildImageSearchUrl(query);
      window.open(url, '_blank', 'noopener');

      showHudStatus(`🔍 Searching: "${query}"`, 'success');
      setTimeout(hideHudStatus, 3000);

    } else if (decision.toUpperCase().includes('GENERATE')) {
      // Generate image with AI
      showHudStatus('🎨 Generating image...', 'processing');
      await generateAIImage(placeholderElement, imageConfig);

    } else {
      throw new Error('AI returned unclear decision');
    }

  } catch (error) {
    console.error('AI image decision failed:', error);
    showHudStatus(`❌ ${error.message}`, 'error', {
      onRetry: () => askAIForImage(placeholderElement, imageConfig)
    });
    setTimeout(hideHudStatus, 6000);
  }
}

async function generateAIImage(placeholderElement, imageConfig = {}) {
  const apiKey = requireGeminiApiKey();
  if (!apiKey) return;

  const context = extractSlideContext(placeholderElement);
  const { slide, headline, body, slideType } = context;
  const imageContext = imageConfig.alt || imageConfig.label || imageConfig.search || '';

  // Get current theme colors
  const rootStyles = getComputedStyle(document.documentElement);
  const colorSurface = rootStyles.getPropertyValue('--color-surface').trim();
  const colorSurfaceAlt = rootStyles.getPropertyValue('--color-surface-alt').trim();
  const colorAccent = rootStyles.getPropertyValue('--color-accent').trim();

  // Get theme mood
  const themePath = getCurrentThemePath();
  const themeName = themePath?.split('/').pop()?.replace('.json', '') || 'default';
  const themeMoods = {
    'vaporwave': 'dreamy, retro aesthetic, pink and cyan tones, nostalgic',
    'slack': 'quirky, vibrant, playful, unconventional',
    'gameboy': 'pixel art style, retro gaming, limited color palette',
    'default': 'clean, professional, modern'
  };
  const themeMood = themeMoods[themeName] || themeMoods.default;

  showHudStatus('✨ Generating image...', 'info');

  try {
    const prompt = `Create an illustration for a presentation slide about: ${imageContext || headline}.

Slide context:
${headline ? `- Headline: ${headline}` : ''}
${body ? `- Content: ${body.substring(0, 200)}` : ''}

Style requirements:
- Risograph print aesthetic with bold, flat colors, ${themeMood}
- Use complementary colors inspired by: ${colorSurface}, ${colorSurfaceAlt}, ${colorAccent}
- Clean, minimal composition
- High contrast, professional quality
- No text or labels in the image

The image should be visually striking and support the slide content.`;

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ['Image'],
            imageConfig: {
              aspectRatio: '16:9'
            }
          }
        })
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const result = await response.json();
    const imagePart = result.candidates?.[0]?.content?.parts?.find(p => p.inlineData);

    if (!imagePart || !imagePart.inlineData) {
      throw new Error('No image data returned from API');
    }

    // Build base64 data URL
    const mimeType = imagePart.inlineData.mimeType || 'image/png';
    const base64Data = `data:${mimeType};base64,${imagePart.inlineData.data}`;

    // Update the slide with generated image
    if (slideIndex >= 0) {
      updateSlideImage(slideIndex, {
        src: base64Data,
        alt: imageContext || headline || 'AI generated image',
        originalFilename: 'ai-generated.png',
        generatedAt: Date.now()
      }, placeholderElement);

      replaceSlideAt(slideIndex, { focus: false });
      if (!isOverview) {
        setActiveSlide(slideIndex);
      }
    }

    showHudStatus('✨ Image generated!', 'success');
    setTimeout(hideHudStatus, 2000);

  } catch (error) {
    console.error('AI image generation failed:', error);
    showHudStatus(`❌ ${error.message}`, 'error');
    setTimeout(hideHudStatus, 3000);
  }
}

// ================================================================
// Image Upload & Compression
// ================================================================

async function handleImageUpload(file, placeholderElement, imageConfig = {}) {
  if (!file.type.startsWith("image/")) {
    showImageError(placeholderElement, "Please drop an image file");
    return;
  }

  // Show loading state
  const text = placeholderElement.querySelector(".image-placeholder__text");
  const icon = placeholderElement.querySelector(".image-placeholder__icon");
  const originalText = text.textContent;
  const originalIcon = icon.textContent;

  text.textContent = "Compressing...";
  icon.textContent = "⏳";
  placeholderElement.disabled = true;

  let hadError = false;

  try {
    const { file: compressedFile, format: outputFormat, hitSoftLimit } = await compressImage(file);
    const sizeInBytes = compressedFile.size;
    const sizeLabel = formatBytes(sizeInBytes);

    if (sizeInBytes > MAX_IMAGE_BYTES) {
      throw new Error(`Image still too large (${sizeLabel}); try a smaller original.`);
    }

    // Convert to base64
    const base64 = await fileToBase64(compressedFile);

    // Find the slide this placeholder belongs to and update it
    const slideIndex = findSlideIndexForPlaceholder(placeholderElement);
    if (slideIndex !== -1) {
      updateSlideImage(slideIndex, {
        src: base64,
        alt: imageConfig.alt || file.name.replace(/\.[^/.]+$/, ""),
        originalFilename: file.name,
        compressedSize: sizeInBytes,
        compressedFormat: outputFormat,
        uploadedAt: Date.now()
      }, placeholderElement);

      // Re-render the slide and preserve context
      debug('Image uploaded, re-rendering slide', slideIndex);
      debug('Slide image src:', slides[slideIndex].image?.src?.substring(0, 100));
      replaceSlideAt(slideIndex, { focus: false });
      if (!isOverview) {
        setActiveSlide(slideIndex);
      }
      if (hitSoftLimit) {
        console.warn(`Image for slide ${slideIndex} landed above soft target (${sizeLabel}).`);
      }
      const statusType = hitSoftLimit ? "warning" : "success";
      const statusMessage = hitSoftLimit
        ? `Image added (${sizeLabel}) — hit quality floor`
        : `Image added (${sizeLabel})`;
      showHudStatus(statusMessage, statusType);
      setTimeout(hideHudStatus, hitSoftLimit ? 3000 : 2000);
    }
  } catch (error) {
    hadError = true;
    console.error("Image upload failed:", error);
    icon.textContent = originalIcon;
    text.textContent = originalText;
    showImageError(placeholderElement, error.message);
  } finally {
    placeholderElement.disabled = false;
    if (!hadError) {
      text.textContent = originalText;
      icon.textContent = originalIcon;
      delete text.dataset.originalText;
    }
  }
}

async function compressImage(file) {
  // Check if browser-image-compression is available
  if (typeof imageCompression === 'undefined') {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error('Compression library unavailable — use a smaller image (<2MB).');
    }
    return { file, format: file.type || 'image/png', hitSoftLimit: file.size > TARGET_IMAGE_BYTES };
  }

  if (file.size <= TARGET_IMAGE_BYTES) {
    return { file, format: file.type || 'image/png', hitSoftLimit: false };
  }

  const preferredFormats = [];
  if (file.type !== 'image/webp' && file.type !== 'image/gif') {
    preferredFormats.push('image/webp');
  }
  if (file.type) {
    preferredFormats.push(file.type);
  }
  if (!preferredFormats.includes('image/png')) {
    preferredFormats.push('image/png');
  }

  const dimensionSteps = CONFIG.IMAGE.DIMENSION_STEPS;
  const qualitySteps = CONFIG.IMAGE.QUALITY_STEPS;
  let bestCandidate = null;

  for (const format of preferredFormats) {
    for (const dimension of dimensionSteps) {
      const qualities = format === 'image/png' ? [1] : qualitySteps;
      for (const quality of qualities) {
        const options = {
          maxWidthOrHeight: dimension,
          useWebWorker: true,
          maxSizeMB: TARGET_IMAGE_BYTES / (1024 * 1024),
          maxIteration: 12,
          fileType: format,
        };
        if (format !== 'image/png') {
          options.initialQuality = quality;
        }

        try {
          const compressed = await imageCompression(file, options);
          if (compressed.size <= TARGET_IMAGE_BYTES) {
            return { file: compressed, format, hitSoftLimit: false };
          }
          if (compressed.size <= MAX_IMAGE_BYTES) {
            if (!bestCandidate || compressed.size < bestCandidate.file.size) {
              bestCandidate = { file: compressed, format, hitSoftLimit: true };
            }
          }
        } catch (error) {
          console.warn(`Compression attempt failed (${format} @ ${dimension}px, q=${quality}):`, error);
        }
      }
    }
  }

  if (bestCandidate) {
    return bestCandidate;
  }

  throw new Error('Could not shrink image under 2MB. Try exporting a smaller source.');
}

function findSlideIndexForPlaceholder(placeholderElement) {
  const slideElement = placeholderElement.closest('.slide');
  if (!slideElement) return -1;
  return slideElements.indexOf(slideElement);
}

function updateSlideImage(slideIndex, imageData, placeholderElement) {
  if (slideIndex < 0 || slideIndex >= slides.length) return;

  const slide = slides[slideIndex];

  // Try to find the exact image object that this placeholder represents
  const targetImageRef = placeholderElement?._imageRef;

  if (targetImageRef) {
    // Search for this exact image object in the slide data structure
    const updated = findAndUpdateImageInSlide(slide, targetImageRef, imageData);
    if (updated) {
      debug('Updated image in nested structure');
      return;
    }
  }

  // Fallback: update top-level slide.image
  debug('Fallback to top-level slide.image');
  if (!slide.image) {
    slide.image = {};
  }
  Object.assign(slide.image, imageData);
}

function findAndUpdateImageInSlide(slide, targetImageRef, newImageData) {
  // Check top-level image
  if (slide.image === targetImageRef) {
    Object.assign(slide.image, newImageData);
    return true;
  }

  // Check media array (title slides)
  if (Array.isArray(slide.media)) {
    for (const mediaItem of slide.media) {
      if (mediaItem.image === targetImageRef) {
        Object.assign(mediaItem.image, newImageData);
        return true;
      }
    }
  }

  // Check items array (gallery slides)
  if (Array.isArray(slide.items)) {
    for (const item of slide.items) {
      if (item.image === targetImageRef) {
        Object.assign(item.image, newImageData);
        return true;
      }
    }
  }

  // Check split columns
  if (slide.left?.image === targetImageRef) {
    Object.assign(slide.left.image, newImageData);
    return true;
  }
  if (slide.right?.image === targetImageRef) {
    Object.assign(slide.right.image, newImageData);
    return true;
  }

  // Check pillars
  if (Array.isArray(slide.pillars)) {
    for (const pillar of slide.pillars) {
      if (pillar.image === targetImageRef) {
        Object.assign(pillar.image, newImageData);
        return true;
      }
    }
  }

  return false;
}

function showImageError(placeholderElement, message) {
  const text = placeholderElement.querySelector(".image-placeholder__text");
  if (!text) return;

  const previousText = text.dataset.originalText || text.textContent;
  text.dataset.originalText = previousText;
  text.textContent = message;
  placeholderElement.classList.add("image-placeholder--error");

  setTimeout(() => {
    text.textContent = text.dataset.originalText || previousText;
    delete text.dataset.originalText;
    placeholderElement.classList.remove("image-placeholder--error");
  }, 3000);
}

// Global paste handler for images
async function handleGlobalPaste(event) {
  // Don't interfere with paste in text inputs
  const target = event.target;
  if (target && (target.matches('input, textarea') || target.isContentEditable)) {
    return;
  }

  const items = event.clipboardData?.items;
  if (!items) return;

  for (let item of items) {
    if (item.type.startsWith('image/')) {
      event.preventDefault();
      const file = item.getAsFile();
      if (!file) continue;

      // Find the first image placeholder on the current slide
      const currentSlide = slideElements[currentIndex];
      if (!currentSlide) continue;

      const placeholder = currentSlide.querySelector('.image-placeholder');
      if (placeholder) {
        // Safely parse placeholder config with error handling
        let imageConfig = {};
        try {
          imageConfig = JSON.parse(placeholder.dataset.placeholderFor || '{}');
        } catch (error) {
          console.warn('Invalid placeholder config, using defaults:', error);
        }
        await handleImageUpload(file, placeholder, imageConfig);
      } else {
        showHudStatus("No image placeholder on current slide", "warning");
        setTimeout(hideHudStatus, 2000);
      }
      break; // Only handle the first image
    }
  }
}

function normalizeOrientation(value) {
  if (!value) return null;
  const normalized = String(value).toLowerCase().replace(/!+$/, "");
  const alias = {
    poster: "portrait",
    "one-sheet": "portrait",
    flyer: "portrait",
    sheet: "portrait",
    banner: "landscape",
    widescreen: "landscape",
    panorama: "landscape",
  }[normalized];
  if (alias) {
    return alias;
  }
  if (["portrait", "landscape", "square"].includes(normalized)) {
    return normalized;
  }
  if (["vertical", "tall"].includes(normalized)) {
    return "portrait";
  }
  if (["horizontal", "wide"].includes(normalized)) {
    return "landscape";
  }
  return null;
}

function deriveOrientationFromDimensions(width, height) {
  if (!width || !height) return null;
  if (Math.abs(width - height) / Math.max(width, height) < 0.08) {
    return "square";
  }
  return width > height ? "landscape" : "portrait";
}

function handleImageModalTrigger(event) {
  if (isOverview) return;
  const trigger = event.target.closest("[data-modal-src]");
  if (!trigger) return;
  const src = trigger.dataset.modalSrc;
  if (!src) return;
  event.preventDefault();
  event.stopPropagation();
  openImageModal(src, trigger.dataset.modalAlt ?? trigger.alt ?? "");
}

// Singleton image modal - created once, reused forever
let imageModal = null;
let imageModalHandlers = null;

/**
 * Initialize the image modal singleton
 * Creates modal once and sets up event listeners
 * @returns {Object} Modal element and close function
 */
function initImageModal() {
  if (imageModal) return { modal: imageModal, ...imageModalHandlers };

  // Create modal element once
  const modal = document.createElement('div');
  modal.className = 'image-modal';
  modal.innerHTML = `
    <div class="image-modal__backdrop"></div>
    <div class="image-modal__content">
      <img src="" alt="" loading="eager" decoding="sync" />
      <button class="image-modal__close" aria-label="Close">×</button>
    </div>
  `;

  document.body.appendChild(modal);

  const img = modal.querySelector('.image-modal__content img');
  const backdrop = modal.querySelector('.image-modal__backdrop');
  const closeBtn = modal.querySelector('.image-modal__close');

  // Close handler
  const closeModal = () => {
    modal.classList.remove('is-active');
  };

  // ESC key handler
  const handleEsc = (e) => {
    if (e.key === 'Escape' && modal.classList.contains('is-active')) {
      closeModal();
    }
  };

  // Set up event listeners ONCE
  backdrop.addEventListener('click', closeModal);
  img.addEventListener('click', closeModal);
  closeBtn.addEventListener('click', closeModal);
  document.addEventListener('keydown', handleEsc);

  // Store references
  imageModal = modal;
  imageModalHandlers = { closeModal, img };

  return { modal, closeModal, img };
}

/**
 * Open image modal with specified image
 * @param {string} src - Image source URL
 * @param {string} alt - Image alt text
 */
function openImageModal(src, alt) {
  const { modal, img } = initImageModal();

  // Update image
  img.src = src;
  img.alt = alt || '';

  // Show modal
  requestAnimationFrame(() => modal.classList.add('is-active'));
}

function createFootnote(text) {
  const footnote = document.createElement("p");
  footnote.className = "slide__footnote";
  setRichContent(footnote, text);
  return footnote;
}

function createMediaStrip(media) {
  const container = document.createElement("div");
  container.className = "media-strip";

  media.forEach((item) => {
    if (item.image) {
      container.appendChild(createImage(item.image, "media-strip__image"));
    } else if (item.color) {
      container.appendChild(createColorBlock(item, "media-strip__color"));
    }
  });

  return container;
}

function createColorBlock(item, className = "gallery__color") {
  const block = document.createElement("div");
  block.className = className;
  block.style.background = item.color;
  if (item.label) {
    block.textContent = item.label;
  }
  return block;
}

function setRichContent(element, html) {
  if (html == null) return;
  element.innerHTML = parseMarkdown(html);
  applyAutoLinksToElement(element);
}

/**
 * Parse simple markdown with XSS protection
 * Escapes HTML first, then applies markdown transformations
 * @param {string} text - The markdown text to parse
 * @returns {string} Safe HTML string
 */
function parseMarkdown(text) {
  if (typeof text !== 'string') return text;

  // First, escape all HTML to prevent XSS
  let safe = escapeHtml(text);

  // Now apply markdown transformations on the escaped text
  safe = safe
    // Bold: **text** or __text__
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    // Italic: *text* or _text_ (but not inside words)
    .replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '<em>$1</em>')
    .replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<em>$1</em>')
    // Code: `code`
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  // Links: [text](url) - with URL sanitization
  safe = safe.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
    // Sanitize URL - only allow safe protocols
    const sanitizedUrl = sanitizeUrl(url);
    if (!sanitizedUrl) {
      // Invalid URL - return just the text
      return linkText;
    }
    return `<a href="${sanitizedUrl}" rel="noopener noreferrer">${linkText}</a>`;
  });

  return safe;
}

/**
 * Sanitize URL to prevent javascript: and data: protocol attacks
 * @param {string} url - The URL to sanitize
 * @returns {string|null} Sanitized URL or null if invalid
 */
function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return null;

  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    // Try to parse as absolute URL
    const parsed = new URL(trimmed, window.location.href);

    // Whitelist safe protocols
    const safeProtocols = ['http:', 'https:', 'mailto:', 'tel:'];
    if (safeProtocols.includes(parsed.protocol)) {
      return parsed.href;
    }

    // Unsafe protocol
    return null;
  } catch (e) {
    // If URL parsing fails, check if it's a relative URL
    if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
      // Relative URLs are generally safe
      return trimmed;
    }

    // Invalid URL
    return null;
  }
}

function maybeCreateQuoteElement(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const quoteMatch = trimmed.match(/^(["“])(.*?)(["”])(?:\s*(?:[—–-]{1,2})\s*(.+))?$/s);
  if (!quoteMatch) {
    return null;
  }

  const [, , quoteBody, , attribution] = quoteMatch;
  const block = document.createElement("blockquote");
  block.className = "quote-block";

  const quoteSpan = document.createElement("span");
  setRichContent(quoteSpan, quoteBody.trim());
  block.append(...quoteSpan.childNodes);

  if (attribution) {
    const cite = document.createElement("cite");
    setRichContent(cite, attribution.trim());
    block.appendChild(cite);
  }

  return block;
}

function applyAutoLinksToElement(element) {
  if (!autoLinkConfigs.length || !element) return;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node || !node.nodeValue || !node.nodeValue.trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      if (node.parentElement && node.parentElement.closest("a")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes = [];
  let current;
  while ((current = walker.nextNode())) {
    textNodes.push(current);
  }

  textNodes.forEach((node) => {
    const original = node.nodeValue;
    const matches = [];

    autoLinkConfigs.forEach((config) => {
      config.regex.lastIndex = 0;
      let match;
      while ((match = config.regex.exec(original)) !== null) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          text: match[0],
          config,
        });
      }
    });

    if (!matches.length) return;
    matches.sort((a, b) => a.start - b.start);

    const filtered = [];
    let lastEnd = -1;
    matches.forEach((match) => {
      if (match.start < lastEnd) return;
      filtered.push(match);
      lastEnd = match.end;
    });

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    filtered.forEach((match) => {
      if (match.start > cursor) {
        fragment.appendChild(
          document.createTextNode(original.slice(cursor, match.start))
        );
      }
      fragment.appendChild(createAutoLink(match.text, match.config));
      cursor = match.end;
    });

    if (cursor < original.length) {
      fragment.appendChild(
        document.createTextNode(original.slice(cursor))
      );
    }

    node.parentNode.replaceChild(fragment, node);
  });
}

function createAutoLink(text, config) {
  const anchor = document.createElement("a");
  anchor.textContent = text;
  anchor.href = buildAutoLinkHref(text, config);
  if (config.openInNewTab) {
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
  }
  anchor.className = "auto-link";
  return anchor;
}

function buildAutoLinkHref(text, config) {
  if (config.urlTemplate) {
    return config.urlTemplate.replace(/%s/g, encodeURIComponent(text.trim()));
  }
  if (config.url) {
    return config.url;
  }
  const query = config.search ?? text;
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(
    query
  )}`;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ===================================================================
// DECK IMPORT/EXPORT
// ===================================================================



function toggleEditDrawer() {
  if (!editDrawerInstance) return;
  if (editDrawerInstance.isOpen) {
    closeDrawer(editDrawerInstance);
  } else {
    openEditDrawer();
  }
}

function openEditDrawer() {
  if (!editDrawerInstance) return;
  if (themeDrawerInstance?.isOpen) {
    closeDrawer(themeDrawerInstance, { restoreFocus: false });
  }
  // Pre-render the form BEFORE opening to avoid DOM manipulation during animation
  renderEditForm(getEditDrawerContext());
  openDrawer(editDrawerInstance);
}

function closeEditDrawer() {
  if (!editDrawerInstance) return;
  closeDrawer(editDrawerInstance);
}


function getEditDrawerContext() {
  return {
    getSlides: () => slides,
    getCurrentIndex: () => currentIndex,
    updateSlide: (index, slide) => {
      slides[index] = slide;
    },
    replaceSlideAt: (index, options) => replaceSlideAt(index, options),
    insertSlideAt: (index, slideData, options) => insertSlideAt(index, slideData, options),
    downloadDeck,
    getSlideTemplate,
    showHudStatus,
    hideHudStatus,
    closeDrawer: () => closeDrawer(editDrawerInstance),
  };
}

function getKeyboardContext() {
  return {
    isOverview: () => isOverview,
    moveOverviewCursorBy,
    exitOverview,
    getOverviewCursor: () => overviewCursor,
    toggleOverview,
    downloadDeck,
    toggleSpeakerNotes,
    setActiveSlide,
    getCurrentIndex: () => currentIndex,
    getSlideCount: () => slideElements.length,
    toggleEditDrawer,
    toggleVoiceRecording,
    toggleThemeDrawer,
    openSettingsModal,
    closeSettingsModal,
    toggleKeyboardHelp,
    toggleSlideIndex,
    triggerDeckUpload: () => {
      const uploadInput = document.getElementById('deck-upload');
      if (uploadInput) uploadInput.click();
    },
  };
}
const createdEditDrawer = createDrawer({
  id: 'edit-drawer',
  onOpen: () => {
    setEditDrawerOpen(true);
    // renderEditForm is now called before opening for smooth animation
    const closeBtn = editDrawerInstance.element.querySelector('.edit-drawer__close');
    if (closeBtn && !closeBtn.dataset.listenerAttached) {
      closeBtn.addEventListener('click', () => closeDrawer(editDrawerInstance));
      closeBtn.dataset.listenerAttached = 'true';
    }
  },
  onClose: () => {
    setEditDrawerOpen(false);
  },
});
setEditDrawerInstance(createdEditDrawer);






function getSlideTemplate(type) {
  const templates = {
    title: {
      type: 'title',
      eyebrow: 'New Section',
      title: 'Title Goes Here',
      subtitle: 'Optional subtitle copy',
      media: [],
      font: 'grotesk'
    },
    standard: {
      type: 'standard',
      badge: 'Slide',
      headline: 'Headline Goes Here',
      body: ['First talking point', 'Second talking point'],
      font: 'sans'
    },
    quote: {
      type: 'quote',
      quote: '"Add your quote here."',
      attribution: 'Attribution Name',
      font: 'sans'
    },
    split: {
      type: 'split',
      left: {
        headline: 'Left Column',
        body: ['Left column bullet']
      },
      right: {
        headline: 'Right Column',
        body: ['Right column bullet']
      },
      font: 'sans'
    },
    grid: {
      type: 'grid',
      headline: 'Grid Headline',
      body: ['Introduce the items in this grid.'],
      items: [
        {
          image: { src: '', alt: 'Image description' },
          label: 'Item label'
        },
        {
          image: { src: '', alt: 'Image description' },
          label: 'Item label'
        }
      ],
      font: 'sans'
    },
    pillars: {
      type: 'pillars',
      headline: 'Pillars Headline',
      body: ['Introduce the pillars.'],
      pillars: [
        {
          title: 'Pillar One',
          copy: ['Supporting detail for pillar one']
        },
        {
          title: 'Pillar Two',
          copy: ['Supporting detail for pillar two']
        }
      ],
      font: 'sans'
    },
    gallery: {
      type: 'gallery',
      headline: 'Gallery Headline',
      body: 'Describe the collection showcased here.',
      items: [
        {
          image: { src: '', alt: 'Image description' },
          label: 'Item label',
          copy: 'Optional supporting copy.'
        },
        {
          image: { src: '', alt: 'Image description' },
          label: 'Item label',
          copy: 'Optional supporting copy.'
        }
      ],
      font: 'sans'
    },
    image: {
      type: 'image',
      badge: 'Slide',
      headline: 'Image Slide Headline',
      image: { src: '', alt: 'Describe the image' },
      caption: 'Optional caption text.',
      font: 'sans'
    },
    typeface: {
      type: 'typeface',
      headline: 'Typeface Showcase',
      fonts: [
        {
          name: 'Display',
          font: '"Space Grotesk", sans-serif',
          sample: 'The quick brown fox jumps over the lazy dog.'
        },
        {
          name: 'Body',
          font: '"Inter", sans-serif',
          sample: 'Use this space to demonstrate body copy.'
        }
      ],
      body: ['Describe how these typefaces support the system.'],
      font: 'sans'
    }
  };

  const template = templates[type];
  if (!template) return null;
  return deepClone(template);
}


function downloadTheme(themeData) {
  const json = JSON.stringify(themeData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'theme.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  console.log('✓ Theme downloaded as theme.json');
}

// ===================================================================
// SETTINGS MODAL
// ===================================================================

// ═══════════════════════════════════════════════════════════════════════════
// KEYBOARD HELP MODAL
// ═══════════════════════════════════════════════════════════════════════════

function toggleKeyboardHelp() {
  const modal = document.getElementById('hints-modal');
  if (!modal) return;

  const isOpen = modal.getAttribute('aria-hidden') === 'false';
  if (isOpen) {
    closeKeyboardHelp();
  } else {
    openKeyboardHelp();
  }
}

function openKeyboardHelp() {
  const modal = document.getElementById('hints-modal');
  if (!modal) return;

  modal.setAttribute('aria-hidden', 'false');

  // Set up listeners if not already done
  setupKeyboardHelpListeners();
}

function closeKeyboardHelp() {
  const modal = document.getElementById('hints-modal');
  if (!modal) return;

  modal.setAttribute('aria-hidden', 'true');
}

function setupKeyboardHelpListeners() {
  // Close button
  const closeBtn = document.getElementById('hints-modal-close');
  if (closeBtn && !closeBtn.dataset.listenerAttached) {
    closeBtn.addEventListener('click', closeKeyboardHelp);
    closeBtn.dataset.listenerAttached = 'true';
  }

  // Got it button
  const gotItBtn = document.getElementById('hints-modal-got-it');
  if (gotItBtn && !gotItBtn.dataset.listenerAttached) {
    gotItBtn.addEventListener('click', closeKeyboardHelp);
    gotItBtn.dataset.listenerAttached = 'true';
  }

  // Backdrop
  const backdrop = document.querySelector('.hints-modal__backdrop');
  if (backdrop && !backdrop.dataset.listenerAttached) {
    backdrop.addEventListener('click', closeKeyboardHelp);
    backdrop.dataset.listenerAttached = 'true';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// KEYBOARD HELP MODAL
// ═══════════════════════════════════════════════════════════════════════════

function toggleKeyboardHelp() {
  const modal = document.getElementById('hints-modal');
  if (!modal) return;

  const isOpen = modal.getAttribute('aria-hidden') === 'false';
  if (isOpen) {
    closeKeyboardHelp();
  } else {
    openKeyboardHelp();
  }
}

function openKeyboardHelp() {
  const modal = document.getElementById('hints-modal');
  if (!modal) return;

  modal.setAttribute('aria-hidden', 'false');

  // Set up listeners if not already done
  setupKeyboardHelpListeners();
}

function closeKeyboardHelp() {
  const modal = document.getElementById('hints-modal');
  if (!modal) return;

  modal.setAttribute('aria-hidden', 'true');
}

function setupKeyboardHelpListeners() {
  // Close button
  const closeBtn = document.getElementById('hints-modal-close');
  if (closeBtn && !closeBtn.dataset.listenerAttached) {
    closeBtn.addEventListener('click', closeKeyboardHelp);
    closeBtn.dataset.listenerAttached = 'true';
  }

  // Got it button
  const gotItBtn = document.getElementById('hints-modal-got-it');
  if (gotItBtn && !gotItBtn.dataset.listenerAttached) {
    gotItBtn.addEventListener('click', closeKeyboardHelp);
    gotItBtn.dataset.listenerAttached = 'true';
  }

  // Backdrop
  const backdrop = document.querySelector('.hints-modal__backdrop');
  if (backdrop && !backdrop.dataset.listenerAttached) {
    backdrop.addEventListener('click', closeKeyboardHelp);
    backdrop.dataset.listenerAttached = 'true';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SPEAKER NOTES
// ═══════════════════════════════════════════════════════════════════════════

function toggleSpeakerNotes() {
  const modal = document.getElementById('notes-modal');
  if (!modal) return;

  const isOpen = modal.classList.contains('is-open');

  if (isOpen) {
    modal.classList.remove('is-open');
  } else {
    // Update notes content for current slide
    const currentSlide = slides[currentIndex];
    const slideTitle = document.getElementById('notes-slide-title');
    const notesText = document.getElementById('notes-text');

    if (slideTitle) {
      slideTitle.textContent = `Slide ${currentIndex + 1} of ${slides.length}`;
    }

    if (notesText) {
      const notes = currentSlide?.notes || currentSlide?.speaker_notes;
      if (notes) {
        notesText.textContent = notes;
      } else {
        notesText.textContent = 'No speaker notes for this slide.';
      }
    }

    modal.classList.add('is-open');
  }
}

// Setup notes modal close handlers
const notesModal = document.getElementById('notes-modal');
if (notesModal) {
  const closeBtn = notesModal.querySelector('.notes-modal__close');
  const backdrop = notesModal.querySelector('.notes-modal__backdrop');

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      notesModal.classList.remove('is-open');
    });
  }

  if (backdrop) {
    backdrop.addEventListener('click', () => {
      notesModal.classList.remove('is-open');
    });
  }

  // Close on Escape
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && notesModal.classList.contains('is-open')) {
      notesModal.classList.remove('is-open');
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// GRAPH GENERATION (Gemini 2.5 Flash Image)
// ═══════════════════════════════════════════════════════════════════════════

async function generateGraphImage(slide, containerElement) {
  const apiKey = requireGeminiApiKey();
  if (!apiKey) return;

  // Show HUD loading state
  showHudStatus('📊 Generating graph...', 'processing');

  // Show button loading state
  const button = containerElement.querySelector('.graph-generate-btn, .graph-regenerate-btn');
  if (button) {
    button.disabled = true;
    button.textContent = button.classList.contains('graph-regenerate-btn')
      ? '🔄 Generating...'
      : 'Generating...';
  }

  try {
    // Get current theme colors
    const rootStyles = getComputedStyle(document.documentElement);
    const colorSurface = rootStyles.getPropertyValue('--color-surface').trim();
    const colorSurfaceAlt = rootStyles.getPropertyValue('--color-surface-alt').trim();
    const colorAccent = rootStyles.getPropertyValue('--color-accent').trim();

    // Build prompt with theme colors and risograph style
    const normalizedOrientation = normalizeOrientation(slide.orientation) || (slide.orientation ? String(slide.orientation).toLowerCase() : '');
    const orientation = normalizedOrientation || 'landscape';
    const aspectRatio = orientation === 'portrait' ? '3:4' : orientation === 'square' ? '1:1' : '16:9';

    const prompt = `Create a clean, minimal ${orientation} graph or chart: ${slide.description || slide.title}.

Style requirements:
- Risograph print aesthetic with bold, flat colors
- Use these colors: ${colorSurface}, ${colorSurfaceAlt}, ${colorAccent}
- Clean typography, clear labels
- Data-focused, no decorative elements
- High contrast, easy to read from distance
- Professional presentation quality

The graph should be publication-ready with clear data visualization.`;

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            responseModalities: ['Image'],
            imageConfig: {
              aspectRatio: aspectRatio
            }
          }
        })
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const result = await response.json();
    const imagePart = result.candidates?.[0]?.content?.parts?.find(p => p.inlineData);

    if (!imagePart || !imagePart.inlineData) {
      throw new Error('No image data returned from API');
    }

    // Build base64 data URL
    const mimeType = imagePart.inlineData.mimeType || 'image/png';
    const imageData = `data:${mimeType};base64,${imagePart.inlineData.data}`;

    // Save to slide object
    slide.imageData = imageData;

    // Update container to show image
    containerElement.innerHTML = '';

    const img = document.createElement('img');
    img.className = 'graph-image';
    img.src = imageData;
    img.alt = slide.description || 'Generated graph';
    img.dataset.orientation = normalizeOrientation(slide.orientation);

    const regenerateBtn = document.createElement('button');
    regenerateBtn.className = 'graph-regenerate-btn';
    regenerateBtn.textContent = '🔄 Regenerate';
    regenerateBtn.addEventListener('click', () => generateGraphImage(slide, containerElement));

    containerElement.appendChild(img);
    containerElement.appendChild(regenerateBtn);

    showHudStatus('✨ Graph generated!', 'success');
    setTimeout(hideHudStatus, 2000);

  } catch (error) {
    console.error('Graph generation failed:', error);
    showHudStatus(`❌ Graph failed: ${error.message}`, 'error', {
      onRetry: () => generateGraphImage(slide, containerElement)
    });
    setTimeout(hideHudStatus, 6000);

    // Reset button
    if (button) {
      button.disabled = false;
      button.textContent = button.classList.contains('graph-regenerate-btn')
        ? '🔄 Regenerate'
        : 'Generate Graph';
    }
  }
}

// ================================================================
// Theme Drawer UI & Management
// ================================================================

// ═══════════════════════════════════════════════════════════════════════════
// Theme Generation - Palette Variants
// ═══════════════════════════════════════════════════════════════════════════

// Initialize theme drawer on deck init
async function initDeckWithTheme() {
  await loadAndApplyTheme();
  await loadAutoLinks();
  syncThemeSelectUI();

  let loadedSlides = null;
  let loadError = null;
  try {
    loadedSlides = await loadSlides();
  } catch (error) {
    loadError = error;
  }

  if (Array.isArray(loadedSlides)) {
    setSlides(loadedSlides);
  } else {
    const finalError = loadError || new Error("Unable to load slides");
    console.error("Failed to load slides", finalError);
    renderLoadError(finalError);
    return;
  }

  try {
    validateSlides(slides);
  } catch (validationError) {
    console.error("Failed to validate slides", validationError);
    renderLoadError(validationError);
    return;
  }

  const renderableSlides = slides.filter(slide => slide.type !== "_schema");
  updateTotalCounter(renderableSlides.length);

  if (!Array.isArray(renderableSlides) || renderableSlides.length === 0) {
    renderEmptyState();
    return;
  }

  const renderedElements = renderableSlides.map((slide, index) =>
    createSlide(slide, index, renderers)
  );
  setSlideElements(renderedElements);

  const fragment = document.createDocumentFragment();
  slideElements.forEach((slide) => {
    slide.style.visibility = "hidden";
    slide.style.pointerEvents = "none";
    fragment.appendChild(slide);
  });
  slidesRoot.appendChild(fragment);
  updateOverviewLayout();

  initKeyboardNav(getKeyboardContext());
  slidesRoot.addEventListener("click", handleSlideClick);
  document.addEventListener("click", handleImageModalTrigger);
  document.addEventListener("paste", handleGlobalPaste);

  const uploadInput = document.getElementById('deck-upload');
  if (uploadInput) {
    uploadInput.addEventListener('change', handleDeckUpload);
  }

  initVoiceButtons({
    openSettingsModal,
    showApiKeyStatus,
    showHudStatus,
    hideHudStatus,
    getCurrentIndex: () => currentIndex,
    getSlides: () => slides,
    insertSlideAt,
    replaceSlideAt,
    setActiveSlide,
    setOverviewCursor,
    updateSlide: (index, slide) => { slides[index] = slide; },
    validateSlides,
    downloadTheme,
  });

  const homeBtn = document.getElementById('home-btn');
  if (homeBtn) {
    homeBtn.addEventListener('click', () => {
      window.location.href = 'index.html';
    });
  }

  const helpBtn = document.getElementById('help-btn');
  if (helpBtn) {
    helpBtn.addEventListener('click', openKeyboardHelp);
  }

  const overviewBtn = document.getElementById('overview-btn');
  if (overviewBtn) {
    overviewBtn.addEventListener('click', toggleOverview);
  }

  // Initialize deck name display and rename functionality
  initDeckName();

  // Initialize theme drawer
  initThemeDrawer();

  // Show intro modal on first visit
  showIntroModalIfFirstVisit();

  // Show keyboard hints on first visit
  showKeyboardHintsIfFirstVisit();

  // Initialize share modal
  initShareModal();

  setActiveSlide(0);
  updateOverviewButton();
  setOverviewCursor(currentIndex);
  handleInitialIntent();

  // Mark initialization as complete
  isInitializing = false;
  isInitialized = true;
  console.log('[Init] initDeckWithTheme completed');
}

function handleInitialIntent() {
  const openIntent = getParam('open');
  if (!openIntent) return;

  requestAnimationFrame(() => {
    if (openIntent === 'theme') {
      openThemeDrawer();
    } else if (openIntent === 'settings') {
      openSettingsModal();
    } else if (openIntent === 'edit') {
      openEditDrawer();
    }
  });
}

// ================================================================
// Intro Modal (First Visit)
// ================================================================

function showIntroModalIfFirstVisit() {
  const INTRO_SEEN_KEY = 'slideomatic_intro_seen';
  const introModal = document.getElementById('intro-modal');
  const closeBtn = document.getElementById('intro-modal-close');

  if (!introModal) return;

  // Check if user has seen intro before
  const hasSeenIntro = localStorage.getItem(INTRO_SEEN_KEY);

  if (!hasSeenIntro) {
    // Show intro modal with slight delay for effect
    setTimeout(() => {
      introModal.classList.add('is-open');
    }, 800);

    // Close button handler
    closeBtn?.addEventListener('click', () => {
      introModal.classList.remove('is-open');
      localStorage.setItem(INTRO_SEEN_KEY, 'true');
    });

    // Close on backdrop click
    const backdrop = introModal.querySelector('.intro-modal__backdrop');
    backdrop?.addEventListener('click', () => {
      introModal.classList.remove('is-open');
      localStorage.setItem(INTRO_SEEN_KEY, 'true');
    });
  }
}

function showKeyboardHintsIfFirstVisit() {
  const HINTS_SEEN_KEY = 'slideomatic_hints_seen';
  const hintsModal = document.getElementById('hints-modal');
  const closeBtn = document.getElementById('hints-modal-close');
  const gotItBtn = document.getElementById('hints-modal-got-it');
  const backdrop = hintsModal?.querySelector('.hints-modal__backdrop');

  if (!hintsModal) return;

  // Check if user has seen hints before
  const hasSeenHints = localStorage.getItem(HINTS_SEEN_KEY);

  if (!hasSeenHints) {
    // Show hints modal with slight delay for effect
    setTimeout(() => {
      hintsModal.setAttribute('aria-hidden', 'false');
    }, 1000);

    const closeHints = () => {
      hintsModal.setAttribute('aria-hidden', 'true');
      localStorage.setItem(HINTS_SEEN_KEY, 'true');
    };

    // Close button handler
    closeBtn?.addEventListener('click', closeHints);

    // "Got it" button handler
    gotItBtn?.addEventListener('click', closeHints);

    // Backdrop click to close
    backdrop?.addEventListener('click', closeHints);

    // ESC key to close
    document.addEventListener('keydown', function handleHintsEsc(event) {
      if (event.key === 'Escape' && hintsModal.getAttribute('aria-hidden') === 'false') {
        closeHints();
        document.removeEventListener('keydown', handleHintsEsc);
      }
    });
  }
}

// ================================================================
// Share Modal & Functionality
// ================================================================

function initShareModal() {
  const shareBtn = document.getElementById('share-deck-btn');
  const shareModal = document.getElementById('share-modal');
  const closeBtn = document.getElementById('share-modal-close');
  const backdrop = shareModal?.querySelector('.share-modal__backdrop');
  const copyBtn = document.getElementById('share-copy-btn');
  const urlInput = document.getElementById('share-url-input');
  const qrContainer = document.getElementById('share-qr-code');
  const statusDiv = document.getElementById('share-status');

  if (!shareBtn || !shareModal) return;

  shareBtn.addEventListener('click', async () => {
    await openShareModal();
  });

  closeBtn?.addEventListener('click', closeShareModal);
  backdrop?.addEventListener('click', closeShareModal);

  copyBtn?.addEventListener('click', () => {
    if (urlInput?.value) {
      navigator.clipboard.writeText(urlInput.value).then(() => {
        showShareStatus('✓ Link copied to clipboard!', 'success');
        setTimeout(() => hideShareStatus(), 2000);
      }).catch(() => {
        showShareStatus('⚠️ Failed to copy. Try selecting and copying manually.', 'error');
      });
    }
  });

  function showShareStatus(message, type) {
    if (!statusDiv) return;
    statusDiv.textContent = message;
    statusDiv.className = `share-modal__status is-visible is-${type}`;
  }

  function hideShareStatus() {
    if (!statusDiv) return;
    statusDiv.className = 'share-modal__status';
  }

  async function openShareModal() {
    shareModal.classList.add('is-open');
    shareModal.setAttribute('aria-hidden', 'false');

    // Reset state
    if (urlInput) urlInput.value = '';
    if (qrContainer) qrContainer.innerHTML = '';
    showShareStatus('🔗 Generating share link...', 'loading');

    try {
      const shareUrl = await generateShareUrl();
      if (urlInput) urlInput.value = shareUrl;
      generateQRCode(shareUrl);
      showShareStatus('✓ Ready to share!', 'success');
      setTimeout(() => hideShareStatus(), 3000);
    } catch (error) {
      console.error('Share failed:', error);
      showShareStatus(`❌ ${error.message}`, 'error');
    }
  }

  function closeShareModal() {
    shareModal.classList.remove('is-open');
    shareModal.setAttribute('aria-hidden', 'true');
    hideShareStatus();
  }

  async function generateShareUrl() {
    const deckPayload = {
      version: 1,
      slides,
      theme: getCurrentTheme(),
      meta: {
        title: deriveDeckName(slides),
        createdAt: Date.now(),
      },
    };

    let response;
    try {
      response = await fetch('/.netlify/functions/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(deckPayload),
      });
    } catch (networkError) {
      throw new Error('Share service unavailable. Use `netlify dev` locally or the deployed site.');
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      // Ignore JSON parse failure; handled below
    }

    if (!response.ok) {
      const message = payload?.error || 'Unable to create share link';
      throw new Error(message);
    }

    if (!payload?.shareUrl && !payload?.id) {
      throw new Error('Share link response missing id');
    }

    return payload.shareUrl || buildShareUrlFromId(payload.id);
  }

  function buildShareUrlFromId(id) {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('share', id);
    return url.toString();
  }

  function generateQRCode(url) {
    if (!qrContainer) return;
    if (typeof QRCodeStyling === 'undefined') {
      qrContainer.innerHTML = '<p style="color: #666;">QR code unavailable</p>';
      return;
    }

    qrContainer.innerHTML = '';

    // Get colors from current theme, or use default pastel gradient
    const themeColors = getThemeColorsForQR();

    // QR code styling matching your QR buddy's approach!
    const qrCode = new QRCodeStyling({
      width: 400,
      height: 400,
      margin: 20,
      type: "canvas",
      data: url,
      qrOptions: {
        typeNumber: 0,
        mode: "Byte",
        errorCorrectionLevel: "Q" // 25% recovery - perfect for styled codes
      },
      dotsOptions: {
        type: "rounded", // Better for gradients + scans
        gradient: {
          type: "linear",
          rotation: 0.785, // 45deg
          colorStops: [
            { offset: 0, color: themeColors[0] },
            { offset: 0.5, color: themeColors[1] },
            { offset: 1, color: themeColors[2] }
          ]
        }
      },
      backgroundOptions: {
        color: themeColors[3] // Background color
      },
      cornersSquareOptions: {
        type: "extra-rounded",
        gradient: {
          type: "linear",
          rotation: 0.785,
          colorStops: [
            { offset: 0, color: themeColors[0] },
            { offset: 0.5, color: themeColors[1] },
            { offset: 1, color: themeColors[2] }
          ]
        }
      },
      cornersDotOptions: {
        type: "dot",
        gradient: {
          type: "linear",
          rotation: 0.785,
          colorStops: [
            { offset: 0, color: themeColors[0] },
            { offset: 0.5, color: themeColors[1] },
            { offset: 1, color: themeColors[2] }
          ]
        }
      }
    });

    qrCode.append(qrContainer);
  }

  function getThemeColorsForQR() {
    // Try to get colors from current theme
    const currentTheme = getCurrentTheme();

    if (currentTheme && currentTheme.palette) {
      const palette = currentTheme.palette;

      // Extract 3-4 vibrant colors from theme
      const colors = [];

      // Look for accent/primary colors first
      if (palette.accent) colors.push(palette.accent);
      if (palette.primary) colors.push(palette.primary);
      if (palette.secondary) colors.push(palette.secondary);

      // Fill in with other theme colors if needed
      if (colors.length < 3 && palette.text) colors.push(palette.text);
      if (colors.length < 3 && palette.background) {
        // Use background but lightened
        colors.push(lightenColor(palette.background, 0.3));
      }

      // Pad with defaults if theme doesn't have enough colors
      while (colors.length < 3) {
        colors.push('#FF73C8', '#9CCAFF', '#FFE26F');
      }

      // Background color (use theme bg or white)
      const bgColor = palette.background || '#FFFFFF';

      return [colors[0], colors[1], colors[2], bgColor];
    }

    // Default pastel gradient (matching your aesthetic)
    return [
      '#FF73C8', // Pink
      '#9CCAFF', // Blue
      '#FFE26F', // Yellow
      '#FFFFFF'  // White bg
    ];
  }

  function lightenColor(color, amount) {
    // Simple color lightener
    const num = parseInt(color.replace('#', ''), 16);
    const r = Math.min(255, ((num >> 16) & 0xFF) + Math.floor(255 * amount));
    const g = Math.min(255, ((num >> 8) & 0xFF) + Math.floor(255 * amount));
    const b = Math.min(255, (num & 0xFF) + Math.floor(255 * amount));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }
}
