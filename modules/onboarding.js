// ═══════════════════════════════════════════════════════════════════════════
// Onboarding & Help Modules
// ═══════════════════════════════════════════════════════════════════════════

export function showIntroModalIfFirstVisit() {
  const INTRO_SEEN_KEY = 'slideomatic_intro_seen';
  const introModal = document.getElementById('intro-modal');
  const closeBtn = document.getElementById('intro-modal-close');

  if (!introModal) return;

  // Check if user has seen intro before
  const hasSeenIntro = localStorage.getItem(INTRO_SEEN_KEY);

  if (!hasSeenIntro) {
    // Show intro modal with slight delay for effect
    setTimeout(() => {
      introModal.classList.add('is-open');
    }, 800);

    // Close button handler
    closeBtn?.addEventListener('click', () => {
      introModal.classList.remove('is-open');
      localStorage.setItem(INTRO_SEEN_KEY, 'true');
    });

    // Close on backdrop click
    const backdrop = introModal.querySelector('.intro-modal__backdrop');
    backdrop?.addEventListener('click', () => {
      introModal.classList.remove('is-open');
      localStorage.setItem(INTRO_SEEN_KEY, 'true');
    });
  }
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
    const openHints = () => {
      hintsModal.setAttribute('aria-hidden', 'false');
      hintsModal.classList.add('is-open');
    };

    const closeHints = () => {
      hintsModal.setAttribute('aria-hidden', 'true');
      hintsModal.classList.remove('is-open');
      localStorage.setItem(HINTS_SEEN_KEY, 'true');
    };

    setTimeout(openHints, 1000);

    // Close button handler
    closeBtn?.addEventListener('click', closeHints);

    // "Got it" button handler
    gotItBtn?.addEventListener('click', closeHints);

    // Backdrop click to close
    backdrop?.addEventListener('click', closeHints);

    // ESC key to close
    document.addEventListener('keydown', function handleHintsEsc(event) {
      if (event.key === 'Escape' && hintsModal.getAttribute('aria-hidden') === 'false') {
        closeHints();
        document.removeEventListener('keydown', handleHintsEsc);
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// KEYBOARD HELP MODAL
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

  modal.setAttribute('aria-hidden', 'false');
  modal.classList.add('is-open');

  // Set up listeners if not already done
  setupKeyboardHelpListeners();
}

export function closeKeyboardHelp() {
  const modal = document.getElementById('hints-modal');
  if (!modal) return;

  modal.setAttribute('aria-hidden', 'true');
  modal.classList.remove('is-open');
}

function setupKeyboardHelpListeners() {
  // Close button
  const closeBtn = document.getElementById('hints-modal-close');
  if (closeBtn && !closeBtn.dataset.listenerAttached) {
    closeBtn.addEventListener('click', closeKeyboardHelp);
    closeBtn.dataset.listenerAttached = 'true';
  }

  // Got it button
  const gotItBtn = document.getElementById('hints-modal-got-it');
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
