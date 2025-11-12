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
import { formatBytes, clamp, fileToBase64, escapeHtml } from './modules/utils.js';
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
  initSlideIndex,
  toggleSlideIndex,
  closeSlideIndex,
  refreshSlideIndex,
  updateSlideIndexHighlight,
} from './slide-index.js';

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

  // Toast notifications
  TOAST: {
    MAX_ACTIVE: 5,                     // Maximum simultaneous toasts
    SUCCESS_DURATION: 2000,            // Auto-hide after 2s
    ERROR_DURATION: 3000,              // Auto-hide after 3s
    WARNING_DURATION: 3000,            // Auto-hide after 3s
    INFO_DURATION: 2500,               // Auto-hide after 2.5s
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

const slidesRoot = document.getElementById("slides");
const currentCounter = document.querySelector("[data-counter-current]");
const totalCounter = document.querySelector("[data-counter-total]");
const progressBar = document.querySelector("[data-progress]");
const urlParams = new URLSearchParams(window.location.search);
const requestedDeck = urlParams.get('deck');

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

// ═══════════════════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

let slides = [];
let slideElements = [];
let currentIndex = 0;
let isOverview = false;
const preloadedImages = new Set();
let autoLinkConfigs = [];
let overviewRowCount = 1;
let overviewColumnCount = 0;
let overviewCursor = 0;
let lastOverviewHighlight = 0;
let isThemeDrawerOpen = false;
let themeDrawerInstance = null;
const slideScrollPositions = new Map();
const DECK_STORAGE_PREFIX = 'slideomatic_deck_overrides:';
const LAST_DECK_KEY = 'slideomatic:last-deck';
let deckStorageKey = null;
let deckPersistFailureNotified = false;
let activeDeckId = null;
let isNewDeckRequest = false;

if (requestedDeck) {
  if (requestedDeck === 'new') {
    isNewDeckRequest = true;
    activeDeckId = generateDeckId();
    urlParams.set('deck', activeDeckId);
    const nextSearch = urlParams.toString();
    const nextUrl = `${window.location.pathname}?${nextSearch}${window.location.hash ?? ''}`;
    if (window.history && typeof window.history.replaceState === 'function') {
      window.history.replaceState({}, '', nextUrl);
    }
  } else {
    activeDeckId = requestedDeck;
  }
}

// ================================================================
// Theme Library - localStorage persistence
// ================================================================


// ================================================================
// AI Theme Generation
// ================================================================

async function generateThemeWithAI(description) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('No API key set. Press S to open settings and add your Gemini API key.');
  }

  const sanitizedDescription = typeof description === 'string'
    ? description.replace(/`/g, "'")
    : '';

  const prompt = `You are a theme designer for a presentation app called Slide-O-Matic.

User description:
${sanitizedDescription || '(no additional description provided)'}

The theme should use these CSS variables (all are required):

{
  "color-bg": "<main background color - usually light>",
  "background-surface": "<gradient or solid for backdrop>",
  "background-overlay": "<subtle texture overlay>",
  "background-opacity": "<0-1 for overlay opacity>",
  "slide-bg": "<slide background with rgba for transparency>",
  "slide-border-color": "<slide border color>",
  "slide-border-width": "<border thickness, e.g. '5px'>",
  "slide-shadow": "<CSS box-shadow>",
  "color-surface": "<primary accent color>",
  "color-surface-alt": "<secondary accent color>",
  "color-accent": "<highlight color for badges>",
  "badge-bg": "<badge background>",
  "badge-color": "<badge text color>",
  "color-ink": "<main text color>",
  "color-muted": "<muted text color>",
  "border-width": "<default border width>",
  "gutter": "<spacing - use clamp()>",
  "radius": "<border radius>",
  "font-sans": "<sans-serif font stack>",
  "font-mono": "<monospace font stack>",
  "shadow-sm": "<small shadow>",
  "shadow-md": "<medium shadow>",
  "shadow-lg": "<large shadow>",
  "shadow-xl": "<extra large shadow>"
}

Design Guidelines:
- Create harmonious color palettes (60-30-10 rule)
- Ensure good contrast (4.5:1 minimum for text)
- Use rgba() for transparent backgrounds
- Shadows should match the theme mood (hard shadows for punk/bold, soft for calm)
- Choose appropriate fonts that match the vibe
- Keep gradients subtle and tasteful

Return ONLY valid JSON, no markdown or explanation.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 2048,
        }
      })
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Gemini API call failed');
  }

  const result = await response.json();
  const generatedText = result.candidates[0]?.content?.parts[0]?.text;
  if (!generatedText) {
    throw new Error('No response from Gemini');
  }

  // Extract JSON from response (might be wrapped in markdown)
  const jsonMatch = generatedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ||
                    generatedText.match(/\{[\s\S]*\}/);

  const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : generatedText;
  const theme = JSON.parse(jsonText);

  return normalizeThemeTokens(theme);
}

// ═══════════════════════════════════════════════════════════════════════════
// DECK INITIALIZATION & LOADING
// ═══════════════════════════════════════════════════════════════════════════
// Main entry point and deck setup orchestration
// ═══════════════════════════════════════════════════════════════════════════

initDeckWithTheme();

async function initDeck() {
  await loadAndApplyTheme();
  await loadAutoLinks();

  let loadedSlides = null;
  let loadError = null;
  try {
    loadedSlides = await loadSlides();
  } catch (error) {
    loadError = error;
  }

  const storedSlides = activeDeckId ? null : loadPersistedDeck();
  let usedStoredDeck = false;

  if (activeDeckId) {
    if (Array.isArray(loadedSlides)) {
      slides = loadedSlides;
      usedStoredDeck = !isNewDeckRequest;
    }
  } else if (Array.isArray(storedSlides)) {
    slides = storedSlides;
    usedStoredDeck = true;
  } else if (Array.isArray(loadedSlides)) {
    slides = loadedSlides;
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

  if (usedStoredDeck) {
    console.info('Slide-o-Matic: loaded deck overrides from localStorage.');
  }

  markDeckAsRecent();
  // Filter out schema/docs slides before rendering
  const renderableSlides = slides.filter(slide => slide.type !== "_schema");

  totalCounter.textContent = renderableSlides.length;

  if (!Array.isArray(renderableSlides) || renderableSlides.length === 0) {
    renderEmptyState();
    return;
  }

  slideElements = renderableSlides.map((slide, index) =>
    createSlide(slide, index, renderers)
  );

  const fragment = document.createDocumentFragment();
  slideElements.forEach((slide) => {
    slide.style.visibility = "hidden";
    slide.style.pointerEvents = "none";
    fragment.appendChild(slide);
  });
  slidesRoot.appendChild(fragment);
  updateOverviewLayout();

  initSlideIndex({
    getSlides: () => slides,
    getCurrentIndex: () => currentIndex,
    setActiveSlide: (index) => setActiveSlide(index),
  });
  refreshSlideIndex();

  initKeyboardNav(getKeyboardContext());
  slidesRoot.addEventListener("click", handleSlideClick);
  document.addEventListener("click", handleImageModalTrigger);

  // Setup deck upload
  const uploadInput = document.getElementById('deck-upload');
  if (uploadInput) {
    uploadInput.addEventListener('change', handleDeckUpload);
  }

  // Setup voice-driven actions
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
    setOverviewCursor: (index) => { overviewCursor = index; },
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

  const editBtn = document.getElementById('edit-btn');
  if (editBtn) {
    editBtn.addEventListener('click', toggleEditDrawer);
  }

  const overviewBtn = document.getElementById('overview-btn');
  if (overviewBtn) {
    overviewBtn.addEventListener('click', toggleOverview);
  }

  const saveDeckBtn = document.getElementById('save-deck-btn');
  if (saveDeckBtn) {
    saveDeckBtn.addEventListener('click', () => {
      const persisted = downloadDeck();
      if (persisted) {
        showHudStatus('💾 Deck downloaded', 'success');
        setTimeout(hideHudStatus, 1600);
      }
    });
  }

  // Theme select now handled in initThemeDrawer()

  setActiveSlide(0);
  updateOverviewButton();
  overviewCursor = currentIndex;
}

async function loadSlides() {
  // Priority 1: Check for ?url= parameter (shareable links)
  const urlParam = urlParams.get("url");
  if (urlParam) {
    try {
      const response = await fetch(urlParam);
      if (!response.ok) {
        throw new Error(`Failed to fetch from URL: ${urlParam}`);
      }
      const data = await response.json();
      if (Array.isArray(data)) {
        showHudStatus('✓ Loaded deck from URL', 'success');
        setTimeout(hideHudStatus, 2000);
        return data;
      }
    } catch (error) {
      console.error("Failed to load deck from URL", error);
      showHudStatus('⚠️ Failed to load deck from URL', 'error');
      setTimeout(hideHudStatus, 3000);
    }
  }

  // Priority 2: Check for ?data= parameter (base64 encoded deck)
  const dataParam = urlParams.get("data");
  if (dataParam) {
    try {
      const decoded = decodeURIComponent(escape(atob(dataParam)));
      const data = JSON.parse(decoded);
      if (Array.isArray(data)) {
        showHudStatus('✓ Loaded deck from share link', 'success');
        setTimeout(hideHudStatus, 2000);
        return data;
      }
    } catch (error) {
      console.error("Failed to load deck from data parameter", error);
      showHudStatus('⚠️ Failed to load shared deck', 'error');
      setTimeout(hideHudStatus, 3000);
    }
  }

  // Priority 3: Check for localStorage deck
  if (activeDeckId) {
    const stored = loadPersistedDeck();
    if (Array.isArray(stored)) {
      return stored.slice();
    }
    // Bootstrap a blank deck if we were asked to start fresh or if the deck was removed.
    slides = [getSlideTemplate('title')];
    persistSlides({ suppressWarning: true });
    return slides.slice();
  }

  // Priority 3: No defaults - start with a blank deck
  return [getSlideTemplate('title')];
}

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
  const params = new URLSearchParams(window.location.search);
  const themeParam = params.get("theme");
  if (!themeParam) return "theme.json";
  if (themeParam.endsWith(".json")) {
    return themeParam;
  }
  if (themeParam.includes("/")) {
    return `${themeParam}.json`;
  }
  return `themes/${themeParam}.json`;
}

function resolveSlidesPath() {
  const params = new URLSearchParams(window.location.search);
  const slidesParam = params.get("slides");
  if (!slidesParam) {
    return "slides.json";
  }
  if (slidesParam.endsWith(".json")) {
    return slidesParam;
  }
  return `${slidesParam}.json`;
}

function getDeckStorageKey() {
  if (deckStorageKey) return deckStorageKey;
  if (activeDeckId) {
    deckStorageKey = `${DECK_STORAGE_PREFIX}${encodeURIComponent(activeDeckId)}`;
    return deckStorageKey;
  }
  const path = resolveSlidesPath();
  try {
    const url = new URL(path, window.location.href);
    const keySource = `${url.origin}${url.pathname}${url.search ?? ""}`;
    deckStorageKey = `${DECK_STORAGE_PREFIX}${encodeURIComponent(keySource)}`;
  } catch (error) {
    deckStorageKey = `${DECK_STORAGE_PREFIX}${encodeURIComponent(path)}`;
  }
  return deckStorageKey;
}

function loadPersistedDeck() {
  try {
    const stored = localStorage.getItem(getDeckStorageKey());
    if (!stored) return null;
    const payload = JSON.parse(stored);
    if (!payload || typeof payload !== 'object') return null;
    if (!Array.isArray(payload.slides)) return null;
    return payload.slides;
  } catch (error) {
    console.warn('Failed to load deck overrides from localStorage:', error);
    try {
      localStorage.removeItem(getDeckStorageKey());
    } catch (_) {
      // Ignore cleanup failure – nothing else we can do.
    }
    return null;
  }
}

function persistSlides(options = {}) {
  const { suppressWarning = false } = options;
  if (!Array.isArray(slides)) return false;
  try {
    const updatedAt = Date.now();
    const source = activeDeckId ? `local:${activeDeckId}` : resolveSlidesPath();
    const payload = {
      version: 1,
      updatedAt,
      source,
      slides,
      meta: {
        name: deriveDeckName(slides),
        updatedAt,
        deckId: activeDeckId ?? null,
      },
    };
    localStorage.setItem(getDeckStorageKey(), JSON.stringify(payload));
    deckPersistFailureNotified = false;
    markDeckAsRecent();
    return true;
  } catch (error) {
    console.warn('Unable to persist deck edits to localStorage:', error);
    if (!deckPersistFailureNotified && !suppressWarning) {
      try {
        showHudStatus('⚠️ Unable to save edits locally', 'warning');
        setTimeout(hideHudStatus, 2400);
      } catch (_) {
        // HUD not available; ignore.
      }
      deckPersistFailureNotified = true;
    }
    return false;
  }
}

function clearPersistedDeck() {
  try {
    localStorage.removeItem(getDeckStorageKey());
    deckPersistFailureNotified = false;
  } catch (error) {
    console.warn('Failed to clear deck overrides from localStorage:', error);
  }
}

function generateDeckId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `deck-${crypto.randomUUID()}`;
  }
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `deck-${Date.now().toString(36)}-${randomPart}`;
}

function markDeckAsRecent() {
  if (!activeDeckId) return;
  try {
    localStorage.setItem(LAST_DECK_KEY, activeDeckId);
  } catch (error) {
    console.warn('Unable to record last deck ID:', error);
  }
}

function deriveDeckName(slideList) {
  if (!Array.isArray(slideList) || slideList.length === 0) {
    return 'Untitled deck';
  }
  const first = slideList[0] ?? {};
  const textCandidate =
    first.title ||
    first.headline ||
    first.eyebrow ||
    first.quote ||
    (Array.isArray(first.body) ? first.body[0] : first.body) ||
    first.badge;
  if (typeof textCandidate === 'string' && textCandidate.trim()) {
    return textCandidate.trim();
  }
  return 'Untitled deck';
}

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


function handleSlideClick(event) {
  if (!isOverview) return;
  const targetSlide = event.target.closest(".slide");
  if (!targetSlide) return;
  const targetIndex = Number.parseInt(targetSlide.dataset.index, 10);
  if (Number.isNaN(targetIndex)) return;
  exitOverview(targetIndex);
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERVIEW MODE
// ═══════════════════════════════════════════════════════════════════════════
// Grid view of all slides for quick navigation
// ═══════════════════════════════════════════════════════════════════════════

function toggleOverview() {
  if (isOverview) {
    exitOverview();
    return;
  }
  enterOverview();
}

function enterOverview() {
  closeSlideIndex();
  closeThemeDrawer();
  document.body.dataset.mode = "overview";
  updateOverviewLayout();
  slideElements.forEach((slide) => {
    slide.style.visibility = "visible";
    slide.style.pointerEvents = "auto";
    slide.setAttribute("aria-hidden", "false");
    slide.tabIndex = 0;
  });
  isOverview = true;
  overviewCursor = clamp(currentIndex, 0, slideElements.length - 1);
  highlightOverviewSlide(overviewCursor);
  const focusedSlide = slideElements[overviewCursor];
  if (focusedSlide) {
    requestAnimationFrame(() => focusedSlide.focus({ preventScroll: true }));
  }
  updateOverviewButton();
}

function exitOverview(targetIndex = currentIndex) {
  delete document.body.dataset.mode;
  isOverview = false;
  slideElements.forEach((slide, index) => {
    if (index !== targetIndex) {
      slide.style.visibility = "hidden";
      slide.style.pointerEvents = "none";
      slide.setAttribute("aria-hidden", "true");
    }
    slide.classList.remove('is-active');
    slide.tabIndex = -1;
  });
  setActiveSlide(targetIndex);
  overviewCursor = currentIndex;
  lastOverviewHighlight = overviewCursor;
  updateOverviewButton();
}

function updateOverviewButton() {
  const overviewBtn = document.getElementById('overview-btn');
  if (!overviewBtn) return;
  if (isOverview) {
    overviewBtn.textContent = "Slides";
    overviewBtn.setAttribute('aria-label', 'Exit overview');
    overviewBtn.title = 'Return to active slide';
  } else {
    overviewBtn.textContent = "Overview";
    overviewBtn.setAttribute('aria-label', 'View all slides');
    overviewBtn.title = 'View all slides';
  }
}

function updateOverviewLayout() {
  const totalSlides = slideElements.length;
  if (!totalSlides) return;
  overviewRowCount = 1;
  overviewColumnCount = totalSlides;
  slidesRoot.style.setProperty('--overview-row-count', overviewRowCount);
  slidesRoot.style.setProperty('--overview-column-count', overviewColumnCount);
  overviewCursor = clamp(overviewCursor, 0, totalSlides - 1);
  if (isOverview) {
    highlightOverviewSlide(overviewCursor, { scroll: false });
  } else {
    overviewCursor = clamp(currentIndex, 0, totalSlides - 1);
    lastOverviewHighlight = overviewCursor;
  }
}

function highlightOverviewSlide(index, { scroll = true } = {}) {
  const totalSlides = slideElements.length;
  if (!totalSlides) return;
  const clamped = clamp(index, 0, totalSlides - 1);
  const previous = slideElements[lastOverviewHighlight];
  if (previous) {
    previous.classList.remove('is-active');
    previous.tabIndex = -1;
  }

  overviewCursor = clamped;
  const current = slideElements[overviewCursor];
  if (current) {
    current.classList.add('is-active');
    current.tabIndex = 0;
    if (scroll) {
      current.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
  }
  lastOverviewHighlight = overviewCursor;
}

function moveOverviewCursorBy(deltaColumn, deltaRow) {
  const totalSlides = slideElements.length;
  if (!totalSlides) return;
  const delta = deltaColumn !== 0 ? deltaColumn : deltaRow;
  if (!delta) return;
  const nextIndex = clamp(overviewCursor + delta, 0, totalSlides - 1);
  highlightOverviewSlide(nextIndex);
}

window.addEventListener('resize', () => {
  if (!slideElements.length) return;
  updateOverviewLayout();
  if (isOverview) {
    highlightOverviewSlide(overviewCursor, { scroll: false });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// NAVIGATION & SLIDE CONTROL
// ═══════════════════════════════════════════════════════════════════════════
// Functions for navigating between slides and managing active state
// ═══════════════════════════════════════════════════════════════════════════

function setActiveSlide(nextIndex) {
  const clamped = clamp(nextIndex, 0, slideElements.length - 1);
  if (!isOverview && clamped === currentIndex && slideElements[currentIndex].classList.contains("is-active")) {
    updateHud();
    return;
  }

  // Save reference to old slide before changing index
  const oldSlide = slideElements[currentIndex];
  if (oldSlide) {
    slideScrollPositions.set(currentIndex, oldSlide.scrollTop);
  }

  // Remove active from old slide
  oldSlide.classList.remove("is-active");
  oldSlide.classList.add("is-leaving");
  oldSlide.style.pointerEvents = "none";
  oldSlide.setAttribute("aria-hidden", "true");

  // Clean up old slide after transition
  setTimeout(() => {
    oldSlide.classList.remove("is-leaving");
    if (!oldSlide.classList.contains("is-active")) {
      oldSlide.style.visibility = "hidden";
    }
  }, 400);

  // Update to new index
  currentIndex = clamped;

  // Show new slide immediately
  const newSlide = slideElements[currentIndex];
  newSlide.style.visibility = "visible";
  newSlide.style.pointerEvents = isOverview ? "none" : "auto";
  newSlide.setAttribute("aria-hidden", "false");
  const previousScroll = slideScrollPositions.get(currentIndex) || 0;
  newSlide.scrollTop = previousScroll;
  newSlide.querySelectorAll('img[data-src]').forEach(loadLazyImage);
  slideElements[currentIndex].classList.add("is-active");
  slideElements[currentIndex].scrollIntoView({ block: "center" });
  overviewCursor = currentIndex;
  lastOverviewHighlight = currentIndex;
  updateOverviewButton();

  updateHud();
  updateSlideIndexHighlight(currentIndex);
  if (isEditDrawerOpen) {
    renderEditForm(getEditDrawerContext());
  }
  preloadSlideImages(currentIndex);
  preloadSlideImages(currentIndex + 1);
  preloadSlideImages(currentIndex + 2);
}

function updateHud() {
  // Animate counter change
  const counterEl = currentCounter.parentElement;
  counterEl.classList.add('updating');
  setTimeout(() => counterEl.classList.remove('updating'), 300);

  currentCounter.textContent = currentIndex + 1;
  const progress = ((currentIndex + 1) / slideElements.length) * 100;
  progressBar.style.width = `${progress}%`;

  // Update speaker notes indicator
  const notesIndicator = document.getElementById('notes-indicator');
  if (notesIndicator) {
    const currentSlide = slides[currentIndex];
    const hasNotes = currentSlide?.notes || currentSlide?.speaker_notes;
    if (hasNotes) {
      notesIndicator.removeAttribute('hidden');
      notesIndicator.onclick = toggleSpeakerNotes;
    } else {
      notesIndicator.setAttribute('hidden', '');
    }
  }
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

function preloadImage(src) {
  if (!src || preloadedImages.has(src)) return;
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  preloadedImages.add(src);
}

function preloadSlideImages(index) {
  const slide = slideElements[index];
  if (!slide) return;
  const images = slide.querySelectorAll("img[data-modal-src]");
  images.forEach((img) => {
    if (img.dataset && img.dataset.src) {
      loadLazyImage(img);
    }
    const src = img.dataset.modalSrc || img.currentSrc || img.src;
    preloadImage(src);
  });
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
  const apiKey = localStorage.getItem('gemini_api_key');
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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: decisionPrompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 100,
          }
        })
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
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
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
        const imageConfig = JSON.parse(placeholder.dataset.placeholderFor || '{}');
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

function downloadDeck() {
  const persisted = persistSlides();
  const json = JSON.stringify(slides, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'slides.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  console.log('✓ Deck downloaded as slides.json');
  return persisted;
}

function handleDeckUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      const newSlides = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.slides)
        ? parsed.slides
        : null;

      if (!newSlides) {
        throw new Error('File must contain a JSON array of slides.');
      }

      validateSlides(newSlides);

      // Replace current slides
      slides = newSlides;

      // Reload deck with new slides
      reloadDeck({ targetIndex: 0 });
      const persisted = persistSlides();

      if (persisted) {
        showHudStatus(`📂 Loaded ${newSlides.length} slides`, 'success');
        setTimeout(hideHudStatus, 1600);
      }
      console.log(`✓ Loaded ${slides.length} slides from ${file.name}`);
    } catch (error) {
      console.error('Failed to load deck:', error);
      alert(`Failed to load deck: ${error.message}`);
    }
  };

  reader.readAsText(file);

  // Reset input so the same file can be uploaded again
  event.target.value = '';
}

function reloadDeck(options = {}) {
  const { targetIndex = currentIndex, focus = true } = options;
  // Clear existing slides
  slidesRoot.innerHTML = '';
  slideScrollPositions.clear();

  // Filter out schema slides
  const renderableSlides = slides.filter(slide => slide.type !== "_schema");

  totalCounter.textContent = renderableSlides.length;

  if (!Array.isArray(renderableSlides) || renderableSlides.length === 0) {
    renderEmptyState();
    return;
  }

  // Re-render all slides
  slideElements = renderableSlides.map((slide, index) =>
    createSlide(slide, index, renderers)
  );

  const fragment = document.createDocumentFragment();
  slideElements.forEach((slide) => {
    slide.style.visibility = "hidden";
    slide.style.pointerEvents = "none";
    fragment.appendChild(slide);
  });
  slidesRoot.appendChild(fragment);
  updateOverviewLayout();
  refreshSlideIndex();

  const clampedIndex = clamp(
    typeof targetIndex === "number" ? targetIndex : 0,
    0,
    renderableSlides.length - 1
  );

  if (focus) {
    setActiveSlide(clampedIndex);
  } else {
    currentIndex = clampedIndex;
  }
}

// ===================================================================
// EDIT DRAWER
// ===================================================================

let isEditDrawerOpen = false;
let editDrawerInstance = null;


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



editDrawerInstance = createDrawer({
  id: 'edit-drawer',
  onOpen: () => {
    isEditDrawerOpen = true;
    // renderEditForm is now called before opening for smooth animation
    const closeBtn = editDrawerInstance.element.querySelector('.edit-drawer__close');
    if (closeBtn && !closeBtn.dataset.listenerAttached) {
      closeBtn.addEventListener('click', () => closeDrawer(editDrawerInstance));
      closeBtn.dataset.listenerAttached = 'true';
    }
  },
  onClose: () => {
    isEditDrawerOpen = false;
  },
});

function shiftScrollPositions(startIndex, delta) {
  if (!slideScrollPositions.size || delta === 0) return;
  const updated = new Map();
  slideScrollPositions.forEach((value, key) => {
    if (key >= startIndex) {
      const nextKey = key + delta;
      if (nextKey >= 0) {
        updated.set(nextKey, value);
      }
    } else {
      updated.set(key, value);
    }
  });
  slideScrollPositions.clear();
  updated.forEach((value, key) => slideScrollPositions.set(key, value));
}

function reindexSlides(startIndex = 0) {
  for (let index = Math.max(0, startIndex); index < slideElements.length; index += 1) {
    const slideElement = slideElements[index];
    if (!slideElement) continue;
    slideElement.dataset.index = index;
    const autoBadge = slideElement.querySelector(':scope > .badge[data-badge-auto="true"]');
    if (autoBadge) {
      autoBadge.textContent = `+ Slide ${index + 1}`;
    }
  }
}

function insertSlideAt(index, slideData, options = {}) {
  const { activate = false } = options;
  if (index < 0) index = 0;
  if (index > slides.length) index = slides.length;

  slides.splice(index, 0, slideData);
  shiftScrollPositions(index, 1);

  const newSlideElement = createSlide(slideData, index, renderers);
  if (isOverview) {
    newSlideElement.style.visibility = 'visible';
    newSlideElement.style.pointerEvents = 'auto';
    newSlideElement.setAttribute('aria-hidden', 'false');
    newSlideElement.tabIndex = 0;
  } else {
    newSlideElement.style.visibility = 'hidden';
    newSlideElement.style.pointerEvents = 'none';
    newSlideElement.setAttribute('aria-hidden', 'true');
    newSlideElement.tabIndex = -1;
  }

  const existingElement = slideElements[index];
  if (existingElement && existingElement.parentElement) {
    existingElement.parentElement.insertBefore(newSlideElement, existingElement);
  } else {
    slidesRoot.appendChild(newSlideElement);
  }

  slideElements.splice(index, 0, newSlideElement);
  reindexSlides(index);

  totalCounter.textContent = slideElements.length;
  updateOverviewLayout();
  refreshSlideIndex();

  if (!activate) {
    if (!isOverview && index <= currentIndex) {
      currentIndex = clamp(currentIndex + 1, 0, slideElements.length - 1);
    }
    if (isOverview && index <= overviewCursor) {
      overviewCursor = clamp(overviewCursor + 1, 0, slideElements.length - 1);
    }
  }

  if (activate) {
    if (isOverview) {
      highlightOverviewSlide(index);
    } else {
      setActiveSlide(index);
    }
  } else if (!isOverview) {
    updateHud();
  } else {
    overviewCursor = clamp(overviewCursor, 0, slideElements.length - 1);
    highlightOverviewSlide(overviewCursor, { scroll: false });
  }

  updateSlideIndexHighlight(isOverview ? overviewCursor : currentIndex);
  persistSlides();

  return newSlideElement;
}

function removeSlideAt(index, options = {}) {
  const { focus = true } = options;
  if (index < 0 || index >= slides.length) return;

  slides.splice(index, 1);
  persistSlides();
  slideScrollPositions.delete(index);
  shiftScrollPositions(index + 1, -1);

  const [removedElement] = slideElements.splice(index, 1);
  if (removedElement && removedElement.parentElement) {
    removedElement.parentElement.removeChild(removedElement);
  }

  if (!slideElements.length) {
    slidesRoot.innerHTML = '';
    renderEmptyState();
    totalCounter.textContent = 0;
    currentIndex = 0;
    updateHud();
    refreshSlideIndex();
    updateOverviewLayout();
    return;
  }

  reindexSlides(index);
  totalCounter.textContent = slideElements.length;
  updateOverviewLayout();
  refreshSlideIndex();

  if (isOverview) {
    overviewCursor = clamp(overviewCursor, 0, slideElements.length - 1);
    highlightOverviewSlide(overviewCursor, { scroll: false });
    updateSlideIndexHighlight(overviewCursor);
    return;
  }

  const nextIndex = clamp(currentIndex >= index ? currentIndex - 1 : currentIndex, 0, slideElements.length - 1);

  if (focus) {
    setActiveSlide(nextIndex);
  } else {
    currentIndex = nextIndex;
    updateHud();
    updateSlideIndexHighlight(currentIndex);
  }
}

function replaceSlideAt(index, options = {}) {
  const { focus = true } = options;
  if (index < 0 || index >= slides.length) return;

  const existing = slideElements[index];
  if (!existing || !existing.parentElement) {
    reloadDeck({ targetIndex: index, focus });
    persistSlides();
    return;
  }

  const previousScroll = existing.scrollTop;
  slideScrollPositions.set(index, previousScroll);

  // Clear stale placeholder references before replacing slide
  const oldPlaceholders = existing.querySelectorAll('.image-placeholder');
  oldPlaceholders.forEach(placeholder => {
    delete placeholder._imageRef;
  });

  const slideData = slides[index];
  const newSlide = createSlide(slideData, index, renderers);
  newSlide.style.visibility = existing.style.visibility;
  newSlide.style.pointerEvents = existing.style.pointerEvents;
  newSlide.setAttribute('aria-hidden', existing.getAttribute('aria-hidden') ?? 'true');
  newSlide.tabIndex = existing.tabIndex;

  existing.replaceWith(newSlide);
  slideElements[index] = newSlide;

  const wasActive = index === currentIndex && !isOverview;
  if (wasActive) {
    newSlide.classList.add('is-active');
    newSlide.style.visibility = 'visible';
    newSlide.style.pointerEvents = 'auto';
    newSlide.setAttribute('aria-hidden', 'false');
    const scrollOffset = slideScrollPositions.get(index) ?? previousScroll ?? 0;
    requestAnimationFrame(() => {
      newSlide.scrollTop = scrollOffset;
      if (focus) {
        newSlide.focus({ preventScroll: true });
      }
    });
  } else if (isOverview) {
    newSlide.style.visibility = 'visible';
    newSlide.style.pointerEvents = 'auto';
    newSlide.setAttribute('aria-hidden', 'false');
  } else {
    newSlide.style.visibility = 'hidden';
    newSlide.style.pointerEvents = 'none';
    newSlide.setAttribute('aria-hidden', 'true');
  }

  updateOverviewLayout();
  refreshSlideIndex();
  updateSlideIndexHighlight(currentIndex);
  if (wasActive && !isOverview) {
    updateHud();
  }
  persistSlides();
}

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
  return JSON.parse(JSON.stringify(template));
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

function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  const input = document.getElementById('gemini-api-key');
  if (modal && input) {
    input.value = getGeminiApiKey();
    modal.classList.add('is-open');

    // Setup event listeners if not already set
    setupSettingsModalListeners();
  }
}

function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) {
    modal.classList.remove('is-open');
  }
}

function setupSettingsModalListeners() {
  // Close button
  const closeBtn = document.querySelector('.settings-modal__close');
  if (closeBtn && !closeBtn.dataset.listenerAttached) {
    closeBtn.addEventListener('click', closeSettingsModal);
    closeBtn.dataset.listenerAttached = 'true';
  }

  // Backdrop
  const backdrop = document.querySelector('.settings-modal__backdrop');
  if (backdrop && !backdrop.dataset.listenerAttached) {
    backdrop.addEventListener('click', closeSettingsModal);
    backdrop.dataset.listenerAttached = 'true';
  }

  // Save button
  const saveBtn = document.getElementById('save-api-key');
  if (saveBtn && !saveBtn.dataset.listenerAttached) {
    saveBtn.addEventListener('click', saveApiKey);
    saveBtn.dataset.listenerAttached = 'true';
  }

  // Test button
  const testBtn = document.getElementById('test-api-key');
  if (testBtn && !testBtn.dataset.listenerAttached) {
    testBtn.addEventListener('click', testApiKey);
    testBtn.dataset.listenerAttached = 'true';
  }

  // Clear button
  const clearBtn = document.getElementById('clear-api-key');
  if (clearBtn && !clearBtn.dataset.listenerAttached) {
    clearBtn.addEventListener('click', clearApiKey);
    clearBtn.dataset.listenerAttached = 'true';
  }

  // Toggle visibility button
  const toggleBtn = document.getElementById('toggle-api-key-visibility');
  if (toggleBtn && !toggleBtn.dataset.listenerAttached) {
    toggleBtn.addEventListener('click', toggleApiKeyVisibility);
    toggleBtn.dataset.listenerAttached = 'true';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// KEYBOARD HELP MODAL
// ═══════════════════════════════════════════════════════════════════════════

function toggleKeyboardHelp() {
  const modal = document.getElementById('keyboard-help-modal');
  if (!modal) return;

  const isOpen = modal.classList.contains('is-open');
  if (isOpen) {
    closeKeyboardHelp();
  } else {
    openKeyboardHelp();
  }
}

function openKeyboardHelp() {
  const modal = document.getElementById('keyboard-help-modal');
  if (!modal) return;

  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');

  // Focus the dialog for accessibility
  const dialog = modal.querySelector('.keyboard-help-modal__dialog');
  if (dialog) {
    requestAnimationFrame(() => dialog.focus());
  }

  // Set up listeners if not already done
  setupKeyboardHelpListeners();
}

function closeKeyboardHelp() {
  const modal = document.getElementById('keyboard-help-modal');
  if (!modal) return;

  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
}

function setupKeyboardHelpListeners() {
  // Close button
  const closeBtn = document.getElementById('keyboard-help-close');
  if (closeBtn && !closeBtn.dataset.listenerAttached) {
    closeBtn.addEventListener('click', closeKeyboardHelp);
    closeBtn.dataset.listenerAttached = 'true';
  }

  // Backdrop
  const backdrop = document.querySelector('.keyboard-help-modal__backdrop');
  if (backdrop && !backdrop.dataset.listenerAttached) {
    backdrop.addEventListener('click', closeKeyboardHelp);
    backdrop.dataset.listenerAttached = 'true';
  }
}

function saveApiKey() {
  const input = document.getElementById('gemini-api-key');
  const key = input.value.trim();

  if (key) {
    localStorage.setItem(STORAGE_KEY_API, key);
    showApiKeyStatus('success', '✓ API key saved successfully!');
  } else {
    showApiKeyStatus('error', 'Please enter a valid API key');
  }
}

async function testApiKey() {
  const key = getGeminiApiKey();
  const testBtn = document.getElementById('test-api-key');

  if (!key) {
    showApiKeyStatus('error', 'No API key found. Please save one first.');
    return;
  }

  // Animate button while testing
  if (testBtn) {
    testBtn.disabled = true;
    testBtn.classList.add('is-loading');
    testBtn.innerHTML = '<span class="loading-spinner"></span> Testing...';
  }

  showApiKeyStatus('info', '⏳ Testing connection...');

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'test' }] }]
        })
      }
    );

    if (response.ok) {
      showApiKeyStatus('success', '✅ Connection successful! Your API key is working.');
      if (testBtn) {
        testBtn.classList.add('is-success');
        testBtn.innerHTML = '✅ Connected!';
        setTimeout(() => {
          testBtn.classList.remove('is-success', 'is-loading');
          testBtn.innerHTML = 'Test Connection';
          testBtn.disabled = false;
        }, 2000);
      }
    } else {
      const error = await response.json();
      showApiKeyStatus('error', `❌ Invalid API key or connection failed: ${error.error?.message || 'Unknown error'}`);
      if (testBtn) {
        testBtn.classList.remove('is-loading');
        testBtn.innerHTML = 'Test Connection';
        testBtn.disabled = false;
      }
    }
  } catch (error) {
    showApiKeyStatus('error', '❌ Connection test failed. Please check your internet connection.');
    if (testBtn) {
      testBtn.classList.remove('is-loading');
      testBtn.innerHTML = 'Test Connection';
      testBtn.disabled = false;
    }
  }
}

function clearApiKey() {
  if (confirm('Are you sure you want to clear your API key?')) {
    localStorage.removeItem(STORAGE_KEY_API);
    const input = document.getElementById('gemini-api-key');
    if (input) input.value = '';
    showApiKeyStatus('info', 'API key cleared');
  }
}

function toggleApiKeyVisibility() {
  const input = document.getElementById('gemini-api-key');
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
}

function showApiKeyStatus(type, message) {
  const status = document.getElementById('api-key-status');
  if (!status) return;

  status.className = `settings-field__status is-visible is-${type}`;
  status.textContent = message;

  // Auto-hide success/info messages after 3 seconds (keep errors visible)
  if (type !== 'error') {
    setTimeout(() => {
      status.classList.remove('is-visible');
    }, 3000);
  }
}

// ===================================================================
// HUD STATUS HELPERS
// ===================================================================

let lastFailedOperation = null; // Store last failed operation for retry
let activeToasts = new Map(); // Track active toasts

/**
 * Show a toast notification with auto-dismiss and max limit
 * @param {string} message - The message to display
 * @param {string} type - Toast type (success, error, warning, info, processing)
 * @param {Object} options - Additional options (onRetry, duration)
 * @returns {number} Toast ID
 */
function showHudStatus(message, type = '', options = {}) {
  const container = document.getElementById('toast-container');
  if (!container) return null;

  // Enforce max toast limit - remove oldest if at limit
  if (activeToasts.size >= CONFIG.TOAST.MAX_ACTIVE) {
    const oldestId = activeToasts.keys().next().value;
    hideToast(oldestId);
  }

  // Create toast element
  const toast = document.createElement('div');
  const toastId = Date.now() + Math.random();
  toast.className = `toast ${type ? `toast--${type}` : ''}`;

  // If this is an error and there's a retry function, add retry button
  if (type === 'error' && options.onRetry) {
    lastFailedOperation = options.onRetry;
    const retryBtn = document.createElement('button');
    retryBtn.className = 'toast__retry-btn';
    retryBtn.textContent = '🔄 Retry';

    const retryHandler = () => {
      hideToast(toastId);
      if (lastFailedOperation) {
        lastFailedOperation();
        lastFailedOperation = null;
      }
    };
    retryBtn.addEventListener('click', retryHandler);
    toast._retryHandler = retryHandler; // Store for cleanup

    toast.textContent = message + ' ';
    toast.appendChild(retryBtn);
  } else {
    toast.textContent = message;
    lastFailedOperation = null;
  }

  container.appendChild(toast);
  activeToasts.set(toastId, toast);

  // Auto-dismiss after duration (unless it's 'processing' or has retry button)
  if (type !== 'processing' && !options.onRetry) {
    const duration = options.duration || CONFIG.TOAST[`${type.toUpperCase()}_DURATION`] || CONFIG.TOAST.INFO_DURATION;
    setTimeout(() => {
      if (activeToasts.has(toastId)) {
        hideToast(toastId);
      }
    }, duration);
  }

  return toastId;
}

function hideHudStatus() {
  // Hide the most recent toast
  if (activeToasts.size > 0) {
    const lastToastId = Array.from(activeToasts.keys()).pop();
    hideToast(lastToastId);
  }
}

/**
 * Hide and remove a toast notification
 * Properly cleans up event listeners
 * @param {number} toastId - Toast ID to hide
 */
function hideToast(toastId) {
  const toast = activeToasts.get(toastId);
  if (!toast) return;

  // Clean up retry button listener if exists
  const retryBtn = toast.querySelector('.toast__retry-btn');
  if (retryBtn && toast._retryHandler) {
    retryBtn.removeEventListener('click', toast._retryHandler);
    delete toast._retryHandler;
  }

  toast.classList.add('toast--hiding');
  lastFailedOperation = null;

  setTimeout(() => {
    toast.remove();
    activeToasts.delete(toastId);
  }, 200);
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
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
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

function generateRandomTheme() {
  const baseTheme = getCurrentTheme();
  const source = getCurrentThemePath();
  const activeTheme = normalizeThemeTokens(baseTheme || {});
  const baseSource = resolveBaseThemePath(source || '');
  const randomizer = getThemeRandomizer(baseSource);
  const randomizedTheme = randomizer(activeTheme, { baseSource });
  return normalizeThemeTokens(randomizedTheme || activeTheme);
}

function resolveBaseThemePath(source = '') {
  let value = (source || '').trim();
  while (value.startsWith('random:')) {
    value = value.slice(7).trim();
  }
  return value;
}

function getThemeRandomizer(baseSource = '') {
  const normalized = baseSource.toLowerCase();

  if (
    normalized.startsWith('saved:') ||
    normalized === '__ai__' ||
    normalized === '__custom__' ||
    normalized === '__local__'
  ) {
    return randomizeCustomTheme;
  }

  if (normalized === '__random__') {
    return randomizeDefaultTheme;
  }

  if (normalized.endsWith('themes/gameboy.json')) {
    return randomizeGameboyTheme;
  }

  if (normalized.endsWith('themes/vaporwave.json')) {
    return randomizeVaporwaveTheme;
  }

  if (normalized.endsWith('themes/slack.json')) {
    return randomizeSlackTheme;
  }

  if (normalized.endsWith('theme.json')) {
    return randomizeDefaultTheme;
  }

  if (!baseSource) {
    return randomizeDefaultTheme;
  }

  return randomizeCustomTheme;
}

function randomizeDefaultTheme(theme, context = {}) {
  const baseHue = Math.floor(Math.random() * 360);
  const strategies = ['analogous', 'triadic', 'complementary', 'split-complementary', 'monochromatic'];
  const palette = generatePalette(baseHue, sample(strategies));

  const isDefaultBase = !context.baseSource || context.baseSource === 'theme.json';
  const isDark = isDefaultBase ? false : Math.random() < 0.25;

  const colorBg = isDark
    ? hslToHex(baseHue, clamp(22 + Math.random() * 12, 0, 100), clamp(14 + Math.random() * 10, 0, 100))
    : hslToHex(baseHue, clamp(28 + Math.random() * 20, 0, 100), clamp(88 + Math.random() * 6, 0, 100));

  const colorInk = isDefaultBase ? '#1b1b1b' : getAccessibleTextColor(colorBg);
  const colorMuted =
    colorInk === '#000000'
      ? mixHexColors('#000000', '#555555', 0.55)
      : mixHexColors('#ffffff', '#444444', 0.45);
  const badgeTextColor = getAccessibleTextColor(palette.accent);

  const borderCandidates = [
    theme['border-width'],
    theme['slide-border-width'],
    '4px',
    '5px',
    '6px',
  ].filter(Boolean);
  const borderWidth = sample(borderCandidates) || '5px';

  const shadowSets = [
    {
      sm: '6px 6px 0 rgba(0, 0, 0, 0.25)',
      md: '10px 10px 0 rgba(0, 0, 0, 0.3)',
      lg: '16px 16px 0 rgba(0, 0, 0, 0.35)',
      xl: '24px 24px 0 rgba(0, 0, 0, 0.4)',
    },
    {
      sm: '4px 4px 0 rgba(0, 0, 0, 0.22)',
      md: '8px 8px 0 rgba(0, 0, 0, 0.26)',
      lg: '12px 12px 0 rgba(0, 0, 0, 0.3)',
      xl: '18px 18px 0 rgba(0, 0, 0, 0.32)',
    },
    {
      sm: '0 4px 12px rgba(0, 0, 0, 0.18)',
      md: '0 8px 24px rgba(0, 0, 0, 0.22)',
      lg: '0 12px 36px rgba(0, 0, 0, 0.26)',
      xl: '0 18px 54px rgba(0, 0, 0, 0.3)',
    },
    {
      sm: theme['shadow-sm'],
      md: theme['shadow-md'],
      lg: theme['shadow-lg'],
      xl: theme['shadow-xl'],
    },
  ].filter((set) => set.sm && set.md && set.lg && set.xl);
  const shadows = sample(shadowSets) || shadowSets[0];

  const surfacePrimary = palette.primary;
  const surfaceSecondary = palette.secondary;
  const surfaceAccent = palette.accent;

  const updatedTheme = {
    ...theme,
    'color-bg': colorBg,
    'background-surface': `radial-gradient(circle at 18% 22%, ${applyAlpha(surfacePrimary, 0.55)}, transparent 60%), radial-gradient(circle at 78% 32%, ${applyAlpha(surfaceSecondary, 0.55)}, transparent 60%), radial-gradient(circle at 48% 74%, ${applyAlpha(surfaceAccent, 0.35)}, transparent 62%), ${colorBg}`,
    'slide-bg': hexToRgbaString(colorBg, isDark ? 0.9 : 0.82),
    'slide-border-color': colorInk,
    'slide-border-width': borderWidth,
    'slide-shadow': shadows.md,
    'color-surface': surfacePrimary,
    'color-surface-alt': surfaceSecondary,
    'color-accent': surfaceAccent,
    'badge-bg': surfaceAccent,
    'badge-color': badgeTextColor,
    'color-ink': colorInk,
    'color-muted': colorMuted,
    'border-width': borderWidth,
    'shadow-sm': shadows.sm,
    'shadow-md': shadows.md,
    'shadow-lg': shadows.lg,
    'shadow-xl': shadows.xl,
  };

  return updatedTheme;
}

function randomizeGameboyTheme(theme) {
  const baseHue = Math.floor(Math.random() * 360);
  const light = hslToHex(baseHue, clamp(24 + Math.random() * 12, 0, 100), clamp(72 + Math.random() * 12, 0, 100));
  const medium = hslToHex(baseHue, clamp(30 + Math.random() * 14, 0, 100), clamp(56 + Math.random() * 10, 0, 100));
  const dark = hslToHex(baseHue, clamp(36 + Math.random() * 16, 0, 100), clamp(36 + Math.random() * 10, 0, 100));
  const deepest = hslToHex(baseHue, clamp(38 + Math.random() * 12, 0, 100), clamp(22 + Math.random() * 10, 0, 100));
  const borderWidth = theme['border-width'] || theme['slide-border-width'] || '6px';

  return {
    ...theme,
    'color-bg': light,
    'background-surface': `linear-gradient(135deg, ${medium} 0%, ${dark} 100%)`,
    'background-overlay': `repeating-linear-gradient(0deg, ${applyAlpha(deepest, 0.75)} 0px, transparent 1px, transparent 2px, ${applyAlpha(deepest, 0.75)} 3px)`,
    'slide-bg': hexToRgbaString(light, 0.82),
    'slide-border-color': deepest,
    'slide-border-width': borderWidth,
    'slide-shadow': `8px 8px 0 ${applyAlpha(deepest, 0.55)}`,
    'color-surface': medium,
    'color-surface-alt': dark,
    'color-accent': deepest,
    'badge-bg': medium,
    'badge-color': getAccessibleTextColor(medium),
    'color-ink': deepest,
    'color-muted': dark,
    'border-width': borderWidth,
    'shadow-sm': `4px 4px 0 ${applyAlpha(deepest, 0.8)}`,
    'shadow-md': `8px 8px 0 ${applyAlpha(deepest, 0.8)}`,
    'shadow-lg': `12px 12px 0 ${applyAlpha(deepest, 0.75)}`,
    'shadow-xl': `16px 16px 0 ${applyAlpha(deepest, 0.7)}`,
  };
}

function randomizeVaporwaveTheme(theme) {
  const baseHue = Math.floor(Math.random() * 360);
  const pink = hslToHex((baseHue + 320) % 360, 92, 68);
  const cyan = hslToHex((baseHue + 180) % 360, 95, 62);
  const mint = hslToHex((baseHue + 140) % 360, 90, 64);
  const purple = hslToHex((baseHue + 280) % 360, 80, 58);
  const neon = hslToHex((baseHue + 80) % 360, 95, 70);
  const ink = shiftHex(purple, -0.55);

  return {
    ...theme,
    'color-bg': pink,
    'background-surface': `linear-gradient(140deg, ${cyan} 0%, ${mint} 50%, ${purple} 100%)`,
    'background-overlay': theme['background-overlay'] || 'repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.08) 0px, transparent 2px, transparent 4px, rgba(255, 255, 255, 0.08) 6px), repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.08) 0px, transparent 2px, transparent 4px, rgba(255, 255, 255, 0.08) 6px)',
    'slide-bg': hexToRgbaString(pink, 0.82),
    'slide-border-color': cyan,
    'slide-shadow': `12px 12px 0 ${applyAlpha(cyan, 0.5)}`,
    'color-surface': purple,
    'color-surface-alt': mint,
    'color-accent': neon,
    'badge-bg': neon,
    'badge-color': getAccessibleTextColor(neon),
    'color-ink': ink,
    'color-muted': mixHexColors(ink, '#ffffff', 0.25),
    'shadow-sm': `8px 8px 0 ${applyAlpha(cyan, 0.42)}`,
    'shadow-md': `12px 12px 0 ${applyAlpha(cyan, 0.5)}`,
    'shadow-lg': `16px 16px 0 ${applyAlpha(cyan, 0.6)}`,
    'shadow-xl': `24px 24px 0 ${applyAlpha(cyan, 0.7)}`,
  };
}

function randomizeSlackTheme(theme) {
  const baseHue = Math.floor(Math.random() * 360);
  const backdrop = hslToHex(baseHue, 95, 58);
  const mid = hslToHex((baseHue + 12) % 360, 90, 46);
  const deep = hslToHex((baseHue + 200) % 360, 90, 40);
  const accent = hslToHex((baseHue + 140) % 360, 92, 52);
  const badgeBg = hslToHex((baseHue + 320) % 360, 92, 40);
  const ink = '#000000';

  return {
    ...theme,
    'color-bg': backdrop,
    'background-surface': `radial-gradient(circle at 25% 25%, ${backdrop} 0%, ${mid} 35%, ${deep} 100%)`,
    'slide-bg': hexToRgbaString(backdrop, 0.82),
    'slide-border-color': ink,
    'slide-shadow': `12px 12px 0 ${applyAlpha(ink, 0.85)}`,
    'color-surface': accent,
    'color-surface-alt': deep,
    'color-accent': ink,
    'badge-bg': badgeBg,
    'badge-color': getAccessibleTextColor(badgeBg),
    'color-ink': ink,
    'color-muted': mixHexColors(ink, '#666666', 0.45),
    'shadow-sm': `6px 6px 0 ${applyAlpha(ink, 0.9)}`,
    'shadow-md': `12px 12px 0 ${applyAlpha(ink, 0.9)}`,
    'shadow-lg': `18px 18px 0 ${applyAlpha(ink, 0.9)}`,
    'shadow-xl': `24px 24px 0 ${applyAlpha(ink, 0.9)}`,
  };
}

function randomizeCustomTheme(theme, context = {}) {
  const variant = randomizeDefaultTheme(theme, context);
  return {
    ...variant,
    'font-sans': theme['font-sans'],
    'font-mono': theme['font-mono'],
    'radius': theme['radius'],
    'background-overlay': theme['background-overlay'],
    'background-opacity': theme['background-opacity'],
  };
}

function generatePalette(baseHue, strategy = 'triadic') {
  let hues;
  switch (strategy) {
    case 'analogous':
      hues = [baseHue, (baseHue + 32) % 360, (baseHue + 64) % 360];
      break;
    case 'complementary':
      hues = [baseHue, (baseHue + 180) % 360, (baseHue + 30) % 360];
      break;
    case 'split-complementary':
      hues = [baseHue, (baseHue + 150) % 360, (baseHue + 210) % 360];
      break;
    case 'monochromatic':
      hues = [baseHue, baseHue, baseHue];
      break;
    default:
      hues = [baseHue, (baseHue + 120) % 360, (baseHue + 240) % 360];
  }

  const primary = hslToHex(hues[0], clamp(68 + Math.random() * 22, 0, 100), clamp(54 + Math.random() * 14, 0, 100));
  const secondary = hslToHex(hues[1], clamp(60 + Math.random() * 24, 0, 100), clamp(58 + Math.random() * 16, 0, 100));
  const accent = hslToHex(hues[2], clamp(70 + Math.random() * 20, 0, 100), clamp(52 + Math.random() * 18, 0, 100));

  return { primary, secondary, accent };
}

function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const saturation = clamp(s, 0, 100) / 100;
  const lightness = clamp(l, 0, 100) / 100;

  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = lightness - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (hue < 60) {
    r = c; g = x; b = 0;
  } else if (hue < 120) {
    r = x; g = c; b = 0;
  } else if (hue < 180) {
    r = 0; g = c; b = x;
  } else if (hue < 240) {
    r = 0; g = x; b = c;
  } else if (hue < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  const toHex = (value) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToRgb(hex) {
  const sanitized = typeof hex === 'string' ? hex.replace('#', '') : '';
  if (sanitized.length !== 6 || Number.isNaN(Number.parseInt(sanitized, 16))) {
    return [255, 255, 255];
  }
  const intVal = Number.parseInt(sanitized, 16);
  const r = (intVal >> 16) & 255;
  const g = (intVal >> 8) & 255;
  const b = intVal & 255;
  return [r, g, b];
}

function hexToRgbaString(hex, alpha = 1) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function getRelativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const norm = channel / 255;
    return norm <= 0.03928 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function getContrastRatio(foregroundHex, backgroundHex) {
  const l1 = getRelativeLuminance(foregroundHex);
  const l2 = getRelativeLuminance(backgroundHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function getAccessibleTextColor(backgroundHex) {
  const blackContrast = getContrastRatio('#000000', backgroundHex);
  const whiteContrast = getContrastRatio('#ffffff', backgroundHex);
  return blackContrast >= whiteContrast ? '#000000' : '#ffffff';
}

function mixHexColors(colorA, colorB, ratio = 0.5) {
  const [r1, g1, b1] = hexToRgb(colorA);
  const [r2, g2, b2] = hexToRgb(colorB);
  const blend = (a, b) => Math.round(a * (1 - ratio) + b * ratio);
  return `#${[blend(r1, r2), blend(g1, g2), blend(b1, b2)]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

function applyAlpha(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function shiftHex(hex, amount = 0) {
  const ratio = clamp(Math.abs(amount), 0, 1);
  const target = amount >= 0 ? '#ffffff' : '#000000';
  return mixHexColors(hex, target, ratio);
}

function sample(list) {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  return list[Math.floor(Math.random() * list.length)];
}

function syncThemeSelectUI() {
  const trigger = document.getElementById('theme-select-trigger');
  const dropdown = document.getElementById('theme-select-dropdown');
  if (!trigger || !dropdown) return;

  const currentPath = getCurrentThemePath() || '';
  const basePath = resolveBaseThemePath(currentPath);
  const isRandom = currentPath.startsWith('random:');
  const valueSpan = trigger.querySelector('.theme-select__value');
  if (!valueSpan) return;

  const options = Array.from(dropdown.querySelectorAll('.theme-select__option'));
  const matchingOption = options.find(opt => {
    const value = opt.dataset.value;
    if (!value) return false;
    return value === currentPath || value === basePath;
  });

  if (matchingOption) {
    const optionLabel = matchingOption.textContent.trim();
    valueSpan.textContent = isRandom ? `🎲 ${optionLabel}` : matchingOption.textContent;
    options.forEach(opt => {
      opt.classList.toggle('is-selected', opt.dataset.value === basePath);
    });
  } else {
    valueSpan.textContent = isRandom ? '🎲 Custom Theme' : '🎨 Custom Theme';
    options.forEach(opt => opt.classList.remove('is-selected'));
  }
}


themeDrawerInstance = createDrawer({
  id: 'theme-drawer',
  onOpen: () => {
    const themeBtn = document.getElementById('theme-btn');
    isThemeDrawerOpen = true;
    themeBtn?.setAttribute('aria-expanded', 'true');
    themeBtn?.classList.add('is-active');
    // Theme content is now pre-populated before opening for smooth animation
    const closeBtn = themeDrawerInstance.element.querySelector('.theme-drawer__close');
    if (closeBtn && !closeBtn.dataset.listenerAttached) {
      closeBtn.addEventListener('click', () => closeDrawer(themeDrawerInstance));
      closeBtn.dataset.listenerAttached = 'true';
    }
  },
  onClose: () => {
    const themeBtn = document.getElementById('theme-btn');
    isThemeDrawerOpen = false;
    themeBtn?.setAttribute('aria-expanded', 'false');
    themeBtn?.classList.remove('is-active');
  },
});

function toggleThemeDrawer() {
  if (!themeDrawerInstance) return;
  if (themeDrawerInstance.isOpen) {
    closeDrawer(themeDrawerInstance);
  } else {
    openThemeDrawer();
  }
}

function openThemeDrawer() {
  if (!themeDrawerInstance) return;
  if (editDrawerInstance?.isOpen) {
    closeDrawer(editDrawerInstance, { restoreFocus: false });
  }
  // Pre-populate theme content BEFORE opening for smooth animation
  loadThemeIntoEditor();
  populateThemeDropdown();
  syncThemeSelectUI();
  openDrawer(themeDrawerInstance);
}

function closeThemeDrawer() {
  if (!themeDrawerInstance) return;
  closeDrawer(themeDrawerInstance);
}


function initThemeDrawer() {
  const themeDrawer = themeDrawerInstance?.element;
  const themeBtn = document.getElementById('theme-btn');
  const saveBtn = document.getElementById('theme-save-btn');
  const aiBtn = document.getElementById('theme-ai-btn');
  const randomBtn = document.getElementById('theme-random-btn');

  if (!themeDrawer) return;

  themeBtn?.setAttribute('aria-expanded', 'false');
  themeBtn?.classList.remove('is-active');

  if (themeBtn && !themeBtn.dataset.listenerAttached) {
    themeBtn.addEventListener('click', toggleThemeDrawer);
    themeBtn.dataset.listenerAttached = 'true';
  }

  const closeBtn = themeDrawer.querySelector('.theme-drawer__close');
  if (closeBtn && !closeBtn.dataset.listenerAttached) {
    closeBtn.addEventListener('click', () => closeDrawer(themeDrawerInstance));
    closeBtn.dataset.listenerAttached = 'true';
  }

  // Custom dropdown logic
  const trigger = document.getElementById('theme-select-trigger');
  const dropdown = document.getElementById('theme-select-dropdown');

  if (trigger && dropdown && !trigger.dataset.listenerAttached) {
    const closeDropdown = () => {
      trigger.classList.remove('is-open');
      dropdown.classList.remove('is-open');
    };

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const isOpen = trigger.classList.contains('is-open');
      if (isOpen) {
        closeDropdown();
      } else {
        trigger.classList.add('is-open');
        dropdown.classList.add('is-open');
      }
    });
    trigger.dataset.listenerAttached = 'true';

    document.addEventListener('click', (e) => {
      if (!trigger.contains(e.target) && !dropdown.contains(e.target)) {
        closeDropdown();
      }
    });

    dropdown.addEventListener('click', async (e) => {
      const option = e.target.closest('.theme-select__option');
      if (!option) return;

      const themePath = option.dataset.value;
      const themeLabel = option.textContent;

      const valueSpan = trigger.querySelector('.theme-select__value');
      if (valueSpan) valueSpan.textContent = themeLabel;

      closeDropdown();

      dropdown.querySelectorAll('.theme-select__option').forEach(opt => {
        opt.classList.toggle('is-selected', opt === option);
      });

      showHudStatus('🎨 Switching theme...', 'processing');
      try {
        if (themePath.startsWith('saved:')) {
          const savedName = themePath.replace('saved:', '');
          const library = loadThemeLibrary();
          const entry = library.find(e => e.name === savedName);
          if (entry) {
            const normalizedTheme = applyTheme(entry.theme);
            setCurrentTheme(normalizedTheme, { source: themePath });
          }
        } else {
          const response = await fetch(themePath, { cache: "no-store" });
          if (!response.ok) throw new Error(`Failed to load theme: ${response.status}`);
          const theme = await response.json();
          const normalizedTheme = applyTheme(theme);
          setCurrentTheme(normalizedTheme, { source: themePath });
        }
        showHudStatus('✨ Theme applied', 'success');
        setTimeout(hideHudStatus, 1600);
      } catch (error) {
        console.error('Failed to apply theme:', error);
        showHudStatus('❌ Theme failed', 'error');
        setTimeout(hideHudStatus, 2000);
      }
    });
  }

  saveBtn?.addEventListener('click', () => {
    try {
      const theme = getCurrentTheme();

      // Get current theme path to suggest a name
      const currentPath = getCurrentThemePath() || '';
      const basePath = resolveBaseThemePath(currentPath);
      let defaultName = '';
      if (basePath.startsWith('saved:')) {
        defaultName = basePath.replace('saved:', '');
      }

      const name = prompt('Name your theme:', defaultName);
      if (!name || !name.trim()) return;

      saveThemeToLibrary(name.trim(), theme);
      setCurrentTheme(theme, { source: `saved:${name.trim()}` });
      populateThemeDropdown();
      syncThemeSelectUI();

      showHudStatus('💾 Theme saved', 'success');
      setTimeout(hideHudStatus, 1600);
    } catch (error) {
      showHudStatus(`❌ ${error.message}`, 'error');
      setTimeout(hideHudStatus, 2000);
    }
  });

  aiBtn?.addEventListener('click', async () => {
    const description = prompt('Describe your theme:\n(e.g. "dark cyberpunk with neon greens" or "warm sunset beach vibes")');
    if (!description) return;

    try {
      showHudStatus('✨ Generating theme...', 'processing');
      aiBtn.disabled = true;

      const theme = await generateThemeWithAI(description);

      const normalizedTheme = applyTheme(theme);
      setCurrentTheme(normalizedTheme, { source: '__ai__' });
      loadThemeIntoEditor();

      showHudStatus('✨ Theme generated!', 'success');
      setTimeout(hideHudStatus, 1600);
    } catch (error) {
      showHudStatus(`❌ ${error.message}`, 'error');
      setTimeout(hideHudStatus, 3000);
    } finally {
      aiBtn.disabled = false;
    }
  });

  randomBtn?.addEventListener('click', () => {
    try {
      showHudStatus('🎲 Generating random theme...', 'processing');

      const baseSource = resolveBaseThemePath(getCurrentThemePath() || '') || 'theme.json';
      const theme = generateRandomTheme();

      const normalizedTheme = applyTheme(theme);
      setCurrentTheme(normalizedTheme, { source: `random:${baseSource}` });
      loadThemeIntoEditor();

      showHudStatus('✨ Random theme applied!', 'success');
      setTimeout(hideHudStatus, 1600);
    } catch (error) {
      showHudStatus(`❌ ${error.message}`, 'error');
      setTimeout(hideHudStatus, 2000);
    }
  });

  populateThemeDropdown();
  syncThemeSelectUI();
}



function loadThemeIntoEditor() {
  // Note: Theme fields removed - using Random + AI + Save workflow
  syncThemeSelectUI();
}

// ═══════════════════════════════════════════════════════════════════════════
// Obsolete theme field functions removed - using Random + AI + Save workflow
// ═══════════════════════════════════════════════════════════════════════════

function extractCurrentThemeFromCSS() {
  const root = document.documentElement;
  const style = getComputedStyle(root);

  const themeVars = [
    'color-bg', 'background-surface', 'background-overlay', 'background-opacity',
    'slide-bg', 'slide-border-color', 'slide-border-width', 'slide-shadow',
    'color-surface', 'color-surface-alt', 'color-accent', 'badge-bg', 'badge-color',
    'color-ink', 'color-muted', 'border-width', 'gutter', 'radius',
    'font-sans', 'font-mono', 'shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-xl'
  ];

  const theme = {};
  themeVars.forEach(varName => {
    const value = style.getPropertyValue(`--${varName}`).trim();
    if (value) {
      theme[varName] = value;
    }
  });

  return theme;
}

function populateThemeDropdown() {
  const dropdown = document.getElementById('theme-select-dropdown');
  if (!dropdown) return;

  const library = loadThemeLibrary();

  // Remove old saved theme options (keep built-in themes)
  const options = Array.from(dropdown.querySelectorAll('.theme-select__option'));
  options.forEach(option => {
    const value = option.dataset.value || '';
    if (value.startsWith('saved:')) {
      option.remove();
    }
  });

  // Add saved themes to dropdown
  library.forEach(entry => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-select__option';
    button.dataset.value = `saved:${entry.name}`;
    button.textContent = `✨ ${entry.name}`;
    dropdown.appendChild(button);
  });
}

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

  const storedSlides = loadPersistedDeck();

  if (Array.isArray(storedSlides)) {
    slides = storedSlides;
  } else if (Array.isArray(loadedSlides)) {
    slides = loadedSlides;
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

  const usingPersistedSlides = Array.isArray(storedSlides);
  if (usingPersistedSlides) {
    console.info('Slide-o-Matic: loaded deck overrides from localStorage.');
  }

  const renderableSlides = slides.filter(slide => slide.type !== "_schema");
  totalCounter.textContent = renderableSlides.length;

  if (!Array.isArray(renderableSlides) || renderableSlides.length === 0) {
    renderEmptyState();
    return;
  }

  slideElements = renderableSlides.map((slide, index) =>
    createSlide(slide, index, renderers)
  );

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
    setOverviewCursor: (index) => { overviewCursor = index; },
    updateSlide: (index, slide) => { slides[index] = slide; },
    validateSlides,
    downloadTheme,
  });

  const overviewBtn = document.getElementById('overview-btn');
  if (overviewBtn) {
    overviewBtn.addEventListener('click', toggleOverview);
  }

  const saveDeckBtn = document.getElementById('save-deck-btn');
  if (saveDeckBtn) {
    saveDeckBtn.addEventListener('click', () => {
      const persisted = downloadDeck();
      if (persisted) {
        showHudStatus('💾 Deck downloaded', 'success');
        setTimeout(hideHudStatus, 1600);
      }
    });
  }

  // Initialize theme drawer
  initThemeDrawer();

  // Show intro modal on first visit
  showIntroModalIfFirstVisit();

  // Initialize share modal
  initShareModal();

  setActiveSlide(0);
  updateOverviewButton();
  overviewCursor = currentIndex;
  handleInitialIntent();
}

function handleInitialIntent() {
  const params = new URLSearchParams(window.location.search);
  const openIntent = params.get('open');
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
    const deckData = {
      version: 1,
      slides: slides,
      theme: getCurrentTheme(),
      meta: {
        title: deriveDeckName(slides),
        createdAt: Date.now(),
      },
    };

    const jsonString = JSON.stringify(deckData.slides, null, 2);

    // Try paste service first
    try {
      const pasteUrl = await uploadToPasteService(jsonString);
      const baseUrl = window.location.origin + window.location.pathname;
      return `${baseUrl}?url=${encodeURIComponent(pasteUrl)}`;
    } catch (error) {
      debug('Paste service failed, falling back to base64:', error);
      // Fallback to base64 encoding in URL
      const encoded = btoa(unescape(encodeURIComponent(jsonString)));
      const baseUrl = window.location.origin + window.location.pathname;
      return `${baseUrl}?data=${encoded}`;
    }
  }

  async function uploadToPasteService(content) {
    // Try dpaste.com first
    try {
      const response = await fetch('https://dpaste.com/api/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          content: content,
          syntax: 'json',
          expiry_days: 365,
        }),
      });

      if (!response.ok) throw new Error('dpaste.com failed');

      const url = await response.text();
      // dpaste returns the page URL, we need the raw URL
      const rawUrl = url.trim() + '.txt';
      return rawUrl;
    } catch (error) {
      debug('dpaste failed:', error);

      // Fallback to paste.ee
      try {
        const response = await fetch('https://api.paste.ee/v1/pastes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            description: 'Slide-o-Matic Deck',
            sections: [{
              name: 'deck.json',
              syntax: 'json',
              contents: content,
            }],
          }),
        });

        if (!response.ok) throw new Error('paste.ee failed');

        const data = await response.json();
        return `https://api.paste.ee/v1/pastes/${data.id}/raw`;
      } catch (error2) {
        throw new Error('Upload services unavailable. Using fallback method.');
      }
    }
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
