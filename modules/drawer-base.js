// ═══════════════════════════════════════════════════════════════════════════
// Drawer Base Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Provides shared drawer behaviors used throughout Slide-o-Matic.
// - Creates drawer instances with configurable hooks
// - Handles open/close animations and focus restoration
// - Implements focus trapping utilities for accessibility
//
import { trapFocus, focusFirstElement, getFocusableElements } from './utils.js';

// FOCUSABLE_SELECTORS and local helper functions removed in favor of utils.js imports


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
  element.classList.remove('is-open');
  element.classList.remove('is-springing');
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
  if (target) {
    requestAnimationFrame(() => target.focus());
  }
  drawer.previousFocus = null;

  drawer.onClose?.(drawer);
}

export {
  createDrawer,
  openDrawer,
  closeDrawer,
  trapFocus,
  getFocusableElements,
  focusFirstElement,
};

