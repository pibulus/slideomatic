// ═══════════════════════════════════════════════════════════════════════════
// Deck Panel Module
// ═══════════════════════════════════════════════════════════════════════════
//
// The second tab of the edit drawer. Everything here belongs to the whole
// deck rather than the slide in front of you: body weight, sharing, files,
// and the AI key. Keeping it out of the HUD is what lets the bar stay a
// stage control instead of a settings menu.
//
// Dependencies: hud.js (status toasts)
// Used by: main.js
//
// ═══════════════════════════════════════════════════════════════════════════

import { showHudStatus, hideHudStatus } from './hud.js';

const WEIGHT_KEY = 'slideomatic_weight_body';
const DEFAULT_WEIGHT = 500;
const WEIGHTS = [400, 500, 600];

let initialized = false;

function readStoredWeight() {
  try {
    const raw = Number.parseInt(localStorage.getItem(WEIGHT_KEY) || '', 10);
    return WEIGHTS.includes(raw) ? raw : null;
  } catch (_error) {
    return null;
  }
}

function computedWeight() {
  const raw = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--weight-body'),
    10
  );
  return WEIGHTS.includes(raw) ? raw : DEFAULT_WEIGHT;
}

export function getBodyWeight() {
  return readStoredWeight() ?? computedWeight();
}

/**
 * Paint the weight onto the document and the control.
 *
 * A theme may pin its own `weight-body` token (the pixel theme does — fake
 * bold ruins it), so an unset preference must leave the theme alone rather
 * than stamping the default over it.
 */
export function applyBodyWeight(weight, { persist = false } = {}) {
  const next = WEIGHTS.includes(weight) ? weight : DEFAULT_WEIGHT;
  document.documentElement.style.setProperty('--weight-body', String(next));
  paintWeightControl(next);

  if (persist) {
    try {
      localStorage.setItem(WEIGHT_KEY, String(next));
    } catch (error) {
      console.warn('Could not remember body weight:', error);
    }
  }
  return next;
}

function paintWeightControl(weight) {
  const picker = document.getElementById('deck-weight-picker');
  picker?.querySelectorAll('[data-weight]').forEach((btn) => {
    const isOn = Number(btn.dataset.weight) === weight;
    btn.classList.toggle('is-active', isOn);
    btn.setAttribute('aria-checked', isOn ? 'true' : 'false');
  });

  const preview = document.getElementById('deck-weight-preview');
  if (preview) preview.style.fontWeight = String(weight);
}

export function initDeckPanel(context = {}) {
  const stored = readStoredWeight();
  if (stored) {
    applyBodyWeight(stored);
  } else {
    paintWeightControl(computedWeight());
  }

  if (initialized) return;
  initialized = true;

  const picker = document.getElementById('deck-weight-picker');
  picker?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-weight]');
    if (!btn) return;
    applyBodyWeight(Number(btn.dataset.weight), { persist: true });
    showHudStatus('Type weight set', 'success');
    setTimeout(hideHudStatus, 1200);
  });

  document.getElementById('deck-download-btn')?.addEventListener('click', () => {
    context.downloadDeck?.();
  });

  document.getElementById('deck-upload-btn')?.addEventListener('click', () => {
    context.triggerDeckUpload?.();
  });

  document.getElementById('deck-shuffle-btn')?.addEventListener('click', () => {
    context.randomizeTheme?.();
  });

  document.getElementById('deck-ai-key-btn')?.addEventListener('click', () => {
    context.openSettingsModal?.();
  });

  refreshAiStatus(context);
}

export function refreshAiStatus(context = {}) {
  const status = document.getElementById('deck-ai-status');
  if (!status) return;
  let hasKey = false;
  try {
    hasKey = Boolean(context.getApiKey?.());
  } catch (_error) {
    hasKey = false;
  }
  status.textContent = hasKey
    ? 'Gemini is connected. The cheat console can draft a slide or a whole starter deck from a sentence.'
    : 'No key set. Slides and decks can be drafted with Gemini once a key is in place.';
}
