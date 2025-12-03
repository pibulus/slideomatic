import { generateSlideFromPrompt, generateDeckFromPrompt } from './voice-modes.js';

const CHEAT_CODES = ['iddqd', 'idkfa', 'abracadabra'];
const MAX_BUFFER = Math.max(...CHEAT_CODES.map(code => code.length));

let buffer = '';
let initialized = false;
let root;
let promptInput;
let statusEl;
let slideBtn;
let deckBtn;
let unlockedLabel;

export function initCheatConsole() {
  if (initialized) return;
  root = document.getElementById('cheat-console');
  if (!root) return;

  promptInput = /** @type {HTMLTextAreaElement|null} */ (root.querySelector('#cheat-console-prompt'));
  statusEl = root.querySelector('#cheat-console-status');
  slideBtn = /** @type {HTMLButtonElement|null} */ (root.querySelector('#cheat-console-slide'));
  deckBtn = /** @type {HTMLButtonElement|null} */ (root.querySelector('#cheat-console-deck'));
  unlockedLabel = root.querySelector('#cheat-console-unlocked');
  const closeBtn = root.querySelector('[data-cheat-close]');

  if (!promptInput || !slideBtn || !deckBtn || !closeBtn) return;

  document.addEventListener('keydown', handleGlobalKey);
  closeBtn.addEventListener('click', hideConsole);
  root.querySelector('.cheat-console__backdrop')?.addEventListener('click', hideConsole);

  slideBtn.addEventListener('click', () => handleCheatAction('slide'));
  deckBtn.addEventListener('click', () => handleCheatAction('deck'));

  initialized = true;
}

function handleGlobalKey(event) {
  if (event.key === 'Escape' && root?.classList.contains('is-open')) {
    hideConsole();
    return;
  }

  if (
    event.target &&
    (event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target.isContentEditable)
  ) {
    return;
  }

  if (!/^[a-z]$/i.test(event.key)) {
    return;
  }

  buffer = (buffer + event.key.toLowerCase()).slice(-MAX_BUFFER);
  const hit = CHEAT_CODES.find(code => buffer.endsWith(code));
  if (hit) {
    showConsole(hit);
    buffer = '';
  }
}

function showConsole(code) {
  if (!root || !promptInput) return;
  root.classList.add('is-open');
  root.setAttribute('aria-hidden', 'false');
  document.body.classList.add('cheat-console-open');
  if (unlockedLabel) {
    unlockedLabel.textContent = `Cheat unlocked: ${code.toUpperCase()}`;
  }
  setStatus(`Cheat "${code}" unlocked. Describe what you want and let Gemini cook.`, 'info');
  promptInput.focus();
}

function hideConsole() {
  if (!root) return;
  root.classList.remove('is-open');
  root.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('cheat-console-open');
}

async function handleCheatAction(mode) {
  if (!promptInput || !slideBtn || !deckBtn) return;
  const prompt = promptInput.value.trim();
  if (!prompt) {
    setStatus('Add a description first.', 'error');
    promptInput.focus();
    return;
  }

  const triggerBtn = mode === 'slide' ? slideBtn : deckBtn;
  const otherBtn = mode === 'slide' ? deckBtn : slideBtn;
  triggerBtn.disabled = true;
  otherBtn.disabled = true;
  triggerBtn.textContent = mode === 'slide' ? 'Cooking...' : 'Mixing deck...';
  setStatus('', 'info');

  try {
    if (mode === 'slide') {
      await generateSlideFromPrompt(prompt, { insert: true });
      setStatus('✨ Slide injected after the current one.', 'success');
    } else {
      await generateDeckFromPrompt(prompt, { insert: true, slideCount: 6 });
      setStatus('✨ Mini deck appended right after the current slide.', 'success');
    }
  } catch (error) {
    setStatus(error?.message || 'Something went wrong.', 'error');
  } finally {
    triggerBtn.disabled = false;
    otherBtn.disabled = false;
    triggerBtn.textContent = mode === 'slide' ? 'Generate slide' : 'Generate mini deck';
  }
}

function setStatus(message, type) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.dataset.state = type;
}
