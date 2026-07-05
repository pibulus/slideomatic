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
  setActiveDeckId,
  deckStorageKey,
  setDeckStorageKey,
  deckPersistFailureNotified,
  setDeckPersistFailureNotified,
  DECK_STORAGE_PREFIX,
  LAST_DECK_KEY,
} from './state.js';
import { deriveDeckName } from './utils.js';
import { validateSlides } from './validation.js';

const noop = () => {};

/** @type {(param: string) => string | null} */
let getParamHook = () => null;
/** @type {(message: string, type?: string) => void} */
let showHudStatusHook = noop;
/** @type {() => void} */
let hideHudStatusHook = noop;
/** @type {(status: string) => void} */
let showSaveStatusHook = noop;
/** @type {() => void} */
let updateDeckNameDisplayHook = noop;
/** @type {(type: string) => any} */
let getSlideTemplateHook = () => ({ type: 'title' });
/** @type {(theme: any) => void} */
let applySharedThemeHook = noop;
/** @type {() => any} */
let getCurrentThemeHook = () => null;
/** @type {(options?: { invalid?: boolean }) => Promise<string | null>} */
let requestSharePasswordHook = null;

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
  if (typeof hooks.getCurrentTheme === 'function') {
    getCurrentThemeHook = hooks.getCurrentTheme;
  }
  if (typeof hooks.requestSharePassword === 'function') {
    requestSharePasswordHook = hooks.requestSharePassword;
  }
}

export async function loadSlides() {
  const shareParam = getParamHook('share');
  if (shareParam) {
    const sharedSlides = await attemptSharedDeckLoad(shareParam);
    if (Array.isArray(sharedSlides) && sharedSlides.length) {
      return sharedSlides;
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
      // Accept both bare arrays and the app's own export shape
      // ({version, meta, theme, slides}) — a hosted JSON backup used to be
      // rejected silently and fall through to the default deck.
      const urlSlides = Array.isArray(data)
        ? data
        : data && typeof data === 'object' && Array.isArray(data.slides)
          ? data.slides
          : null;
      if (urlSlides) {
        if (!Array.isArray(data) && data.theme) {
          applySharedThemeHook(data.theme);
        }
        showHudStatusHook('✓ Loaded deck from URL', 'success');
        setTimeout(hideHudStatusHook, 2000);
        return urlSlides;
      }
      throw new Error('URL did not contain a deck (expected a slides array)');
    } catch (error) {
      console.error('Failed to load deck from URL', error);
      showHudStatusHook('⚠️ Failed to load deck from URL', 'error');
      setTimeout(hideHudStatusHook, 3000);
    }
  }

  const dataParam = getParamHook('data');
  if (dataParam) {
    try {
      const json = await decodeDataParam(dataParam);
      const data = JSON.parse(json);

      // Support both plain arrays (legacy) and {slides, theme} objects
      if (Array.isArray(data)) {
        const result = materializeSharedDeck(data, { source: 'share:data' });
        showHudStatusHook(
          result.persisted ? '✓ Shared deck copied locally' : '✓ Loaded shared deck',
          result.persisted ? 'success' : 'warning'
        );
        setTimeout(hideHudStatusHook, 2000);
        return result.slides;
      }
      if (data && Array.isArray(data.slides)) {
        if (data.theme) {
          applySharedThemeHook(data.theme);
        }
        const result = materializeSharedDeck(data.slides, {
          source: 'share:data',
          theme: data.theme,
          meta: data.meta,
        });
        showHudStatusHook(
          result.persisted ? '✓ Shared deck copied locally' : '✓ Loaded shared deck',
          result.persisted ? 'success' : 'warning'
        );
        setTimeout(hideHudStatusHook, 2000);
        return result.slides;
      }
    } catch (error) {
      console.error('Failed to load deck from data parameter', error);
      showHudStatusHook('⚠️ Failed to load shared deck', 'error');
      setTimeout(hideHudStatusHook, 3000);
    }
  }

  if (activeDeckId) {
    const stored = loadPersistedDeck();
    if (Array.isArray(stored)) {
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
    throw new Error(`Slides file ${slidesPath} is missing or not a slides array`);
  } catch (error) {
    console.warn(`Unable to load slides from ${slidesPath}, starting with blank deck`, error);
    // Only toast when a specific deck was requested — a bare /deck.html
    // falling back to a blank starter is expected, a dead ?slides= link isn't.
    if (getParamHook('slides')) {
      showHudStatusHook('⚠️ Could not load that deck — starting blank', 'warning');
      setTimeout(hideHudStatusHook, 3000);
    }
  }

  return [getSlideTemplateHook('title')];
}

class SharePasswordError extends Error {
  constructor(message, { invalidPassword = false } = {}) {
    super(message);
    this.name = 'SharePasswordError';
    this.invalidPassword = invalidPassword;
  }
}

async function attemptSharedDeckLoad(shareId) {
  let password = null;
  while (true) {
    try {
      const record = await fetchSharedRecord(shareId, password);
      if (Array.isArray(record?.slides)) {
        if (record.theme) {
          applySharedThemeHook(record.theme);
        }
        const result = materializeSharedDeck(record.slides, {
          source: `share:${shareId}`,
          theme: record.theme,
          meta: record.meta,
        });
        showHudStatusHook(
          result.persisted ? '✓ Shared deck copied locally' : '✓ Loaded shared deck',
          result.persisted ? 'success' : 'warning'
        );
        setTimeout(hideHudStatusHook, 2000);
        return result.slides;
      }
      throw new Error('Malformed shared deck payload');
    } catch (error) {
      if (error instanceof SharePasswordError) {
        password = await requestPassphrase(error.invalidPassword);
        if (!password) {
          showHudStatusHook('Share requires a passphrase.', 'error');
          setTimeout(hideHudStatusHook, 3000);
          return null;
        }
        continue;
      }
      console.error('Failed to load shared deck', error);
      showHudStatusHook('⚠️ Failed to load shared deck', 'error');
      setTimeout(hideHudStatusHook, 3000);
      return null;
    }
  }
}

async function fetchSharedRecord(shareId, password) {
  const params = new URLSearchParams({ id: shareId });
  if (password) {
    params.set('password', password);
  }

  const response = await fetch(`/.netlify/functions/share?${params.toString()}`, { cache: 'no-store' });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Ignore – handled below
  }

  if (response.status === 401 && payload?.requiresPassword) {
    throw new SharePasswordError(payload?.error || 'Password required', {
      invalidPassword: Boolean(payload?.invalidPassword),
    });
  }

  if (!response.ok) {
    const message = payload?.error || `Failed to fetch shared deck (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function requestPassphrase(isInvalid) {
  if (typeof requestSharePasswordHook === 'function') {
    return requestSharePasswordHook({ invalid: isInvalid });
  }
  const promptText = isInvalid
    ? 'Passphrase was incorrect. Try again:'
    : 'Enter the passphrase to unlock this deck:';
  const response = window.prompt(promptText);
  return response ? response.trim() : null;
}

// The recipient's local copy must not carry assetId/storage refs: slide
// deletes and JSON imports queue those ids against the unauthenticated
// delete-asset endpoint, which would break the original share (and, via
// global dedup, other people's shares) for everyone. The image URLs still
// load; only the "I own this blob" markers are dropped.
function detachSharedAssetRefs(slideArray) {
  const detach = (image) => {
    if (image && typeof image === 'object' && image.assetId) {
      delete image.assetId;
      delete image.storage;
    }
  };
  slideArray.forEach((slide) => {
    if (!slide || typeof slide !== 'object') return;
    detach(slide.image);
    if (Array.isArray(slide.media)) slide.media.forEach((m) => detach(m?.image));
    if (Array.isArray(slide.items)) slide.items.forEach((i) => detach(i?.image));
    detach(slide.left?.image);
    detach(slide.right?.image);
    if (Array.isArray(slide.pillars)) slide.pillars.forEach((p) => detach(p?.image));
  });
}

function materializeSharedDeck(slideArray, options = {}) {
  const sharedSlides = JSON.parse(JSON.stringify(slideArray));
  detachSharedAssetRefs(sharedSlides);
  validateSlides(sharedSlides);

  const deckId = generateDeckId();
  const updatedAt = Date.now();
  const storageKey = `${DECK_STORAGE_PREFIX}${encodeURIComponent(deckId)}`;
  const meta = options.meta && typeof options.meta === 'object' ? options.meta : {};
  const payload = {
    version: 1,
    updatedAt,
    source: options.source || 'share',
    slides: sharedSlides,
    meta: {
      name: meta.name || meta.title || deriveDeckName(sharedSlides),
      updatedAt,
      deckId,
    },
  };

  if (options.theme && typeof options.theme === 'object') {
    payload.theme = options.theme;
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify(payload));
    if (!localStorage.getItem(storageKey)) {
      throw new Error('Save verification failed');
    }
    localStorage.setItem(LAST_DECK_KEY, deckId);
    setActiveDeckId(deckId);
    setDeckStorageKey(storageKey);
    replaceUrlWithDeckId(deckId);
    return { slides: sharedSlides, persisted: true };
  } catch (error) {
    console.warn('Unable to save shared deck copy locally:', error);
    return { slides: sharedSlides, persisted: false };
  }
}

function replaceUrlWithDeckId(deckId) {
  if (!window.history || typeof window.history.replaceState !== 'function') return;
  try {
    // Rewrite the pathname too: staying on /s/<slug> made every reload
    // re-match the share loader and mint a fresh localStorage copy each
    // time, orphaning any edits made to the previous copy.
    const target = new URL('/deck.html', window.location.origin);
    target.hash = `deck=${encodeURIComponent(deckId)}`;
    window.history.replaceState({}, '', target.toString());
  } catch (error) {
    console.warn('Unable to replace shared URL with local deck URL:', error);
  }
}

export function resolveSlidesPath() {
  const slidesParam = getParamHook('slides');
  if (!slidesParam) {
    return '/slides.json';
  }
  if (/^(https?:)?\/\//.test(slidesParam) || slidesParam.startsWith('/')) {
    return slidesParam;
  }
  if (slidesParam.endsWith('.json')) {
    return `/${slidesParam.replace(/^\/+/, '')}`;
  }
  return `/${slidesParam.replace(/^\/+/, '')}.json`;
}

function getDeckStorageKey() {
  if (deckStorageKey) {
    return deckStorageKey;
  }
  if (activeDeckId) {
    setDeckStorageKey(`${DECK_STORAGE_PREFIX}${encodeURIComponent(activeDeckId)}`);
    return deckStorageKey;
  }
  const path = resolveSlidesPath();
  try {
    const url = new URL(path, window.location.href);
    const keySource = `${url.origin}${url.pathname}${url.search ?? ''}`;
    setDeckStorageKey(`${DECK_STORAGE_PREFIX}${encodeURIComponent(keySource)}`);
  } catch {
    setDeckStorageKey(`${DECK_STORAGE_PREFIX}${encodeURIComponent(path)}`);
  }
  return deckStorageKey;
}

function loadPersistedDeck() {
  try {
    const key = getDeckStorageKey();
    const stored = localStorage.getItem(key);
    if (!stored) {
      return null;
    }
    const payload = JSON.parse(stored);
    if (!payload || typeof payload !== 'object') {
      console.warn('[loadPersistedDeck] Invalid payload structure');
      return null;
    }
    if (!Array.isArray(payload.slides)) {
      console.warn('[loadPersistedDeck] payload.slides is not an array');
      return null;
    }
    if (payload.theme && typeof payload.theme === 'object') {
      applySharedThemeHook(payload.theme);
    }

    // Validate loaded slides to catch corrupted localStorage data
    try {
      validateSlides(payload.slides);
    } catch (validationError) {
      console.warn('[loadPersistedDeck] Stored slides failed validation, backing up:', validationError);
      // Returning null makes loadSlides persist a blank deck over this key —
      // stash the original first so the user's data stays recoverable.
      stashCorruptDeck(key, stored);
      return null;
    }

    return payload.slides;
  } catch (error) {
    console.warn('Failed to load deck overrides from localStorage:', error);
    try {
      const key = getDeckStorageKey();
      const raw = localStorage.getItem(key);
      if (raw) stashCorruptDeck(key, raw);
      localStorage.removeItem(key);
    } catch {
      // Ignore cleanup failure – nothing else we can do.
    }
    return null;
  }
}

// Outside DECK_STORAGE_PREFIX so the launcher shelf never lists it; the data
// is recoverable from devtools if a user reports a vanished deck.
function stashCorruptDeck(key, raw) {
  try {
    localStorage.setItem(`slideomatic_corrupt_backup:${key}`, raw);
  } catch (error) {
    console.warn('Could not back up corrupt deck payload:', error);
  }
}

export function persistSlides(options = {}) {
  const { suppressWarning = false, silent = false } = options;
  if (!Array.isArray(slides)) return false;

  // Path-loaded decks (guide, starter templates, plain /deck.html) have no
  // local deck id, and loadSlides() never reads path-keyed overrides back —
  // edits would survive the session but vanish on reload. Fork into a real
  // local deck on the first edit so autosave means what it says, the deck
  // shows up on the launcher shelf, and built-ins stay pristine.
  if (!activeDeckId) {
    const deckId = generateDeckId();
    setActiveDeckId(deckId);
    setDeckStorageKey(`${DECK_STORAGE_PREFIX}${encodeURIComponent(deckId)}`);
    replaceUrlWithDeckId(deckId);
  }

  if (!silent) {
    showSaveStatusHook('saving');
  }

  try {
    const updatedAt = Date.now();
    const source = `local:${activeDeckId}`;
    const storageKey = getDeckStorageKey();
    const currentTheme = getCurrentThemeHook();
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
    if (currentTheme && typeof currentTheme === 'object') {
      payload.theme = currentTheme;
    }
    localStorage.setItem(storageKey, JSON.stringify(payload));
    setDeckPersistFailureNotified(false);
    markDeckAsRecent();
    updateDeckNameDisplayHook();

    if (!silent) {
      showSaveStatusHook('saved');
    }

    return true;
  } catch (error) {
    console.warn('Unable to persist deck edits to localStorage:', error);
    if (!deckPersistFailureNotified && !suppressWarning) {
      try {
        showHudStatusHook('⚠️ Unable to save edits locally', 'warning');
        setTimeout(hideHudStatusHook, 2400);
      } catch {
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
  const currentTheme = getCurrentThemeHook();
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
  if (currentTheme && typeof currentTheme === 'object') {
    payload.theme = currentTheme;
  }

  try {
    const key = `${DECK_STORAGE_PREFIX}${encodeURIComponent(newDeckId)}`;
    localStorage.setItem(key, JSON.stringify(payload));

    // Verify the save actually persisted before navigating
    const verification = localStorage.getItem(key);
    if (!verification) {
      throw new Error('Save appeared to succeed but data not found in storage');
    }

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

/**
 * Decode a `?data=` parameter.
 * Supports two formats:
 *   - `gz.<base64url>` — gzip-compressed via CompressionStream
 *   - plain base64 (legacy)
 */
// Cap decompressed `?data=` payloads so a gzip bomb can't exhaust memory.
// Decks are <500KB compressed; 8MB decompressed leaves generous headroom.
const MAX_DECODED_DATA_BYTES = 8 * 1024 * 1024;

async function decodeDataParam(param) {
  if (param.startsWith('gz.')) {
    const b64 = param.slice(3).replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));

    // Read chunk-by-chunk and bail before a decompression bomb blows past the cap.
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_DECODED_DATA_BYTES) {
          throw new Error('Decoded deck data exceeds the size limit.');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return new TextDecoder().decode(concatUint8(chunks, total));
  }

  // Legacy plain base64
  return decodeURIComponent(escape(atob(param)));
}

function concatUint8(chunks, total) {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
