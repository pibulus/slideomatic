import {
  loadTheme,
  applyTheme,
  validateTheme,
  saveThemeToLibrary,
  loadThemeLibrary,
  deleteThemeFromLibrary,
  getCurrentTheme,
  setCurrentTheme,
  getCurrentThemePath,
  checkContrast,
  LOCAL_THEME_SOURCE,
  normalizeThemeTokens,
} from './modules/theme-manager.js';
import { formatBytes, clamp, fileToBase64, escapeHtml, safeParse, deriveDeckName, deepClone } from './modules/utils.js';
import { CONFIG, debug } from './modules/constants.js';
import {
  createImage,
  handleGlobalPaste,
  cleanupSlideAssets,
  cleanupAllSlideAssets,
  handleImageModalTrigger,
} from './modules/image-handling.js';
import {
  renderers,
  createSlide,
  renderLoadError,
  renderEmptyState,
  validateSlides,
  attachSlideHomeBadge,
} from './modules/slide-rendering.js';
import { showHudStatus, hideHudStatus } from './modules/hud.js';
import { prepareSlideForEditing, restoreBase64FromTokens } from './modules/base64-tokens.js';
import { registerLazyImage, loadLazyImage } from './lazy-images.js';
import { renderEditForm } from './modules/edit-drawer.js';
import {
  createDrawer,
  openDrawer,
  closeDrawer,
} from './modules/drawer-base.js';
import {
  initVoiceButtons,
  toggleVoiceRecording,
  getGeminiApiKey,
  STORAGE_KEY_API,
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
  closeSlideIndex,
  refreshSlideIndex,
  updateSlideIndexHighlight,
} from './slide-index.js';
import {
  loadSlides,
  persistSlides,
  generateDeckId,
  registerDeckPersistenceHooks,
} from './modules/deck-persistence.js';
import { slidesRoot, currentCounter, totalCounter, progressBar } from './modules/dom-refs.js';
import {
  insertSlideAt,
  removeSlideAt,
  replaceSlideAt,
  downloadDeck,
  handleDeckUpload,
  reloadDeck,
  registerSlideActionHooks,
} from './modules/slide-actions.js';
import {
  initThemeDrawer,
  toggleThemeDrawer,
  openThemeDrawer,
  closeThemeDrawer,
  syncThemeSelectUI,
} from './modules/theme-drawer.js';
import {
  slides,
  setSlides,
  slideElements,
  setSlideElements,
  currentIndex,
  setCurrentIndex,
  isOverview,
  setOverview,
  autoLinkConfigs,
  setAutoLinkConfigs,
  overviewRowCount,
  setOverviewRowCount,
  overviewColumnCount,
  setOverviewColumnCount,
  overviewCursor,
  setOverviewCursor,
  lastOverviewHighlight,
  setLastOverviewHighlight,
  isThemeDrawerOpen,
  setThemeDrawerOpen,
  themeDrawerInstance,
  setThemeDrawerInstance,
  slideScrollPositions,
  DECK_STORAGE_PREFIX,
  LAST_DECK_KEY,
  deckStorageKey,
  setDeckStorageKey,
  deckPersistFailureNotified,
  setDeckPersistFailureNotified,
  activeDeckId,
  setActiveDeckId,
  isNewDeckRequest,
  setNewDeckRequest,
  isEditDrawerOpen,
  setEditDrawerOpen,
  editDrawerInstance,
  setEditDrawerInstance,
} from './modules/state.js';
import {
  registerNavigationHooks,
  toggleOverview,
  enterOverview,
  exitOverview,
  updateOverviewButton,
  updateOverviewLayout,
  highlightOverviewSlide,
  moveOverviewCursorBy,
  handleResize,
  setActiveSlide,
  updateTotalCounter,
  updateHud,
  handleSlideClick,
} from './modules/navigation.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

// Moved to modules/constants.js

// Backward compatibility - keep original constants for now
const DEBUG = CONFIG.DEBUG;
const MAX_IMAGE_BYTES = CONFIG.IMAGE.MAX_BYTES;
const TARGET_IMAGE_BYTES = CONFIG.IMAGE.TARGET_BYTES;
const IMAGE_SETTLE_WINDOW_MS = CONFIG.IMAGE.SETTLE_WINDOW_MS;
// assetDeletionQueue and assetCleanupTimer are now in image-handling.js


// ═══════════════════════════════════════════════════════════════════════════
// DOM REFERENCES
// ═══════════════════════════════════════════════════════════════════════════

const urlParams = new URLSearchParams(window.location.search);
// Also check hash params (for servers that strip query strings)
const hashParams = new URLSearchParams(window.location.hash.slice(1));

// Helper to get param from search OR hash
function getParam(name) {
  return urlParams.get(name) || hashParams.get(name);
}

const requestedDeck = getParam('deck');
console.log('[Init] ==================== DECK.HTML LOADING ====================');
console.log('[Init] Full URL:', window.location.href);
console.log('[Init] Search params:', window.location.search);
console.log('[Init] Hash:', window.location.hash);
console.log('[Init] Requested deck (from search):', urlParams.get('deck'));
console.log('[Init] Requested deck (from hash):', hashParams.get('deck'));
console.log('[Init] Final requested deck:', requestedDeck);
console.log('[Init] =========================================================');

// renderers imported from slide-rendering.js

registerDeckPersistenceHooks({
  getParam,
  showHudStatus,
  hideHudStatus,
  showSaveStatus,
  updateDeckNameDisplay,
  getSlideTemplate,
  applySharedTheme: applySharedThemeFromShare,
});

registerNavigationHooks({
  closeThemeDrawer,
  getEditDrawerContext,
  renderEditForm,
  toggleSpeakerNotes,
});

registerSlideActionHooks({
  showHudStatus,
  hideHudStatus,
  createSlide: (slide, index) => createSlide(slide, index, renderers),
  renderEmptyState,
  cleanupSlideAssets,
  cleanupAllSlideAssets,
});

function applySharedThemeFromShare(themeData) {
  if (!themeData || typeof themeData !== 'object') return;
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
  if (assetDeletionQueue.size) {
    flushAssetDeletions(true);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

if (requestedDeck) {
  if (requestedDeck === 'new') {
    setNewDeckRequest(true);
    setActiveDeckId(generateDeckId());
    setDeckStorageKey(null); // Clear cache so getDeckStorageKey() rebuilds with new ID
    console.log('[Init] New deck request, generated ID:', activeDeckId);
    urlParams.set('deck', activeDeckId);
    const nextSearch = urlParams.toString();
    const nextUrl = `${window.location.pathname}?${nextSearch}${window.location.hash ?? ''}`;
    if (window.history && typeof window.history.replaceState === 'function') {
      window.history.replaceState({}, '', nextUrl);
    }
  } else {
    setActiveDeckId(requestedDeck);
    setDeckStorageKey(null); // Clear cache so getDeckStorageKey() rebuilds with deck ID
    console.log('[Init] Loading existing deck, ID:', activeDeckId);
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
  console.log('[Init] Starting initDeckWithTheme - FIRST TIME');
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
  const themeParam = getParam("theme");
  if (!themeParam) return "theme.json";
  if (themeParam.endsWith(".json")) {
    return themeParam;
  }
  if (themeParam.includes("/")) {
    return `${themeParam}.json`;
  }
  return `themes/${themeParam}.json`;
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
    } catch (error) {
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

  document.title = `${name} — Slide-o-Matic`;
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

function initSaveStatus() {
  // Save status is updated by showSaveStatus() function
}

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
    const response = await fetch("autolinks.json", { cache: "no-store" });
    if (!response.ok) return;
    const links = await response.json();
    if (!Array.isArray(links)) return;
    autoLinkConfigs = links
      .filter((link) => Boolean(link?.term))
      .map((link) => ({
        term: link.term,
        search: link.search,
        url: link.url,
        urlTemplate: link.urlTemplate,
        openInNewTab: link.openInNewTab !== false,
        regex: new RegExp(escapeRegExp(link.term), "gi"),
      }));
  } catch (error) {
    console.warn("Unable to load autolinks.json", error);
    autoLinkConfigs = [];
  }
}

// Slide rendering logic moved to modules/slide-rendering.js

// attachSlideHomeBadge moved to modules/slide-rendering.js

// Image modal logic moved to modules/image-handling.js */

// Helpers moved to modules/slide-rendering.js

// Rich content rendering moved to modules/slide-rendering.js

// ===================================================================
// DECK IMPORT/EXPORT
// ===================================================================



function toggleEditDrawer() {
  if (!editDrawerInstance) return;
  if (editDrawerInstance.isOpen) {
    closeDrawer(editDrawerInstance);
  } else {
    openEditDrawer();
  }
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

function closeEditDrawer() {
  if (!editDrawerInstance) return;
  closeDrawer(editDrawerInstance);
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
    toggleThemeDrawer,
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






function getSlideTemplate(type) {
  const templates = {
    title: {
      type: 'title',
      eyebrow: 'New Section',
      title: 'Title Goes Here',
      subtitle: 'Optional subtitle copy',
      media: [],
      font: 'grotesk'
    },
    standard: {
      type: 'standard',
      badge: 'Slide',
      headline: 'Headline Goes Here',
      body: ['First talking point', 'Second talking point'],
      font: 'sans'
    },
    quote: {
      type: 'quote',
      quote: '"Add your quote here."',
      attribution: 'Attribution Name',
      font: 'sans'
    },
    split: {
      type: 'split',
      left: {
        headline: 'Left Column',
        body: ['Left column bullet']
      },
      right: {
        headline: 'Right Column',
        body: ['Right column bullet']
      },
      font: 'sans'
    },
    grid: {
      type: 'grid',
      headline: 'Grid Headline',
      body: ['Introduce the items in this grid.'],
      items: [
        {
          image: { src: '', alt: 'Image description' },
          label: 'Item label'
        },
        {
          image: { src: '', alt: 'Image description' },
          label: 'Item label'
        }
      ],
      font: 'sans'
    },
    pillars: {
      type: 'pillars',
      headline: 'Pillars Headline',
      body: ['Introduce the pillars.'],
      pillars: [
        {
          title: 'Pillar One',
          copy: ['Supporting detail for pillar one']
        },
        {
          title: 'Pillar Two',
          copy: ['Supporting detail for pillar two']
        }
      ],
      font: 'sans'
    },
    gallery: {
      type: 'gallery',
      headline: 'Gallery Headline',
      body: 'Describe the collection showcased here.',
      items: [
        {
          image: { src: '', alt: 'Image description' },
          label: 'Item label',
          copy: 'Optional supporting copy.'
        },
        {
          image: { src: '', alt: 'Image description' },
          label: 'Item label',
          copy: 'Optional supporting copy.'
        }
      ],
      font: 'sans'
    },
    image: {
      type: 'image',
      badge: 'Slide',
      headline: 'Image Slide Headline',
      image: { src: '', alt: 'Describe the image' },
      caption: 'Optional caption text.',
      font: 'sans'
    },
    typeface: {
      type: 'typeface',
      headline: 'Typeface Showcase',
      fonts: [
        {
          name: 'Display',
          font: '"Space Grotesk", sans-serif',
          sample: 'The quick brown fox jumps over the lazy dog.'
        },
        {
          name: 'Body',
          font: '"Inter", sans-serif',
          sample: 'Use this space to demonstrate body copy.'
        }
      ],
      body: ['Describe how these typefaces support the system.'],
      font: 'sans'
    }
  };

  const template = templates[type];
  if (!template) return null;
  return deepClone(template);
}


function downloadTheme(themeData) {
  const json = JSON.stringify(themeData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'theme.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  console.log('✓ Theme downloaded as theme.json');
}

// ===================================================================
// SETTINGS MODAL
// ===================================================================

// ═══════════════════════════════════════════════════════════════════════════
// KEYBOARD HELP MODAL
// ═══════════════════════════════════════════════════════════════════════════

function toggleKeyboardHelp() {
  const modal = document.getElementById('hints-modal');
  if (!modal) return;

  const isOpen = modal.getAttribute('aria-hidden') === 'false';
  if (isOpen) {
    closeKeyboardHelp();
  } else {

    openKeyboardHelp();
  }
}

function openKeyboardHelp() {
  const modal = document.getElementById('hints-modal');
  if (!modal) return;

  modal.setAttribute('aria-hidden', 'false');

  // Set up listeners if not already done
  setupKeyboardHelpListeners();
}

function closeKeyboardHelp() {
  const modal = document.getElementById('hints-modal');
  if (!modal) return;

  modal.setAttribute('aria-hidden', 'true');
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

// ═══════════════════════════════════════════════════════════════════════════
// SPEAKER NOTES
// ═══════════════════════════════════════════════════════════════════════════

function toggleSpeakerNotes() {
  const modal = document.getElementById('notes-modal');
  if (!modal) return;

  const isOpen = modal.classList.contains('is-open');

  if (isOpen) {
    modal.classList.remove('is-open');
  } else {
    // Update notes content for current slide
    const currentSlide = slides[currentIndex];
    const slideTitle = document.getElementById('notes-slide-title');
    const notesText = document.getElementById('notes-text');

    if (slideTitle) {
      slideTitle.textContent = `Slide ${currentIndex + 1} of ${slides.length}`;
    }

    if (notesText) {
      const notes = currentSlide?.notes || currentSlide?.speaker_notes;
      if (notes) {
        notesText.textContent = notes;
      } else {
        notesText.textContent = 'No speaker notes for this slide.';
      }
    }

    modal.classList.add('is-open');
  }
}

// Setup notes modal close handlers
const notesModal = document.getElementById('notes-modal');
if (notesModal) {
  const closeBtn = notesModal.querySelector('.notes-modal__close');
  const backdrop = notesModal.querySelector('.notes-modal__backdrop');

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      notesModal.classList.remove('is-open');
    });
  }

  if (backdrop) {
    backdrop.addEventListener('click', () => {
      notesModal.classList.remove('is-open');
    });
  }

  // Close on Escape
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && notesModal.classList.contains('is-open')) {
      notesModal.classList.remove('is-open');
    }
  });
}


// ================================================================
// Theme Drawer UI & Management
// ================================================================

// ═══════════════════════════════════════════════════════════════════════════
// Theme Generation - Palette Variants
// ═══════════════════════════════════════════════════════════════════════════

// Initialize theme drawer on deck init
async function initDeckWithTheme() {
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
    const finalError = loadError || new Error("Unable to load slides");
    console.error("Failed to load slides", finalError);
    renderLoadError(finalError);
    return;
  }

  try {
    validateSlides(slides);
  } catch (validationError) {
    console.error("Failed to validate slides", validationError);
    renderLoadError(validationError);
    return;
  }

  const renderableSlides = slides.filter(slide => slide.type !== "_schema");
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
    slide.style.visibility = "hidden";
    slide.style.pointerEvents = "none";
    fragment.appendChild(slide);
  });
  slidesRoot.appendChild(fragment);
  updateOverviewLayout();

  initKeyboardNav(getKeyboardContext());
  slidesRoot.addEventListener("click", handleSlideClick);
  document.addEventListener("click", handleImageModalTrigger);
  document.addEventListener("paste", handleGlobalPaste);

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
    downloadTheme,
  });

  const homeBtn = document.getElementById('home-btn');
  if (homeBtn) {
    homeBtn.addEventListener('click', () => {
      window.location.href = 'index.html';
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

  // Initialize deck name display and rename functionality
  initDeckName();

  // Initialize theme drawer
  initThemeDrawer();

  // Show intro modal on first visit
  showIntroModalIfFirstVisit();

  // Show keyboard hints on first visit
  showKeyboardHintsIfFirstVisit();

  // Initialize share modal
  initShareModal();

  setActiveSlide(0);
  updateOverviewButton();
  setOverviewCursor(currentIndex);
  handleInitialIntent();

  // Mark initialization as complete
  isInitializing = false;
  isInitialized = true;
  console.log('[Init] initDeckWithTheme completed');
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

// ================================================================
// Intro Modal (First Visit)
// ================================================================

function showIntroModalIfFirstVisit() {
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

function showKeyboardHintsIfFirstVisit() {
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
      hintsModal.setAttribute('aria-hidden', 'false');
    }, 1000);

    const closeHints = () => {
      hintsModal.setAttribute('aria-hidden', 'true');
      localStorage.setItem(HINTS_SEEN_KEY, 'true');
    };

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

// ================================================================
// Share Modal & Functionality
// ================================================================

function initShareModal() {
  const shareBtn = document.getElementById('share-deck-btn');
  const shareModal = document.getElementById('share-modal');
  const closeBtn = document.getElementById('share-modal-close');
  const backdrop = shareModal?.querySelector('.share-modal__backdrop');
  const copyBtn = document.getElementById('share-copy-btn');
  const urlInput = document.getElementById('share-url-input');
  const qrContainer = document.getElementById('share-qr-code');
  const statusDiv = document.getElementById('share-status');

  if (!shareBtn || !shareModal) return;

  shareBtn.addEventListener('click', async () => {
    await openShareModal();
  });

  closeBtn?.addEventListener('click', closeShareModal);
  backdrop?.addEventListener('click', closeShareModal);

  copyBtn?.addEventListener('click', () => {
    if (urlInput?.value) {
      navigator.clipboard.writeText(urlInput.value).then(() => {
        showShareStatus('✓ Link copied to clipboard!', 'success');
        setTimeout(() => hideShareStatus(), 2000);
      }).catch(() => {
        showShareStatus('⚠️ Failed to copy. Try selecting and copying manually.', 'error');
      });
    }
  });

  function showShareStatus(message, type) {
    if (!statusDiv) return;
    statusDiv.textContent = message;
    statusDiv.className = `share-modal__status is-visible is-${type}`;
  }

  function hideShareStatus() {
    if (!statusDiv) return;
    statusDiv.className = 'share-modal__status';
  }

  async function openShareModal() {
    shareModal.classList.add('is-open');
    shareModal.setAttribute('aria-hidden', 'false');

    // Reset state
    if (urlInput) urlInput.value = '';
    if (qrContainer) qrContainer.innerHTML = '';
    showShareStatus('🔗 Generating share link...', 'loading');

    try {
      const shareUrl = await generateShareUrl();
      if (urlInput) urlInput.value = shareUrl;
      generateQRCode(shareUrl);
      showShareStatus('✓ Ready to share!', 'success');
      setTimeout(() => hideShareStatus(), 3000);
    } catch (error) {
      console.error('Share failed:', error);
      showShareStatus(`❌ ${error.message}`, 'error');
    }
  }

  function closeShareModal() {
    shareModal.classList.remove('is-open');
    shareModal.setAttribute('aria-hidden', 'true');
    hideShareStatus();
  }

  async function generateShareUrl() {
    const deckPayload = {
      version: 1,
      slides,
      theme: getCurrentTheme(),
      meta: {
        title: deriveDeckName(slides),
        createdAt: Date.now(),
      },
    };

    let response;
    try {
      response = await fetch('/.netlify/functions/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(deckPayload),
      });
    } catch (networkError) {
      throw new Error('Share service unavailable. Use `netlify dev` locally or the deployed site.');
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      // Ignore JSON parse failure; handled below
    }

    if (!response.ok) {
      const message = payload?.error || 'Unable to create share link';
      throw new Error(message);
    }

    if (!payload?.shareUrl && !payload?.id) {
      throw new Error('Share link response missing id');
    }

    return payload.shareUrl || buildShareUrlFromId(payload.id);
  }

  function buildShareUrlFromId(id) {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('share', id);
    return url.toString();
  }

  function generateQRCode(url) {
    if (!qrContainer) return;
    if (typeof QRCodeStyling === 'undefined') {
      qrContainer.innerHTML = '<p style="color: #666;">QR code unavailable</p>';
      return;
    }

    qrContainer.innerHTML = '';

    // Get colors from current theme, or use default pastel gradient
    const themeColors = getThemeColorsForQR();

    // QR code styling matching your QR buddy's approach!
    const qrCode = new QRCodeStyling({
      width: 400,
      height: 400,
      margin: 20,
      type: "canvas",
      data: url,
      qrOptions: {
        typeNumber: 0,
        mode: "Byte",
        errorCorrectionLevel: "Q" // 25% recovery - perfect for styled codes
      },
      dotsOptions: {
        type: "rounded", // Better for gradients + scans
        gradient: {
          type: "linear",
          rotation: 0.785, // 45deg
          colorStops: [
            { offset: 0, color: themeColors[0] },
            { offset: 0.5, color: themeColors[1] },
            { offset: 1, color: themeColors[2] }
          ]
        }
      },
      backgroundOptions: {
        color: themeColors[3] // Background color
      },
      cornersSquareOptions: {
        type: "extra-rounded",
        gradient: {
          type: "linear",
          rotation: 0.785,
          colorStops: [
            { offset: 0, color: themeColors[0] },
            { offset: 0.5, color: themeColors[1] },
            { offset: 1, color: themeColors[2] }
          ]
        }
      },
      cornersDotOptions: {
        type: "dot",
        gradient: {
          type: "linear",
          rotation: 0.785,
          colorStops: [
            { offset: 0, color: themeColors[0] },
            { offset: 0.5, color: themeColors[1] },
            { offset: 1, color: themeColors[2] }
          ]
        }
      }
    });

    qrCode.append(qrContainer);
  }

  function getThemeColorsForQR() {
    // Try to get colors from current theme
    const currentTheme = getCurrentTheme();

    if (currentTheme && currentTheme.palette) {
      const palette = currentTheme.palette;

      // Extract 3-4 vibrant colors from theme
      const colors = [];

      // Look for accent/primary colors first
      if (palette.accent) colors.push(palette.accent);
      if (palette.primary) colors.push(palette.primary);
      if (palette.secondary) colors.push(palette.secondary);

      // Fill in with other theme colors if needed
      if (colors.length < 3 && palette.text) colors.push(palette.text);
      if (colors.length < 3 && palette.background) {
        // Use background but lightened
        colors.push(lightenColor(palette.background, 0.3));
      }

      // Pad with defaults if theme doesn't have enough colors
      while (colors.length < 3) {
        colors.push('#FF73C8', '#9CCAFF', '#FFE26F');
      }

      // Background color (use theme bg or white)
      const bgColor = palette.background || '#FFFFFF';

      return [colors[0], colors[1], colors[2], bgColor];
    }

    // Default pastel gradient (matching your aesthetic)
    return [
      '#FF73C8', // Pink
      '#9CCAFF', // Blue
      '#FFE26F', // Yellow
      '#FFFFFF'  // White bg
    ];
  }

  function lightenColor(color, amount) {
    // Simple color lightener
    const num = parseInt(color.replace('#', ''), 16);
    const r = Math.min(255, ((num >> 16) & 0xFF) + Math.floor(255 * amount));
    const g = Math.min(255, ((num >> 8) & 0xFF) + Math.floor(255 * amount));
    const b = Math.min(255, (num & 0xFF) + Math.floor(255 * amount));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }
}
