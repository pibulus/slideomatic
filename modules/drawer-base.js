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

const hasWindow = typeof window !== 'undefined';
const reduceMotionQuery = hasWindow && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

const DRAWER_OPEN_FRAMES = [
  { transform: 'translateX(105%)', opacity: 0.9 },
  { transform: 'translateX(-8%)', opacity: 1, offset: 0.7, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1.25)' },
  { transform: 'translateX(2%)', offset: 0.88, easing: 'cubic-bezier(0.15, 1.2, 0.35, 1)' },
  { transform: 'translateX(0)', offset: 1, easing: 'cubic-bezier(0.2, 1, 0.2, 1)' },
];

const DRAWER_CLOSE_FRAMES = [
  { transform: 'translateX(0)', opacity: 1 },
  { transform: 'translateX(4%)', offset: 0.35, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' },
  { transform: 'translateX(105%)', opacity: 0.85, offset: 1, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
];

const DRAWER_TIMINGS = {
  open: { duration: 620, fill: 'forwards' },
  close: { duration: 420, fill: 'forwards' },
};

function prefersReducedMotion() {
  return reduceMotionQuery?.matches ?? false;
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
    state: element.classList.contains('is-open') ? 'open' : 'closed',
    previousFocus: null,
    keydownHandler: null,
    clickOutsideHandler: null,
    animation: null,
  };
}

function openDrawer(drawer) {
  if (!drawer || drawer.isOpen) {
    return Promise.resolve();
  }
  const { element, trapFocus: shouldTrapFocus } = drawer;

  drawer.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  drawer.isOpen = true;
  drawer.state = 'opening';

  element.classList.add('is-open');
  element.classList.remove('is-closing');
  element.setAttribute('aria-hidden', 'false');

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
  requestAnimationFrame(() => {
    document.addEventListener('click', drawer.clickOutsideHandler, true);
  });

  focusFirstElement(element);
  drawer.onOpen?.(drawer);

  return playDrawerAnimation(drawer, 'open').finally(() => {
    if (drawer.isOpen) {
      drawer.state = 'open';
    }
  });
}

function closeDrawer(drawer, options = {}) {
  if (!drawer || !drawer.isOpen) {
    return Promise.resolve();
  }
  const { element } = drawer;
  const { restoreFocus = true } = options;

  drawer.isOpen = false;
  drawer.state = 'closing';
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

  const animationPromise = playDrawerAnimation(drawer, 'close');

  return animationPromise.finally(() => {
    if (drawer.state !== 'closing') {
      return;
    }

    drawer.state = 'closed';
    element.classList.remove('is-open');
    element.classList.remove('is-closing');
    drawer.previousFocus = null;
    if (target) {
      requestAnimationFrame(() => target.focus());
    }
    drawer.onClose?.(drawer);
  });
}

function playDrawerAnimation(drawer, phase) {
  const { element } = drawer;
  const reduced = prefersReducedMotion();
  const canAnimate = typeof element.animate === 'function' && !reduced;

  if (!canAnimate) {
    element.style.transform = phase === 'open' ? 'translateX(0)' : 'translateX(105%)';
    return Promise.resolve();
  }

  if (drawer.animation) {
    drawer.animation.cancel();
    drawer.animation = null;
  }

  const keyframes = phase === 'open' ? DRAWER_OPEN_FRAMES : DRAWER_CLOSE_FRAMES;
  const timing = DRAWER_TIMINGS[phase];
  const animation = element.animate(keyframes, timing);
  drawer.animation = animation;

  return animation.finished
    .catch(() => {})
    .finally(() => {
      if (drawer.animation === animation) {
        drawer.animation = null;
      }
    });
}

export {
  createDrawer,
  openDrawer,
  closeDrawer,
  trapFocus,
  getFocusableElements,
  focusFirstElement,
};
