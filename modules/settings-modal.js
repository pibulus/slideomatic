// ═══════════════════════════════════════════════════════════════════════════
// Settings Modal Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Encapsulates logic for the Gemini API settings modal (open/close, listeners,
// save/test/clear actions, and status updates).
//
// ═══════════════════════════════════════════════════════════════════════════

import { STORAGE_KEY_API, getGeminiApiKey, callGemini } from './voice-modes.js';

import { trapFocus, focusFirstElement } from './utils.js';

let previousFocus = null;
let keydownHandler = null;

export function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  const input = /** @type {HTMLInputElement} */ (document.getElementById('gemini-api-key'));
  if (modal && input) {
    previousFocus = document.activeElement;
    input.value = getGeminiApiKey();
    input.type = 'password';
    syncApiKeyVisibilityToggle(false);
    modal.removeAttribute('inert');
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    setupSettingsModalListeners();
    
    // Focus management
    focusFirstElement(modal);
    
    if (keydownHandler) document.removeEventListener('keydown', keydownHandler);
    keydownHandler = (e) => {
      if (e.key === 'Escape') {
        closeSettingsModal();
      } else if (e.key === 'Tab') {
        trapFocus(e, modal);
      }
    };
    document.addEventListener('keydown', keydownHandler);
  }
}

export function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) {
    // Restore focus BEFORE hiding the modal
    if (previousFocus && typeof previousFocus.focus === 'function') {
      previousFocus.focus({ preventScroll: true });
      previousFocus = null;
    }

    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    modal.setAttribute('inert', '');
    
    if (keydownHandler) {
      document.removeEventListener('keydown', keydownHandler);
      keydownHandler = null;
    }
  }
}

export function setupSettingsModalListeners() {
  const closeBtn = /** @type {HTMLElement} */ (document.querySelector('.settings-modal__close'));
  if (closeBtn && !closeBtn.dataset.listenerAttached) {
    closeBtn.addEventListener('click', closeSettingsModal);
    closeBtn.dataset.listenerAttached = 'true';
  }

  const backdrop = /** @type {HTMLElement} */ (document.querySelector('.settings-modal__backdrop'));
  if (backdrop && !backdrop.dataset.listenerAttached) {
    backdrop.addEventListener('click', closeSettingsModal);
    backdrop.dataset.listenerAttached = 'true';
  }

  const saveBtn = /** @type {HTMLButtonElement} */ (document.getElementById('save-api-key'));
  if (saveBtn && !saveBtn.dataset.listenerAttached) {
    saveBtn.addEventListener('click', saveApiKey);
    saveBtn.dataset.listenerAttached = 'true';
  }

  const testBtn = /** @type {HTMLButtonElement} */ (document.getElementById('test-api-key'));
  if (testBtn && !testBtn.dataset.listenerAttached) {
    testBtn.addEventListener('click', testApiKey);
    testBtn.dataset.listenerAttached = 'true';
  }

  const clearBtn = /** @type {HTMLButtonElement} */ (document.getElementById('clear-api-key'));
  if (clearBtn && !clearBtn.dataset.listenerAttached) {
    clearBtn.addEventListener('click', clearApiKey);
    clearBtn.dataset.listenerAttached = 'true';
  }

  const toggleBtn = /** @type {HTMLButtonElement} */ (document.getElementById('toggle-api-key-visibility'));
  if (toggleBtn && !toggleBtn.dataset.listenerAttached) {
    toggleBtn.addEventListener('click', toggleApiKeyVisibility);
    toggleBtn.dataset.listenerAttached = 'true';
  }
}

function saveApiKey() {
  const input = /** @type {HTMLInputElement} */ (document.getElementById('gemini-api-key'));
  const key = input.value.trim();

  if (key) {
    try {
      localStorage.setItem(STORAGE_KEY_API, key);
      showApiKeyStatus('success', '✓ API key saved successfully!');
    } catch (error) {
      console.warn('Failed to store API key:', error);
      showApiKeyStatus('error', 'Could not save the key — storage is full or blocked (private mode?)');
    }
  } else {
    showApiKeyStatus('error', 'Please enter a valid API key');
  }
}

async function testApiKey() {
  const key = getGeminiApiKey();
  const testBtn = /** @type {HTMLButtonElement} */ (document.getElementById('test-api-key'));

  if (!key) {
    showApiKeyStatus('error', 'No API key found. Please save one first.');
    return;
  }

  if (testBtn) {
    testBtn.disabled = true;
    testBtn.classList.add('is-loading');
    testBtn.innerHTML = '<span class="loading-spinner"></span> Testing...';
  }

  showApiKeyStatus('info', '⏳ Testing connection...');

  try {
    // Route through our proxy like every other Gemini call — keeps the key off
    // the URL bar / direct-request path, honors the model allow-list, and uses
    // the rolling alias instead of a pinned model (anti-drift). The proxy uses
    // the visitor's pasted key (sent as userKey) since we only reach here when
    // getGeminiApiKey() is non-empty.
    const response = await callGemini(
      'gemini-flash-lite-latest',
      { contents: [{ parts: [{ text: 'test' }] }] },
      { signal: AbortSignal.timeout(15_000) }
    );

    if (response.ok) {
      showApiKeyStatus('success', '✅ Connection successful! Your API key is working.');
      if (testBtn) {
        testBtn.classList.add('is-success');
        testBtn.innerHTML = '✅ Connected!';
        setTimeout(() => {
          testBtn.classList.remove('is-success', 'is-loading');
          testBtn.innerHTML = 'Test Connection';
          testBtn.disabled = false;
        }, 2000);
      }
    } else {
      const error = await response.json();
      showApiKeyStatus('error', `❌ Invalid API key or connection failed: ${error.error?.message || 'Unknown error'}`);
      if (testBtn) {
        testBtn.classList.remove('is-loading');
        testBtn.innerHTML = 'Test Connection';
        testBtn.disabled = false;
      }
    }
  } catch {
    showApiKeyStatus('error', '❌ Connection test failed. Please check your internet connection.');
    if (testBtn) {
      testBtn.classList.remove('is-loading');
      testBtn.innerHTML = 'Test Connection';
      testBtn.disabled = false;
    }
  }
}

function clearApiKey() {
  if (confirm('Are you sure you want to clear your API key?')) {
    localStorage.removeItem(STORAGE_KEY_API);
    const input = /** @type {HTMLInputElement} */ (document.getElementById('gemini-api-key'));
    if (input) input.value = '';
    showApiKeyStatus('info', 'API key cleared');
  }
}

function toggleApiKeyVisibility() {
  const input = /** @type {HTMLInputElement} */ (document.getElementById('gemini-api-key'));
  if (input) {
    const willShow = input.type === 'password';
    input.type = willShow ? 'text' : 'password';
    syncApiKeyVisibilityToggle(willShow);
  }
}

function syncApiKeyVisibilityToggle(isVisible) {
  const toggleBtn = /** @type {HTMLButtonElement} */ (document.getElementById('toggle-api-key-visibility'));
  if (!toggleBtn) return;
  toggleBtn.setAttribute('aria-pressed', String(isVisible));
  toggleBtn.setAttribute('aria-label', isVisible ? 'Hide Gemini API key' : 'Show Gemini API key');
}

export function showApiKeyStatus(type, message) {
  const status = document.getElementById('api-key-status');
  if (!status) return;

  status.className = `settings-field__status is-visible is-${type}`;
  status.textContent = message;

  if (type !== 'error') {
    setTimeout(() => {
      status.classList.remove('is-visible');
    }, 3000);
  }
}
