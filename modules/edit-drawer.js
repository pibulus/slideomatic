// ═══════════════════════════════════════════════════════════════════════════
// Edit Drawer Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Houses the edit drawer UI and slide editing helpers.
// - Renders the quick-edit form and JSON editor
// - Synchronizes quick edits with slide JSON
// - Saves and duplicates slides, delegating to shared modules
//
// Dependencies: drawer-base.js, image-manager.js, base64-tokens.js, utils.js
// Used by: main.js
//
// ═══════════════════════════════════════════════════════════════════════════

import { fileToBase64 } from './utils.js';
import {
  prepareSlideForEditing,
  restoreBase64FromTokens,
} from './base64-tokens.js';
import {
  collectSlideImages,
  setupImageRemoveButtons,
  setupImageReplaceButtons,
  setupImageMoveButtons,
  setupImageSearchButtons,
  setupImageDragReorder,
  removeImageByIndex,
  reorderSlideImages,
  addImageToSlide,
  updateImageAltText,
} from './slide-image-ui.js';
import { updateSlideImageByIndex } from './image-utils.js';
import { openImageSearch } from './image-search-ui.js';
import { setupAccordion } from './accordion.js';
import { setupCustomSelect } from './custom-select.js';
import {
  loadThemeLibrary,
  applyTheme,
  setCurrentTheme,
  getCurrentTheme,
  saveThemeToLibrary,
} from './theme-manager.js';
import {
  randomizeTheme,
  syncThemeSelectUI,
  populateThemeDropdown,
} from './theme-drawer.js';
import { persistSlides } from './deck-persistence.js';
import { exportDeckToPdf } from './pdf-export.js';
import { CONFIG, debug } from './constants.js';
import {
  getLayoutMeta,
  buildMainSections,
  buildActionsSection,
  buildAdvancedSection,
} from './edit-drawer-forms.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const AUTO_SAVE_DELAY_MS = CONFIG.AUTO_SAVE_DELAY_MS;

// ═══════════════════════════════════════════════════════════════════════════
// MODULE STATE - Event Listener Tracking
// ═══════════════════════════════════════════════════════════════════════════

let activeFormListeners = [];
let autoSaveTimeout = null;
let moduleImagePicker = null; // Reused across edit drawer renders to prevent DOM leak
let drawerDictationSession = null;

/**
 * Clean up all event listeners before re-rendering form
 * Prevents memory leaks from accumulated listeners
 */
function cleanupFormListeners() {
  stopDrawerDictation();
  activeFormListeners.forEach(({ element, event, handler, options }) => {
    element?.removeEventListener(event, handler, options);
  });
  activeFormListeners = [];

  if (autoSaveTimeout) {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = null;
  }
}

/**
 * Called when the drawer closes: flush any pending debounced autosave now
 * (while the form + current index still match the edited slide) instead of
 * letting the timer fire later against whatever slide is then current, then
 * drop listeners and stop dictation.
 */
export function flushPendingEditDrawerWork(context) {
  if (autoSaveTimeout) {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = null;
    try {
      autoSaveSlide(context);
    } catch (error) {
      console.warn('Failed to flush pending edit on drawer close:', error);
    }
  }
  cleanupFormListeners();
}

/**
 * Register an event listener for cleanup tracking
 */
function addTrackedListener(element, event, handler, options) {
  if (!element) return;
  element.addEventListener(event, handler, options);
  activeFormListeners.push({ element, event, handler, options });
}

// ═══════════════════════════════════════════════════════════════════════════

function ensureContext(context) {
  if (!context) {
    throw new Error('Edit drawer context missing');
  }
  const required = [
    'getSlides',
    'getCurrentIndex',
    'updateSlide',
    'replaceSlideAt',
    'insertSlideAt',
    'deleteSlideAt',
    'downloadDeck',
    'getSlideTemplate',
    'showHudStatus',
    'hideHudStatus',
    'closeDrawer',
  ];
  required.forEach((key) => {
    if (typeof context[key] !== 'function') {
      throw new Error(`Edit drawer context is missing required function "${key}"`);
    }
  });

  return context;
}

function applyLayoutToCurrentSlide(ctx, layout, variant) {
  const template = ctx.getSlideTemplate(layout);
  if (!template) {
    ctx.showHudStatus(`🧩 No template for "${layout}" yet`, 'info');
    setTimeout(() => ctx.hideHudStatus(), 2000);
    return;
  }

  // Flush any in-progress quick-edit typing before switching layout
  syncQuickEditToJSON(ctx);
  const textarea = document.getElementById('slide-json-editor');
  let latestSlide = null;
  if (textarea instanceof HTMLTextAreaElement) {
    try {
      const parsed = JSON.parse(textarea.value);
      const orig = ctx.getSlides()[ctx.getCurrentIndex()];
      if (orig) latestSlide = restoreBase64FromTokens(parsed, orig);
    } catch {
      // Fall back to current slide in state
    }
  }

  const slides = ctx.getSlides();
  const currentIndex = ctx.getCurrentIndex();
  const currentSlide = latestSlide || slides[currentIndex];
  if (!currentSlide) return;

  const mergedSlide = mergeSlideWithTemplate(template, currentSlide);

  // Apply variant if present and type matches
  if (layout === 'standard' && variant) {
    mergedSlide.layout = variant;
    delete mergedSlide.variant;
  } else if ((layout === 'split' || layout === 'quote') && variant) {
    mergedSlide.variant = variant;
    delete mergedSlide.layout;
  } else {
    delete mergedSlide.layout;
    if (layout !== 'split' && layout !== 'quote') delete mergedSlide.variant;
  }

  ctx.updateSlide(currentIndex, mergedSlide);
  ctx.replaceSlideAt(currentIndex);
  renderEditForm(ctx);

  const label = getLayoutMeta(layout)?.label || layout;
  ctx.showHudStatus(`✓ Switched to ${label}`, 'success');
  setTimeout(() => ctx.hideHudStatus(), 1600);
}

function applyVariantToCurrentSlide(ctx, variant) {
  syncQuickEditToJSON(ctx);
  const slides = ctx.getSlides();
  const currentIndex = ctx.getCurrentIndex();
  const currentSlide = slides[currentIndex];
  if (!currentSlide) return;

  const updatedSlide = JSON.parse(JSON.stringify(currentSlide));
  const type = updatedSlide.type || 'standard';
  if (type === 'standard') {
    if (!variant || variant === 'default') {
      delete updatedSlide.layout;
    } else {
      updatedSlide.layout = variant;
    }
  } else if (type === 'split' || type === 'quote') {
    if (!variant || variant === 'default' || variant === 'simple') {
      delete updatedSlide.variant;
    } else {
      updatedSlide.variant = variant;
    }
  }

  ctx.updateSlide(currentIndex, updatedSlide);
  ctx.replaceSlideAt(currentIndex);
  renderEditForm(ctx);
  ctx.showHudStatus('✓ Layout updated', 'success');
  setTimeout(() => ctx.hideHudStatus(), 1400);
}

/**
 * Set up quick-edit field synchronization using event delegation
 * This prevents listener accumulation by using a single delegated handler
 */
function setupQuickEditSync(context) {
  const content = document.getElementById('edit-drawer-content');
  if (!content) return;

  // Use event delegation on the container instead of individual inputs
  const handleInput = (event) => {
    const input = event.target;
    if (!(input instanceof Element) || !input.matches('[data-field]')) return;

    syncQuickEditToJSON(context);

    // Check if auto-save is enabled
    const autoSaveToggle = document.getElementById('autosave-toggle');
    const isAutoSaveEnabled = (autoSaveToggle instanceof HTMLInputElement) ? autoSaveToggle.checked : true;

    if (isAutoSaveEnabled) {
      // Auto-save after idle typing
      clearTimeout(autoSaveTimeout);
      autoSaveTimeout = setTimeout(() => {
        autoSaveSlide(context);
      }, AUTO_SAVE_DELAY_MS);
    }
  };

  addTrackedListener(content, 'input', handleInput);
}

let jsonSyncBroken = false;

function syncQuickEditToJSON(context) {
  const textarea = document.getElementById('slide-json-editor');
  if (!(textarea instanceof HTMLTextAreaElement)) return true;

  try {
    const slide = JSON.parse(textarea.value);
    const inputs = document.querySelectorAll('[data-field]');

    inputs.forEach((input) => {
      if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) return;
      
      const field = input.dataset.field;
      if (!field) return;

      let rawValue = input.value;
      let finalValue = rawValue;

      if (field.endsWith('.body') || field === 'body') {
        if (rawValue.includes('\n')) {
          const lines = rawValue
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
          // @ts-ignore - Reassigning to array is intentional here
          // Empty array (not '') so an all-whitespace paste empties the
          // field instead of deleting it and collapsing the drawer layout
          finalValue = lines.length ? lines : [];
        }
      }

      // Handle nested fields (e.g., 'left.headline', 'pillars.0.title', 'items.0.label')
      if (field.includes('.')) {
        const parts = field.split('.');
        if (parts.length === 3 && (parts[0] === 'pillars' || parts[0] === 'items')) {
          const arrName = parts[0];
          const idx = Number.parseInt(parts[1], 10);
          const prop = parts[2];
          if (Array.isArray(slide[arrName]) && slide[arrName][idx]) {
            if (prop === 'copy' && Array.isArray(slide[arrName][idx].copy) && typeof finalValue === 'string') {
              const lines = finalValue.split('\n').map((l) => l.trim()).filter(Boolean);
              slide[arrName][idx].copy = lines.length ? lines : [''];
            } else if (finalValue === '' || finalValue == null) {
              delete slide[arrName][idx][prop];
            } else {
              slide[arrName][idx][prop] = finalValue;
            }
          }
        } else {
          const [parent, child] = parts;
          if (!slide[parent]) slide[parent] = {};

          if (finalValue === '' || finalValue == null) {
            delete slide[parent][child];
          } else {
            slide[parent][child] = finalValue;
          }
        }
      } else {
        // Handle top-level fields
        if (finalValue === '' || finalValue == null) {
          delete slide[field];
        } else {
          // @ts-ignore - Body can be an array
          slide[field] = finalValue;
        }
      }
    });

    textarea.value = JSON.stringify(slide, null, 2);

    if (jsonSyncBroken) {
      jsonSyncBroken = false;
      textarea.classList.remove('edit-drawer__textarea--needs-fix');
      if (context) {
        const ctx = ensureContext(context);
        ctx.showHudStatus('✓ Back in sync', 'success');
        setTimeout(() => ctx.hideHudStatus(), 1200);
      }
    }
    return true;
  } catch {
    console.warn('Cannot sync quick-edit: invalid JSON');
    if (!jsonSyncBroken) {
      jsonSyncBroken = true;
      textarea.classList.add('edit-drawer__textarea--needs-fix');
      if (context) {
        const ctx = ensureContext(context);
        ctx.showHudStatus('🧩 The JSON below needs a tweak — your edits are waiting', 'info');
        setTimeout(() => ctx.hideHudStatus(), 2500);
      }
    }
    return false;
  }
}

function autoSaveSlide(context) {
  const ctx = ensureContext(context);
  syncQuickEditToJSON(context);

  const textarea = document.getElementById('slide-json-editor');
  if (!(textarea instanceof HTMLTextAreaElement)) return;

  try {
    const editedSlide = JSON.parse(textarea.value);
    const slides = ctx.getSlides();
    const currentIndex = ctx.getCurrentIndex();
    const originalSlide = slides[currentIndex];

    if (!originalSlide) return;

    const restoredSlide = restoreBase64FromTokens(editedSlide, originalSlide);
    ctx.updateSlide(currentIndex, restoredSlide);
    ctx.replaceSlideAt(currentIndex);

    // Show subtle "Saved ✓" indicator
    showAutoSaveStatus(ctx);
  } catch (error) {
    console.warn('Auto-save failed:', error);
    ctx.showHudStatus('💾 Not saved yet — fix the JSON below and it\'ll catch up', 'info');
    setTimeout(() => ctx.hideHudStatus(), 2500);
  }
}

/**
 * @param {object} context
 */
function showAutoSaveStatus(context) {
  const ctx = ensureContext(context);
  ctx.showHudStatus('✓ Saved', 'success');
  setTimeout(() => ctx.hideHudStatus(), 800);
}

function getSelectedLayoutValue() {
  const select = document.getElementById('slide-layout-select-wrapper');
  if (select) {
    return select.dataset.value || '';
  }
  return '';
}

// updateLayoutSelectTooltip removed - now handled by custom select component

/**
 * @param {object} context
 */
function handleLayoutAdd(context) {
  const layout = getSelectedLayoutValue();
  const ctx = ensureContext(context);
  if (!layout) {
    ctx.showHudStatus('Select a slide type first', 'warning');
    setTimeout(() => ctx.hideHudStatus(), 1500);
    return;
  }
  addNewSlideWithLayout(ctx, layout);
}

/**
 * @param {object} ctx
 * @param {string} layout
 */
function addNewSlideWithLayout(ctx, layout) {
  const template = ctx.getSlideTemplate(layout);
  if (!template) {
    ctx.showHudStatus(`🧩 No template for "${layout}" yet`, 'info');
    setTimeout(() => ctx.hideHudStatus(), 2000);
    return;
  }

  const currentIndex = ctx.getCurrentIndex();
  const newIndex = currentIndex + 1;

  // Create new slide from template
  const newSlide = JSON.parse(JSON.stringify(template));

  ctx.insertSlideAt(newIndex, newSlide, { activate: true });

  const label = getLayoutMeta(layout)?.label || layout;
  ctx.showHudStatus(`✨ New ${label} slide added`, 'success');
  setTimeout(() => ctx.hideHudStatus(), 1600);
}

const PRESERVED_FIELDS = [
  'headline',
  'body',
  'eyebrow',
  'badge',
  'title',
  'subtitle',
  'quote',
  'attribution',
  'notes',
  'speaker_notes',
  'cta',
  'description',
];

/**
 * @param {object} template
 * @param {object} currentSlide
 */
function mergeSlideWithTemplate(template, currentSlide) {
  const merged = JSON.parse(JSON.stringify(template));
  const targetType = merged.type || 'standard';

  // Preserve matching fields that exist on currentSlide and are non-empty
  PRESERVED_FIELDS.forEach((key) => {
    const val = currentSlide[key];
    const hasVal = Array.isArray(val) ? val.length > 0 : (val !== undefined && val !== null && val !== '');
    if (hasVal && Object.prototype.hasOwnProperty.call(merged, key)) {
      merged[key] = JSON.parse(JSON.stringify(val));
    }
  });

  // Cross-map primary heading across title / quote / standard-family slides
  const existingHeading = currentSlide.headline || currentSlide.title || currentSlide.quote;
  if (existingHeading) {
    if (targetType === 'title' && !currentSlide.title) {
      merged.title = existingHeading;
    } else if (targetType === 'quote' && !currentSlide.quote) {
      merged.quote = existingHeading;
    } else if (Object.prototype.hasOwnProperty.call(merged, 'headline') && !currentSlide.headline) {
      merged.headline = existingHeading;
    }
  }

  // Cross-map subtitle <-> attribution
  const existingSub = currentSlide.subtitle || currentSlide.attribution;
  if (existingSub) {
    if (targetType === 'quote' && !currentSlide.attribution) {
      merged.attribution = existingSub;
    } else if (Object.prototype.hasOwnProperty.call(merged, 'subtitle') && !currentSlide.subtitle) {
      merged.subtitle = existingSub;
    }
  }

  // Preserve single image if switching between single-image slide types
  if (currentSlide.image?.src && (targetType === 'standard' || targetType === 'image' || targetType === 'quote')) {
    merged.image = JSON.parse(JSON.stringify(currentSlide.image));
  }

  // Always preserve notes and badge/eyebrow if present
  if (currentSlide.notes) merged.notes = currentSlide.notes;
  if (currentSlide.speaker_notes) merged.speaker_notes = currentSlide.speaker_notes;
  if (currentSlide.badge && targetType !== 'title') merged.badge = currentSlide.badge;

  return merged;
}

/**
 * @param {object} context
 */
async function handleDownloadPdf(context) {
  const ctx = ensureContext(context);
  const downloadBtn = document.getElementById('download-pdf-btn');
  const deckNameInput = document.getElementById('deck-name-text') || document.getElementById('deck-name');
  const deckName = (deckNameInput?.value || deckNameInput?.textContent || 'slideomatic').trim();

  try {
    if (downloadBtn) downloadBtn.disabled = true;
    ctx.showHudStatus('📄 Rendering PDF…', 'info');
    const result = await exportDeckToPdf(deckName);
    if (result?.failedSlides?.length) {
      ctx.showHudStatus(
        `⚠️ PDF ready — ${result.rendered}/${result.total} slides (skipped ${result.failedSlides.join(', ')})`,
        'warning'
      );
    } else {
      ctx.showHudStatus('✅ PDF ready', 'success');
    }
  } catch (error) {
    console.error('PDF export failed:', error);
    ctx.showHudStatus('📄 PDF export hiccup. Give it another go', 'error');
  } finally {
    if (downloadBtn) downloadBtn.disabled = false;
    setTimeout(() => ctx.hideHudStatus(), 2000);
  }
}

/**
 * @param {object} context
 * @param {number} imageIndex
 */
function handleImageRemove(context, imageIndex) {
  const ctx = ensureContext(context);
  const slides = ctx.getSlides();
  const currentIndex = ctx.getCurrentIndex();
  const currentSlide = slides[currentIndex];
  if (!currentSlide) return;

  const updatedSlide = removeImageByIndex(imageIndex, currentSlide);
  ctx.updateSlide(currentIndex, updatedSlide);
  ctx.replaceSlideAt(currentIndex);
  renderEditForm(ctx);
  ctx.showHudStatus('🗑️ Image removed', 'success');
  setTimeout(() => ctx.hideHudStatus(), 1600);
  debug('Image removed from slide');
}

/**
 * @param {object} context
 * @param {number} fromIndex
 * @param {number} toIndex
 */
function handleImageReorder(context, fromIndex, toIndex) {
  const ctx = ensureContext(context);
  const slides = ctx.getSlides();
  const currentIndex = ctx.getCurrentIndex();
  const currentSlide = slides[currentIndex];
  if (!currentSlide) return;

  const updatedSlide = reorderSlideImages(fromIndex, toIndex, currentSlide);
  ctx.updateSlide(currentIndex, updatedSlide);
  renderEditForm(ctx);
  ctx.showHudStatus('↕️ Images reordered', 'success');
  setTimeout(() => ctx.hideHudStatus(), 1600);
}

/**
 * @param {object} context
 * @param {number} imageIndex
 * @param {string} altText
 */
function handleImageAltUpdate(context, imageIndex, altText) {
  const ctx = ensureContext(context);
  const slides = ctx.getSlides();
  const currentIndex = ctx.getCurrentIndex();
  const currentSlide = slides[currentIndex];
  if (!currentSlide) return;

  const updatedSlide = updateImageAltText(imageIndex, altText, currentSlide);
  ctx.updateSlide(currentIndex, updatedSlide);
  ctx.replaceSlideAt(currentIndex);
}

/**
 * @param {object} context
 * @param {File} file
 * @param {number|null} [replaceIndex]
 */
async function handleImageFile(context, file, replaceIndex = null) {
  if (!file || !file.type.startsWith('image/')) return;
  const ctx = ensureContext(context);

  try {
    const { file: compressed, format } = await compressImageForEdit(file);
    const dataUrl = await fileToBase64(compressed);

    const imageData = {
      src: dataUrl,
      alt: file.name.replace(/\.[^/.]+$/, ''),
      originalFilename: file.name,
      compressedSize: compressed.size,
      format,
    };

    const slides = ctx.getSlides();
    const currentIndex = ctx.getCurrentIndex();
    const currentSlide = slides[currentIndex];
    if (!currentSlide) return;

    if (typeof replaceIndex === 'number' && replaceIndex >= 0) {
      updateSlideImageByIndex(currentIndex, replaceIndex, imageData);
    } else {
      const updatedSlide = addImageToSlide(currentSlide, imageData);
      ctx.updateSlide(currentIndex, updatedSlide);
    }
    ctx.replaceSlideAt(currentIndex);
    renderEditForm(ctx);

    ctx.showHudStatus('📷 Image added!', 'success');
    setTimeout(() => ctx.hideHudStatus(), 2000);
  } catch (error) {
    console.warn('Image upload failed:', error);
    ctx.showHudStatus('🖼 That image did not want to load. Try another', 'error');
    setTimeout(() => ctx.hideHudStatus(), 2000);
  }
}

// Helper functions for image compression (simplified versions)
/**
 * @param {File} file
 */
async function compressImageForEdit(file) {
  const MAX_SIZE = CONFIG.IMAGE.MAX_BYTES;
  const TARGET_SIZE = CONFIG.IMAGE.TARGET_BYTES;

  // @ts-ignore - Global from script tag
  if (typeof imageCompression === 'undefined') {
    if (file.size > MAX_SIZE) {
      throw new Error('Image too large. Please use a smaller image (<500KB).');
    }
    return { file, format: file.type || 'image/png' };
  }

  if (file.size <= TARGET_SIZE) {
    return { file, format: file.type || 'image/png' };
  }

  try {
    // @ts-ignore - Global from script tag
    const compressed = await imageCompression(file, {
      maxWidthOrHeight: 1920,
      maxSizeMB: TARGET_SIZE / (1024 * 1024),
      useWebWorker: true,
      fileType: 'image/webp'
    });

    if (compressed.size > MAX_SIZE) {
      throw new Error('Could not compress image below 500KB. Try a smaller source.');
    }

    return { file: compressed, format: 'image/webp' };
  } catch (error) {
    throw new Error(`Compression failed: ${error.message}`);
  }
}

// handleJsonToggle removed - now handled by accordion component

function setupTextareaExpansion() {
  const textareas = document.querySelectorAll('.edit-drawer__textarea');
  textareas.forEach(textarea => {
    if (!(textarea instanceof HTMLTextAreaElement)) return;

    const adjustHeight = () => {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    };

    // Initial adjustment if it has content and is visible
    if (textarea.value && textarea.offsetParent !== null) {
      // We might need a slight delay for layout to settle if it was just inserted
      requestAnimationFrame(adjustHeight);
    }

    addTrackedListener(textarea, 'input', adjustHeight);
    addTrackedListener(textarea, 'focus', adjustHeight);
    
    // Contract on blur
    addTrackedListener(textarea, 'blur', () => {
       textarea.style.height = ''; 
    });
  });
}

function setupDictationButtons(context) {
  const buttons = document.querySelectorAll('[data-dictate-target]');
  buttons.forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    addTrackedListener(button, 'click', () => handleDrawerDictation(button, context));
  });
}

async function handleDrawerDictation(button, context) {
  const ctx = ensureContext(context);
  const targetId = button.dataset.dictateTarget;
  const target = targetId ? document.getElementById(targetId) : null;
  if (!(target instanceof HTMLTextAreaElement)) return;

  if (drawerDictationSession?.button === button) {
    const session = drawerDictationSession;
    drawerDictationSession = null;
    setDrawerDictationButton(button, 'processing');
    ctx.showHudStatus('Cleaning transcript...', 'info');
    session.stop();
    return;
  }

  stopDrawerDictation();

  // No key gate: the Gemini proxy falls back to the shared server key, so
  // dictation works out of the box just like deck/slide generation.
  const {
    startSpeechCapture,
    transcribeSpeechToText,
  } = await import('./voice-modes.js');

  try {
    const token = { cancelled: false };
    setDrawerDictationButton(button, 'recording');
    ctx.showHudStatus('Recording text. Tap Mic again to stop.', 'info');
    const recorder = await startSpeechCapture({
      onStop: async (audioBlob) => {
        if (token.cancelled) return;
        try {
          setDrawerDictationButton(button, 'processing');
          ctx.showHudStatus('Cleaning transcript...', 'info');
          const transcript = await transcribeSpeechToText(audioBlob);
          appendTextToTextarea(target, transcript);
          ctx.showHudStatus('Transcript added', 'success');
          setTimeout(() => ctx.hideHudStatus(), 1600);
        } catch (error) {
          ctx.showHudStatus(`Dictation failed: ${error.message}`, 'error');
          setTimeout(() => ctx.hideHudStatus(), 3000);
        } finally {
          drawerDictationSession = null;
          setDrawerDictationButton(button, 'idle');
          target.focus({ preventScroll: true });
        }
      },
      onError: (error) => {
        if (token.cancelled) return;
        drawerDictationSession = null;
        setDrawerDictationButton(button, 'idle');
        ctx.showHudStatus(error?.message || 'Recording failed', 'error');
        setTimeout(() => ctx.hideHudStatus(), 3000);
      },
    });
    drawerDictationSession = { button, stop: recorder.stop, token };
  } catch (error) {
    drawerDictationSession = null;
    setDrawerDictationButton(button, 'idle');
    ctx.showHudStatus(error?.message || 'Could not start microphone', 'error');
    setTimeout(() => ctx.hideHudStatus(), 3000);
  }
}

function stopDrawerDictation() {
  if (!drawerDictationSession) return;
  const { button, stop, token } = drawerDictationSession;
  drawerDictationSession = null;
  token.cancelled = true;
  stop();
  setDrawerDictationButton(button, 'idle');
}

function setDrawerDictationButton(button, state) {
  button.classList.toggle('is-recording', state === 'recording');
  button.disabled = state === 'processing';
  button.textContent = state === 'recording' ? 'Stop' : state === 'processing' ? 'Wait' : 'Mic';
  button.setAttribute('aria-label', state === 'recording' ? 'Stop dictation' : 'Dictate text');
}

function appendTextToTextarea(textarea, text) {
  const clean = (text || '').trim();
  if (!clean) return;
  const current = textarea.value.trim();
  textarea.value = current ? `${current}\n${clean}` : clean;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

/**
 * @param {object} context
 */
export function renderEditForm(context) {
  const ctx = ensureContext(context);
  const content = document.getElementById('edit-drawer-content');
  if (!content) return;

  // Clean up all existing event listeners before re-rendering
  cleanupFormListeners();

  // Preserve open/closed state of existing accordions across re-renders
  const existingAccordions = content.querySelectorAll('.accordion');
  const hadAccordions = existingAccordions.length > 0;
  const openTitles = new Set(
    Array.from(content.querySelectorAll('.accordion.is-open .accordion__title'))
      .map((el) => el.textContent.trim())
  );

  const slides = ctx.getSlides();
  const currentIndex = ctx.getCurrentIndex();
  const currentSlide = slides[currentIndex];
  if (!currentSlide) return;

  const displaySlide = prepareSlideForEditing(currentSlide);
  const mainSections = buildMainSections(currentSlide);
  const actionsSection = buildActionsSection();
  const advancedSection = buildAdvancedSection(displaySlide);

  content.innerHTML = `
    <form class="edit-drawer__form">
      ${mainSections}
      ${actionsSection}
      ${advancedSection}
    </form>
  `;

  if (hadAccordions) {
    content.querySelectorAll('.accordion').forEach((acc) => {
      const title = acc.querySelector('.accordion__title')?.textContent.trim() || '';
      acc.classList.toggle('is-open', openTitles.has(title));
    });
  }

  // Setup auto-expanding textareas
  setupTextareaExpansion();
  setupDictationButtons(ctx);

  // Setup accordions with whimsical animations
  setupAccordion(content, { allowMultiple: true, addTrackedListener });

  // Setup custom selects
  setupCustomSelect(content, { addTrackedListener });

  // Setup theme picker & buttons inside edit drawer
  const themeSelect = document.getElementById('edit-theme-select');
  if (themeSelect) {
    addTrackedListener(themeSelect, 'customSelectChange', async (e) => {
      const themePath = e.detail.value;
      try {
        if (themePath.startsWith('saved:')) {
          const savedName = themePath.replace('saved:', '');
          const library = loadThemeLibrary();
          const entry = library.find((item) => item.name === savedName);
          if (entry) {
            const normalizedTheme = applyTheme(entry.theme);
            setCurrentTheme(normalizedTheme, { source: themePath });
          }
        } else {
          const response = await fetch(themePath, { cache: 'no-store' });
          if (!response.ok) throw new Error(`Failed to load theme: ${response.status}`);
          const theme = await response.json();
          const normalizedTheme = applyTheme(theme);
          setCurrentTheme(normalizedTheme, { source: themePath });
        }
        syncThemeSelectUI();
        persistSlides({ silent: true });
        ctx.showHudStatus('✓ Theme applied', 'success');
        setTimeout(() => ctx.hideHudStatus(), 1600);
      } catch (error) {
        console.error('Failed to apply theme:', error);
        ctx.showHudStatus('Could not load that theme', 'error');
        setTimeout(() => ctx.hideHudStatus(), 2000);
      }
    });
  }

  addTrackedListener(
    document.getElementById('theme-random-btn-inline'),
    'click',
    () => randomizeTheme()
  );

  addTrackedListener(
    document.getElementById('theme-save-btn-inline'),
    'click',
    () => {
      try {
        const theme = getCurrentTheme();
        const name = window.prompt('Name this theme:', '');
        if (!name || !name.trim()) return;
        const trimmedName = name.trim();
        const saved = saveThemeToLibrary(trimmedName, theme);
        if (!saved) {
          ctx.showHudStatus('Could not save theme (storage full)', 'error');
          setTimeout(() => ctx.hideHudStatus(), 2400);
          return;
        }
        setCurrentTheme(theme, { source: `saved:${trimmedName}` });
        populateThemeDropdown();
        syncThemeSelectUI();
        persistSlides({ silent: true });
        renderEditForm(ctx);
        ctx.showHudStatus('✓ Theme saved', 'success');
        setTimeout(() => ctx.hideHudStatus(), 1600);
      } catch (error) {
        console.error('Failed to save theme:', error);
      }
    }
  );


  // Register all button click handlers with cleanup tracking
  addTrackedListener(
    document.getElementById('duplicate-slide-btn'),
    'click',
    () => duplicateCurrentSlide(ctx)
  );

  addTrackedListener(
    document.getElementById('delete-slide-btn'),
    'click',
    () => deleteCurrentSlide(ctx)
  );

  addTrackedListener(
    document.getElementById('download-deck-btn'),
    'click',
    () => ctx.downloadDeck()
  );

  addTrackedListener(
    document.getElementById('download-pdf-btn'),
    'click',
    () => handleDownloadPdf(ctx)
  );

  // Instant Slide Type switching (no "Update Slide" button needed)
  const layoutSelect = document.getElementById('slide-layout-select-wrapper');
  if (layoutSelect) {
    addTrackedListener(layoutSelect, 'customSelectChange', (e) => {
      const nextType = e.detail?.value;
      if (nextType) {
        applyLayoutToCurrentSlide(ctx, nextType, null);
      }
    });
  }

  // Instant Layout Variant switching
  ['standard-layout-select-wrapper', 'split-layout-select-wrapper', 'quote-layout-select-wrapper'].forEach((id) => {
    const variantSelect = document.getElementById(id);
    if (variantSelect) {
      addTrackedListener(variantSelect, 'customSelectChange', (e) => {
        applyVariantToCurrentSlide(ctx, e.detail?.value);
      });
    }
  });

  addTrackedListener(
    document.getElementById('layout-add-btn'),
    'click',
    () => handleLayoutAdd(ctx)
  );

  // Add / remove pillar cards on Pillars slides
  addTrackedListener(
    document.getElementById('add-pillar-btn'),
    'click',
    () => {
      syncQuickEditToJSON(ctx);
      const s = JSON.parse(JSON.stringify(ctx.getSlides()[ctx.getCurrentIndex()] || {}));
      if (!Array.isArray(s.pillars)) s.pillars = [];
      s.pillars.push({ title: `Card ${s.pillars.length + 1}`, copy: ['Supporting detail'] });
      ctx.updateSlide(ctx.getCurrentIndex(), s);
      ctx.replaceSlideAt(ctx.getCurrentIndex());
      renderEditForm(ctx);
    }
  );

  addTrackedListener(content, 'click', (event) => {
    const removePillarBtn = event.target instanceof Element
      ? event.target.closest('[data-remove-pillar]')
      : null;
    if (!removePillarBtn) return;
    event.preventDefault();
    const pIdx = Number.parseInt(removePillarBtn.getAttribute('data-remove-pillar') || '', 10);
    if (Number.isNaN(pIdx)) return;
    syncQuickEditToJSON(ctx);
    const s = JSON.parse(JSON.stringify(ctx.getSlides()[ctx.getCurrentIndex()] || {}));
    if (Array.isArray(s.pillars) && s.pillars.length > 1) {
      s.pillars.splice(pIdx, 1);
      ctx.updateSlide(ctx.getCurrentIndex(), s);
      ctx.replaceSlideAt(ctx.getCurrentIndex());
      renderEditForm(ctx);
    }
  });

  setupQuickEditSync(ctx);

  setupImageRemoveButtons({
    root: content,
    onRemove: (imageIndex) => handleImageRemove(ctx, imageIndex),
    addTrackedListener,
  });

  let pendingReplaceImageIndex = null;

  const dropzone = document.getElementById('image-manager-dropzone');
  if (dropzone) {
    const getImagePicker = () => {
      if (moduleImagePicker) return moduleImagePicker;
      moduleImagePicker = document.createElement('input');
      moduleImagePicker.type = 'file';
      moduleImagePicker.accept = 'image/*';
      moduleImagePicker.style.display = 'none';
      document.body.appendChild(moduleImagePicker);
      return moduleImagePicker;
    };

    const picker = getImagePicker();
    const handlePickerChange = () => {
      const file = picker.files?.[0];
      const replaceIdx = pendingReplaceImageIndex;
      pendingReplaceImageIndex = null;
      if (file) {
        handleImageFile(ctx, file, replaceIdx);
      }
      picker.value = '';
    };
    picker.onchange = handlePickerChange;

    addTrackedListener(
      document.getElementById('add-image-btn'),
      'click',
      (event) => {
        event.preventDefault();
        pendingReplaceImageIndex = null;
        picker.click();
      }
    );

    setupImageReplaceButtons({
      root: content,
      onReplace: (imageIndex) => {
        pendingReplaceImageIndex = imageIndex;
        picker.click();
      },
      addTrackedListener,
    });

    const emptyDropzone = dropzone.querySelector('.edit-drawer__image-dropzone');
    if (emptyDropzone) {
      addTrackedListener(emptyDropzone, 'click', (event) => {
        event.preventDefault();
        pendingReplaceImageIndex = null;
        picker.click();
      });
    }

    addTrackedListener(dropzone, 'dragover', (event) => {
      event.preventDefault();
      dropzone.classList.add('is-drag-over');
    });

    addTrackedListener(dropzone, 'dragleave', () => {
      dropzone.classList.remove('is-drag-over');
    });

    addTrackedListener(dropzone, 'drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('is-drag-over');
      const files = Array.from(event.dataTransfer?.files || []);
      const imageFile = files.find((file) => file.type.startsWith('image/'));
      if (imageFile) {
        handleImageFile(ctx, imageFile, null);
      }
    });
  }

  addTrackedListener(
    document.getElementById('search-new-image-btn'),
    'click',
    () => {
      const currentSlide = ctx.getSlides()[ctx.getCurrentIndex()];
      if (!currentSlide) return;
      const seedQuery = (currentSlide.headline || currentSlide.title || '')
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .trim()
        .slice(0, 60);
      openImageSearch({
        slideIndex: ctx.getCurrentIndex(),
        seedQuery,
        onPick: (imageData) => {
          const slideIdx = ctx.getCurrentIndex();
          const slideObj = ctx.getSlides()[slideIdx];
          if (!slideObj) return;
          const updatedSlide = addImageToSlide(slideObj, imageData);
          ctx.updateSlide(slideIdx, updatedSlide);
          ctx.replaceSlideAt(slideIdx);
        },
        onSuccess: () => renderEditForm(ctx),
      });
    }
  );

  const imageList = content.querySelector('.edit-drawer__image-list');
  if (imageList instanceof HTMLElement) {
    setupImageDragReorder({
      container: imageList,
      onReorder: (fromIndex, toIndex) => handleImageReorder(ctx, fromIndex, toIndex),
      addTrackedListener,
    });
  }

  setupImageMoveButtons({
    root: content,
    onMove: (fromIndex, toIndex) => handleImageReorder(ctx, fromIndex, toIndex),
    addTrackedListener,
  });


  setupImageSearchButtons({
    root: content,
    onSearch: (imageIndex) => {
      const currentSlide = ctx.getSlides()[ctx.getCurrentIndex()];
      if (!currentSlide) return;

      // Seed the search with the image slot's own alt text first: alt is
      // written as a findable description, while headlines are often puns
      // ("An Explosive History" finds pizza, "taco stand street food" finds
      // tacos). Headline stays as the fallback.
      const slotAlt = collectSlideImages(currentSlide)[imageIndex]?.alt || '';
      const seedQuery = (slotAlt || currentSlide.headline || currentSlide.title || '')
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .trim()
        .slice(0, 60);

      openImageSearch({
        slideIndex: ctx.getCurrentIndex(),
        imageIndex,
        seedQuery,
        onSuccess: () => renderEditForm(ctx),
      });
    },
    addTrackedListener,
  });

  // Setup alt text input event listeners using event delegation
  addTrackedListener(content, 'input', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches('.edit-drawer__image-alt-input')) return;

    const imageIndex = Number.parseInt(input.dataset.imageIndex || '', 10);
    if (Number.isNaN(imageIndex)) return;
    const altText = input.value;
    handleImageAltUpdate(ctx, imageIndex, altText);
  });
}

/**
 * @param {object} context
 */

/**
 * @param {object} context
 */
export function duplicateCurrentSlide(context) {
  const ctx = ensureContext(context);
  const slides = ctx.getSlides();
  const currentIndex = ctx.getCurrentIndex();
  const currentSlide = slides[currentIndex];
  if (!currentSlide) return;

  const duplicatedSlide = JSON.parse(JSON.stringify(currentSlide));
  const newIndex = currentIndex + 1;
  ctx.insertSlideAt(newIndex, duplicatedSlide, { activate: true });
  ctx.closeDrawer();
  ctx.showHudStatus('✨ Slide duplicated', 'success');
  setTimeout(() => ctx.hideHudStatus(), 1600);
  debug('Slide duplicated');
}

/**
 * @param {object} context
 */
export function deleteCurrentSlide(context) {
  const ctx = ensureContext(context);
  const slides = ctx.getSlides();
  const currentIndex = ctx.getCurrentIndex();

  if (slides.length <= 1) {
    ctx.showHudStatus('🌱 A deck needs at least one slide', 'info');
    setTimeout(() => ctx.hideHudStatus(), 1800);
    return;
  }

  // Soft two-tap confirm instead of a native dialog: first tap arms the
  // button for 3s, second tap deletes. Pain-free zone.
  const deleteBtn = document.getElementById('delete-slide-btn');
  if (deleteBtn && deleteBtn.dataset.armed !== 'true') {
    deleteBtn.dataset.armed = 'true';
    deleteBtn.textContent = 'Tap again to delete';
    deleteBtn.classList.add('is-armed');
    setTimeout(() => {
      if (deleteBtn.isConnected && deleteBtn.dataset.armed === 'true') {
        delete deleteBtn.dataset.armed;
        deleteBtn.textContent = 'Delete';
        deleteBtn.classList.remove('is-armed');
      }
    }, 3000);
    return;
  }
  if (deleteBtn) {
    delete deleteBtn.dataset.armed;
    deleteBtn.classList.remove('is-armed');
  }

  // removeSlideAt (via deleteSlideAt) already re-renders, re-indexes, and
  // persists the deck — no extra replaceSlideAt needed here.
  const success = ctx.deleteSlideAt(currentIndex);
  if (success) {
    ctx.closeDrawer();
    ctx.showHudStatus('🗑️ Slide deleted', 'success');
    setTimeout(() => ctx.hideHudStatus(), 1600);
    debug('Slide deleted');
  }
}
