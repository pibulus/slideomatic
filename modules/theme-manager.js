// ═══════════════════════════════════════════════════════════════════════════
// Theme Manager Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Controls theme loading, normalization, validation, and persistence.
// - Loads theme JSON from paths or localStorage
// - Applies tokens to the document root
// - Manages user theme library in localStorage
// - Provides WCAG contrast checking utilities
//
// Dependencies: utils.js
// Used by: main.js, voice-modes.js
//
// ═══════════════════════════════════════════════════════════════════════════

const THEME_LIBRARY_KEY = 'slideomatic_themes';
const CURRENT_THEME_KEY = 'slideomatic_current_theme';
const CURRENT_THEME_PATH_KEY = 'slideomatic_current_theme_path';
export const LOCAL_THEME_SOURCE = '__local__';

const REQUIRED_THEME_TOKENS = {
  'color-bg': '#fffbf3',
  'background-surface': 'radial-gradient(circle at 15% 20%, rgba(255, 159, 243, 0.35), transparent 55%), radial-gradient(circle at 85% 30%, rgba(136, 212, 255, 0.35), transparent 55%), radial-gradient(circle at 40% 70%, rgba(254, 202, 87, 0.25), transparent 60%), radial-gradient(circle at 80% 90%, rgba(255, 159, 243, 0.18), transparent 55%), #fffbf3',
  'background-overlay': 'radial-gradient(circle at 25% 25%, rgba(0, 0, 0, 0.15) 0.5px, transparent 1px), radial-gradient(circle at 75% 75%, rgba(0, 0, 0, 0.1) 0.5px, transparent 1px), radial-gradient(circle at 50% 50%, rgba(0, 0, 0, 0.08) 1px, transparent 2px)',
  'background-opacity': '0.5',
  'slide-bg': 'rgba(255, 251, 243, 0.82)',
  'slide-border-color': '#1b1b1b',
  'slide-border-width': '5px',
  'slide-shadow': '10px 10px 0 rgba(0, 0, 0, 0.3)',
  'color-surface': '#ff9ff3',
  'color-surface-alt': '#88d4ff',
  'color-accent': '#feca57',
  'badge-bg': '#feca57',
  'badge-color': '#1b1b1b',
  'color-ink': '#000000',
  'color-muted': '#2b2b2b',
  'border-width': '5px',
  'gutter': "clamp(32px, 5vw, 72px)",
  'radius': '12px',
  'font-sans': '"Inter", "Helvetica Neue", Arial, sans-serif',
  'font-mono': '"Space Mono", "IBM Plex Mono", monospace',
  'shadow-sm': '6px 6px 0 rgba(0, 0, 0, 0.25)',
  'shadow-md': '10px 10px 0 rgba(0, 0, 0, 0.3)',
  'shadow-lg': '16px 16px 0 rgba(0, 0, 0, 0.35)',
  'shadow-xl': '24px 24px 0 rgba(0, 0, 0, 0.4)',
};

let currentTheme = null;
let currentThemePath = LOCAL_THEME_SOURCE;

const colorParserCanvas = typeof document !== 'undefined'
  ? document.createElement('canvas')
  : null;
const colorParserContext = colorParserCanvas ? colorParserCanvas.getContext('2d') : null;

if (colorParserCanvas && colorParserContext) {
  colorParserCanvas.width = 1;
  colorParserCanvas.height = 1;
}

function normalizeThemeTokens(theme) {
  const base = { ...REQUIRED_THEME_TOKENS };
  const extras = {};

  if (theme && typeof theme === 'object') {
    Object.entries(theme).forEach(([token, value]) => {
      if (value == null) return;
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      if (Object.prototype.hasOwnProperty.call(base, token)) {
        base[token] = stringValue;
      } else {
        extras[token] = stringValue;
      }
    });
  }

  const missingTokens = Object.keys(REQUIRED_THEME_TOKENS).filter(
    (key) => !theme || theme[key] == null
  );

  if (missingTokens.length) {
    console.warn(
      `Theme missing tokens: ${missingTokens.join(', ')}. Using defaults for them.`
    );
  }

  return { ...base, ...extras };
}

function validateTheme(theme) {
  if (!theme || typeof theme !== 'object') {
    return { isValid: false, missing: Object.keys(REQUIRED_THEME_TOKENS) };
  }

  const missing = Object.keys(REQUIRED_THEME_TOKENS).filter(
    (token) => theme[token] == null || `${theme[token]}`.trim() === ''
  );

  return { isValid: missing.length === 0, missing };
}

function loadThemeLibrary() {
  try {
    const stored = localStorage.getItem(THEME_LIBRARY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.warn('Failed to load theme library:', error);
    return [];
  }
}

function saveThemeToLibrary(name, theme) {
  const library = loadThemeLibrary();
  const existing = library.findIndex((entry) => entry.name === name);

  const normalizedTheme = normalizeThemeTokens(theme);

  const themeEntry = {
    name,
    theme: normalizedTheme,
    created: existing >= 0 ? library[existing].created : Date.now(),
    updated: Date.now(),
  };

  if (existing >= 0) {
    library[existing] = themeEntry;
  } else {
    library.push(themeEntry);
  }

  try {
    localStorage.setItem(THEME_LIBRARY_KEY, JSON.stringify(library));
  } catch (error) {
    console.warn('Failed to save theme library entry:', error);
  }

  return themeEntry;
}

function deleteThemeFromLibrary(name) {
  const library = loadThemeLibrary();
  const filtered = library.filter((entry) => entry.name !== name);
  try {
    localStorage.setItem(THEME_LIBRARY_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.warn('Failed to delete theme from library:', error);
  }
}

function getCurrentThemePath() {
  return currentThemePath;
}

function setCurrentTheme(theme, options = {}) {
  const normalized = normalizeThemeTokens(theme);
  currentTheme = normalized;
  try {
    localStorage.setItem(CURRENT_THEME_KEY, JSON.stringify(normalized));
  } catch (error) {
    console.warn('Failed to store current theme:', error);
  }

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
    if (!storedPath) {
      try {
        localStorage.setItem(CURRENT_THEME_PATH_KEY, currentThemePath);
      } catch (error) {
        console.warn('Failed to backfill theme path:', error);
      }
    }
    return currentTheme;
  } catch (error) {
    console.warn('Failed to load current theme:', error);
    try {
      localStorage.removeItem(CURRENT_THEME_KEY);
    } catch (_) {
      // Ignore cleanup failure
    }
    return null;
  }
}

async function loadTheme(themePath) {
  const response = await fetch(themePath, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  const theme = await response.json();
  return normalizeThemeTokens(theme);
}

function applyTheme(themeData) {
  if (!themeData || typeof themeData !== 'object') return null;
  const normalized = normalizeThemeTokens(themeData);
  const root = document.documentElement;
  Object.entries(normalized).forEach(([token, value]) => {
    if (value == null) return;
    root.style.setProperty(`--${token}`, value);
  });
  currentTheme = normalized;
  return normalized;
}

function toRgb(color) {
  if (!color) return null;

  if (typeof color === 'string' && color.startsWith('#')) {
    const hex = color.slice(1);
    const normalizedHex = hex.length === 3
      ? hex.split('').map((char) => char + char).join('')
      : hex;
    if (normalizedHex.length !== 6) return null;
    const value = Number.parseInt(normalizedHex, 16);
    return {
      r: (value >> 16) & 255,
      g: (value >> 8) & 255,
      b: value & 255,
    };
  }

  if (colorParserContext) {
    try {
      colorParserContext.fillStyle = '#000';
      colorParserContext.fillStyle = color;
      const computed = colorParserContext.fillStyle;
      const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (match) {
        return {
          r: Number.parseInt(match[1], 10),
          g: Number.parseInt(match[2], 10),
          b: Number.parseInt(match[3], 10),
        };
      }
    } catch (error) {
      console.warn('Unable to parse color value for contrast check:', color, error);
    }
  }

  return null;
}

function relativeLuminance({ r, g, b }) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [channel(r), channel(g), channel(b)];
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function checkContrast(fg, bg) {
  const fgRgb = toRgb(fg);
  const bgRgb = toRgb(bg);
  if (!fgRgb || !bgRgb) return null;

  const L1 = relativeLuminance(fgRgb);
  const L2 = relativeLuminance(bgRgb);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  return Number.isFinite(ratio) ? Number(ratio.toFixed(2)) : null;
}

export {
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
  normalizeThemeTokens,
};
