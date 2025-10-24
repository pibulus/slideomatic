import { normalizeThemeTokens, REQUIRED_THEME_TOKENS } from './theme-utils.js';
import { registerLazyImage, loadLazyImage } from './lazy-images.js';
import {
  initSlideIndex,
  toggleSlideIndex,
  closeSlideIndex,
  refreshSlideIndex,
  updateSlideIndexHighlight,
} from './slide-index.js';

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
const voiceButtons = {};
let activeVoiceMode = null;
let voiceProcessing = false;
const OVERVIEW_MAX_ROWS = 3;
let overviewRowCount = 1;
let overviewColumnCount = 0;
let overviewCursor = 0;
let lastOverviewHighlight = 0;
let currentTheme = null;
let isThemeDrawerOpen = false;
let themeDrawerPreviousFocus = null;
let currentThemePath = "theme.json";
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

const THEME_LIBRARY_KEY = 'slideomatic_themes';
const CURRENT_THEME_KEY = 'slideomatic_current_theme';
const CURRENT_THEME_PATH_KEY = 'slideomatic_current_theme_path';
const LOCAL_THEME_SOURCE = '__local__';
const FOCUSABLE_SELECTORS = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function getFocusableElements(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTORS)).filter(
    (el) =>
      !el.hasAttribute('disabled') &&
      el.getAttribute('tabindex') !== '-1' &&
      typeof el.focus === 'function' &&
      (el.offsetWidth > 0 ||
        el.offsetHeight > 0 ||
        el.getClientRects().length > 0)
  );
}

function trapFocus(event, container) {
  if (event.key !== 'Tab') return;
  const focusable = getFocusableElements(container);
  if (focusable.length === 0) {
    event.preventDefault();
    container.setAttribute('tabindex', '-1');
    container.focus({ preventScroll: true });
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const isShift = event.shiftKey;
  const active = document.activeElement;

  if (!isShift && active === last) {
    event.preventDefault();
    first.focus();
  } else if (isShift && active === first) {
    event.preventDefault();
    last.focus();
  }
}

function focusFirstElement(container) {
  const focusable = getFocusableElements(container);
  if (focusable.length > 0) {
    focusable[0].focus();
  } else {
    container.setAttribute('tabindex', '-1');
    container.focus({ preventScroll: true });
  }
}
function getThemeLibrary() {
  try {
    const stored = localStorage.getItem(THEME_LIBRARY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.warn('Failed to load theme library:', error);
    return [];
  }
}

function saveThemeToLibrary(name, theme) {
  const library = getThemeLibrary();
  const existing = library.findIndex(t => t.name === name);

  const normalizedTheme = normalizeThemeTokens(theme);

  const themeEntry = {
    name,
    theme: normalizedTheme,
    created: existing >= 0 ? library[existing].created : Date.now(),
    updated: Date.now()
  };

  if (existing >= 0) {
    library[existing] = themeEntry;
  } else {
    library.push(themeEntry);
  }

  localStorage.setItem(THEME_LIBRARY_KEY, JSON.stringify(library));
  return themeEntry;
}

function deleteThemeFromLibrary(name) {
  const library = getThemeLibrary();
  const filtered = library.filter(t => t.name !== name);
  localStorage.setItem(THEME_LIBRARY_KEY, JSON.stringify(filtered));
}

function setCurrentTheme(theme, options = {}) {
  const normalized = normalizeThemeTokens(theme);
  currentTheme = normalized;
  localStorage.setItem(CURRENT_THEME_KEY, JSON.stringify(normalized));
  const source = options.source ?? currentThemePath ?? LOCAL_THEME_SOURCE;
  currentThemePath = source;
  try {
    localStorage.setItem(CURRENT_THEME_PATH_KEY, source);
  } catch (error) {
    console.warn('Failed to store theme path:', error);
  }
  return normalized;
}

function getCurrentTheme() {
  if (currentTheme) return currentTheme;
  try {
    const stored = localStorage.getItem(CURRENT_THEME_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    currentTheme = normalizeThemeTokens(parsed);
    const storedPath = localStorage.getItem(CURRENT_THEME_PATH_KEY);
    currentThemePath = storedPath || LOCAL_THEME_SOURCE;
    return currentTheme;
  } catch (error) {
    console.warn('Failed to load current theme:', error);
    localStorage.removeItem(CURRENT_THEME_KEY);
    return null;
  }
}

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

  document.addEventListener("keydown", handleKeyboard);
  slidesRoot.addEventListener("click", handleSlideClick);
  document.addEventListener("click", handleImageModalTrigger);

  // Setup deck upload
  const uploadInput = document.getElementById('deck-upload');
  if (uploadInput) {
    uploadInput.addEventListener('change', handleDeckUpload);
  }

  // Setup voice-driven actions
  const addBtn = document.getElementById('add-btn');
  if (addBtn) {
    voiceButtons.add = addBtn;
    addBtn.addEventListener('click', () => toggleVoiceRecording('add'));
    updateVoiceUI('add', 'idle');
  }

  const editBtn = document.getElementById('edit-btn');
  if (editBtn) {
    voiceButtons.edit = editBtn;
    editBtn.addEventListener('click', () => toggleVoiceRecording('edit'));
    updateVoiceUI('edit', 'idle');
  }

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
      const themePath = event.target.value;
      showHudStatus('🎨 Switching theme...', 'processing');
      try {
        const response = await fetch(themePath, { cache: "no-store" });
        if (!response.ok) throw new Error(`Failed to load theme: ${response.status}`);
        const theme = await response.json();
        const normalizedTheme = applyTheme(theme);
        setCurrentTheme(normalizedTheme, { source: themePath });
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
  const themeParamProvided = params.has("theme");
  const storedTheme = getCurrentTheme();
  if (storedTheme && !themeParamProvided) {
    applyTheme(storedTheme);
    const storedPath = localStorage.getItem(CURRENT_THEME_PATH_KEY);
    currentThemePath = storedPath || LOCAL_THEME_SOURCE;
    if (!storedPath) {
      try {
        localStorage.setItem(CURRENT_THEME_PATH_KEY, currentThemePath);
      } catch (error) {
        console.warn('Failed to persist theme path:', error);
      }
    }
    syncThemeSelectUI();
    return;
  }

  const themePath = resolveThemePath();
  try {
    const response = await fetch(themePath, { cache: "no-store" });
    if (!response.ok) return;
    const theme = await response.json();
    const normalizedTheme = applyTheme(theme);
    setCurrentTheme(normalizedTheme, { source: themePath });
    currentThemePath = themePath;
    syncThemeSelectUI();
  } catch (error) {
    console.warn("Unable to load custom theme, using defaults.", error);
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

function applyTheme(theme) {
  if (!theme || typeof theme !== "object") return;
  const normalized = normalizeThemeTokens(theme);
  currentTheme = normalized;
  const root = document.documentElement;
  Object.entries(normalized).forEach(([token, value]) => {
    if (value == null) return;
    root.style.setProperty(`--${token}`, value);
  });
  return normalized;
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

function handleKeyboard(event) {
  const target = event.target;
  if (
    target &&
    target instanceof HTMLElement &&
    (target.matches("input, textarea, select") ||
      target.isContentEditable)
  ) {
    return;
  }

  const { key } = event;
  const lowerKey = key.toLowerCase();

  if (isOverview) {
    if (key === "ArrowRight") {
      event.preventDefault();
      moveOverviewCursorBy(1, 0);
      return;
    }
    if (key === "ArrowLeft") {
      event.preventDefault();
      moveOverviewCursorBy(-1, 0);
      return;
    }
    if (key === "ArrowDown") {
      event.preventDefault();
      moveOverviewCursorBy(0, 1);
      return;
    }
    if (key === "ArrowUp") {
      event.preventDefault();
      moveOverviewCursorBy(0, -1);
      return;
    }
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      flashKeyFeedback('↵');
      exitOverview(overviewCursor);
      return;
    }
    if (key === "Escape") {
      event.preventDefault();
      flashKeyFeedback('ESC');
      exitOverview();
      return;
    }
  }

  if (key === "ArrowRight" || key === " ") {
    event.preventDefault();
    flashKeyFeedback('→');
    setActiveSlide(currentIndex + 1);
    return;
  }

  if (key === "ArrowLeft") {
    event.preventDefault();
    flashKeyFeedback('←');
    setActiveSlide(currentIndex - 1);
    return;
  }

  if (key === "Home") {
    event.preventDefault();
    flashKeyFeedback('⇤');
    setActiveSlide(0);
    return;
  }

  if (key === "End") {
    event.preventDefault();
    flashKeyFeedback('⇥');
    setActiveSlide(slideElements.length - 1);
    return;
  }

  if (lowerKey === "o") {
    event.preventDefault();
    flashKeyFeedback('O');
    toggleOverview();
    return;
  }

  if (lowerKey === "i") {
    event.preventDefault();
    flashKeyFeedback('I');
    toggleSlideIndex();
    return;
  }

  if (lowerKey === "d") {
    event.preventDefault();
    flashKeyFeedback('D');
    downloadDeck();
    return;
  }

  if (lowerKey === "n") {
    event.preventDefault();
    flashKeyFeedback('N');
    toggleSpeakerNotes();
    return;
  }

  if (lowerKey === "u") {
    event.preventDefault();
    flashKeyFeedback('U');
    const uploadInput = document.getElementById('deck-upload');
    if (uploadInput) uploadInput.click();
    return;
  }

  if (lowerKey === "e") {
    event.preventDefault();
    flashKeyFeedback('E');
    toggleEditDrawer();
    return;
  }

  if (lowerKey === "v") {
    event.preventDefault();
    flashKeyFeedback('V');
    toggleVoiceRecording('add');
    return;
  }

  if (lowerKey === "t") {
    event.preventDefault();
    flashKeyFeedback('T');
    toggleThemeDrawer();
    return;
  }

  if (lowerKey === "s") {
    event.preventDefault();
    flashKeyFeedback('S');
    openSettingsModal();
    return;
  }

  if (key === "Escape") {
    closeSettingsModal();
  }
}

function flashKeyFeedback(key) {
  const feedback = document.createElement('div');
  feedback.className = 'key-feedback';
  feedback.textContent = key;
  document.body.appendChild(feedback);

  requestAnimationFrame(() => {
    feedback.classList.add('active');
  });

  setTimeout(() => {
    feedback.classList.remove('active');
    setTimeout(() => feedback.remove(), 300);
  }, 400);
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
    renderEditForm();
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

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return '';
  }
  const thresh = 1024;
  if (bytes < thresh) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let u = -1;
  let value = bytes;
  do {
    value /= thresh;
    ++u;
  } while (value >= thresh && u < units.length - 1);
  return `${value.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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
let editDrawerPreviousFocus = null;

document.getElementById('edit-drawer')?.setAttribute('aria-hidden', 'true');

const handleEditDrawerKeydown = (event) => {
  const drawer = document.getElementById('edit-drawer');
  if (!drawer || !isEditDrawerOpen) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeEditDrawer();
  } else if (event.key === 'Tab') {
    trapFocus(event, drawer);
  }
};

function toggleEditDrawer() {
  if (isEditDrawerOpen) {
    closeEditDrawer();
  } else {
    openEditDrawer();
  }
}

function openEditDrawer() {
  const drawer = document.getElementById('edit-drawer');
  if (!drawer || isEditDrawerOpen) return;

  if (isThemeDrawerOpen) {
    closeThemeDrawer();
  }

  isEditDrawerOpen = true;
  editDrawerPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  drawer.classList.add('is-open', 'is-springing');
  drawer.setAttribute('aria-hidden', 'false');
  drawer.addEventListener(
    'animationend',
    () => drawer.classList.remove('is-springing'),
    { once: true }
  );

  renderEditForm();

  const closeBtn = drawer.querySelector('.edit-drawer__close');
  if (closeBtn && !closeBtn.dataset.listenerAttached) {
    closeBtn.addEventListener('click', closeEditDrawer);
    closeBtn.dataset.listenerAttached = 'true';
  }

  focusFirstElement(drawer);
  document.addEventListener('keydown', handleEditDrawerKeydown, true);
}

function closeEditDrawer() {
  const drawer = document.getElementById('edit-drawer');
  if (!drawer || !isEditDrawerOpen) return;

  isEditDrawerOpen = false;
  drawer.classList.remove('is-open');
  drawer.classList.remove('is-springing');
  drawer.setAttribute('aria-hidden', 'true');
  document.removeEventListener('keydown', handleEditDrawerKeydown, true);

  const target = editDrawerPreviousFocus && typeof editDrawerPreviousFocus.focus === 'function'
    ? editDrawerPreviousFocus
    : document.getElementById('edit-btn');
  requestAnimationFrame(() => target?.focus());
  editDrawerPreviousFocus = null;
}

// ================================================================
// Base64 Token System - Makes JSON Editor Readable
// ================================================================

function createBase64Token(imageData) {
  const filename = imageData.originalFilename || 'image';
  const size = imageData.compressedSize
    ? formatBytes(imageData.compressedSize)
    : 'unknown size';
  return `{{BASE64_IMAGE: ${filename}, ${size}}}`;
}

function isBase64Token(str) {
  return typeof str === 'string' && str.startsWith('{{BASE64_IMAGE:');
}

function replaceBase64WithToken(imageObj) {
  if (!imageObj || typeof imageObj !== 'object') return imageObj;

  const result = { ...imageObj };

  if (result.src && typeof result.src === 'string' && result.src.startsWith('data:image')) {
    result.src = createBase64Token(result);
  }

  return result;
}

function prepareSlideForEditing(slide) {
  // Deep clone to avoid mutating original
  const clone = JSON.parse(JSON.stringify(slide));

  // Handle top-level image
  if (clone.image) {
    clone.image = replaceBase64WithToken(clone.image);
  }

  // Handle media array (title slides)
  if (Array.isArray(clone.media)) {
    clone.media = clone.media.map(mediaItem => {
      if (mediaItem.image) {
        return { ...mediaItem, image: replaceBase64WithToken(mediaItem.image) };
      }
      return mediaItem;
    });
  }

  // Handle gallery items
  if (Array.isArray(clone.items)) {
    clone.items = clone.items.map(item => {
      if (item.image) {
        return { ...item, image: replaceBase64WithToken(item.image) };
      }
      return item;
    });
  }

  // Handle split columns
  if (clone.left?.image) {
    clone.left = { ...clone.left, image: replaceBase64WithToken(clone.left.image) };
  }
  if (clone.right?.image) {
    clone.right = { ...clone.right, image: replaceBase64WithToken(clone.right.image) };
  }

  // Handle pillars
  if (Array.isArray(clone.pillars)) {
    clone.pillars = clone.pillars.map(pillar => {
      if (pillar.image) {
        return { ...pillar, image: replaceBase64WithToken(pillar.image) };
      }
      return pillar;
    });
  }

  return clone;
}

function restoreBase64InImage(editedImage, originalImage) {
  if (!editedImage || typeof editedImage !== 'object') return editedImage;

  const result = { ...editedImage };

  // If the edited version has a token, restore original base64
  if (isBase64Token(result.src)) {
    if (originalImage?.src?.startsWith('data:image')) {
      result.src = originalImage.src;
    } else {
      // Token but no original base64? User probably manually typed it wrong
      console.warn('Base64 token found but no original image data to restore');
      result.src = ''; // Clear it to show placeholder
    }
  }

  return result;
}

function restoreBase64FromTokens(editedSlide, originalSlide) {
  const result = { ...editedSlide };

  // Restore top-level image
  if (result.image && originalSlide.image) {
    result.image = restoreBase64InImage(result.image, originalSlide.image);
  }

  // Restore media array (title slides)
  if (Array.isArray(result.media) && Array.isArray(originalSlide.media)) {
    result.media = result.media.map((mediaItem, index) => {
      if (mediaItem.image && originalSlide.media[index]?.image) {
        return { ...mediaItem, image: restoreBase64InImage(mediaItem.image, originalSlide.media[index].image) };
      }
      return mediaItem;
    });
  }

  // Restore gallery items
  if (Array.isArray(result.items) && Array.isArray(originalSlide.items)) {
    result.items = result.items.map((item, index) => {
      if (item.image && originalSlide.items[index]?.image) {
        return { ...item, image: restoreBase64InImage(item.image, originalSlide.items[index].image) };
      }
      return item;
    });
  }

  // Restore split columns
  if (result.left?.image && originalSlide.left?.image) {
    result.left = { ...result.left, image: restoreBase64InImage(result.left.image, originalSlide.left.image) };
  }
  if (result.right?.image && originalSlide.right?.image) {
    result.right = { ...result.right, image: restoreBase64InImage(result.right.image, originalSlide.right.image) };
  }

  // Restore pillars
  if (Array.isArray(result.pillars) && Array.isArray(originalSlide.pillars)) {
    result.pillars = result.pillars.map((pillar, index) => {
      if (pillar.image && originalSlide.pillars[index]?.image) {
        return { ...pillar, image: restoreBase64InImage(pillar.image, originalSlide.pillars[index].image) };
      }
      return pillar;
    });
  }

  return result;
}

// ================================================================
// Quick-Edit Fields - 80/20 UX Layer
// ================================================================

function buildQuickEditFields(slide) {
  const type = slide.type || 'standard';
  let html = `<div class="edit-drawer__quick-edit">`;

  html += `<div class="edit-drawer__field edit-drawer__field--readonly">
    <label class="edit-drawer__label">Type</label>
    <div class="edit-drawer__type-display">${type}</div>
  </div>`;

  // Common text fields based on slide type
  if (type === 'title') {
    if ('eyebrow' in slide) {
      html += buildTextField('eyebrow', 'Eyebrow', slide.eyebrow || '');
    }
    html += buildTextField('title', 'Title', slide.title || '');
    if ('subtitle' in slide) {
      html += buildTextField('subtitle', 'Subtitle', slide.subtitle || '');
    }
  } else if (type === 'quote') {
    html += buildTextArea('quote', 'Quote', slide.quote || slide.headline || '');
    html += buildTextField('attribution', 'Attribution', slide.attribution || slide.body || '');
  } else {
    // Standard, split, grid, gallery, etc.
    if ('headline' in slide || type === 'standard' || type === 'gallery' || type === 'grid') {
      html += buildTextField('headline', 'Headline', slide.headline || '');
    }
    if ('body' in slide || type === 'standard' || type === 'gallery') {
      html += buildTextArea('body', 'Body', Array.isArray(slide.body) ? slide.body.join('\n') : (slide.body || ''));
    }
  }

  // Image manager
  html += buildImageManager(slide);

  html += `</div>`;
  return html;
}

function buildTextField(id, label, value) {
  const escapedValue = String(value || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `
    <div class="edit-drawer__field">
      <label class="edit-drawer__label" for="quick-edit-${id}">${label}</label>
      <input
        type="text"
        class="edit-drawer__input"
        id="quick-edit-${id}"
        data-field="${id}"
        value="${escapedValue}"
      />
    </div>
  `;
}

function buildTextArea(id, label, value) {
  const escapedValue = String(value || '').replace(/</g, '&lt;');
  return `
    <div class="edit-drawer__field">
      <label class="edit-drawer__label" for="quick-edit-${id}">${label}</label>
      <textarea
        class="edit-drawer__textarea edit-drawer__textarea--small"
        id="quick-edit-${id}"
        data-field="${id}"
        rows="3"
      >${escapedValue}</textarea>
    </div>
  `;
}

function buildImageManager(slide) {
  const images = collectSlideImages(slide);

  if (images.length === 0) return '';

  let html = `
    <div class="edit-drawer__field">
      <label class="edit-drawer__label">Images (${images.length})</label>
      <div class="edit-drawer__image-list">
  `;

  images.forEach((img, index) => {
    const filename = img.originalFilename || img.src?.split('/').pop() || 'image';
    const isBase64 = img.src?.startsWith('data:');
    const size = img.compressedSize ? ` (${formatBytes(img.compressedSize)})` : '';
    const displayName = isBase64 ? `${filename}${size}` : filename;

    html += `
      <div class="edit-drawer__image-item">
        <span class="edit-drawer__image-icon">📷</span>
        <span class="edit-drawer__image-name">${displayName}</span>
        <button type="button" class="edit-drawer__image-remove" data-image-index="${index}" title="Remove image">×</button>
      </div>
    `;
  });

  html += `
      </div>
    </div>
  `;

  return html;
}

function collectSlideImages(slide) {
  const images = [];

  if (slide.image?.src) {
    images.push(slide.image);
  }

  if (Array.isArray(slide.media)) {
    slide.media.forEach(item => {
      if (item.image?.src) images.push(item.image);
    });
  }

  if (Array.isArray(slide.items)) {
    slide.items.forEach(item => {
      if (item.image?.src) images.push(item.image);
    });
  }

  if (slide.left?.image?.src) {
    images.push(slide.left.image);
  }

  if (slide.right?.image?.src) {
    images.push(slide.right.image);
  }

  if (Array.isArray(slide.pillars)) {
    slide.pillars.forEach(pillar => {
      if (pillar.image?.src) images.push(pillar.image);
    });
  }

  return images;
}

function renderEditForm() {
  const content = document.getElementById('edit-drawer-content');
  if (!content) return;

  const currentSlide = slides[currentIndex];
  if (!currentSlide) return;

  // Prepare slide for display (replace base64 with tokens)
  const displaySlide = prepareSlideForEditing(currentSlide);

  // Build quick-edit fields based on slide type
  const quickEditHTML = buildQuickEditFields(currentSlide);

  content.innerHTML = `
    <form class="edit-drawer__form">
      ${quickEditHTML}

      <div class="edit-drawer__field edit-drawer__field--json">
        <button type="button" class="edit-drawer__json-toggle" id="json-toggle">
          <span class="edit-drawer__json-toggle-icon">▶</span>
          <span class="edit-drawer__json-toggle-text">Advanced (JSON Editor)</span>
        </button>
        <div class="edit-drawer__json-container" id="json-container" style="display: none;">
          <textarea
            class="edit-drawer__textarea"
            id="slide-json-editor"
            rows="20"
            style="font-family: var(--font-mono); font-size: 0.9rem;"
          >${JSON.stringify(displaySlide, null, 2)}</textarea>
        </div>
      </div>
      <div class="edit-drawer__field edit-drawer__field--template">
        <label class="edit-drawer__label">Add Template</label>
        <div class="edit-drawer__template-controls">
          <select class="edit-drawer__select" id="slide-template-select">
            <option value="">Choose slide type…</option>
            <option value="title">Title</option>
            <option value="standard">Standard</option>
            <option value="quote">Quote</option>
            <option value="split">Split</option>
            <option value="grid">Grid</option>
            <option value="pillars">Pillars</option>
            <option value="gallery">Gallery</option>
            <option value="image">Image</option>
            <option value="typeface">Typeface</option>
          </select>
          <button type="button" class="edit-drawer__button" id="add-template-btn">
            Add Template
          </button>
        </div>
      </div>
      <button type="button" class="edit-drawer__button" id="save-slide-btn">
        Save & Reload
      </button>
      <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="duplicate-slide-btn">
        Duplicate Slide
      </button>
      <button type="button" class="edit-drawer__button edit-drawer__button--ghost" id="download-deck-btn">
        Save Deck JSON
      </button>
    </form>
  `;

  // Setup save button
  document.getElementById('save-slide-btn')?.addEventListener('click', saveCurrentSlide);
  document.getElementById('duplicate-slide-btn')?.addEventListener('click', duplicateCurrentSlide);
  document.getElementById('download-deck-btn')?.addEventListener('click', () => {
    const persisted = downloadDeck();
    if (persisted) {
      showHudStatus('💾 Deck downloaded', 'success');
      setTimeout(hideHudStatus, 1600);
    }
  });

  const templateBtn = document.getElementById('add-template-btn');
  if (templateBtn) {
    templateBtn.addEventListener('click', () => {
      const select = document.getElementById('slide-template-select');
      const type = select ? select.value : '';
      if (!type) {
        alert('Select a slide type to add.');
        return;
      }

      const template = getSlideTemplate(type);
      if (!template) {
        alert(`No template available for type "${type}".`);
        return;
      }

      const insertIndex = currentIndex + 1;
      insertSlideAt(insertIndex, template, { activate: true });
      showHudStatus(`✨ Added ${type} template`, 'success');
      setTimeout(hideHudStatus, 1600);
      renderEditForm();
      console.log(`✓ Added ${type} template slide`);
    });
  }

  // Setup JSON toggle
  const jsonToggle = document.getElementById('json-toggle');
  if (jsonToggle) {
    jsonToggle.addEventListener('click', () => {
      const container = document.getElementById('json-container');
      const icon = jsonToggle.querySelector('.edit-drawer__json-toggle-icon');
      if (container && icon) {
        const isOpen = container.style.display !== 'none';
        container.style.display = isOpen ? 'none' : 'block';
        icon.textContent = isOpen ? '▶' : '▼';
      }
    });
  }

  // Setup quick-edit field sync
  setupQuickEditSync();

}

function setupQuickEditSync() {
  // Find all quick-edit input fields
  const inputs = document.querySelectorAll('[data-field]');

  inputs.forEach(input => {
    input.addEventListener('input', () => {
      syncQuickEditToJSON();
    });
  });
}

function syncQuickEditToJSON() {
  const textarea = document.getElementById('slide-json-editor');
  if (!textarea) return;

  try {
    const slide = JSON.parse(textarea.value);
    const inputs = document.querySelectorAll('[data-field]');

    inputs.forEach(input => {
      const field = input.dataset.field;
      let value = input.value;

      // Handle body as array if it contains newlines
      if (field === 'body' && value.includes('\n')) {
        value = value.split('\n').filter(line => line.trim());
      }

      slide[field] = value;
    });

    textarea.value = JSON.stringify(slide, null, 2);
  } catch (error) {
    // If JSON is invalid, don't try to sync
    console.warn('Cannot sync quick-edit: invalid JSON');
  }
}

function saveCurrentSlide() {
  // First, sync quick-edit fields to JSON
  syncQuickEditToJSON();

  const textarea = document.getElementById('slide-json-editor');
  if (!textarea) return;

  try {
    const editedSlide = JSON.parse(textarea.value);
    const originalSlide = slides[currentIndex];

    console.log('[DEBUG] Saving slide...');
    console.log('[DEBUG] Edited image src:', editedSlide.image?.src?.substring(0, 100));
    console.log('[DEBUG] Original image src:', originalSlide.image?.src?.substring(0, 100));

    // Restore base64 data from tokens
    const restoredSlide = restoreBase64FromTokens(editedSlide, originalSlide);

    console.log('[DEBUG] Restored image src:', restoredSlide.image?.src?.substring(0, 100));

    const targetIndex = currentIndex;
    slides[currentIndex] = restoredSlide;
    replaceSlideAt(targetIndex);
    closeEditDrawer();
    showHudStatus('✨ Slide updated', 'success');
    setTimeout(hideHudStatus, 1600);
    console.log('✓ Slide updated');
  } catch (error) {
    alert(`Invalid JSON: ${error.message}`);
  }
}

function duplicateCurrentSlide() {
  const currentSlide = slides[currentIndex];
  if (!currentSlide) return;

  // Deep clone the slide
  const duplicatedSlide = JSON.parse(JSON.stringify(currentSlide));

  // Insert after current slide
  const newIndex = currentIndex + 1;
  insertSlideAt(newIndex, duplicatedSlide, { activate: true });
  closeEditDrawer();
  showHudStatus('✨ Slide duplicated', 'success');
  setTimeout(hideHudStatus, 1600);
  console.log('✓ Slide duplicated');
}

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

// ===================================================================
// VOICE-DRIVEN SLIDE ACTIONS
// ===================================================================

let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let mediaStream = null;

// ===================================================================
// API KEY MANAGEMENT
// ===================================================================

const STORAGE_KEY_API = 'slideomatic_gemini_api_key';

function getGeminiApiKey() {
  return localStorage.getItem(STORAGE_KEY_API) || '';
}

function toggleVoiceRecording(mode = 'add') {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    openSettingsModal();
    showApiKeyStatus('error', 'Please add your Gemini API key to use voice features');
    return;
  }

  if (mode === 'edit' && !slideElements[currentIndex]) {
    alert('No slide selected to edit.');
    return;
  }

  if (voiceProcessing) {
    return;
  }

  if (isRecording) {
    if (activeVoiceMode === mode) {
      stopVoiceRecording();
    }
    return;
  }

  startVoiceRecording(mode);
}

async function startVoiceRecording(mode) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }
    });

    const mimeTypes = ['audio/webm', 'audio/ogg', 'audio/mp4', ''];
    let mimeType = '';
    for (const type of mimeTypes) {
      if (!type || MediaRecorder.isTypeSupported(type)) {
        mimeType = type;
        break;
      }
    }

    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    audioChunks = [];
    mediaStream = stream;
    activeVoiceMode = mode;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const currentMode = activeVoiceMode || mode;
      const audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' });
      voiceProcessing = true;
      try {
        await processVoiceAction(currentMode, audioBlob);
      } finally {
        cleanupVoiceRecording({ resetButton: false });
        updateVoiceUI(currentMode, 'idle');
        voiceProcessing = false;
        activeVoiceMode = null;
      }
    };

    mediaRecorder.start(1000);
    isRecording = true;
    updateVoiceUI(mode, 'recording');
    console.log('🎙️ Recording started...');
  } catch (error) {
    console.error('❌ Error starting recording:', error);
    alert('Failed to access microphone. Please check permissions.');
    cleanupVoiceRecording({ resetButton: false });
    updateVoiceUI(mode, 'idle');
    activeVoiceMode = null;
  }
}

function stopVoiceRecording() {
  if (!mediaRecorder || !isRecording) return;

  isRecording = false;
  if (activeVoiceMode) {
    updateVoiceUI(activeVoiceMode, 'processing');
  }

  if (mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

function cleanupVoiceRecording({ resetButton = true } = {}) {
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  mediaRecorder = null;
  audioChunks = [];
  isRecording = false;
  if (resetButton && activeVoiceMode) {
    updateVoiceUI(activeVoiceMode, 'idle');
  }
}

function updateVoiceUI(mode, state) {
  const button = voiceButtons[mode];
  const hudStatus = document.getElementById('hud-status');
  if (!button) return;

  const baseLabel = mode === 'edit' ? 'Edit' : 'Add';
  const shortcutHint = mode === 'add' ? ' (shortcut V)' : '';

  if (state === 'recording') {
    button.classList.add('is-recording');
    button.classList.remove('is-processing');
    button.textContent = 'Stop';
    button.setAttribute('aria-label', 'Stop recording');
    if (hudStatus) {
      hudStatus.textContent = '🎙 Recording...';
      hudStatus.className = 'hud__status hud__status--recording is-visible';
    }
    return;
  }

  if (state === 'processing') {
    button.classList.remove('is-recording');
    button.classList.add('is-processing');
    button.textContent = baseLabel;
    button.setAttribute('aria-label', `${baseLabel} slide from voice${shortcutHint}`);
    if (hudStatus) {
      hudStatus.textContent = mode === 'edit'
        ? '⚡ Updating slide...'
        : '⚡ Generating slide...';
      hudStatus.className = 'hud__status hud__status--processing is-visible';
    }
    return;
  }

  button.classList.remove('is-recording', 'is-processing');
  button.textContent = baseLabel;
  button.setAttribute('aria-label', `${baseLabel} slide from voice${shortcutHint}`);
}

async function processVoiceAction(mode, audioBlob) {
  const action = mode === 'edit' ? processVoiceEditSlide : processVoiceToSlide;
  await action(audioBlob);
}

async function processVoiceToSlide(audioBlob) {
  try {
    console.log('🤖 Processing audio with Gemini...');
    const uiStart = performance.now();

    const base64Audio = await blobToBase64(audioBlob);
    const audioData = base64Audio.split(',')[1];

    const prompt = buildSlideDesignPrompt();
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      throw new Error('No API key set. Press S to open settings and add your Gemini API key.');
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: audioBlob.type || 'audio/webm',
                  data: audioData
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.7,
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

    const jsonMatch = generatedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ||
                      generatedText.match(/\{[\s\S]*\}/);

    const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : generatedText;
    const slideData = JSON.parse(jsonText);
    validateSlides([slideData]);

    const newIndex = insertSlideAfterCurrent(slideData);

    await ensureMinimumDelay(uiStart, 1300);
    showHudStatus('✨ Slide ready — Save Deck to export', 'success');
    setActiveSlide(newIndex);
    setTimeout(hideHudStatus, 2000);
    console.log('✅ Slide created and inserted!');
  } catch (error) {
    console.error('❌ Error processing voice:', error);
    alert(`Failed to create slide: ${error.message}`);
  }
}

async function processVoiceEditSlide(audioBlob) {
  try {
    const targetIndex = currentIndex;
    const slideToEdit = slides[targetIndex];
    if (!slideToEdit) {
      throw new Error('No slide selected to edit.');
    }

    console.log('🛠 Updating slide with Gemini...');
    const uiStart = performance.now();

    const base64Audio = await blobToBase64(audioBlob);
    const audioData = base64Audio.split(',')[1];
    const prompt = buildSlideEditPrompt(slideToEdit);
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      throw new Error('No API key set. Press S to open settings and add your Gemini API key.');
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: audioBlob.type || 'audio/webm',
                  data: audioData
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.6,
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

    const jsonMatch = generatedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ||
                      generatedText.match(/\{[\s\S]*\}/);
    const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : generatedText;
    const updatedSlide = JSON.parse(jsonText);
    validateSlides([updatedSlide]);

    slides[targetIndex] = updatedSlide;
    replaceSlideAt(targetIndex);
    overviewCursor = targetIndex;

    await ensureMinimumDelay(uiStart, 1300);
    showHudStatus('✨ Slide updated — Save Deck to export', 'success');
    setTimeout(hideHudStatus, 2000);
    console.log('✅ Slide updated via Gemini!');
  } catch (error) {
    console.error('❌ Error updating slide:', error);
    alert(`Failed to update slide: ${error.message}`);
  }
}

function buildSlideEditPrompt(slide) {
  const slideJson = JSON.stringify(slide, null, 2);
  return `You are an expert Slideomatic editor. Update the existing slide JSON based on the user's voice instructions.\n\nCURRENT SLIDE JSON:\n\n\`\`\`json\n${slideJson}\n\`\`\`\n\nRULES:\n- Preserve the slide's "type" and required keys for that type.\n- If the user requests additions or removals, update the relevant arrays (items, pillars, etc.).\n- Keep badge/headline/body values unless the user explicitly changes them.\n- Return ONLY a single valid JSON object with no commentary or markdown fences.\n- If the request is unclear, make a best effort improvement while keeping the structure consistent.`;
}

function buildSlideDesignPrompt() {
  return `You are a slide designer for Slideomatic, a presentation system. Your job is to create a single slide JSON object based on the user's voice description.

IMPORTANT RULES FOR IMAGE NAMES:
- Image "alt" text is used for Google Image Search, so make it FINDABLE but not TOO SPECIFIC
- Good: "vintage synthesizer", "mountain landscape sunset", "modern office workspace"
- Bad: "moog model d serial 12345", "mount everest north face 1996", "apple macbook pro m1 2021"
- Use common, searchable terms that will return good visual results
- Think like a user searching Google Images - what would find the RIGHT kind of image?

AVAILABLE SLIDE TYPES:
1. "title" - Big hero slide with title, subtitle, optional media strip
   Fields: type, title, subtitle, eyebrow, media (array of {image: {src, alt}}), footnote

2. "standard" - Headline + body + optional image
   Fields: type, headline, body (string or array), image {src, alt}, footnote

3. "quote" - Large quote with attribution
   Fields: type, quote, attribution

4. "split" - Two-column layout
   Fields: type, left {headline, body, image}, right {headline, body, image}

5. "grid" - Grid of images/colors
   Fields: type, headline, body, items (array of {image: {src, alt}, label})

6. "pillars" - Feature cards
   Fields: type, headline, pillars (array of {title, copy, image})

7. "gallery" - Visual gallery
   Fields: type, headline, items (array of {image, label, copy})

  8. "image" - Full-bleed image slide
     Fields: type, image {src, alt}, caption
  
  9. "graph" - AI-generated infographic/graph
     Fields: type, title, description, orientation (landscape/portrait/square), imageData (base64)
  
  10. "typeface" - Font showcase
      Fields: type, headline, fonts (array of {name, font, sample})

AVAILABLE FONTS (use font field on ANY slide or in typeface showcase):
- Presets: "sans" (Inter), "mono" (Space Mono), "grotesk" (Space Grotesk), "jetbrains" (JetBrains Mono), "pixel" (Press Start 2P)
- Any system font: "Georgia", "Comic Sans MS", etc.
- Font can be set per-slide in root level: {"type": "quote", "font": "pixel", ...}

MARKDOWN & LINKS (use in headlines, body, quotes):
- Bold: **text** or __text__
- Italic: *text* or _text_
- Links: [text](url) - example: [Visit Site](https://example.com)
- Code: \`code\`
- Combine: **[Bold Link](url)**

DESIGN GUIDELINES:
- Choose the slide type that best fits the user's description
- For image searches, use FINDABLE alt text (see rules above)
- Keep headlines punchy (5-7 words max)
- Body text should be clear and concise
- Use markdown for emphasis, links, code snippets
- If user mentions multiple points, consider "pillars" or "grid"
- If user wants a visual focus, use "image" or "gallery"
- For quotes or testimonials, use "quote" type
- Badge field is optional - use for section labels
- Add font presets when user requests specific typography

Return ONLY valid JSON matching the schema. No markdown, no explanations.

Example output for "a slide about vintage synthesizers with some examples":
{
  "type": "grid",
  "headline": "Vintage Synthesizers",
  "body": "The machines that shaped electronic music",
  "items": [
    {"image": {"alt": "moog synthesizer"}, "label": "Moog"},
    {"image": {"alt": "roland jupiter synthesizer"}, "label": "Roland Jupiter"},
    {"image": {"alt": "arp odyssey synth"}, "label": "ARP Odyssey"}
  ]
}

Now listen to the audio and create the slide:`;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function ensureMinimumDelay(startTimestamp, minimumMs = 1200) {
  const elapsed = performance.now() - startTimestamp;
  if (elapsed >= minimumMs) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, minimumMs - elapsed));
}

function insertSlideAfterCurrent(slideData) {
  // Insert after current index
  const newIndex = currentIndex + 1;
  insertSlideAt(newIndex, slideData, { activate: true });
  return newIndex;
}

// ===================================================================
// VOICE-TO-THEME
// ===================================================================

let isRecordingTheme = false;
let themeMediaRecorder = null;
let themeAudioChunks = [];
let themeMediaStream = null;

function toggleVoiceTheme() {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    openSettingsModal();
    showApiKeyStatus('error', 'Please add your Gemini API key to use voice features');
    return;
  }

  if (isRecordingTheme) {
    stopVoiceThemeRecording();
  } else {
    startVoiceThemeRecording();
  }
}

async function startVoiceThemeRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }
    });

    const mimeTypes = ['audio/webm', 'audio/ogg', 'audio/mp4', ''];
    let mimeType = '';
    for (const type of mimeTypes) {
      if (!type || MediaRecorder.isTypeSupported(type)) {
        mimeType = type;
        break;
      }
    }

    themeMediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    themeAudioChunks = [];
    themeMediaStream = stream;

    themeMediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        themeAudioChunks.push(event.data);
      }
    };

    themeMediaRecorder.onstop = async () => {
      const audioBlob = new Blob(themeAudioChunks, { type: mimeType || 'audio/webm' });
      await processVoiceToTheme(audioBlob);
      cleanupVoiceThemeRecording();
    };

    themeMediaRecorder.start(1000);
    isRecordingTheme = true;

    showHudStatus('🎨 Recording theme...', 'recording');
    console.log('🎨 Recording theme description...');
  } catch (error) {
    console.error('❌ Error starting theme recording:', error);
    alert('Failed to access microphone. Please check permissions.');
    cleanupVoiceThemeRecording();
  }
}

function stopVoiceThemeRecording() {
  if (!themeMediaRecorder || !isRecordingTheme) return;

  isRecordingTheme = false;
  showHudStatus('🎨 Generating theme...', 'processing');

  if (themeMediaRecorder.state !== 'inactive') {
    themeMediaRecorder.stop();
  }
}

function cleanupVoiceThemeRecording() {
  if (themeMediaStream) {
    themeMediaStream.getTracks().forEach(track => track.stop());
    themeMediaStream = null;
  }
  themeMediaRecorder = null;
  themeAudioChunks = [];
  isRecordingTheme = false;
}

async function processVoiceToTheme(audioBlob) {
  try {
    console.log('🎨 Generating theme with Gemini...');
    const uiStart = performance.now();

    const base64Audio = await blobToBase64(audioBlob);
    const audioData = base64Audio.split(',')[1];

    const prompt = buildThemeDesignPrompt();

    // Check for API key first
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      throw new Error('No API key set. Press S to open settings and add your Gemini API key.');
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: audioBlob.type || 'audio/webm',
                  data: audioData
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 1.0,  // Higher temp for more creative themes
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

    const jsonMatch = generatedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ||
                      generatedText.match(/\{[\s\S]*\}/);

    const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : generatedText;
    const themeData = JSON.parse(jsonText);

    // Apply the new theme
    const normalizedTheme = applyTheme(themeData);

    // Download theme.json automatically
    downloadTheme(normalizedTheme);
    setCurrentTheme(normalizedTheme, { source: '__ai__' });

    await ensureMinimumDelay(uiStart, 1500);
    showHudStatus('🎨 Theme created!', 'success');
    setTimeout(hideHudStatus, 2200);
    console.log('✅ Theme applied and downloaded!');
  } catch (error) {
    console.error('❌ Error processing theme:', error);
    alert(`Failed to create theme: ${error.message}`);
    hideHudStatus();
  }
}

function buildThemeDesignPrompt() {
  return `You are a theme designer for Slideomatic. Create a complete theme.json based on the user's voice description.

THEME SCHEMA - ALL fields required:
{
  "color-bg": "#fffbf3",                    // Main background color
  "background-surface": "radial-gradient(...)",  // Complex gradient or solid color
  "background-overlay": "radial-gradient(...)",  // Texture/pattern overlay or ""
  "background-opacity": "0.5",              // Opacity of overlay (0-1)
  "slide-bg": "rgba(255, 251, 243, 0.88)", // Slide background (can be transparent)
  "slide-border-color": "#1b1b1b",         // Slide border color
  "slide-border-width": "5px",             // Border thickness (0px for none)
  "slide-shadow": "10px 10px 0 rgba(0, 0, 0, 0.3)", // Neo-brutalist shadow
  "color-surface": "#ff9ff3",              // Primary accent color
  "color-surface-alt": "#88d4ff",          // Secondary accent
  "color-accent": "#feca57",               // Tertiary accent
  "badge-bg": "#feca57",                   // Badge background
  "badge-color": "#1b1b1b",                // Badge text color
  "color-ink": "#000000",                  // Primary text color
  "color-muted": "#2b2b2b",                // Secondary text color
  "border-width": "5px",                   // Global border width
  "gutter": "clamp(32px, 5vw, 72px)",      // Spacing unit
  "radius": "12px",                        // Border radius
  "font-sans": "\\"Inter\\", sans-serif",    // Sans font stack
  "font-mono": "\\"Space Mono\\", monospace", // Mono font stack
  "shadow-sm": "6px 6px 0 rgba(0, 0, 0, 0.25)",
  "shadow-md": "10px 10px 0 rgba(0, 0, 0, 0.3)",
  "shadow-lg": "16px 16px 0 rgba(0, 0, 0, 0.35)",
  "shadow-xl": "24px 24px 0 rgba(0, 0, 0, 0.4)"
}

DESIGN GUIDELINES:
1. **Color Harmony** - Choose a cohesive palette (pastel-punk, dark mode, neon, retro, etc.)
2. **Gradients** - Can use radial-gradient, linear-gradient, or solid colors
3. **Shadows** - Neo-brutalist (hard offset shadows) or soft (box-shadow with blur)
4. **Borders** - Can be thick (5px+), thin (1-2px), or none (0px)
5. **Typography** - Suggest real font stacks (serif, sans, mono, display)
6. **Contrast** - Ensure text is readable on backgrounds
7. **Vibe** - Match the mood the user describes (playful, serious, retro, modern, etc.)

STYLE ARCHETYPES:
- **Pastel Punk** (default): Soft pastels + chunky borders + hard shadows
- **Dark Brutalist**: Dark bg + neon accents + heavy borders
- **Minimal Clean**: White/light grays + subtle borders + no gradients
- **Retro Warm**: Warm browns/oranges + serif fonts + textured overlays
- **Neon Cyber**: Dark bg + bright neons + glowing shadows
- **Nature Soft**: Greens/earth tones + organic gradients + soft shadows

Return ONLY valid JSON. No markdown, no explanations.

Example for "dark cyberpunk with neon accents":
{
  "color-bg": "#0a0e27",
  "background-surface": "radial-gradient(circle at 20% 30%, rgba(255, 0, 255, 0.15), transparent 50%), radial-gradient(circle at 80% 70%, rgba(0, 255, 255, 0.15), transparent 50%), #0a0e27",
  "background-overlay": "repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.03) 0px, transparent 1px, transparent 2px, rgba(255, 255, 255, 0.03) 3px)",
  "background-opacity": "0.8",
  "slide-bg": "rgba(10, 14, 39, 0.95)",
  "slide-border-color": "#ff00ff",
  "slide-border-width": "3px",
  "slide-shadow": "0 0 20px rgba(255, 0, 255, 0.5), 0 0 40px rgba(0, 255, 255, 0.3)",
  "color-surface": "#ff00ff",
  "color-surface-alt": "#00ffff",
  "color-accent": "#ffff00",
  "badge-bg": "#ff00ff",
  "badge-color": "#0a0e27",
  "color-ink": "#ffffff",
  "color-muted": "#a0a0ff",
  "border-width": "2px",
  "gutter": "clamp(32px, 5vw, 72px)",
  "radius": "8px",
  "font-sans": "\\"Orbitron\\", \\"Arial\\", sans-serif",
  "font-mono": "\\"Share Tech Mono\\", monospace",
  "shadow-sm": "0 0 10px rgba(255, 0, 255, 0.4)",
  "shadow-md": "0 0 20px rgba(255, 0, 255, 0.5)",
  "shadow-lg": "0 0 30px rgba(255, 0, 255, 0.6)",
  "shadow-xl": "0 0 40px rgba(255, 0, 255, 0.7)"
}

Now listen to the audio and create the theme:`;
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

  if (!key) {
    showApiKeyStatus('error', 'No API key found. Please save one first.');
    return;
  }

  showApiKeyStatus('info', 'Testing connection...');

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
      showApiKeyStatus('success', '✓ Connection successful! Your API key is working.');
    } else {
      const error = await response.json();
      showApiKeyStatus('error', `Invalid API key or connection failed: ${error.error?.message || 'Unknown error'}`);
    }
  } catch (error) {
    showApiKeyStatus('error', 'Connection test failed. Please check your internet connection.');
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

function handleThemeDrawerKeydown(event) {
  if (!isThemeDrawerOpen) return;
  const themeDrawer = document.getElementById('theme-drawer');
  if (!themeDrawer) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeThemeDrawer();
  } else if (event.key === 'Tab') {
    trapFocus(event, themeDrawer);
  }
}

function syncThemeSelectUI() {
  const themeSelect = document.getElementById('theme-select');
  if (!themeSelect) return;
  const options = Array.from(themeSelect.options).map(option => option.value);
  if (options.includes(currentThemePath)) {
    themeSelect.value = currentThemePath;
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

function openThemeDrawer() {
  const themeDrawer = document.getElementById('theme-drawer');
  const themeBtn = document.getElementById('theme-btn');
  if (!themeDrawer || isThemeDrawerOpen) return;

  if (isEditDrawerOpen) {
    closeEditDrawer();
  }

  isThemeDrawerOpen = true;
  themeDrawerPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  themeDrawer.classList.add('is-open', 'is-springing');
  themeDrawer.setAttribute('aria-hidden', 'false');
  themeBtn?.setAttribute('aria-expanded', 'true');
  themeBtn?.classList.add('is-active');
  themeDrawer.addEventListener(
    'animationend',
    () => themeDrawer.classList.remove('is-springing'),
    { once: true }
  );

  loadThemeIntoEditor();
  renderThemeLibrary();
  syncThemeSelectUI();
  focusFirstElement(themeDrawer);
  document.addEventListener('keydown', handleThemeDrawerKeydown, true);
}

function closeThemeDrawer() {
  const themeDrawer = document.getElementById('theme-drawer');
  const themeBtn = document.getElementById('theme-btn');
  if (!themeDrawer || !isThemeDrawerOpen) return;

  isThemeDrawerOpen = false;
  themeDrawer.classList.remove('is-open');
  themeDrawer.classList.remove('is-springing');
  themeDrawer.setAttribute('aria-hidden', 'true');
  themeBtn?.setAttribute('aria-expanded', 'false');
  themeBtn?.classList.remove('is-active');

  document.removeEventListener('keydown', handleThemeDrawerKeydown, true);

  const target = themeDrawerPreviousFocus && typeof themeDrawerPreviousFocus.focus === 'function'
    ? themeDrawerPreviousFocus
    : themeBtn;
  requestAnimationFrame(() => target?.focus());
  themeDrawerPreviousFocus = null;
}

function toggleThemeDrawer() {
  if (isThemeDrawerOpen) {
    closeThemeDrawer();
  } else {
    openThemeDrawer();
  }
}

function initThemeDrawer() {
  const themeDrawer = document.getElementById('theme-drawer');
  const themeBtn = document.getElementById('theme-btn');
  const closeBtn = themeDrawer?.querySelector('.theme-drawer__close');
  const textarea = document.getElementById('theme-json-editor');
  const applyBtn = document.getElementById('theme-apply-btn');
  const saveBtn = document.getElementById('theme-save-btn');
  const aiBtn = document.getElementById('theme-ai-btn');
  const randomBtn = document.getElementById('theme-random-btn');

  if (!themeDrawer) return;

  themeDrawer.setAttribute('aria-hidden', 'true');
  themeBtn?.setAttribute('aria-expanded', 'false');
  themeBtn?.classList.remove('is-active');

  if (themeBtn && !themeBtn.dataset.listenerAttached) {
    themeBtn.addEventListener('click', toggleThemeDrawer);
    themeBtn.dataset.listenerAttached = 'true';
  }

  if (closeBtn && !closeBtn.dataset.listenerAttached) {
    closeBtn.addEventListener('click', closeThemeDrawer);
    closeBtn.dataset.listenerAttached = 'true';
  }

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
      const name = prompt('Name your theme:', 'My Theme');
      if (!name) return;

      saveThemeToLibrary(name, theme);
      renderThemeLibrary();
      showHudStatus('💾 Theme saved', 'success');
      setTimeout(hideHudStatus, 1600);
    } catch (error) {
      showHudStatus(`❌ ${error.message}`, 'error');
      setTimeout(hideHudStatus, 2000);
    }
  });

  aiBtn?.addEventListener('click', async () => {
    const description = prompt('Describe your theme:\\n(e.g. "dark cyberpunk with neon greens" or "warm sunset beach vibes")');
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
}

function loadThemeIntoEditor() {
  const textarea = document.getElementById('theme-json-editor');
  if (!textarea) return;

  const theme = getCurrentTheme() || currentTheme;
  if (theme) {
    textarea.value = JSON.stringify(theme, null, 2);
  } else {
    // Load from CSS variables as fallback
    const computedTheme = extractCurrentThemeFromCSS();
    textarea.value = JSON.stringify(computedTheme, null, 2);
  }
  syncThemeSelectUI();
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

function renderThemeLibrary() {
  const list = document.getElementById('theme-library-list');
  if (!list) return;

  const library = getThemeLibrary();

  if (library.length === 0) {
    list.innerHTML = '<p style="font-family: var(--font-mono); font-size: 0.85rem; color: var(--color-muted); font-style: italic;">No saved themes yet</p>';
    return;
  }

  list.innerHTML = library.map(entry => `
    <div class="theme-drawer__library-item">
      <span class="theme-drawer__library-item-name">${entry.name}</span>
      <div class="theme-drawer__library-item-actions">
        <button class="theme-drawer__library-item-btn" data-action="load" data-name="${entry.name}">
          Load
        </button>
        <button class="theme-drawer__library-item-btn theme-drawer__library-item-btn--delete" data-action="delete" data-name="${entry.name}">
          Delete
        </button>
      </div>
    </div>
  `).join('');

  // Wire up load/delete buttons
  list.querySelectorAll('[data-action="load"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.name;
      const library = getThemeLibrary();
      const entry = library.find(t => t.name === name);
      if (entry) {
        const normalizedTheme = applyTheme(entry.theme);
        setCurrentTheme(normalizedTheme, { source: `library:${name}` });
        loadThemeIntoEditor();
        showHudStatus(`✨ Loaded "${name}"`, 'success');
        setTimeout(hideHudStatus, 1600);
      }
    });
  });

  list.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.name;
      if (confirm(`Delete theme "${name}"?`)) {
        deleteThemeFromLibrary(name);
        renderThemeLibrary();
        showHudStatus(`🗑️ Deleted "${name}"`, 'success');
        setTimeout(hideHudStatus, 1600);
      }
    });
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

  document.addEventListener("keydown", handleKeyboard);
  slidesRoot.addEventListener("click", handleSlideClick);
  document.addEventListener("click", handleImageModalTrigger);
  document.addEventListener("paste", handleGlobalPaste);

  const uploadInput = document.getElementById('deck-upload');
  if (uploadInput) {
    uploadInput.addEventListener('change', handleDeckUpload);
  }

  const addBtn = document.getElementById('add-btn');
  if (addBtn) {
    voiceButtons.add = addBtn;
    addBtn.addEventListener('click', () => toggleVoiceRecording('add'));
    updateVoiceUI('add', 'idle');
  }

  const editBtn = document.getElementById('edit-btn');
  if (editBtn) {
    voiceButtons.edit = editBtn;
    editBtn.addEventListener('click', () => toggleVoiceRecording('edit'));
    updateVoiceUI('edit', 'idle');
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
