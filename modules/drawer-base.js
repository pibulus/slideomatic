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

const DEFAULT_MOTION_PROFILE = {
  open: {
    keyframes: [
      { transform: 'translateX(105%)', opacity: 0.9 },
      { transform: 'translateX(-8%)', opacity: 1, offset: 0.7, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1.25)' },
      { transform: 'translateX(2%)', offset: 0.88, easing: 'cubic-bezier(0.15, 1.2, 0.35, 1)' },
      { transform: 'translateX(0)', offset: 1, easing: 'cubic-bezier(0.2, 1, 0.2, 1)' },
    ],
    options: { duration: 620, fill: 'forwards' },
  },
  close: {
    keyframes: [
      { transform: 'translateX(0)', opacity: 1 },
      { transform: 'translateX(4%)', offset: 0.35, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' },
      { transform: 'translateX(105%)', opacity: 0.85, offset: 1, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    ],
    options: { duration: 420, fill: 'forwards' },
  },
};

function cloneKeyframes(frames = []) {
  return frames.map((frame) => ({ ...frame }));
}

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
    motionProfile = DEFAULT_MOTION_PROFILE,
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
    motionProfile,
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
  
  // Check if we should use CSS class-based animation
  const profile = drawer.motionProfile || DEFAULT_MOTION_PROFILE;
  const motionSegment = profile[phase];
  
  // If the profile specifies a CSS class for this phase (e.g. 'is-springing'), use that
  if (motionSegment && typeof motionSegment === 'string') {
    if (phase === 'open') {
      // Force reflow to ensure the browser sees the starting state (transform: 0 from is-open class)
      // vs the animation starting state.
      // Actually, we want the animation to start from off-screen.
      // The is-open class sets transform: 0.
      // The animation keyframes start at transform: 104%.
      // We need to make sure the animation class is applied effectively.
      
      void element.offsetWidth; 
      element.classList.add(motionSegment);
      
      // Wait for animation end
      return new Promise((resolve) => {
        const handler = (e) => {
          if (e.target === element) {
            element.removeEventListener('animationend', handler);
            resolve();
          }
        };
        element.addEventListener('animationend', handler);
        
        // Fallback safety
        setTimeout(() => {
          element.removeEventListener('animationend', handler);
          resolve();
        }, 1000);
      });
    } else {
      // For closing, we just remove the class and let the standard close logic happen
      // or if there's a specific close class, we could add it. 
      // But typically we just remove the open class.
      // If a specific close class was needed, we'd handle it here.
      // For now, if it's a string profile, we assume it's an "open" class that persists.
      // The standard close logic in closeDrawer adds 'is-closing' which has its own CSS.
      element.classList.remove(motionSegment);
      return Promise.resolve();
    }
  }

  const canAnimate = typeof element.animate === 'function' && !reduced;

  if (!canAnimate) {
    element.style.transform = phase === 'open' ? 'translateX(0)' : 'translateX(105%)';
    return Promise.resolve();
  }

  if (drawer.animation) {
    drawer.animation.cancel();
    drawer.animation = null;
  }

  // Fallback to WAAPI if not using CSS class
  const segment = profile[phase] || DEFAULT_MOTION_PROFILE[phase];
  // If segment is missing or invalid (e.g. we passed a string for open but nothing for close), fallback
  if (!segment || typeof segment !== 'object') {
     return Promise.resolve();
  }

  const keyframes = cloneKeyframes(segment.keyframes);
  const timing = { fill: 'forwards', ...(segment.options || {}) };
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
