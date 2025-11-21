// ═══════════════════════════════════════════════════════════════════════════
// Settings Modal Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Encapsulates logic for the Gemini API settings modal (open/close, listeners,
// save/test/clear actions, and status updates).
//
// ═══════════════════════════════════════════════════════════════════════════

import { STORAGE_KEY_API, getGeminiApiKey } from './voice-modes.js';

export function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  const input = document.getElementById('gemini-api-key');
  if (modal && input) {
    input.value = getGeminiApiKey();
    modal.classList.add('is-open');
    setupSettingsModalListeners();
  }
}

export function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) {
    modal.classList.remove('is-open');
  }
}

export function setupSettingsModalListeners() {
  const closeBtn = document.querySelector('.settings-modal__close');
  if (closeBtn && !closeBtn.dataset.listenerAttached) {
    closeBtn.addEventListener('click', closeSettingsModal);
    closeBtn.dataset.listenerAttached = 'true';
  }

  const backdrop = document.querySelector('.settings-modal__backdrop');
  if (backdrop && !backdrop.dataset.listenerAttached) {
    backdrop.addEventListener('click', closeSettingsModal);
    backdrop.dataset.listenerAttached = 'true';
  }

  const saveBtn = document.getElementById('save-api-key');
  if (saveBtn && !saveBtn.dataset.listenerAttached) {
    saveBtn.addEventListener('click', saveApiKey);
    saveBtn.dataset.listenerAttached = 'true';
  }

  const testBtn = document.getElementById('test-api-key');
  if (testBtn && !testBtn.dataset.listenerAttached) {
    testBtn.addEventListener('click', testApiKey);
    testBtn.dataset.listenerAttached = 'true';
  }

  const clearBtn = document.getElementById('clear-api-key');
  if (clearBtn && !clearBtn.dataset.listenerAttached) {
    clearBtn.addEventListener('click', clearApiKey);
    clearBtn.dataset.listenerAttached = 'true';
  }

  const toggleBtn = document.getElementById('toggle-api-key-visibility');
  if (toggleBtn && !toggleBtn.dataset.listenerAttached) {
    toggleBtn.addEventListener('click', toggleApiKeyVisibility);
    toggleBtn.dataset.listenerAttached = 'true';
  }
}

function saveApiKey() {
  const input = document.getElementById('gemini-api-key');
  const key = input.value.trim();

  if (key) {
    localStorage.setItem(STORAGE_KEY_API, key);
    showApiKeyStatus('success', '✓ API key saved successfully!');
  } else {
    showApiKeyStatus('error', 'Please enter a valid API key');
  }
}

async function testApiKey() {
  const key = getGeminiApiKey();
  const testBtn = document.getElementById('test-api-key');

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
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'test' }] }] }),
      }
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
  } catch (error) {
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
    const input = document.getElementById('gemini-api-key');
    if (input) input.value = '';
    showApiKeyStatus('info', 'API key cleared');
  }
}

function toggleApiKeyVisibility() {
  const input = document.getElementById('gemini-api-key');
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
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
