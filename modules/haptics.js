/**
 * Haptics Module
 * Centralizes vibration patterns for consistent tactile feedback.
 */

const PATTERNS = {
  light: [10], // Subtle tick for UI interactions
  medium: [40], // Distinct bump for slide changes
  heavy: [70], // Stronger vibration for errors or major actions
  success: [50, 50, 50], // Double tick
  warning: [50, 100, 50], // Triple tick
};

let isHapticsEnabled = true;

/**
 * Trigger a haptic feedback pattern.
 * @param {'light'|'medium'|'heavy'|'success'|'warning'} type
 */
export function vibrate(type = 'light') {
  if (!isHapticsEnabled || typeof navigator.vibrate !== 'function') return;

  const pattern = PATTERNS[type] || PATTERNS.light;
  try {
    navigator.vibrate(pattern);
  } catch (e) {
    // Ignore errors (e.g. if user hasn't interacted with document yet)
  }
}

/**
 * Toggle haptics on/off.
 * @param {boolean} enabled
 */
export function setHapticsEnabled(enabled) {
  isHapticsEnabled = enabled;
}
