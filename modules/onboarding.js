import { trapFocus, focusFirstElement } from './utils.js';

let previousFocus = null;
let keydownHandler = null;

export function showIntroModalIfFirstVisit() {
  // Redirect to hints modal logic, as we are consolidating to a single "Quick Guide"
  showKeyboardHintsIfFirstVisit();
}

export function showKeyboardHintsIfFirstVisit() {
  const HINTS_SEEN_KEY = 'slideomatic_hints_seen';
  const hintsModal = document.getElementById('hints-modal');
  const closeBtn = document.getElementById('hints-modal-close');
  const gotItBtn = document.getElementById('hints-modal-got-it');
  const backdrop = hintsModal?.querySelector('.hints-modal__backdrop');

  if (!hintsModal) return;

  // Check if user has seen hints before
  const hasSeenHints = localStorage.getItem(HINTS_SEEN_KEY);

  if (!hasSeenHints) {
    // Show hints modal with slight delay for effect
    setTimeout(() => {
      openKeyboardHelp();
    }, 1000);

    // Mark as seen when closed
    const markSeen = () => {
      localStorage.setItem(HINTS_SEEN_KEY, 'true');
    };
    
    closeBtn?.addEventListener('click', markSeen);
    gotItBtn?.addEventListener('click', markSeen);
    backdrop?.addEventListener('click', markSeen);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// KEYBOARD HELP MODAL (Now uses Quick Guide / hints-modal)
// ═══════════════════════════════════════════════════════════════════════════

export function toggleKeyboardHelp() {
  const modal = document.getElementById('hints-modal');
  if (!modal) return;

  const isOpen =
    modal.getAttribute('aria-hidden') === 'false' ||
    modal.classList.contains('is-open');
  if (isOpen) {
    closeKeyboardHelp();
  } else {
    openKeyboardHelp();
  }
}

export function openKeyboardHelp() {
  const modal = document.getElementById('hints-modal');
  if (!modal) return;

  previousFocus = document.activeElement;
  modal.setAttribute('aria-hidden', 'false');
  modal.classList.add('is-open');

  // Focus management
  focusFirstElement(modal);

  if (keydownHandler) document.removeEventListener('keydown', keydownHandler);
  keydownHandler = (e) => {
    if (e.key === 'Escape') {
      closeKeyboardHelp();
    } else if (e.key === 'Tab') {
      trapFocus(e, modal);
    }
  };
  document.addEventListener('keydown', keydownHandler);

  // Set up listeners if not already done
  setupKeyboardHelpListeners();
}

export function closeKeyboardHelp() {
  const modal = document.getElementById('hints-modal');
  if (!modal) return;

  modal.setAttribute('aria-hidden', 'true');
  modal.classList.remove('is-open');

  if (keydownHandler) {
    document.removeEventListener('keydown', keydownHandler);
    keydownHandler = null;
  }

  if (previousFocus && typeof previousFocus.focus === 'function') {
    previousFocus.focus();
    previousFocus = null;
  }
}

function setupKeyboardHelpListeners() {
  // Close button
  const closeBtn = document.getElementById('hints-modal-close');
  const gotItBtn = document.getElementById('hints-modal-got-it');
  
  if (closeBtn && !closeBtn.dataset.listenerAttached) {
    closeBtn.addEventListener('click', closeKeyboardHelp);
    closeBtn.dataset.listenerAttached = 'true';
  }

  if (gotItBtn && !gotItBtn.dataset.listenerAttached) {
    gotItBtn.addEventListener('click', closeKeyboardHelp);
    gotItBtn.dataset.listenerAttached = 'true';
  }

  // Backdrop
  const backdrop = document.querySelector('.hints-modal__backdrop');
  if (backdrop && !backdrop.dataset.listenerAttached) {
    backdrop.addEventListener('click', closeKeyboardHelp);
    backdrop.dataset.listenerAttached = 'true';
  }
}
