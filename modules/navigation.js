// ═══════════════════════════════════════════════════════════════════════════
// Navigation Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Encapsulates slide navigation helpers:
// - Overview mode toggles and layout updates
// - Slide activation, counters, and HUD updates
// - Resize and click handlers for overview mode
//
// Dependencies: state.js, utils.js, dom-refs.js, lazy-images.js, slide-index.js
// Used by: main.js, keyboard-nav.js (via re-exported helpers)
//
// ═══════════════════════════════════════════════════════════════════════════

import {
  slides,
  slideElements,
  currentIndex,
  setCurrentIndex,
  isOverview,
  setOverview,
  overviewCursor,
  setOverviewCursor,
  lastOverviewHighlight,
  setLastOverviewHighlight,
  overviewRowCount,
  setOverviewRowCount,
  overviewColumnCount,
  setOverviewColumnCount,
  slideScrollPositions,
  isEditDrawerOpen,
  addPreloadedImage,
  hasPreloadedImage,
} from './state.js';
import { clamp } from './utils.js';
import { slidesRoot, currentCounter, totalCounter, progressBar } from './dom-refs.js';
import { loadLazyImage } from './lazy-images.js';
import { closeSlideIndex, updateSlideIndexHighlight } from './slide-index.js';

let closeThemeDrawerHook = () => {};
let getEditDrawerContextHook = () => ({
  getSlides: () => slides,
  getCurrentIndex: () => currentIndex,
});
let renderEditFormHook = (_context) => {};
let toggleSpeakerNotesHook = () => {};

const columnOverviewQuery = (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
  ? window.matchMedia('(max-width: 640px)')
  : { matches: false };
let glideAnimationFrame = null;

const handleOrientationChange = () => {
  if (!isOverview) return;
  cancelGlide();
  requestAnimationFrame(() => {
    const current = slideElements[overviewCursor];
    if (current) {
      glideToSlide(current);
    }
    updateScrollGradients();
  });
};

if (typeof columnOverviewQuery.addEventListener === 'function') {
  columnOverviewQuery.addEventListener('change', handleOrientationChange);
} else if (typeof columnOverviewQuery.addListener === 'function') {
  columnOverviewQuery.addListener(handleOrientationChange);
}

function isColumnOverview() {
  return columnOverviewQuery.matches;
}

function cancelGlide() {
  if (glideAnimationFrame) {
    cancelAnimationFrame(glideAnimationFrame);
    glideAnimationFrame = null;
  }
}

function startGlide(target, axis = 'x') {
  if (!slidesRoot) return;
  cancelGlide();
  const duration = 550;
  const start = axis === 'y' ? slidesRoot.scrollTop : slidesRoot.scrollLeft;
  const distance = target - start;
  if (Math.abs(distance) < 1) {
    if (axis === 'y') {
      slidesRoot.scrollTop = target;
    } else {
      slidesRoot.scrollLeft = target;
    }
    return;
  }

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const initialTime = performance.now();

  const step = (now) => {
    const elapsed = now - initialTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = easeOutCubic(progress);
    const value = start + distance * eased;
    if (axis === 'y') {
      slidesRoot.scrollTop = value;
    } else {
      slidesRoot.scrollLeft = value;
    }

    if (progress < 1) {
      glideAnimationFrame = requestAnimationFrame(step);
    } else {
      glideAnimationFrame = null;
    }
  };

  glideAnimationFrame = requestAnimationFrame(step);
}

function glideToSlide(slide) {
  if (!slidesRoot || !slide) return;
  const axis = isColumnOverview() ? 'y' : 'x';
  const containerRect = slidesRoot.getBoundingClientRect();
  const slideRect = slide.getBoundingClientRect();
  const currentOffset = axis === 'y' ? slidesRoot.scrollTop : slidesRoot.scrollLeft;
  const delta = axis === 'y' ? slideRect.top - containerRect.top : slideRect.left - containerRect.left;
  const viewportSize = axis === 'y' ? slidesRoot.clientHeight : slidesRoot.clientWidth;
  const slideSize = axis === 'y' ? slideRect.height : slideRect.width;
  const rawTarget = currentOffset + delta - (viewportSize - slideSize) / 2;
  const maxScroll = Math.max((axis === 'y' ? slidesRoot.scrollHeight - viewportSize : slidesRoot.scrollWidth - viewportSize), 0);
  const boundedTarget = clamp(rawTarget, 0, maxScroll);
  startGlide(boundedTarget, axis);
}

function bindGlideInterruptions(shouldBind) {
  if (!slidesRoot) return;
  const events = ['wheel', 'pointerdown', 'touchstart'];
  events.forEach((eventName) => {
    if (shouldBind) {
      slidesRoot.addEventListener(eventName, cancelGlide, { passive: true });
    } else {
      slidesRoot.removeEventListener(eventName, cancelGlide, { passive: true });
    }
  });
}

export function registerNavigationHooks(hooks = {}) {
  if (typeof hooks.closeThemeDrawer === 'function') {
    closeThemeDrawerHook = hooks.closeThemeDrawer;
  }
  if (typeof hooks.getEditDrawerContext === 'function') {
    getEditDrawerContextHook = hooks.getEditDrawerContext;
  }
  if (typeof hooks.renderEditForm === 'function') {
    renderEditFormHook = hooks.renderEditForm;
  }
  if (typeof hooks.toggleSpeakerNotes === 'function') {
    toggleSpeakerNotesHook = hooks.toggleSpeakerNotes;
  }
}

export function toggleOverview() {
  if (isOverview) {
    exitOverview();
    return;
  }
  enterOverview();
}

export function enterOverview() {
  closeSlideIndex();
  closeThemeDrawerHook();
  document.body.dataset.mode = 'overview';
  updateOverviewLayout();
  slideElements.forEach((slide) => {
    slide.style.visibility = 'visible';
    slide.style.pointerEvents = 'auto';
    slide.setAttribute('aria-hidden', 'false');
    slide.tabIndex = 0;
  });
  setOverview(true);
  setOverviewCursor(clamp(currentIndex, 0, slideElements.length - 1));
  highlightOverviewSlide(overviewCursor);
  const focusedSlide = slideElements[overviewCursor];
  if (focusedSlide) {
    requestAnimationFrame(() => focusedSlide.focus({ preventScroll: true }));
  }
  // Bind scroll listener for gradient indicators
  slidesRoot?.addEventListener('scroll', updateScrollGradients, { passive: true });
  bindGlideInterruptions(true);
  updateOverviewButton();
}

export function exitOverview(targetIndex = currentIndex) {
  delete document.body.dataset.mode;
  setOverview(false);
  // Remove scroll listener
  slidesRoot?.removeEventListener('scroll', updateScrollGradients);
  bindGlideInterruptions(false);
  slideElements.forEach((slide, index) => {
    if (index !== targetIndex) {
      slide.style.visibility = 'hidden';
      slide.style.pointerEvents = 'none';
      slide.setAttribute('aria-hidden', 'true');
    }
    slide.classList.remove('is-active');
    slide.tabIndex = -1;
  });
  setActiveSlide(targetIndex);
  setOverviewCursor(currentIndex);
  setLastOverviewHighlight(overviewCursor);
  updateOverviewButton();
}

export function updateOverviewButton() {
  const overviewBtn = document.getElementById('overview-btn');
  if (!overviewBtn) return;
  if (isOverview) {
    overviewBtn.textContent = 'Slides';
    overviewBtn.setAttribute('aria-label', 'Exit overview');
    overviewBtn.title = 'Return to active slide';
  } else {
    overviewBtn.textContent = 'Overview';
    overviewBtn.setAttribute('aria-label', 'View all slides');
    overviewBtn.title = 'View all slides';
  }
}

export function updateScrollGradients() {
  if (!slidesRoot) return;

  if (isColumnOverview()) {
    slidesRoot.classList.remove('has-scroll-left', 'has-scroll-right');
    return;
  }

  const { scrollLeft, scrollWidth, clientWidth } = slidesRoot;
  const maxScroll = scrollWidth - clientWidth;

  if (scrollLeft > 20) {
    slidesRoot.classList.add('has-scroll-left');
  } else {
    slidesRoot.classList.remove('has-scroll-left');
  }

  if (scrollLeft < maxScroll - 20) {
    slidesRoot.classList.add('has-scroll-right');
  } else {
    slidesRoot.classList.remove('has-scroll-right');
  }
}

export function updateOverviewLayout() {
  const totalSlides = slideElements.length;
  if (!totalSlides) return;
  setOverviewRowCount(1);
  setOverviewColumnCount(totalSlides);
  slidesRoot?.style.setProperty('--overview-row-count', overviewRowCount);
  slidesRoot?.style.setProperty('--overview-column-count', overviewColumnCount);
  updateScrollGradients();
  setOverviewCursor(clamp(overviewCursor, 0, totalSlides - 1));
  if (isOverview) {
    highlightOverviewSlide(overviewCursor, { scroll: false });
  } else {
    setOverviewCursor(clamp(currentIndex, 0, totalSlides - 1));
    setLastOverviewHighlight(overviewCursor);
  }
}

export function highlightOverviewSlide(index, { scroll = true } = {}) {
  const totalSlides = slideElements.length;
  if (!totalSlides) return;
  const clamped = clamp(index, 0, totalSlides - 1);
  const previous = slideElements[lastOverviewHighlight];
  if (previous) {
    previous.classList.remove('is-active');
    previous.tabIndex = -1;
  }

  setOverviewCursor(clamped);
  const current = slideElements[overviewCursor];
  if (current) {
    current.classList.add('is-active');
    current.tabIndex = 0;
    if (scroll) {
      glideToSlide(current);
    }
  }
  setLastOverviewHighlight(overviewCursor);
}

export function moveOverviewCursorBy(deltaColumn, deltaRow) {
  const totalSlides = slideElements.length;
  if (!totalSlides) return;
  const delta = deltaColumn !== 0 ? deltaColumn : deltaRow;
  if (!delta) return;
  const nextIndex = clamp(overviewCursor + delta, 0, totalSlides - 1);
  highlightOverviewSlide(nextIndex);
}

let resizeTimeout = null;
export const handleResize = () => {
  if (!slideElements.length) return;

  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    updateOverviewLayout();
    if (isOverview) {
      highlightOverviewSlide(overviewCursor, { scroll: false });
    }
  }, 150);
};

export function setActiveSlide(nextIndex) {
  const clamped = clamp(nextIndex, 0, slideElements.length - 1);
  if (!isOverview && clamped === currentIndex && slideElements[currentIndex].classList.contains('is-active')) {
    updateHud();
    return;
  }

  const oldSlide = slideElements[currentIndex];
  if (oldSlide) {
    slideScrollPositions.set(currentIndex, oldSlide.scrollTop);
    oldSlide.classList.remove('is-active');
    oldSlide.classList.add('is-leaving');
    oldSlide.style.pointerEvents = 'none';
    oldSlide.setAttribute('aria-hidden', 'true');
    oldSlide.removeAttribute('aria-current');
    setTimeout(() => {
      oldSlide.classList.remove('is-leaving');
      if (!oldSlide.classList.contains('is-active')) {
        oldSlide.style.visibility = 'hidden';
      }
    }, 400);
  }

  setCurrentIndex(clamped);

  const newSlide = slideElements[currentIndex];
  newSlide.style.visibility = 'visible';
  newSlide.style.pointerEvents = isOverview ? 'none' : 'auto';
  newSlide.setAttribute('aria-hidden', 'false');
  newSlide.setAttribute('aria-current', 'step');
  const previousScroll = slideScrollPositions.get(currentIndex) || 0;
  newSlide.scrollTop = previousScroll;
  newSlide.querySelectorAll('img[data-src]').forEach(loadLazyImage);
  slideElements[currentIndex].classList.add('is-active');
  slideElements[currentIndex].scrollIntoView({ block: 'center' });
  setOverviewCursor(currentIndex);
  setLastOverviewHighlight(currentIndex);
  updateOverviewButton();

  updateHud();
  updateSlideIndexHighlight(currentIndex);
  if (isEditDrawerOpen) {
    renderEditFormHook(getEditDrawerContextHook());
  }
  preloadSlideImages(currentIndex);
  preloadSlideImages(currentIndex + 1);
  preloadSlideImages(currentIndex + 2);
}

export function updateTotalCounter(total) {
  if (totalCounter) {
    totalCounter.textContent = total;
  }
}

export function updateHud() {
  if (currentCounter) {
    const counterEl = currentCounter.parentElement;
    if (counterEl) {
      counterEl.classList.add('updating');
      setTimeout(() => counterEl.classList.remove('updating'), 300);
    }
    currentCounter.textContent = currentIndex + 1;
  }

  if (progressBar) {
    const progress = ((currentIndex + 1) / slideElements.length) * 100;
    progressBar.style.width = `${progress}%`;
  }

  const notesIndicator = document.getElementById('notes-indicator');
  if (notesIndicator) {
    const currentSlide = slides[currentIndex];
    const hasNotes = currentSlide?.notes || currentSlide?.speaker_notes;
    if (hasNotes) {
      notesIndicator.removeAttribute('hidden');
      notesIndicator.onclick = toggleSpeakerNotesHook;
    } else {
      notesIndicator.setAttribute('hidden', '');
    }
  }
}

export function handleSlideClick(event) {
  if (!isOverview) return;
  const targetSlide = event.target.closest('.slide');
  if (!targetSlide) return;
  const targetIndex = Number.parseInt(targetSlide.dataset.index, 10);
  if (Number.isNaN(targetIndex)) return;
  exitOverview(targetIndex);
}

function preloadImage(src) {
  if (!src || hasPreloadedImage(src)) return;
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  addPreloadedImage(src);
}

function preloadSlideImages(index) {
  const slide = slideElements[index];
  if (!slide) return;
  const images = slide.querySelectorAll('img[data-modal-src]');
  images.forEach((img) => {
    if (img.dataset && img.dataset.src) {
      loadLazyImage(img);
    }
    const src = img.dataset.modalSrc || img.currentSrc || img.src;
    preloadImage(src);
  });
}

export function navigateToDeckHome() {
  window.location.href = 'index.html';
}
