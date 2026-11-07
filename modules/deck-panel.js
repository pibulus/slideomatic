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
    btn.setAttribute('tabindex', isOn ? '0' : '-1');
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

  picker?.addEventListener('keydown', (event) => {
    const buttons = Array.from(picker.querySelectorAll('[data-weight]'));
    if (!buttons.length) return;
    const currentIdx = Math.max(
      0,
      buttons.findIndex((btn) => btn.getAttribute('aria-checked') === 'true')
    );
    let nextIdx = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIdx = (currentIdx + 1) % buttons.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIdx = (currentIdx - 1 + buttons.length) % buttons.length;
    }
    if (nextIdx !== null) {
      event.preventDefault();
      const targetBtn = /** @type {HTMLElement} */ (buttons[nextIdx]);
      applyBodyWeight(Number(targetBtn.dataset.weight), { persist: true });
      targetBtn.focus({ preventScroll: true });
      showHudStatus('Type weight set', 'success');
      setTimeout(hideHudStatus, 1200);
    }
  });

  document.getElementById('deck-download-btn')?.addEventListener('click', () => {
    context.downloadDeck?.();
  });

  document.getElementById('deck-pdf-btn')?.addEventListener('click', () => {
    context.downloadPdf?.();
  });

  document.getElementById('deck-upload-btn')?.addEventListener('click', () => {
    context.triggerDeckUpload?.();
  });

  document.getElementById('deck-shuffle-btn')?.addEventListener('click', () => {
    context.randomizeTheme?.();
  });

  document.getElementById('deck-studio-console-btn')?.addEventListener('click', () => {
    context.openStudioConsole?.();
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
    ? 'Personal Gemini key connected. Draft a slide or whole starter deck from a single prompt.'
    : 'Ready to draft a slide or starter deck from a sentence. Add a personal Gemini key for unlimited runs.';
}
