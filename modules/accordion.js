// ═══════════════════════════════════════════════════════════════════════════
// Accordion Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Provides whimsical accordion behavior with spring animations.
// Handles open/close state, animations, and multiple accordion groups.
//
// Usage:
//   import { setupAccordion } from './accordion.js';
//   setupAccordion(container, { openFirst: true });
//
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Setup accordion behavior for all .accordion elements within a container
 * @param {HTMLElement} container - Parent element containing accordions
 * @param {Object} [options] - Configuration options
 * @param {boolean} [options.openFirst] - Open the first accordion by default
 * @param {boolean} [options.allowMultiple] - Allow multiple accordions open simultaneously
 * @param {Function} [options.addTrackedListener] - Optional listener tracking function
 */
export function setupAccordion(container, options = {}) {
  const {
    openFirst = false,
    allowMultiple = false,
    addTrackedListener = null,
  } = options;

  const accordions = container.querySelectorAll('.accordion');
  if (!accordions.length) return;

  accordions.forEach((accordion, index) => {
    const header = accordion.querySelector('.accordion__header');
    const body = accordion.querySelector('.accordion__body');

    if (!header || !body) return;

    // Open first accordion if requested
    if (openFirst && index === 0) {
      accordion.classList.add('is-open');
    }

    const toggleAccordion = () => {
      const isOpen = accordion.classList.contains('is-open');

      if (isOpen) {
        closeAccordion(accordion);
      } else {
        // If not allowing multiple, close all other accordions
        if (!allowMultiple) {
          accordions.forEach((other) => {
            if (other !== accordion && other.classList.contains('is-open')) {
              closeAccordion(other);
            }
          });
        }

        openAccordion(accordion);
      }
    };

    // Use tracked listener if provided, otherwise regular addEventListener
    if (addTrackedListener && typeof addTrackedListener === 'function') {
      addTrackedListener(header, 'click', toggleAccordion);
    } else {
      header.addEventListener('click', toggleAccordion);
    }
  });
}

/**
 * Open an accordion with spring animation
 * @param {Element} accordion - The accordion element to open
 */
export function openAccordion(accordion) {
  if (!accordion || accordion.classList.contains('is-open')) return;

  accordion.classList.add('is-opening');
  accordion.classList.add('is-open');

  // Remove opening class after animation
  setTimeout(() => {
    accordion.classList.remove('is-opening');
  }, 500);
}

/**
 * Close an accordion with bounce animation
 * @param {Element} accordion - The accordion element to close
 */
export function closeAccordion(accordion) {
  if (!accordion || !accordion.classList.contains('is-open')) return;

  accordion.classList.add('is-closing');

  // Remove open class after bounce animation
  setTimeout(() => {
    accordion.classList.remove('is-open');
    accordion.classList.remove('is-closing');
  }, 380);
}

/**
 * Toggle a specific accordion
 * @param {Element} accordion - The accordion element to toggle
 */
export function toggleAccordion(accordion) {
  if (!accordion) return;

  if (accordion.classList.contains('is-open')) {
    closeAccordion(accordion);
  } else {
    openAccordion(accordion);
  }
}

/**
 * Open all accordions within a container
 * @param {HTMLElement} container - Parent element containing accordions
 */
export function openAllAccordions(container) {
  const accordions = container.querySelectorAll('.accordion');
  accordions.forEach((accordion) => openAccordion(accordion));
}

/**
 * Close all accordions within a container
 * @param {HTMLElement} container - Parent element containing accordions
 */
export function closeAllAccordions(container) {
  const accordions = container.querySelectorAll('.accordion');
  accordions.forEach((accordion) => closeAccordion(accordion));
}
