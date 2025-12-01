// ═══════════════════════════════════════════════════════════════════════════
// HUD / Toast Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Provides helper functions for Slide-o-Matic's toast notification HUD.
// Keeps track of active toasts, enforces limits, and exposes show/hide helpers
// for other modules to consume.
//
// ═══════════════════════════════════════════════════════════════════════════

const TOAST_LIMIT = 3;
const TOAST_DURATION = {
  SUCCESS: 1500,
  ERROR: 2000,
  WARNING: 2000,
  INFO: 1500,
};

let lastFailedOperation = null;
const activeToasts = new Map();

const toastHandlers = new WeakMap();

export function showHudStatus(message, type = '', options = {}) {
  const container = document.getElementById('toast-container');
  if (!container) return null;

  if (activeToasts.size >= TOAST_LIMIT) {
    const oldestId = activeToasts.keys().next().value;
    hideToast(oldestId);
  }

  const toast = document.createElement('div');
  const toastId = Date.now() + Math.random();
  toast.className = `toast ${type ? `toast--${type}` : ''}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const handlers = {};

  if (type === 'error' && options.onRetry) {
    lastFailedOperation = options.onRetry;
    const retryBtn = document.createElement('button');
    retryBtn.className = 'toast__retry-btn';
    retryBtn.textContent = '🔄 Retry';

    const retryHandler = () => {
      hideToast(toastId);
      if (lastFailedOperation) {
        lastFailedOperation();
        lastFailedOperation = null;
      }
    };
    retryBtn.addEventListener('click', retryHandler);
    handlers.retry = retryHandler;

    toast.textContent = `${message} `;
    toast.appendChild(retryBtn);
  } else {
    toast.textContent = message;
    lastFailedOperation = null;
  }

  container.appendChild(toast);
  activeToasts.set(toastId, toast);

  const dismissHandler = () => hideToast(toastId);
  toast.addEventListener('click', dismissHandler);
  handlers.dismiss = dismissHandler;
  
  toastHandlers.set(toast, handlers);

  if (type !== 'processing' && !options.onRetry) {
    const duration = options.duration || TOAST_DURATION[type.toUpperCase()] || TOAST_DURATION.INFO;
    setTimeout(() => {
      if (activeToasts.has(toastId)) {
        hideToast(toastId);
      }
    }, duration);
  }

  return toastId;
}

export function hideHudStatus() {
  if (activeToasts.size > 0) {
    const lastToastId = Array.from(activeToasts.keys()).pop();
    hideToast(lastToastId);
  }
}

function hideToast(toastId) {
  const toast = activeToasts.get(toastId);
  if (!toast) return;

  const handlers = toastHandlers.get(toast);
  
  if (handlers?.retry) {
    const retryBtn = toast.querySelector('.toast__retry-btn');
    if (retryBtn) {
      retryBtn.removeEventListener('click', handlers.retry);
    }
  }

  if (handlers?.dismiss) {
    toast.removeEventListener('click', handlers.dismiss);
  }
  
  toastHandlers.delete(toast);

  toast.classList.add('toast--hiding');
  lastFailedOperation = null;

  setTimeout(() => {
    toast.remove();
    activeToasts.delete(toastId);
  }, 200);
}
