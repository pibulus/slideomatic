// ═══════════════════════════════════════════════════════════════════════════
// Drawer Base Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Provides shared drawer behaviors used throughout Slide-o-Matic.
// - Creates drawer instances with configurable hooks
// - Handles open/close animations and focus restoration
// - Implements focus trapping utilities for accessibility
//
// Dependencies: utils.js (focus helpers)
// Used by: edit-drawer.js, main.js, theme drawer implementation
//
// ═══════════════════════════════════════════════════════════════════════════

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function getFocusableElements(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTORS)).filter((el) =>
    !el.hasAttribute('disabled') &&
    el.getAttribute('tabindex') !== '-1' &&
    typeof el.focus === 'function' &&
    (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0)
  );
}

function trapFocus(event, container) {
  if (event.key !== 'Tab') return;
  const focusable = getFocusableElements(container);
  if (focusable.length === 0) {
    event.preventDefault();
    container.setAttribute('tabindex', '-1');
    container.focus({ preventScroll: true });
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  const isShift = event.shiftKey;

  if (!isShift && active === last) {
    event.preventDefault();
    first.focus();
  } else if (isShift && active === first) {
    event.preventDefault();
    last.focus();
  }
}

function focusFirstElement(container) {
  const focusable = getFocusableElements(container);
  if (focusable.length > 0) {
    focusable[0].focus();
  } else {
    container.setAttribute('tabindex', '-1');
    container.focus({ preventScroll: true });
  }
}

function createDrawer(config) {
  const {
    id,
    element: elementRef,
    side = 'right',
    onOpen,
    onClose,
    trapFocus: shouldTrapFocus = true,
  } = config;

  const element = elementRef || (typeof id === 'string' ? document.getElementById(id) : null);
  if (!element) {
    throw new Error(`Drawer element "${id ?? '(unknown)'}" not found`);
  }

  if (!element.hasAttribute('aria-hidden')) {
    element.setAttribute('aria-hidden', 'true');
  }

  return {
    id: typeof id === 'string' ? id : element.id,
    element,
    side,
    onOpen,
    onClose,
    trapFocus: shouldTrapFocus,
    isOpen: element.classList.contains('is-open'),
    previousFocus: null,
    keydownHandler: null,
    clickOutsideHandler: null,
  };
}

function openDrawer(drawer) {
  if (!drawer || drawer.isOpen) return;
  const { element, trapFocus: shouldTrapFocus } = drawer;

  drawer.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  drawer.isOpen = true;

  element.classList.remove('is-closing');
  element.classList.add('is-open', 'is-springing');
  element.setAttribute('aria-hidden', 'false');
  element.addEventListener('animationend', () => element.classList.remove('is-springing'), { once: true });

  if (shouldTrapFocus) {
    drawer.keydownHandler = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDrawer(drawer, { restoreFocus: true });
        return;
      }
      if (event.key === 'Tab') {
        trapFocus(event, element);
      }
    };
    document.addEventListener('keydown', drawer.keydownHandler, true);
  }

  // Add click-outside-to-close handler
  drawer.clickOutsideHandler = (event) => {
    if (!element.contains(event.target)) {
      closeDrawer(drawer, { restoreFocus: true });
    }
  };
  // Use a slight delay to prevent the opening click from immediately closing the drawer
  setTimeout(() => {
    document.addEventListener('click', drawer.clickOutsideHandler, true);
  }, 100);

  focusFirstElement(element);
  drawer.onOpen?.(drawer);
}

function closeDrawer(drawer, options = {}) {
  if (!drawer || !drawer.isOpen) return;
  const { element } = drawer;
  const { restoreFocus = true } = options;

  drawer.isOpen = false;
  element.classList.remove('is-springing');
  element.classList.add('is-closing');
  element.setAttribute('aria-hidden', 'true');

  if (drawer.keydownHandler) {
    document.removeEventListener('keydown', drawer.keydownHandler, true);
    drawer.keydownHandler = null;
  }

  if (drawer.clickOutsideHandler) {
    document.removeEventListener('click', drawer.clickOutsideHandler, true);
    drawer.clickOutsideHandler = null;
  }

  const target = restoreFocus && drawer.previousFocus && typeof drawer.previousFocus.focus === 'function'
    ? drawer.previousFocus
    : null;

  // Wait for close animation to complete
  const onAnimationEnd = () => {
    element.removeEventListener('animationend', onAnimationEnd);
    element.classList.remove('is-open', 'is-closing');
    if (target) {
      requestAnimationFrame(() => target.focus());
    }
    drawer.previousFocus = null;
    drawer.onClose?.(drawer);
  };

  element.addEventListener('animationend', onAnimationEnd);

  // Fallback in case animation doesn't fire
  setTimeout(() => {
    if (element.classList.contains('is-closing')) {
      element.removeEventListener('animationend', onAnimationEnd);
      onAnimationEnd();
    }
  }, 500);
}

export {
  createDrawer,
  openDrawer,
  closeDrawer,
  trapFocus,
  getFocusableElements,
  focusFirstElement,
};

