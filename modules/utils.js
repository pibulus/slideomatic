// ═══════════════════════════════════════════════════════════════════════════
// Utilities Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Shared helper functions used across Slide-o-Matic modules.
// - Numeric helpers (e.g., clamp)
// - Formatting helpers (e.g., formatBytes)
// - DOM-safe string helpers (e.g., escapeHtml)
//
// Dependencies: None
// Used by: base64-tokens.js, image-manager.js, edit-drawer.js, main.js
//
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Clamp a numeric value between a minimum and maximum.
 * Mirrors the inline helper previously declared in main.js.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Convert bytes to a human readable string (e.g., "120 KB").
 * Copied from the original implementation to preserve formatting rules.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
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

/**
 * Escape basic HTML characters so strings can be injected safely.
 * Preserves the behavior of the ad-hoc replacements previously used.
 * @param {string|number|boolean} value
 * @returns {string}
 */
export function escapeHtml(value) {
  const stringValue = String(value ?? '');
  const pattern = /[&<>"]|'/g;
  const replacements = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return stringValue.replace(pattern, (char) => replacements[char] ?? char);
}

/**
 * Convert a File object to a base64 data URL string.
 * Used for embedding images directly in slide JSON.
 * @param {File} file - The file to convert
 * @returns {Promise<string>} - Data URL string (e.g., "data:image/png;base64,...")
 */
export async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Safely parse JSON string, returning null on error.
 * Used for localStorage data parsing where invalid JSON should be handled gracefully.
 * @param {string} value - JSON string to parse
 * @returns {any|null} - Parsed object or null if parsing fails
 */
export function safeParse(value) {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

/**
 * Derive a deck name from the first slide's content.
 * Falls back to "Untitled deck" if no suitable content found.
 * @param {Array} slideList - Array of slide objects
 * @returns {string} - Deck name
 */
export function deriveDeckName(slideList) {
  if (!Array.isArray(slideList) || slideList.length === 0) {
    return 'Untitled deck';
  }
  const first = slideList[0] ?? {};
  const candidate =
    first.title ||
    first.headline ||
    first.eyebrow ||
    first.quote ||
    (Array.isArray(first.body) ? first.body[0] : first.body) ||
    first.badge;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : 'Untitled deck';
}

/**
 * Deep clone a plain object or array.
 * Uses JSON serialization for simplicity - only works with JSON-serializable data
 * (no functions, dates, undefined, symbols, etc).
 * Suitable for slide objects and theme data which are plain JSON structures.
 *
 * @param {Object|Array} obj - Object to clone
 * @returns {Object|Array} - Deep cloned copy
 */
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Escape characters for use in a regular expression.
 * @param {string} string
 * @returns {string}
 */
export function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export function getFocusableElements(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTORS)).filter((el) =>
    !el.hasAttribute('disabled') &&
    el.getAttribute('tabindex') !== '-1' &&
    typeof el.focus === 'function' &&
    (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0)
  );
}

export function trapFocus(event, container) {
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
  const active = document.activeElement;
  const isShift = event.shiftKey;

  if (!isShift && active === last) {
    event.preventDefault();
    first.focus();
  } else if (isShift && active === first) {
    event.preventDefault();
    last.focus();
  }
}

export function focusFirstElement(container) {
  const focusable = getFocusableElements(container);
  if (focusable.length > 0) {
    focusable[0].focus();
  } else {
    container.setAttribute('tabindex', '-1');
    container.focus({ preventScroll: true });
  }
}

