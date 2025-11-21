// ═══════════════════════════════════════════════════════════════════════════
// Global State Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Centralizes shared mutable state for Slide-o-Matic.
// Exposes getters/setters for key values so other modules can coordinate
// without reaching into main.js directly.
//
// Dependencies: None
// Used by: main.js (initial consumer), future navigation/deck modules
//
// ═══════════════════════════════════════════════════════════════════════════

export let slides = [];
export let slideElements = [];
export let currentIndex = 0;
export let isOverview = false;
export const preloadedImages = new Set();
export let autoLinkConfigs = [];
export let overviewRowCount = 1;
export let overviewColumnCount = 0;
export let overviewCursor = 0;
export let lastOverviewHighlight = 0;
export let isThemeDrawerOpen = false;
export let themeDrawerInstance = null;
export const slideScrollPositions = new Map();
export const DECK_STORAGE_PREFIX = 'slideomatic_deck_overrides:';
export const LAST_DECK_KEY = 'slideomatic:last-deck';
export let deckStorageKey = null;
export let deckPersistFailureNotified = false;
export let activeDeckId = null;
export let isNewDeckRequest = false;
export let isEditDrawerOpen = false;
export let editDrawerInstance = null;

export function setSlides(newSlides) {
  slides = newSlides;
}

export function setSlideElements(newElements) {
  slideElements = newElements;
}

export function setCurrentIndex(newIndex) {
  currentIndex = newIndex;
}

export function setOverview(state) {
  isOverview = state;
}

export function setAutoLinkConfigs(configs) {
  autoLinkConfigs = configs;
}

export function setOverviewRowCount(count) {
  overviewRowCount = count;
}

export function setOverviewColumnCount(count) {
  overviewColumnCount = count;
}

export function setOverviewCursor(cursor) {
  overviewCursor = cursor;
}

export function setLastOverviewHighlight(index) {
  lastOverviewHighlight = index;
}

export function setThemeDrawerOpen(state) {
  isThemeDrawerOpen = state;
}

export function setThemeDrawerInstance(instance) {
  themeDrawerInstance = instance;
}

export function setDeckStorageKey(key) {
  deckStorageKey = key;
}

export function setDeckPersistFailureNotified(flag) {
  deckPersistFailureNotified = flag;
}

export function setActiveDeckId(deckId) {
  activeDeckId = deckId;
}

export function setNewDeckRequest(flag) {
  isNewDeckRequest = flag;
}

export function setEditDrawerOpen(state) {
  isEditDrawerOpen = state;
}

export function setEditDrawerInstance(instance) {
  editDrawerInstance = instance;
}
