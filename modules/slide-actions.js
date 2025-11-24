// ═══════════════════════════════════════════════════════════════════════════
// Slide Actions Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Manages slide mutations (insert, remove, replace) and keeps DOM/state in sync.
// Centralizing these helpers avoids duplicating logic across the edit drawer,
// keyboard shortcuts, and other controllers.
//
// Dependencies: state.js, utils.js, navigation.js, deck-persistence.js,
//                slide-rendering.js, dom-refs.js, slide-index.js
// Used by: main.js, edit-drawer.js, keyboard-nav.js
//
// ═══════════════════════════════════════════════════════════════════════════

import {
  slides,
  slideElements,
  currentIndex,
  isOverview,
  slideScrollPositions,
  overviewCursor,
  setSlides,
  setSlideElements,
  setCurrentIndex,
  setOverviewCursor,
} from './state.js';
import { validateSlides } from './validation.js';
import { persistSlides } from './deck-persistence.js';
import { clamp } from './utils.js';
import {
  updateTotalCounter,
  updateOverviewLayout,
  highlightOverviewSlide,
  updateHud,
  setActiveSlide,
} from './navigation.js';
import {
  refreshSlideIndex,
  updateSlideIndexHighlight,
} from './slide-index.js';
import { slidesRoot } from './dom-refs.js';

let showHudStatusHook = () => {};
let hideHudStatusHook = () => {};
let createSlideHook = () => {
  throw new Error('createSlide hook not registered');
};
let renderEmptyStateHook = () => {};
let cleanupSlideAssetsHook = () => {};
let cleanupAllSlideAssetsHook = () => {};

export function registerSlideActionHooks(hooks = {}) {
  if (typeof hooks.showHudStatus === 'function') {
    showHudStatusHook = hooks.showHudStatus;
  }
  if (typeof hooks.hideHudStatus === 'function') {
    hideHudStatusHook = hooks.hideHudStatus;
  }
  if (typeof hooks.createSlide === 'function') {
    createSlideHook = hooks.createSlide;
  }
  if (typeof hooks.renderEmptyState === 'function') {
    renderEmptyStateHook = hooks.renderEmptyState;
  }
  if (typeof hooks.cleanupSlideAssets === 'function') {
    cleanupSlideAssetsHook = hooks.cleanupSlideAssets;
  }
  if (typeof hooks.cleanupAllSlideAssets === 'function') {
    cleanupAllSlideAssetsHook = hooks.cleanupAllSlideAssets;
  }
}

function shiftScrollPositions(startIndex, delta) {
  if (!slideScrollPositions.size || delta === 0) return;
  const updated = new Map();
  slideScrollPositions.forEach((value, key) => {
    if (key >= startIndex) {
      const nextKey = key + delta;
      if (nextKey >= 0) {
        updated.set(nextKey, value);
      }
    } else {
      updated.set(key, value);
    }
  });
  slideScrollPositions.clear();
  updated.forEach((value, key) => slideScrollPositions.set(key, value));
}

function reindexSlides(startIndex = 0) {
  for (let index = Math.max(0, startIndex); index < slideElements.length; index += 1) {
    const slideElement = slideElements[index];
    if (!slideElement) continue;
    slideElement.dataset.index = index;
    const autoBadge = slideElement.querySelector(':scope > .badge[data-badge-auto="true"]');
    if (autoBadge) {
      autoBadge.textContent = `+ Slide ${index + 1}`;
    }
  }
}

export function insertSlideAt(index, slideData, options = {}) {
  const { activate = false } = options;
  if (index < 0) index = 0;
  if (index > slides.length) index = slides.length;

  slides.splice(index, 0, slideData);
  shiftScrollPositions(index, 1);

  const newSlideElement = createSlideHook(slideData, index);
  if (isOverview) {
    newSlideElement.style.visibility = 'visible';
    newSlideElement.style.pointerEvents = 'auto';
    newSlideElement.setAttribute('aria-hidden', 'false');
    newSlideElement.tabIndex = 0;
  } else {
    newSlideElement.style.visibility = 'hidden';
    newSlideElement.style.pointerEvents = 'none';
    newSlideElement.setAttribute('aria-hidden', 'true');
    newSlideElement.tabIndex = -1;
  }

  const existingElement = slideElements[index];
  if (existingElement && existingElement.parentElement) {
    existingElement.parentElement.insertBefore(newSlideElement, existingElement);
  } else {
    slidesRoot?.appendChild(newSlideElement);
  }

  slideElements.splice(index, 0, newSlideElement);
  reindexSlides(index);

  updateTotalCounter(slideElements.length);
  updateOverviewLayout();
  refreshSlideIndex();

  if (!activate) {
    if (!isOverview && index <= currentIndex) {
      setCurrentIndex(clamp(currentIndex + 1, 0, slideElements.length - 1));
    }
    if (isOverview && index <= overviewCursor) {
      setOverviewCursor(clamp(overviewCursor + 1, 0, slideElements.length - 1));
    }
  }

  if (activate) {
    if (isOverview) {
      highlightOverviewSlide(index);
    } else {
      setActiveSlide(index);
    }
  } else if (!isOverview) {
    updateHud();
  } else {
    setOverviewCursor(clamp(overviewCursor, 0, slideElements.length - 1));
    highlightOverviewSlide(overviewCursor, { scroll: false });
  }

  updateSlideIndexHighlight(isOverview ? overviewCursor : currentIndex);
  persistSlides();

  return newSlideElement;
}

export function removeSlideAt(index, options = {}) {
  const { focus = true } = options;
  if (index < 0 || index >= slides.length) return;

  cleanupSlideAssetsHook(slides[index]);

  slides.splice(index, 1);
  persistSlides();
  slideScrollPositions.delete(index);
  shiftScrollPositions(index + 1, -1);

  const [removedElement] = slideElements.splice(index, 1);
  if (removedElement && removedElement.parentElement) {
    removedElement.parentElement.removeChild(removedElement);
  }

  if (!slideElements.length) {
    slidesRoot.innerHTML = '';
    renderEmptyStateHook();
    updateTotalCounter(0);
    setCurrentIndex(0);
    updateHud();
    refreshSlideIndex();
    updateOverviewLayout();
    return;
  }

  reindexSlides(index);
  updateTotalCounter(slideElements.length);
  updateOverviewLayout();
  refreshSlideIndex();

  if (isOverview) {
    setOverviewCursor(clamp(overviewCursor, 0, slideElements.length - 1));
    highlightOverviewSlide(overviewCursor, { scroll: false });
    updateSlideIndexHighlight(overviewCursor);
    return;
  }

  const nextIndex = clamp(currentIndex >= index ? currentIndex - 1 : currentIndex, 0, slideElements.length - 1);

  if (focus) {
    setActiveSlide(nextIndex);
  } else {
    setCurrentIndex(nextIndex);
    updateHud();
    updateSlideIndexHighlight(currentIndex);
  }
}

export function replaceSlideAt(index, options = {}) {
  const { focus = true } = options;
  if (index < 0 || index >= slides.length) return;

  const existing = slideElements[index];
  if (!existing || !existing.parentElement) {
    reloadDeck({ targetIndex: index, focus });
    persistSlides();
    return;
  }

  const previousScroll = existing.scrollTop;
  slideScrollPositions.set(index, previousScroll);

  const oldPlaceholders = existing.querySelectorAll('.image-placeholder');
  oldPlaceholders.forEach((placeholder) => {
    delete placeholder._imageRef;
  });

  const slideData = slides[index];
  const newSlide = createSlideHook(slideData, index);
  newSlide.style.visibility = existing.style.visibility;
  newSlide.style.pointerEvents = existing.style.pointerEvents;
  newSlide.setAttribute('aria-hidden', existing.getAttribute('aria-hidden') ?? 'true');
  newSlide.tabIndex = existing.tabIndex;

  existing.replaceWith(newSlide);
  slideElements[index] = newSlide;

  const wasActive = index === currentIndex && !isOverview;
  if (wasActive) {
    newSlide.classList.add('is-active');
    newSlide.style.visibility = 'visible';
    newSlide.style.pointerEvents = 'auto';
    newSlide.setAttribute('aria-hidden', 'false');
    const scrollOffset = slideScrollPositions.get(index) ?? previousScroll ?? 0;
    requestAnimationFrame(() => {
      newSlide.scrollTop = scrollOffset;
      if (focus) {
        newSlide.focus({ preventScroll: true });
      }
    });
  } else if (isOverview) {
    newSlide.style.visibility = 'visible';
    newSlide.style.pointerEvents = 'auto';
    newSlide.setAttribute('aria-hidden', 'false');
  } else {
    newSlide.style.visibility = 'hidden';
    newSlide.style.pointerEvents = 'none';
    newSlide.setAttribute('aria-hidden', 'true');
  }

  updateOverviewLayout();
  refreshSlideIndex();
  updateSlideIndexHighlight(currentIndex);
  if (wasActive && !isOverview) {
    updateHud();
  }
  persistSlides();
}

export function downloadDeck(filename = 'slides.json') {
  const payload = JSON.stringify(slides, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showHudStatusHook('💾 Deck downloaded', 'success');
  setTimeout(hideHudStatusHook, 1600);
}

export function handleDeckUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      const newSlides = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.slides)
        ? parsed.slides
        : null;

      if (!newSlides) {
        throw new Error('File must contain a JSON array of slides.');
      }

      validateSlides(newSlides);

      cleanupAllSlideAssetsHook();
      setSlides(newSlides);
      reloadDeck({ targetIndex: 0 });
      const persisted = persistSlides();

      if (persisted) {
        showHudStatusHook(`📂 Loaded ${newSlides.length} slides`, 'success');
        setTimeout(hideHudStatusHook, 1600);
      }
    } catch (error) {
      console.error('Failed to load deck:', error);
      showHudStatusHook(`❌ Failed to load deck: ${error.message}`, 'error');
      setTimeout(hideHudStatusHook, 3000);
    }
  };

  reader.readAsText(file);
  event.target.value = '';
}

export function reloadDeck(options = {}) {
  const { targetIndex = currentIndex, focus = true } = options;
  slidesRoot.innerHTML = '';
  slideScrollPositions.clear();

  const renderableSlides = slides.filter((slide) => slide.type !== '_schema');

  updateTotalCounter(renderableSlides.length);

  if (!Array.isArray(renderableSlides) || renderableSlides.length === 0) {
    renderEmptyStateHook();
    return;
  }

  const renderedElements = renderableSlides.map((slide, index) =>
    createSlideHook(slide, index)
  );
  setSlideElements(renderedElements);

  const fragment = document.createDocumentFragment();
  slideElements.forEach((slide) => {
    slide.style.visibility = 'hidden';
    slide.style.pointerEvents = 'none';
    fragment.appendChild(slide);
  });
  slidesRoot.appendChild(fragment);
  updateOverviewLayout();
  refreshSlideIndex();

  const clampedIndex = clamp(
    typeof targetIndex === 'number' ? targetIndex : 0,
    0,
    renderableSlides.length - 1
  );

  if (focus) {
    setActiveSlide(clampedIndex);
  } else {
    setCurrentIndex(clampedIndex);
  }
}
