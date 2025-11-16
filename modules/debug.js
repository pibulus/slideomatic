// ═══════════════════════════════════════════════════════════════════════════
// Debug Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Centralized debug logging that can be disabled for production.
// Set DEBUG = false to suppress all console output.
//
// ═══════════════════════════════════════════════════════════════════════════

// Set to false to disable all debug logging in production
const DEBUG = true;

export const debug = {
  log: DEBUG ? console.log.bind(console) : () => {},
  warn: DEBUG ? console.warn.bind(console) : () => {},
  error: console.error.bind(console), // Always show errors
  info: DEBUG ? console.info.bind(console) : () => {},
};

// Helper to conditionally log based on DEBUG flag
export function debugLog(...args) {
  if (DEBUG) console.log(...args);
}

export function debugWarn(...args) {
  if (DEBUG) console.warn(...args);
}

export function debugError(...args) {
  // Always log errors
  console.error(...args);
}

export function isDebugEnabled() {
  return DEBUG;
}
