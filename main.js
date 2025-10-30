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
import { formatBytes, clamp } from './modules/utils.js';
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
import {
  initSlideIndex,
  toggleSlideIndex,
  closeSlideIndex,
  refreshSlideIndex,
  updateSlideIndexHighlight,
} from './slide-index.js';
import { initKeyboardNav } from './modules/keyboard-nav.js';

const slidesRoot = document.getElementById("slides");
const currentCounter = document.querySelector("[data-counter-current]");
const totalCounter = document.querySelector("[data-counter-total]");
const progressBar = document.querySelector("[data-progress]");

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

let slides = [];
let slideElements = [];
let currentIndex = 0;
let isOverview = false;
const preloadedImages = new Set();
let autoLinkConfigs = [];
const OVERVIEW_MAX_ROWS = 3;
let overviewRowCount = 1;
let overviewColumnCount = 0;
let overviewCursor = 0;
let lastOverviewHighlight = 0;
let isThemeDrawerOpen = false;
let themeDrawerInstance = null;
const slideScrollPositions = new Map();
const DECK_STORAGE_PREFIX = 'slideomatic_deck_overrides:';
let deckStorageKey = null;
let deckPersistFailureNotified = false;

initSlideIndex({
  getSlides: () => slides,
  getCurrentIndex: () => currentIndex,
  setActiveSlide: (index) => setActiveSlide(index),
});

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

// ================================================================
// Smart Random Theme Generator (Color Theory)
// ================================================================

function generateRandomTheme() {
  // Pick a random palette strategy
  const strategies = ['analogous', 'triadic', 'complementary', 'split-complementary', 'monochromatic'];
  const strategy = strategies[Math.floor(Math.random() * strategies.length)];

  // Generate base hue (0-360)
  const baseHue = Math.floor(Math.random() * 360);

  // Generate palette based on strategy
  const palette = generatePalette(baseHue, strategy);

  // Choose light or dark mode randomly (weighted toward light)
  const isDark = Math.random() < 0.3;

  // Pick random border style
  const borderWidths = ['3px', '4px', '5px', '6px'];
  const borderWidth = borderWidths[Math.floor(Math.random() * borderWidths.length)];

  // Pick random shadow style
  const shadowStyles = [
    { sm: '6px 6px 0 rgba(0, 0, 0, 0.25)', md: '10px 10px 0 rgba(0, 0, 0, 0.3)', lg: '16px 16px 0 rgba(0, 0, 0, 0.35)', xl: '24px 24px 0 rgba(0, 0, 0, 0.4)' },
    { sm: '4px 4px 0 rgba(0, 0, 0, 0.2)', md: '8px 8px 0 rgba(0, 0, 0, 0.25)', lg: '12px 12px 0 rgba(0, 0, 0, 0.3)', xl: '18px 18px 0 rgba(0, 0, 0, 0.35)' },
    { sm: '0 4px 12px rgba(0, 0, 0, 0.15)', md: '0 8px 24px rgba(0, 0, 0, 0.2)', lg: '0 12px 32px rgba(0, 0, 0, 0.25)', xl: '0 18px 48px rgba(0, 0, 0, 0.3)' },
  ];
  const shadows = shadowStyles[Math.floor(Math.random() * shadowStyles.length)];

  // Build theme object
  const colorBg = isDark ? hslToHex(baseHue, 20, 10) : hslToHex(baseHue, 30, 95);
  const colorInk = getAccessibleTextColor(colorBg);
  const colorMuted =
    colorInk === '#000000'
      ? mixHexColors('#000000', '#666666', 0.6)
      : mixHexColors('#ffffff', '#444444', 0.4);
  const badgeTextColor = getAccessibleTextColor(palette.accent);

  const theme = {
    'color-bg': colorBg,
    'background-surface': `radial-gradient(circle at 15% 20%, ${palette.primary}55, transparent 55%), radial-gradient(circle at 85% 30%, ${palette.secondary}55, transparent 55%), radial-gradient(circle at 40% 70%, ${palette.accent}45, transparent 60%), ${colorBg}`,
    'background-overlay': 'radial-gradient(circle at 25% 25%, rgba(0, 0, 0, 0.15) 0.5px, transparent 1px), radial-gradient(circle at 75% 75%, rgba(0, 0, 0, 0.1) 0.5px, transparent 1px)',
    'background-opacity': '0.5',
    'slide-bg': isDark ? `rgba(${hexToRgb(colorBg).join(', ')}, 0.92)` : `rgba(${hexToRgb(colorBg).join(', ')}, 0.82)`,
    'slide-border-color': colorInk,
    'slide-border-width': borderWidth,
    'slide-shadow': shadows.md,
    'color-surface': palette.primary,
    'color-surface-alt': palette.secondary,
    'color-accent': palette.accent,
    'badge-bg': palette.accent,
    'badge-color': badgeTextColor,
    'color-ink': colorInk,
    'color-muted': colorMuted,
    'border-width': borderWidth,
    'gutter': 'clamp(32px, 5vw, 72px)',
    'radius': '12px',
    'font-sans': '"Inter", "Helvetica Neue", Arial, sans-serif',
    'font-mono': '"Space Mono", "IBM Plex Mono", monospace',
    'shadow-sm': shadows.sm,
    'shadow-md': shadows.md,
    'shadow-lg': shadows.lg,
    'shadow-xl': shadows.xl
  };

  return theme;
}

function generatePalette(baseHue, strategy) {
  let hues = [];

  switch (strategy) {
    case 'analogous':
      hues = [baseHue, (baseHue + 30) % 360, (baseHue + 60) % 360];
      break;
    case 'triadic':
      hues = [baseHue, (baseHue + 120) % 360, (baseHue + 240) % 360];
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
  }

  // Generate colors with varied saturation/lightness for depth
  const primary = hslToHex(hues[0], 70 + Math.random() * 25, 55 + Math.random() * 15);
  const secondary = hslToHex(hues[1], 65 + Math.random() * 25, 60 + Math.random() * 15);
  const accent = hslToHex(hues[2], 75 + Math.random() * 20, 50 + Math.random() * 20);

  return { primary, secondary, accent };
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;

  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0;
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x;
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c;
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  r = Math.round((r + m) * 255);
  g = Math.round((g + m) * 255);
  b = Math.round((b + m) * 255);

  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : [255, 255, 255];
}

function getRelativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  const [rs, gs, bs] = [r, g, b].map((value) => {
    const channel = value / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
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
  const mix = (a, b) => Math.round(a * (1 - ratio) + b * ratio);
  return (
    '#' +
    [mix(r1, r2), mix(g1, g2), mix(b1, b2)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
  );
}

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

  const indexBtn = document.getElementById('index-btn');
  if (indexBtn) {
    indexBtn.addEventListener('click', toggleSlideIndex);
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

  const themeSelect = document.getElementById('theme-select');
  if (themeSelect) {
    themeSelect.addEventListener('change', async (event) => {
      const value = event.target.value;
      showHudStatus('🎨 Switching theme...', 'processing');

      try {
        let theme;
        let source;

        // Check if it's a user-saved theme (starts with 'saved:')
        if (value.startsWith('saved:')) {
          const themeName = value.replace('saved:', '');
          const library = loadThemeLibrary();
          const entry = library.find(t => t.name === themeName);
          if (!entry) throw new Error(`Theme "${themeName}" not found`);
          theme = entry.theme;
          source = `library:${themeName}`;
        } else {
          // It's a built-in theme (file path)
          const response = await fetch(value, { cache: "no-store" });
          if (!response.ok) throw new Error(`Failed to load theme: ${response.status}`);
          theme = await response.json();
          source = value;
        }

        const normalizedTheme = applyTheme(theme);
        setCurrentTheme(normalizedTheme, { source });
        loadThemeIntoEditor();
        syncThemeSelectUI();
        showHudStatus('✨ Theme applied', 'success');
        setTimeout(hideHudStatus, 1600);
      } catch (error) {
        console.error('Failed to apply theme:', error);
        showHudStatus('❌ Theme failed', 'error');
        setTimeout(hideHudStatus, 2000);
      }
    });
  }

  setActiveSlide(0);
  updateOverviewButton();
  overviewCursor = currentIndex;
}

async function loadSlides() {
  const response = await fetch(resolveSlidesPath(), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.json();
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
    const payload = {
      version: 1,
      updatedAt: Date.now(),
      source: resolveSlidesPath(),
      slides,
    };
    localStorage.setItem(getDeckStorageKey(), JSON.stringify(payload));
    deckPersistFailureNotified = false;
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
}

function createSlide(slide, index, rendererMap) {
  const type = slide.type ?? "standard";
  const section = document.createElement("section");
  section.className = `slide slide--${type}`;
  section.dataset.index = index;
  section.setAttribute("aria-hidden", "true");

  if (slide.image) {
    console.log('[DEBUG createSlide] Slide has image:', {
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
    console.log('[DEBUG createImage] No src, creating placeholder');
    return createImagePlaceholder(image, className);
  }
  const img = document.createElement("img");
  img.className = className;
  const actualSrc = image.src;
  const modalSrc = image.modalSrc ?? actualSrc;
  const shouldLazyLoad = typeof actualSrc === "string" && !actualSrc.startsWith("data:");

  console.log('[DEBUG createImage] Creating image:', {
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
    console.log('[DEBUG createImage] Setting base64 src directly');
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

  const placeholder = document.createElement("button");
  placeholder.type = "button";
  placeholder.className = [...baseClasses, "image-placeholder"].join(" ");

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

  // Click handler for Google Image Search (keep existing behavior)
  if (trimmedQuery) {
    placeholder.dataset.searchQuery = trimmedQuery;
    placeholder.setAttribute("aria-label", `Search images for ${trimmedQuery} or drag and drop`);
    placeholder.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const url = buildImageSearchUrl(trimmedQuery);
      window.open(url, "_blank", "noopener");
    });
  } else {
    placeholder.setAttribute(
      "aria-label",
      "Drag and drop or paste an image"
    );
  }

  // Drag & drop handlers
  placeholder.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.stopPropagation();
    placeholder.classList.add("image-placeholder--dragover");
    text.textContent = "Drop to add image";
  });

  placeholder.addEventListener("dragleave", (event) => {
    event.preventDefault();
    event.stopPropagation();
    placeholder.classList.remove("image-placeholder--dragover");
    text.textContent = trimmedQuery
      ? `Search "${trimmedQuery}" or drag & drop`
      : "Drag & drop or paste image";
  });

  placeholder.addEventListener("drop", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    placeholder.classList.remove("image-placeholder--dragover");

    const files = Array.from(event.dataTransfer.files);
    const imageFile = files.find(f => f.type.startsWith("image/"));

    if (imageFile) {
      await handleImageUpload(imageFile, placeholder, image);
    }
  });

  // Store reference to the original image object
  // This allows us to find and update the correct location in the slide data
  placeholder._imageRef = image;

  return placeholder;
}

function buildImageSearchUrl(query) {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("tbm", "isch");
  url.searchParams.set("q", query);
  return url.toString();
}

// ================================================================
// Image Upload & Compression
// ================================================================

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const TARGET_IMAGE_BYTES = 900 * 1024;

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
      console.log('[DEBUG] Image uploaded, re-rendering slide', slideIndex);
      console.log('[DEBUG] Slide image src:', slides[slideIndex].image?.src?.substring(0, 100));
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

  const dimensionSteps = [1920, 1600, 1440, 1280];
  const qualitySteps = [0.82, 0.72, 0.62, 0.54, 0.46];
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

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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
      console.log('[DEBUG] Updated image in nested structure');
      return;
    }
  }

  // Fallback: update top-level slide.image
  console.log('[DEBUG] Fallback to top-level slide.image');
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

function openImageModal(src, alt) {
  const modal = document.createElement('div');
  modal.className = 'image-modal';
  modal.innerHTML = `
    <div class="image-modal__backdrop"></div>
    <div class="image-modal__content">
      <img src="${src}" alt="${alt || ''}" loading="eager" decoding="sync" />
      <button class="image-modal__close" aria-label="Close">×</button>
    </div>
  `;

  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('is-active'));

  let handleEsc;

  const closeModal = () => {
    modal.classList.remove('is-active');
    document.removeEventListener('keydown', handleEsc);
    setTimeout(() => modal.remove(), 300);
  };

  modal.querySelector('.image-modal__backdrop').addEventListener('click', closeModal);
  const contentImg = modal.querySelector('.image-modal__content img');
  if (contentImg) {
    contentImg.addEventListener('click', closeModal);
  }
  modal.querySelector('.image-modal__close').addEventListener('click', closeModal);

  handleEsc = (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  };
  document.addEventListener('keydown', handleEsc);
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

function parseMarkdown(text) {
  if (typeof text !== 'string') return text;

  return text
    // Bold: **text** or __text__
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    // Italic: *text* or _text_ (but not inside words)
    .replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '<em>$1</em>')
    .replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<em>$1</em>')
    // Links: [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Code: `code`
    .replace(/`([^`]+)`/g, '<code>$1</code>');
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
    toggleSlideIndex,
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
    renderEditForm(getEditDrawerContext());
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

function showHudStatus(message, type = '') {
  const hudStatus = document.getElementById('hud-status');
  if (!hudStatus) return;

  hudStatus.textContent = message;
  hudStatus.className = `hud__status is-visible ${type ? `hud__status--${type}` : ''}`;
}

function hideHudStatus() {
  const hudStatus = document.getElementById('hud-status');
  if (!hudStatus) return;

  hudStatus.classList.remove('is-visible');
  setTimeout(() => {
    hudStatus.textContent = '';
    hudStatus.className = 'hud__status';
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
  const apiKey = localStorage.getItem('gemini_api_key');
  if (!apiKey) {
    alert('Please set your Gemini API key in Settings (⚙️ button) first!');
    return;
  }

  // Show loading state
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

    showHudStatus('✨ Graph generated', 'success');
    setTimeout(hideHudStatus, 2000);

  } catch (error) {
    console.error('Graph generation failed:', error);
    showHudStatus(`❌ ${error.message}`, 'error');
    setTimeout(hideHudStatus, 3000);

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

function syncThemeSelectUI() {
  const themeSelect = document.getElementById('theme-select');
  if (!themeSelect) return;
  const options = Array.from(themeSelect.options).map(option => option.value);
  const currentPath = getCurrentThemePath();
  if (currentPath && options.includes(currentPath)) {
    themeSelect.value = currentPath;
  } else {
    let customOption = themeSelect.querySelector('option[value="__custom__"]');
    if (!customOption) {
      customOption = document.createElement('option');
      customOption.value = '__custom__';
      customOption.textContent = 'Saved Theme';
      customOption.dataset.generated = 'true';
      themeSelect.appendChild(customOption);
    }
    themeSelect.value = '__custom__';
  }
}


themeDrawerInstance = createDrawer({
  id: 'theme-drawer',
  onOpen: () => {
    const themeBtn = document.getElementById('theme-btn');
    isThemeDrawerOpen = true;
    themeBtn?.setAttribute('aria-expanded', 'true');
    themeBtn?.classList.add('is-active');
    loadThemeIntoEditor();
    renderThemeLibrary();
    syncThemeSelectUI();
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
  openDrawer(themeDrawerInstance);
}

function closeThemeDrawer() {
  if (!themeDrawerInstance) return;
  closeDrawer(themeDrawerInstance);
}


function initThemeDrawer() {
  const themeDrawer = themeDrawerInstance?.element;
  const themeBtn = document.getElementById('theme-btn');
  const textarea = document.getElementById('theme-json-editor');
  const applyBtn = document.getElementById('theme-apply-btn');
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

  // JSON toggle
  const jsonToggle = document.getElementById('theme-json-toggle');
  if (jsonToggle && !jsonToggle.dataset.listenerAttached) {
    jsonToggle.addEventListener('click', handleThemeJsonToggle);
    jsonToggle.dataset.listenerAttached = 'true';
  }

  // Tab switching
  const tabs = themeDrawer.querySelectorAll('.theme-drawer__tab');
  tabs.forEach(tab => {
    if (!tab.dataset.tabListenerAttached) {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;

        // Update active tab
        tabs.forEach(t => t.classList.remove('theme-drawer__tab--active'));
        tab.classList.add('theme-drawer__tab--active');

        // Show/hide color grids based on active tab
        const colorGrids = themeDrawer.querySelectorAll('[data-tab-content]');
        colorGrids.forEach(grid => {
          grid.style.display = grid.dataset.tabContent === tabName ? 'grid' : 'none';
        });
      });
      tab.dataset.tabListenerAttached = 'true';
    }
  });

  applyBtn?.addEventListener('click', async () => {
    if (!textarea) return;
    try {
      const themeJson = textarea.value;
      const theme = JSON.parse(themeJson);
      const normalizedTheme = applyTheme(theme);
      setCurrentTheme(normalizedTheme, { source: '__custom__' });
      syncThemeSelectUI();
      showHudStatus('✨ Theme applied', 'success');
      setTimeout(hideHudStatus, 1600);
    } catch (error) {
      showHudStatus(`❌ Invalid JSON: ${error.message}`, 'error');
      setTimeout(hideHudStatus, 3000);
    }
  });

  saveBtn?.addEventListener('click', () => {
    if (!textarea) return;
    try {
      const themeJson = textarea.value;
      const theme = JSON.parse(themeJson);

      // Get current theme from dropdown
      const themeSelect = document.getElementById('theme-select');
      const currentValue = themeSelect?.value || '';

      // Extract name if it's a saved theme, otherwise leave blank
      let defaultName = '';
      if (currentValue.startsWith('saved:')) {
        defaultName = currentValue.replace('saved:', '');
      }

      const name = prompt('Name your theme:', defaultName);
      if (!name || !name.trim()) return;

      saveThemeToLibrary(name.trim(), theme);
      populateThemeDropdown();

      // Select the newly saved theme in dropdown
      if (themeSelect) themeSelect.value = `saved:${name.trim()}`;

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
      syncThemeSelectUI();

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

      const theme = generateRandomTheme();

      const normalizedTheme = applyTheme(theme);
      setCurrentTheme(normalizedTheme, { source: '__random__' });
      loadThemeIntoEditor();
      syncThemeSelectUI();

      showHudStatus('✨ Random theme applied!', 'success');
      setTimeout(hideHudStatus, 1600);
    } catch (error) {
      showHudStatus(`❌ ${error.message}`, 'error');
      setTimeout(hideHudStatus, 2000);
    }
  });

  syncThemeSelectUI();
  populateThemeDropdown();
}



function loadThemeIntoEditor() {
  const textarea = document.getElementById('theme-json-editor');
  const theme = getCurrentTheme() || extractCurrentThemeFromCSS();

  if (textarea) {
    textarea.value = JSON.stringify(theme, null, 2);
  }

  buildThemeFields(theme);
  syncThemeSelectUI();
}

function buildThemeFields(theme) {
  const container = document.getElementById('theme-fields');
  if (!container) return;

  // Organize color fields by tab
  const colorFieldsByTab = {
    background: [
      { key: 'color-bg', label: 'Background' },
      { key: 'color-muted', label: 'Muted' },
    ],
    text: [
      { key: 'color-ink', label: 'Text' },
    ],
    surface: [
      { key: 'color-surface', label: 'Surface' },
      { key: 'color-surface-alt', label: 'Surface Alt' },
    ],
    accent: [
      { key: 'color-accent', label: 'Accent' },
      { key: 'badge-bg', label: 'Badge BG' },
      { key: 'badge-color', label: 'Badge Text' },
    ],
  };

  const textFields = [
    { key: 'font-sans', label: 'Sans Font' },
    { key: 'font-mono', label: 'Mono Font' },
  ];

  const parallelFields = [
    { key: 'border-width', label: 'Border' },
    { key: 'radius', label: 'Radius' },
  ];

  // Build color grids for each tab
  let html = '';
  Object.entries(colorFieldsByTab).forEach(([tab, fields]) => {
    html += `<div class="theme-drawer__color-grid" data-tab-content="${tab}" style="display: ${tab === 'background' ? 'grid' : 'none'};">`;
    fields.forEach(field => {
      const value = extractHexColor(theme[field.key] || '#ffffff');
      const textColor = getContrastColor(value);
      html += `
        <div class="theme-drawer__color-field">
          <input
            type="color"
            class="theme-drawer__color-input"
            id="theme-field-${field.key}"
            data-theme-key="${field.key}"
            value="${value}"
          />
          <label class="theme-drawer__color-label" for="theme-field-${field.key}" style="color: ${textColor}">
            ${field.label}
          </label>
        </div>
      `;
    });
    html += '</div>';
  });

  // Font dropdowns
  const fontOptions = {
    'font-sans': [
      { value: '"Inter", "Helvetica Neue", Arial, sans-serif', label: 'Inter' },
      { value: '"Space Grotesk", "Helvetica Neue", sans-serif', label: 'Space Grotesk' },
      { value: '"Helvetica Neue", Helvetica, Arial, sans-serif', label: 'Helvetica' },
      { value: 'Arial, sans-serif', label: 'Arial' },
      { value: 'Georgia, serif', label: 'Georgia' },
    ],
    'font-mono': [
      { value: '"Space Mono", "IBM Plex Mono", monospace', label: 'Space Mono' },
      { value: '"JetBrains Mono", monospace', label: 'JetBrains Mono' },
      { value: '"Press Start 2P", monospace', label: 'Press Start 2P' },
      { value: '"Courier New", monospace', label: 'Courier New' },
    ],
  };

  textFields.forEach(field => {
    const value = theme[field.key] || '';
    const options = fontOptions[field.key];

    html += `
      <div class="theme-drawer__field">
        <label class="theme-drawer__label" for="theme-field-${field.key}">${field.label}</label>
        <select
          class="theme-drawer__select"
          id="theme-field-${field.key}"
          data-theme-key="${field.key}"
        >
          ${options.map(opt => `
            <option value="${opt.value}" ${value.includes(opt.label) ? 'selected' : ''}>
              ${opt.label}
            </option>
          `).join('')}
        </select>
      </div>
    `;
  });

  html += '<div class="theme-drawer__parallel-fields">';
  parallelFields.forEach(field => {
    const value = theme[field.key] || '';
    html += `
      <div class="theme-drawer__field">
        <label class="theme-drawer__label" for="theme-field-${field.key}">${field.label}</label>
        <input
          type="text"
          class="theme-drawer__input"
          id="theme-field-${field.key}"
          data-theme-key="${field.key}"
          value="${value}"
        />
      </div>
    `;
  });
  html += '</div>';

  container.innerHTML = html;
  setupThemeFieldSync();
  setupColorFieldSync();
}

function getContrastColor(hexColor) {
  // Convert hex to RGB
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);

  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Return black or white based on luminance
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

function setupColorFieldSync() {
  const colorInputs = document.querySelectorAll('.theme-drawer__color-input');
  colorInputs.forEach(input => {
    input.addEventListener('input', (e) => {
      // Update label text color based on new background
      const label = input.nextElementSibling;
      if (label) {
        label.style.color = getContrastColor(e.target.value);
      }
      syncThemeFieldsToJSON();
    });
  });
}

function extractHexColor(value) {
  // Extract hex color from string like "#fffbf3" or "rgba(255, 251, 243, 0.82)"
  const hexMatch = value.match(/#[0-9a-fA-F]{6}/);
  return hexMatch ? hexMatch[0] : '#ffffff';
}

function setupThemeFieldSync() {
  const inputs = document.querySelectorAll('[data-theme-key]');
  inputs.forEach(input => {
    input.addEventListener('input', () => {
      syncThemeFieldsToJSON();
    });
  });
}

function syncThemeFieldsToJSON() {
  const textarea = document.getElementById('theme-json-editor');
  if (!textarea) return;

  try {
    const theme = JSON.parse(textarea.value);
    const inputs = document.querySelectorAll('[data-theme-key]');

    inputs.forEach(input => {
      const key = input.dataset.themeKey;
      const value = input.value;

      if (value) {
        theme[key] = value;
      }
    });

    textarea.value = JSON.stringify(theme, null, 2);
  } catch (error) {
    console.warn('Cannot sync theme fields: invalid JSON');
  }
}

function handleThemeJsonToggle() {
  const container = document.getElementById('theme-json-container');
  const toggle = document.getElementById('theme-json-toggle');
  if (!container || !toggle) return;

  const icon = toggle.querySelector('.theme-drawer__json-toggle-icon');
  const isOpen = container.style.display !== 'none';
  container.style.display = isOpen ? 'none' : 'block';
  if (icon) {
    icon.textContent = isOpen ? '▶' : '▼';
  }
}

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
  const themeSelect = document.getElementById('theme-select');
  if (!themeSelect) return;

  const library = loadThemeLibrary();

  // Remove old saved theme options (keep built-in themes)
  const options = Array.from(themeSelect.options);
  options.forEach(option => {
    if (option.value.startsWith('saved:')) {
      option.remove();
    }
  });

  // Add saved themes to dropdown
  library.forEach(entry => {
    const option = document.createElement('option');
    option.value = `saved:${entry.name}`;
    option.textContent = entry.name;
    themeSelect.appendChild(option);
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

  const themeSelect = document.getElementById('theme-select');
  if (themeSelect) {
    themeSelect.addEventListener('change', async (event) => {
      const themePath = event.target.value;
      showHudStatus('🎨 Switching theme...', 'processing');
      try {
        const response = await fetch(themePath, { cache: "no-store" });
        if (!response.ok) throw new Error(`Failed to load theme: ${response.status}`);
        const theme = await response.json();
        const normalizedTheme = applyTheme(theme);
        setCurrentTheme(normalizedTheme, { source: themePath });
        loadThemeIntoEditor(); // Update editor if drawer is open
        syncThemeSelectUI();
        showHudStatus('✨ Theme applied', 'success');
        setTimeout(hideHudStatus, 1600);
      } catch (error) {
        console.error('Failed to apply theme:', error);
        showHudStatus('❌ Theme failed', 'error');
        setTimeout(hideHudStatus, 2000);
      }
    });
  }

  // Initialize theme drawer
  initThemeDrawer();

  // Show intro modal on first visit
  showIntroModalIfFirstVisit();

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
