// ═══════════════════════════════════════════════════════════════════════════
// Deck Persistence Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Handles all slide deck loading and persistence responsibilities:
// - Loading slides from URL params, localStorage, or bundled JSON
// - Persisting edits to localStorage and managing deck metadata
// - Generating deck IDs and saving copies
//
// Dependencies: state.js, utils.js
// Used by: main.js (orchestrator)
//
// ═══════════════════════════════════════════════════════════════════════════

import {
  slides,
  setSlides,
  activeDeckId,
  deckStorageKey,
  setDeckStorageKey,
  deckPersistFailureNotified,
  setDeckPersistFailureNotified,
  DECK_STORAGE_PREFIX,
  LAST_DECK_KEY,
} from './state.js';
import { deriveDeckName } from './utils.js';

const noop = () => {};

let getParamHook = () => null;
let showHudStatusHook = noop;
let hideHudStatusHook = noop;
let showSaveStatusHook = noop;
let updateDeckNameDisplayHook = noop;
let getSlideTemplateHook = () => ({ type: 'title' });
let applySharedThemeHook = noop;

export function registerDeckPersistenceHooks(hooks = {}) {
  if (typeof hooks.getParam === 'function') getParamHook = hooks.getParam;
  if (typeof hooks.showHudStatus === 'function') showHudStatusHook = hooks.showHudStatus;
  if (typeof hooks.hideHudStatus === 'function') hideHudStatusHook = hooks.hideHudStatus;
  if (typeof hooks.showSaveStatus === 'function') showSaveStatusHook = hooks.showSaveStatus;
  if (typeof hooks.updateDeckNameDisplay === 'function') {
    updateDeckNameDisplayHook = hooks.updateDeckNameDisplay;
  }
  if (typeof hooks.getSlideTemplate === 'function') {
    getSlideTemplateHook = hooks.getSlideTemplate;
  }
  if (typeof hooks.applySharedTheme === 'function') {
    applySharedThemeHook = hooks.applySharedTheme;
  }
}

export async function loadSlides() {
  const shareParam = getParamHook('share');
  if (shareParam) {
    try {
      const response = await fetch(`/.netlify/functions/share?id=${encodeURIComponent(shareParam)}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch shared deck (${response.status})`);
      }
      const data = await response.json();
      if (Array.isArray(data?.slides)) {
        if (data.theme) {
          applySharedThemeHook(data.theme);
        }
        showHudStatusHook('✓ Loaded shared deck', 'success');
        setTimeout(hideHudStatusHook, 2000);
        return data.slides;
      }
      throw new Error('Malformed shared deck payload');
    } catch (error) {
      console.error('Failed to load shared deck', error);
      showHudStatusHook('⚠️ Failed to load shared deck', 'error');
      setTimeout(hideHudStatusHook, 3000);
    }
  }

  const urlParam = getParamHook('url');
  if (urlParam) {
    try {
      const response = await fetch(urlParam);
      if (!response.ok) {
        throw new Error(`Failed to fetch from URL: ${urlParam}`);
      }
      const data = await response.json();
      if (Array.isArray(data)) {
        showHudStatusHook('✓ Loaded deck from URL', 'success');
        setTimeout(hideHudStatusHook, 2000);
        return data;
      }
    } catch (error) {
      console.error('Failed to load deck from URL', error);
      showHudStatusHook('⚠️ Failed to load deck from URL', 'error');
      setTimeout(hideHudStatusHook, 3000);
    }
  }

  const dataParam = getParamHook('data');
  if (dataParam) {
    try {
      const decoded = decodeURIComponent(escape(atob(dataParam)));
      const data = JSON.parse(decoded);
      if (Array.isArray(data)) {
        showHudStatusHook('✓ Loaded deck from share link', 'success');
        setTimeout(hideHudStatusHook, 2000);
        return data;
      }
    } catch (error) {
      console.error('Failed to load deck from data parameter', error);
      showHudStatusHook('⚠️ Failed to load shared deck', 'error');
      setTimeout(hideHudStatusHook, 3000);
    }
  }

  if (activeDeckId) {
    console.log('[loadSlides] Priority 3: Loading deck from localStorage, activeDeckId:', activeDeckId);
    const stored = loadPersistedDeck();
    if (Array.isArray(stored)) {
      console.log('[loadSlides] Successfully loaded deck with', stored.length, 'slides');
      return stored.slice();
    }
    console.warn('[loadSlides] No stored deck found, creating blank template');
    setSlides([getSlideTemplateHook('title')]);
    persistSlides({ suppressWarning: true });
    return slides.slice();
  }

  const slidesPath = resolveSlidesPath();
  try {
    const response = await fetch(slidesPath, { cache: 'no-store' });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) {
        return data;
      }
    }
  } catch (error) {
    console.warn(`Unable to load slides from ${slidesPath}, starting with blank deck`, error);
  }

  return [getSlideTemplateHook('title')];
}

export function resolveSlidesPath() {
  const slidesParam = getParamHook('slides');
  if (!slidesParam) {
    return 'slides.json';
  }
  if (slidesParam.endsWith('.json')) {
    return slidesParam;
  }
  return `${slidesParam}.json`;
}

function getDeckStorageKey() {
  if (deckStorageKey) {
    console.log('[getDeckStorageKey] Using cached key:', deckStorageKey);
    return deckStorageKey;
  }
  if (activeDeckId) {
    setDeckStorageKey(`${DECK_STORAGE_PREFIX}${encodeURIComponent(activeDeckId)}`);
    console.log('[getDeckStorageKey] Built key from activeDeckId:', activeDeckId, '→', deckStorageKey);
    return deckStorageKey;
  }
  const path = resolveSlidesPath();
  try {
    const url = new URL(path, window.location.href);
    const keySource = `${url.origin}${url.pathname}${url.search ?? ''}`;
    setDeckStorageKey(`${DECK_STORAGE_PREFIX}${encodeURIComponent(keySource)}`);
    console.log('[getDeckStorageKey] Built key from path URL:', keySource, '→', deckStorageKey);
  } catch (error) {
    setDeckStorageKey(`${DECK_STORAGE_PREFIX}${encodeURIComponent(path)}`);
    console.log('[getDeckStorageKey] Built key from path:', path, '→', deckStorageKey);
  }
  return deckStorageKey;
}

function loadPersistedDeck() {
  try {
    const key = getDeckStorageKey();
    console.log('[loadPersistedDeck] Looking for deck with key:', key);
    const stored = localStorage.getItem(key);
    if (!stored) {
      console.log('[loadPersistedDeck] No deck found in localStorage for key:', key);
      return null;
    }
    console.log('[loadPersistedDeck] Found deck in localStorage, parsing...');
    const payload = JSON.parse(stored);
    if (!payload || typeof payload !== 'object') {
      console.warn('[loadPersistedDeck] Invalid payload structure');
      return null;
    }
    if (!Array.isArray(payload.slides)) {
      console.warn('[loadPersistedDeck] payload.slides is not an array');
      return null;
    }
    console.log('[loadPersistedDeck] Successfully loaded', payload.slides.length, 'slides');
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

export function persistSlides(options = {}) {
  const { suppressWarning = false, silent = false } = options;
  if (!Array.isArray(slides)) return false;

  const slidesPath = resolveSlidesPath();
  const isBuiltInDeck =
    !activeDeckId &&
    (slidesPath === 'guide.json' ||
      slidesPath === 'design-resources.json' ||
      slidesPath === 'demo-deck.json');
  if (isBuiltInDeck) {
    return false;
  }

  console.log('[persistSlides] Saving deck, activeDeckId:', activeDeckId);

  if (!silent && activeDeckId) {
    showSaveStatusHook('saving');
  }

  try {
    const updatedAt = Date.now();
    const source = activeDeckId ? `local:${activeDeckId}` : resolveSlidesPath();
    const storageKey = getDeckStorageKey();
    console.log('[persistSlides] Using storage key:', storageKey);
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
    setDeckPersistFailureNotified(false);
    markDeckAsRecent();
    updateDeckNameDisplayHook();

    if (!silent && activeDeckId) {
      showSaveStatusHook('saved');
    }

    return true;
  } catch (error) {
    console.warn('Unable to persist deck edits to localStorage:', error);
    if (!deckPersistFailureNotified && !suppressWarning) {
      try {
        showHudStatusHook('⚠️ Unable to save edits locally', 'warning');
        setTimeout(hideHudStatusHook, 2400);
      } catch (_) {
        // HUD not available; ignore.
      }
      setDeckPersistFailureNotified(true);
    }
    return false;
  }
}

export function clearPersistedDeck() {
  try {
    localStorage.removeItem(getDeckStorageKey());
    setDeckPersistFailureNotified(false);
  } catch (error) {
    console.warn('Failed to clear deck overrides from localStorage:', error);
  }
}

export function generateDeckId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `deck-${crypto.randomUUID()}`;
  }
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `deck-${Date.now().toString(36)}-${randomPart}`;
}

export function saveAsNewDeck() {
  if (!Array.isArray(slides) || slides.length === 0) {
    showHudStatusHook('⚠️ No slides to save', 'warning');
    setTimeout(hideHudStatusHook, 2000);
    return;
  }

  const newDeckId = generateDeckId();
  const payload = {
    version: 1,
    updatedAt: Date.now(),
    source: `saved:${resolveSlidesPath()}`,
    slides: slides.slice(),
    meta: {
      name: deriveDeckName(slides),
      updatedAt: Date.now(),
      deckId: newDeckId,
    },
  };

  try {
    const key = `${DECK_STORAGE_PREFIX}${encodeURIComponent(newDeckId)}`;
    localStorage.setItem(key, JSON.stringify(payload));
    showHudStatusHook('✓ Deck saved!', 'success');

    setTimeout(() => {
      const target = new URL(window.location.href);
      target.searchParams.delete('slides');
      target.searchParams.set('deck', newDeckId);
      window.location.href = target.toString();
    }, 800);
  } catch (error) {
    console.error('Failed to save deck:', error);
    showHudStatusHook('⚠️ Unable to save. Storage may be full.', 'error');
    setTimeout(hideHudStatusHook, 3000);
  }
}

function markDeckAsRecent() {
  if (!activeDeckId) return;
  try {
    localStorage.setItem(LAST_DECK_KEY, activeDeckId);
  } catch (error) {
    console.warn('Unable to record last deck ID:', error);
  }
}

