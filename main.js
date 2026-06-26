import {
  loadTheme,
  applyTheme,
  getCurrentTheme,
  setCurrentTheme,
  getCurrentThemePath,
  LOCAL_THEME_SOURCE,
} from './modules/theme-manager.js';
import { deriveDeckName, escapeRegExp } from './modules/utils.js';

import {
  cleanupSlideAssets,
  cleanupAllSlideAssets,
  handleImageModalTrigger,
} from './modules/image-render.js';
import { handleGlobalPaste } from './modules/image-upload.js';
import { flushAssetDeletions } from './modules/image-utils.js';
import {
  renderers,
  createSlide,
  renderLoadError,
  renderEmptyState,
} from './modules/slide-rendering.js';
import { validateSlides } from './modules/validation.js';
import { showHudStatus, hideHudStatus } from './modules/hud.js';


import { renderEditForm } from './modules/edit-drawer.js';
import {
  createDrawer,
  openDrawer,
  closeDrawer,
} from './modules/drawer-base.js';
import {
  initVoiceButtons,
  toggleVoiceRecording,
} from './modules/voice-modes.js';
import { initKeyboardNav } from './modules/keyboard-nav.js';
import {
  openSettingsModal,
  closeSettingsModal,
  showApiKeyStatus,
} from './modules/settings-modal.js';
import {
  initSlideIndex,
  toggleSlideIndex,
} from './modules/slide-index.js';
import { initCheatConsole } from './modules/cheat-codes.js';
import {
  loadSlides,
  generateDeckId,
  registerDeckPersistenceHooks,
} from './modules/deck-persistence.js';
import { slidesRoot, initDomRefs } from './modules/dom-refs.js';
import {
  insertSlideAt,
  replaceSlideAt,
  downloadDeck,
  handleDeckUpload,
  registerSlideActionHooks,
} from './modules/slide-actions.js';
import {
  initThemeDrawer,
  openThemeDrawer,
  closeThemeDrawer,
  syncThemeSelectUI,
  randomizeTheme,
} from './modules/theme-drawer.js';
import {
  slides,
  setSlides,
  slideElements,
  setSlideElements,
  currentIndex,
  isOverview,
  setAutoLinkConfigs,
  overviewCursor,
  setOverviewCursor,
  themeDrawerInstance,
  DECK_STORAGE_PREFIX,
  setDeckStorageKey,
  activeDeckId,
  setActiveDeckId,
  setNewDeckRequest,
  setEditDrawerOpen,
  editDrawerInstance,
  setEditDrawerInstance,
} from './modules/state.js';
import {
  registerNavigationHooks,
  toggleOverview,
  exitOverview,
  updateOverviewButton,
  updateOverviewLayout,
  moveOverviewCursorBy,
  handleResize,
  setActiveSlide,
  updateTotalCounter,
  handleSlideClick,
} from './modules/navigation.js';
import { initTouchNav } from './modules/touch-nav.js';
import { initShareModal } from './modules/share-modal.js';
import { initSharePasswordModal, requestSharePassword } from './modules/share-password-modal.js';
import {
  showIntroModalIfFirstVisit,
  showKeyboardHintsIfFirstVisit,
  toggleKeyboardHelp,
  openKeyboardHelp,
} from './modules/onboarding.js';
import { toggleSpeakerNotes, initSpeakerNotes } from './modules/speaker-notes.js';
import { getSlideTemplate } from './modules/slide-templates.js';




const urlParams = new URLSearchParams(window.location.search);
// Also check hash params (for servers that strip query strings)
const hashParams = new URLSearchParams(window.location.hash.slice(1));

// Helper to get param from search OR hash
function getParam(name) {
  const value = urlParams.get(name) || hashParams.get(name);
  if (value) return value;
  if (name === 'share') {
    const match = window.location.pathname.match(/^\/s\/([^/]+)\/?$/);
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

const requestedDeck = getParam('deck');

// renderers imported from slide-rendering.js

registerDeckPersistenceHooks({
  getParam,
  showHudStatus,
  hideHudStatus,
  showSaveStatus,
  updateDeckNameDisplay,
  getSlideTemplate,
  applySharedTheme: applySharedThemeFromShare,
  getCurrentTheme,
  requestSharePassword,
});

registerNavigationHooks({
  closeThemeDrawer,
  getEditDrawerContext,
  renderEditForm,
  toggleSpeakerNotes,
  onSlideChange: (index) => pushSlideHistory(index),
});

registerSlideActionHooks({
  showHudStatus,
  hideHudStatus,
  createSlide: (slide, index) => createSlide(slide, index, renderers),
  renderEmptyState,
  cleanupSlideAssets,
  cleanupAllSlideAssets,
  getCurrentTheme,
  applyTheme,
  setCurrentTheme,
  deriveDeckName,
});

function applySharedThemeFromShare(themeData) {
  if (!themeData || typeof themeData !== 'object') return;
  // Precedence: an explicit ?theme= URL param always wins over a deck's
  // bundled theme. loadAndApplyTheme() already applied the URL theme, so a
  // deck loaded afterwards must not clobber it.
  if (new URLSearchParams(window.location.search).has('theme')) return;
  try {
    setCurrentTheme(themeData, { source: LOCAL_THEME_SOURCE });
    applyTheme(themeData);
    syncThemeSelectUI();
  } catch (error) {
    console.warn('Failed to apply shared theme payload', error);
  }
}

window.addEventListener('resize', handleResize);
document.addEventListener('paste', handleGlobalPaste);
window.addEventListener('beforeunload', () => {
  flushAssetDeletions();
});



if (requestedDeck) {
  if (requestedDeck === 'new') {
    setNewDeckRequest(true);
    setActiveDeckId(generateDeckId());
    setDeckStorageKey(null); // Clear cache so getDeckStorageKey() rebuilds with new ID
    urlParams.set('deck', activeDeckId);
    const nextSearch = urlParams.toString();
    const nextUrl = `${window.location.pathname}?${nextSearch}${window.location.hash ?? ''}`;
    if (window.history && typeof window.history.replaceState === 'function') {
      window.history.replaceState({}, '', nextUrl);
    }
  } else {
    setActiveDeckId(requestedDeck);
    setDeckStorageKey(null); // Clear cache so getDeckStorageKey() rebuilds with deck ID
  }
}

// ================================================================
// Theme Library - localStorage persistence
// ================================================================


// ═══════════════════════════════════════════════════════════════════════════
// DECK INITIALIZATION & LOADING
// ═══════════════════════════════════════════════════════════════════════════
// Main entry point and deck setup orchestration
// ═══════════════════════════════════════════════════════════════════════════

let isInitializing = false;
let isInitialized = false;

if (!isInitializing && !isInitialized) {
  isInitializing = true;
  initDeckWithTheme();
} else {
  console.warn('[Init] Attempted double initialization - BLOCKED');
}

// Note: Main initialization logic is in initDeckWithTheme() at bottom of file
// (old initDeck() removed to avoid duplication)

async function loadAndApplyTheme() {
  const params = new URLSearchParams(window.location.search);
  const themeParamProvided = params.has('theme');
  const storedTheme = getCurrentTheme();
  if (storedTheme && !themeParamProvided) {
    applyTheme(storedTheme);
    if (!getCurrentThemePath()) {
      setCurrentTheme(storedTheme, { source: LOCAL_THEME_SOURCE });
    }
    syncThemeSelectUI();
    return;
  }

  const themePath = resolveThemePath();
  try {
    const theme = await loadTheme(themePath);
    applyTheme(theme);
    setCurrentTheme(theme, { source: themePath });
    syncThemeSelectUI();
  } catch (error) {
    console.warn('Unable to load custom theme, using defaults.', error);
  }
}

function resolveThemePath() {
  const themeParam = getParam('theme');
  if (!themeParam) return '/theme.json';
  if (/^(https?:)?\/\//.test(themeParam) || themeParam.startsWith('/')) {
    return themeParam;
  }
  if (themeParam.endsWith('.json')) {
    return `/${themeParam.replace(/^\/+/, '')}`;
  }
  if (themeParam.includes('/')) {
    return `/${themeParam.replace(/^\/+/, '')}.json`;
  }
  return `/themes/${themeParam}.json`;
}

function initDeckName() {
  const deckNameEl = document.getElementById('deck-name');
  const deckNameText = document.getElementById('deck-name-text');
  if (!deckNameEl || !deckNameText) return;

  // Update deck name display
  updateDeckNameDisplay();

  // Click to rename
  deckNameEl.addEventListener('click', renameDeck);
}

function updateDeckNameDisplay() {
  const deckNameEl = document.getElementById('deck-name');
  const deckNameText = document.getElementById('deck-name-text');
  if (!deckNameText || !deckNameEl) return;

  let name = 'Untitled deck';

  if (activeDeckId) {
    // Get name from localStorage
    try {
      const key = `${DECK_STORAGE_PREFIX}${encodeURIComponent(activeDeckId)}`;
      const payload = JSON.parse(localStorage.getItem(key) || '{}');
      name = payload.meta?.name || deriveDeckName(slides);
    } catch {
      name = deriveDeckName(slides);
    }
  } else {
    name = deriveDeckName(slides);
  }

  // Hide deck name if it's untitled
  if (name === 'Untitled deck') {
    deckNameEl.hidden = true;
  } else {
    deckNameEl.hidden = false;
    deckNameText.textContent = name;
  }

  document.title = `${name} - Slide-o-Matic`;
  updateDeckPageMeta(name);
}

function updateDeckPageMeta(name) {
  const deckName = name && name !== 'Untitled deck' ? name : 'Slide-o-Matic Deck';
  const description = `${deckName} made with Slide-o-Matic, the playful local-first slideshow builder.`;

  setMetaContent('meta[name="description"]', description);
  setMetaContent('meta[property="og:title"]', deckName);
  setMetaContent('meta[property="og:description"]', description);
  setMetaContent('meta[name="twitter:title"]', deckName);
  setMetaContent('meta[name="twitter:description"]', description);
}

function setMetaContent(selector, content) {
  const meta = document.querySelector(selector);
  if (meta) meta.setAttribute('content', content);
}

function renameDeck() {
  if (!activeDeckId) {
    showHudStatus('Save as copy first to rename', 'info');
    setTimeout(hideHudStatus, 2000);
    return;
  }

  const currentName = document.getElementById('deck-name-text')?.textContent || 'Untitled deck';
  const newName = window.prompt('Rename deck:', currentName);

  if (!newName || newName.trim() === '' || newName === currentName) return;

  try {
    const key = `${DECK_STORAGE_PREFIX}${encodeURIComponent(activeDeckId)}`;
    const payload = JSON.parse(localStorage.getItem(key) || '{}');
    payload.meta = {
      ...(payload.meta || {}),
      name: newName.trim(),
      updatedAt: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(payload));
    updateDeckNameDisplay();
    showHudStatus('✓ Deck renamed', 'success');
    setTimeout(hideHudStatus, 1500);
  } catch (error) {
    console.error('Failed to rename deck:', error);
    showHudStatus('⚠️ Unable to rename', 'error');
    setTimeout(hideHudStatus, 2000);
  }
}

let saveStatusTimeout = null;



function showSaveStatus(state = 'saved') {
  const saveStatus = document.getElementById('save-status');
  const saveText = saveStatus?.querySelector('.hud__save-text');
  if (!saveStatus || !saveText) return;

  clearTimeout(saveStatusTimeout);

  if (state === 'saving') {
    saveText.textContent = 'Saving...';
    saveStatus.setAttribute('data-state', 'saving');
    saveStatus.hidden = false;
  } else if (state === 'saved') {
    saveText.textContent = 'Saved';
    saveStatus.setAttribute('data-state', 'saved');
    saveStatus.hidden = false;

    // Auto-hide after 2 seconds
    saveStatusTimeout = setTimeout(() => {
      saveStatus.hidden = true;
      saveStatus.removeAttribute('data-state');
    }, 2000);
  }
}

// deriveDeckName() now imported from utils.js

async function loadAutoLinks() {
  try {
    const response = await fetch('/autolinks.json', { cache: 'no-store' });
    if (!response.ok) return;
    const links = await response.json();
    if (!Array.isArray(links)) return;
    const processedLinks = links
      .filter((link) => Boolean(link?.term))
      .map((link) => ({
        term: link.term,
        search: link.search,
        url: link.url,
        urlTemplate: link.urlTemplate,
        openInNewTab: link.openInNewTab !== false,
        regex: new RegExp(escapeRegExp(link.term), 'gi'),
      }));
    setAutoLinkConfigs(processedLinks);
  } catch (error) {
    console.warn('Unable to load autolinks.json', error);
    setAutoLinkConfigs([]);
  }
}




function toggleEditDrawer() {
  if (!editDrawerInstance) return false;
  if (editDrawerInstance.isOpen) {
    closeDrawer(editDrawerInstance);
  } else {
    openEditDrawer();
  }
  return Boolean(editDrawerInstance?.isOpen);
}

function openEditDrawer() {
  if (!editDrawerInstance) return;
  if (themeDrawerInstance?.isOpen) {
    closeDrawer(themeDrawerInstance, { restoreFocus: false });
  }
  // Pre-render the form BEFORE opening to avoid DOM manipulation during animation
  renderEditForm(getEditDrawerContext());
  openDrawer(editDrawerInstance);
}




function getEditDrawerContext() {
  return {
    getSlides: () => slides,
    getCurrentIndex: () => currentIndex,
    updateSlide: (index, slide) => {
      slides[index] = slide;
    },
    replaceSlideAt: (index, options) => replaceSlideAt(index, options),
    insertSlideAt: (index, slideData, options) => insertSlideAt(index, slideData, options),
    downloadDeck,
    getSlideTemplate,
    showHudStatus,
    hideHudStatus,
    closeDrawer: () => closeDrawer(editDrawerInstance),
  };
}

function getKeyboardContext() {
  return {
    isOverview: () => isOverview,
    moveOverviewCursorBy,
    exitOverview,
    getOverviewCursor: () => overviewCursor,
    toggleOverview,
    downloadDeck,
    toggleSpeakerNotes,
    setActiveSlide,
    getCurrentIndex: () => currentIndex,
    getSlideCount: () => slideElements.length,
    toggleEditDrawer,
    toggleVoiceRecording,
    randomizeTheme,
    openSettingsModal,
    closeSettingsModal,
    toggleKeyboardHelp,
    toggleSlideIndex,
    triggerDeckUpload: () => {
      const uploadInput = document.getElementById('deck-upload');
      if (uploadInput) uploadInput.click();
    },
  };
}
const createdEditDrawer = createDrawer({
  id: 'edit-drawer',
  onOpen: () => {
    setEditDrawerOpen(true);
    // renderEditForm is now called before opening for smooth animation
    const closeBtn = editDrawerInstance.element.querySelector('.edit-drawer__close');
    if (closeBtn && !closeBtn.dataset.listenerAttached) {
      closeBtn.addEventListener('click', () => closeDrawer(editDrawerInstance));
      closeBtn.dataset.listenerAttached = 'true';
    }
  },
  onClose: () => {
    setEditDrawerOpen(false);
  },
});
setEditDrawerInstance(createdEditDrawer);






// Initialize theme drawer on deck init
async function initDeckWithTheme() {
  // Initialize DOM references first
  initDomRefs();
  
  await loadAndApplyTheme();
  await loadAutoLinks();
  syncThemeSelectUI();

  let loadedSlides = null;
  let loadError = null;
  try {
    loadedSlides = await loadSlides();
  } catch (error) {
    loadError = error;
  }

  if (Array.isArray(loadedSlides)) {
    setSlides(loadedSlides);
  } else {
    const finalError = loadError || new Error('Unable to load slides');
    console.error('Failed to load slides', finalError);
    renderLoadError(finalError);
    return;
  }

  try {
    validateSlides(slides);
  } catch (validationError) {
    console.error('Failed to validate slides', validationError);
    renderLoadError(validationError);
    return;
  }

  const renderableSlides = slides.filter(slide => slide.type !== '_schema');
  updateTotalCounter(renderableSlides.length);

  if (!Array.isArray(renderableSlides) || renderableSlides.length === 0) {
    renderEmptyState();
    return;
  }

  const renderedElements = renderableSlides.map((slide, index) =>
    createSlide(slide, index, renderers)
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

  initKeyboardNav(getKeyboardContext());
  initTouchNav({
    setActiveSlide,
    getCurrentIndex: () => currentIndex,
    isOverview: () => isOverview,
    toggleOverview,
  }, slidesRoot);
  slidesRoot.addEventListener('click', handleSlideClick);
  document.addEventListener('click', handleImageModalTrigger);

  const uploadInput = document.getElementById('deck-upload');
  if (uploadInput) {
    uploadInput.addEventListener('change', handleDeckUpload);
  }

  initVoiceButtons({
    openSettingsModal,
    showApiKeyStatus,
    showHudStatus,
    hideHudStatus,
    getCurrentIndex: () => currentIndex,
    getSlides: () => slides,
    insertSlideAt,
    replaceSlideAt,
    setActiveSlide,
    setOverviewCursor,
    updateSlide: (index, slide) => { slides[index] = slide; },
    validateSlides,
  });

  initCheatConsole();

  const homeBtn = document.getElementById('home-btn');
  if (homeBtn) {
    homeBtn.addEventListener('click', () => {
      setActiveSlide(0);
    });
  }

  const helpBtn = document.getElementById('help-btn');
  if (helpBtn) {
    helpBtn.addEventListener('click', openKeyboardHelp);
  }

  const overviewBtn = document.getElementById('overview-btn');
  if (overviewBtn) {
    overviewBtn.addEventListener('click', toggleOverview);
  }

  initHudControls();

  // Initialize deck name display and rename functionality
  initDeckName();

  // Initialize theme drawer
  initThemeDrawer();

  // Show intro modal on first visit
  showIntroModalIfFirstVisit();

  // Show keyboard hints on first visit
  showKeyboardHintsIfFirstVisit();

  // Initialize slide index (jump to any slide with I key)
  initSlideIndex({
    getSlides: () => slides,
    getCurrentIndex: () => currentIndex,
    setActiveSlide,
  });

  // Initialize share modal
initShareModal();
initSharePasswordModal();

  // Initialize speaker notes
  initSpeakerNotes();

  setActiveSlide(0);
  updateOverviewButton();
  setOverviewCursor(currentIndex);
  initBrowserHistory();
  handleInitialIntent();

  // Mark initialization as complete
  isInitializing = false;
  isInitialized = true;

  // Hide loading overlay
  const loadingOverlay = document.getElementById('loading-overlay');
  if (loadingOverlay) {
    loadingOverlay.classList.add('is-loaded');
    setTimeout(() => {
      loadingOverlay.remove();
    }, 1000); // Remove from DOM after transition
  }
}

function handleInitialIntent() {
  const openIntent = getParam('open');
  if (!openIntent) return;

  requestAnimationFrame(() => {
    if (openIntent === 'theme') {
      openThemeDrawer();
    } else if (openIntent === 'settings') {
      openSettingsModal();
    } else if (openIntent === 'edit') {
      openEditDrawer();
    }
  });
}

function initHudControls() {
  const hud = document.querySelector('.hud');
  if (!hud) return;

  const autoHideQuery = window.matchMedia('(max-width: 1024px)');
  const HIDE_DELAY = 2800;
  let hideTimeout = null;
  let lastInteraction = 0;

  const hideHud = () => {
    if (!autoHideQuery.matches) return;
    hud.dataset.hidden = 'true';
  };

  const scheduleHide = () => {
    if (!autoHideQuery.matches) return;
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(hideHud, HIDE_DELAY);
  };

  const revealHud = () => {
    hud.dataset.hidden = 'false';
    if (!autoHideQuery.matches) return;
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(hideHud, HIDE_DELAY);
  };

  const prevBtn = document.getElementById('hud-prev-btn');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      setActiveSlide(currentIndex - 1);
      revealHud();
    });
  }

  const nextBtn = document.getElementById('hud-next-btn');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      setActiveSlide(currentIndex + 1);
      revealHud();
    });
  }

  // Clickable progress bar - jump to slide by clicking position
  const progressEl = document.getElementById('hud-progress');
  if (progressEl) {
    const jumpToProgressPosition = (clientX) => {
      if (!slideElements.length) return;
      const rect = progressEl.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const targetIndex = Math.round(ratio * (slideElements.length - 1));
      setActiveSlide(targetIndex);
      revealHud();
    };

    progressEl.addEventListener('click', (e) => {
      jumpToProgressPosition(e.clientX);
    });

    progressEl.addEventListener('keydown', (event) => {
      if (!slideElements.length) return;

      let targetIndex = currentIndex;
      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowDown':
          targetIndex = currentIndex - 1;
          break;
        case 'ArrowRight':
        case 'ArrowUp':
          targetIndex = currentIndex + 1;
          break;
        case 'PageUp':
          targetIndex = currentIndex - 5;
          break;
        case 'PageDown':
          targetIndex = currentIndex + 5;
          break;
        case 'Home':
          targetIndex = 0;
          break;
        case 'End':
          targetIndex = slideElements.length - 1;
          break;
        default:
          return;
      }

      event.preventDefault();
      setActiveSlide(targetIndex);
      revealHud();
    });
  }

  const handleInteraction = () => {
    if (!autoHideQuery.matches) return;
    const now = Date.now();
    if (now - lastInteraction < 150) return;
    lastInteraction = now;
    revealHud();
  };

  window.addEventListener('wheel', handleInteraction, { passive: true });

  const attachScrollListener = (target) => {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener('scroll', handleInteraction, { passive: true });
  };

  attachScrollListener(window);
  attachScrollListener(document);
  attachScrollListener(slidesRoot);
  window.addEventListener('pointerdown', handleInteraction, { passive: true });
  window.addEventListener('touchstart', handleInteraction, { passive: true });
  window.addEventListener('keydown', handleInteraction);

  const handleAutoHideChange = () => {
    clearTimeout(hideTimeout);
    hud.dataset.hidden = 'false';
    if (autoHideQuery.matches) scheduleHide();
  };
  if (typeof autoHideQuery.addEventListener === 'function') {
    autoHideQuery.addEventListener('change', handleAutoHideChange);
  } else if (typeof autoHideQuery.addListener === 'function') {
    autoHideQuery.addListener(handleAutoHideChange);
  }

  hud.addEventListener('mouseenter', () => {
    if (!autoHideQuery.matches) return;
    hud.dataset.hidden = 'false';
    clearTimeout(hideTimeout);
  });

  hud.addEventListener('mouseleave', scheduleHide);

  // Initial state
  if (autoHideQuery.matches) {
    revealHud();
  } else {
    hud.dataset.hidden = 'false';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BROWSER HISTORY SUPPORT
// ═══════════════════════════════════════════════════════════════════════════
// Push slide changes to browser history so the back button navigates
// between slides instead of leaving the presentation entirely.
// ═══════════════════════════════════════════════════════════════════════════

let historyInitialized = false;

function initBrowserHistory() {
  if (historyInitialized) return;
  historyInitialized = true;

  // Replace current state with slide 0
  window.history.replaceState({ slide: 0 }, '');

  // Listen for popstate (browser back/forward)
  window.addEventListener('popstate', (event) => {
    if (event.state && typeof event.state.slide === 'number') {
      setActiveSlide(event.state.slide);
    }
  });
}

// Called from setActiveSlide hook - pushes new state when slide changes
function pushSlideHistory(index) {
  if (!historyInitialized) return;
  // Only push if different from current history state
  const currentState = window.history.state;
  if (currentState && currentState.slide === index) return;
  window.history.pushState({ slide: index }, '');
}
