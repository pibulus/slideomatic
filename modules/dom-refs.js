// ═══════════════════════════════════════════════════════════════════════════
// DOM References Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Centralizes shared document queries so multiple modules can reuse the same
// elements without re-querying or depending on main.js globals.
//
// Uses lazy evaluation to ensure DOM is ready before querying.
//
// ═══════════════════════════════════════════════════════════════════════════

let _slidesRoot = null;
let _currentCounter = null;
let _totalCounter = null;
let _progressBar = null;

export function getSlidesRoot() {
  if (!_slidesRoot) {
    _slidesRoot = document.getElementById('slides');
  }
  return _slidesRoot;
}

export function getCurrentCounter() {
  if (!_currentCounter) {
    _currentCounter = document.querySelector('[data-counter-current]');
  }
  return _currentCounter;
}

export function getTotalCounter() {
  if (!_totalCounter) {
    _totalCounter = document.querySelector('[data-counter-total]');
  }
  return _totalCounter;
}

export function getProgressBar() {
  if (!_progressBar) {
    _progressBar = document.querySelector('[data-progress]');
  }
  return _progressBar;
}

// Backwards compatibility - these will be null initially but modules should use getter functions
export let slidesRoot = null;
export let currentCounter = null;
export let totalCounter = null;
export let progressBar = null;

// Initialize refs after DOM is ready (called from main.js)
export function initDomRefs() {
  slidesRoot = getSlidesRoot();
  currentCounter = getCurrentCounter();
  totalCounter = getTotalCounter();
  progressBar = getProgressBar();
}
