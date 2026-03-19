import { trapFocus, focusFirstElement } from './utils.js';

let modal;
let backdrop;
let input;
let submitBtn;
let cancelBtn;
let statusText;
let keydownHandler = null;
let resolver = null;

export function initSharePasswordModal() {
  modal = document.getElementById('share-protect-modal');
  if (!modal) return;

  backdrop = modal.querySelector('[data-share-protect-cancel]');
  input = /** @type {HTMLInputElement} */ (document.getElementById('share-protect-input'));
  submitBtn = document.getElementById('share-protect-submit');
  cancelBtn = document.getElementById('share-protect-cancel');
  statusText = document.getElementById('share-protect-status');

  submitBtn?.addEventListener('click', () => finish(input?.value || ''));
  cancelBtn?.addEventListener('click', () => finish(null));
  backdrop?.addEventListener('click', () => finish(null));

  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(input.value || '');
    }
  });
}

export function requestSharePassword(options = {}) {
  if (!modal) {
    const promptText = options?.invalid
      ? 'Passphrase was incorrect. Try again:'
      : 'Enter the passphrase to unlock this deck:';
    const response = window.prompt(promptText);
    return Promise.resolve(response ? response.trim() : null);
  }

  return new Promise((resolve) => {
    resolver = resolve;
    openModal(Boolean(options?.invalid));
  });
}

function openModal(invalid) {
  if (!modal) return;
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');

  if (statusText) {
    if (invalid) {
      statusText.textContent = 'That passphrase didn\'t match. Try again.';
    } else {
      statusText.textContent = '';
    }
  }

  if (input) {
    input.value = '';
  }

  // focus first focusable (the input)
  if (input) {
    input.focus();
  } else {
    focusFirstElement(modal);
  }

  if (keydownHandler) {
    document.removeEventListener('keydown', keydownHandler);
  }
  keydownHandler = (event) => {
    if (event.key === 'Escape') {
      finish(null);
    } else if (event.key === 'Tab') {
      trapFocus(event, modal);
    }
  };
  document.addEventListener('keydown', keydownHandler);
}

function closeModal() {
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  if (keydownHandler) {
    document.removeEventListener('keydown', keydownHandler);
    keydownHandler = null;
  }
}

function finish(value) {
  closeModal();
  const resolve = resolver;
  resolver = null;
  if (!resolve) return;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    resolve(trimmed || null);
  } else {
    resolve(null);
  }
}
