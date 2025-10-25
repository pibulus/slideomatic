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

