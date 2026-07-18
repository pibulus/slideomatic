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
  replaceImageByIndex,
  reorderSlideImages,
  addImageToSlide,
  updateImageAltText,
} from './slide-image-ui.js';
import { openImageSearch } from './image-search-ui.js';
import { setupAccordion } from './accordion.js';
import { setupCustomSelect } from './custom-select.js';
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
  activeFormListeners.forEach(({ element, event, handler }) => {
    element?.removeEventListener(event, handler);
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
function addTrackedListener(element, event, handler) {
  if (!element) return;
  element.addEventListener(event, handler);
  activeFormListeners.push({ element, event, handler });
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

// ... (existing code) ...

function getSelectedLayoutVariant() {
  const standardSelect = document.getElementById('standard-layout-select-wrapper');
  if (standardSelect) {
    return standardSelect.dataset.value || null;
  }
  const splitSelect = document.getElementById('split-layout-select-wrapper');
  if (splitSelect) {
    return splitSelect.dataset.value || null;
  }
  const quoteSelect = document.getElementById('quote-layout-select-wrapper');
  if (quoteSelect) {
    return quoteSelect.dataset.value || null;
  }
  return null;
}

function handleLayoutApply(context) {
  const layout = getSelectedLayoutValue();
  const variant = getSelectedLayoutVariant();
  const ctx = ensureContext(context);
  if (!layout) {
    ctx.showHudStatus('Select a slide type first', 'warning');
    setTimeout(() => ctx.hideHudStatus(), 1500);
    return;
  }
  applyLayoutToCurrentSlide(ctx, layout, variant);
}

// ... (existing code) ...

function applyLayoutToCurrentSlide(ctx, layout, variant) {
  const template = ctx.getSlideTemplate(layout);
  if (!template) {
    ctx.showHudStatus(`🧩 No template for "${layout}" yet`, 'info');
    setTimeout(() => ctx.hideHudStatus(), 2000);
    return;
  }

  const slides = ctx.getSlides();
  const currentIndex = ctx.getCurrentIndex();
  const currentSlide = slides[currentIndex];
  if (!currentSlide) return;

  const mergedSlide = mergeSlideWithTemplate(template, currentSlide);
  
  // Apply variant if present and type matches
  if (layout === 'standard' && variant) {
    mergedSlide.layout = variant;
    delete mergedSlide.variant; // Clean up potential split/quote variant
  } else if ((layout === 'split' || layout === 'quote') && variant) {
    mergedSlide.variant = variant;
    delete mergedSlide.layout; // Clean up potential standard layout
  } else {
    delete mergedSlide.layout;
    // Only clear variant if switching to a type that doesn't use it
    if (layout !== 'split' && layout !== 'quote') delete mergedSlide.variant;
  }

  ctx.updateSlide(currentIndex, mergedSlide);
  ctx.replaceSlideAt(currentIndex);
  renderEditForm(ctx);

  const label = getLayoutMeta(layout)?.label || layout;
  ctx.showHudStatus(`✨ Layout switched to ${label}`, 'success');
  setTimeout(() => ctx.hideHudStatus(), 1600);
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

    syncQuickEditToJSON();

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

function syncQuickEditToJSON() {
  const textarea = document.getElementById('slide-json-editor');
  if (!(textarea instanceof HTMLTextAreaElement)) return;

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
          finalValue = lines.length ? lines : '';
        }
      }

      // Handle nested fields (e.g., 'left.headline')
      if (field.includes('.')) {
        const [parent, child] = field.split('.');
        if (!slide[parent]) slide[parent] = {};
        
        if (finalValue === '' || finalValue == null) {
          delete slide[parent][child];
        } else {
          slide[parent][child] = finalValue;
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
  } catch {
    console.warn('Cannot sync quick-edit: invalid JSON');
  }
}

function autoSaveSlide(context) {
  const ctx = ensureContext(context);
  syncQuickEditToJSON();

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
  PRESERVED_FIELDS.forEach((key) => {
    if (
      Object.prototype.hasOwnProperty.call(currentSlide, key) &&
      (merged[key] === undefined || merged[key] === null || merged[key] === '')
    ) {
      merged[key] = currentSlide[key];
    }
  });
  // Preserve notes collection if present
  if (currentSlide.notes && !merged.notes) {
    merged.notes = currentSlide.notes;
  }
  if (currentSlide.speaker_notes && !merged.speaker_notes) {
    merged.speaker_notes = currentSlide.speaker_notes;
  }
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
 * @param {number} imageIndex
 */
function handleImageReplace(context, imageIndex) {
  const ctx = ensureContext(context);
  const slides = ctx.getSlides();
  const currentIndex = ctx.getCurrentIndex();
  const currentSlide = slides[currentIndex];
  if (!currentSlide) return;

  const updatedSlide = replaceImageByIndex(imageIndex, currentSlide);
  ctx.updateSlide(currentIndex, updatedSlide);
  ctx.replaceSlideAt(currentIndex);
  renderEditForm(ctx);
  ctx.showHudStatus('↻ Image cleared', 'success');
  setTimeout(() => ctx.hideHudStatus(), 1600);
  debug('Image replaced - src cleared, title preserved');
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
  // Don't re-render form - that would lose focus on the input
  // Just update the slide in the background
}

/**
 * @param {object} context
 */
function handleImageAdd(context) {
  const ctx = ensureContext(context);

  const slides = ctx.getSlides();
  const currentIndex = ctx.getCurrentIndex();
  const currentSlide = slides[currentIndex];

  // Add empty placeholder (user can name it and then fill it via drag/drop, AI, or search)
  const emptyImage = { alt: '' };
  const updatedSlide = addImageToSlide(currentSlide, emptyImage);

  ctx.updateSlide(currentIndex, updatedSlide);
  ctx.replaceSlideAt(currentIndex);
  renderEditForm(ctx);

  ctx.showHudStatus('📷 Empty image added - name it or drag & drop!', 'success');
  setTimeout(() => ctx.hideHudStatus(), 2000);
}

/**
 * @param {object} context
 * @param {File} file
 */
async function handleImageFile(context, file) {
  if (!file || !file.type.startsWith('image/')) return;
  const ctx = ensureContext(context);

  try {
    const { file: compressed, format } = await compressImageForEdit(file);
    const dataUrl = await fileToBase64(compressed);

    const imageData = {
      src: dataUrl,
      alt: file.name,
      originalFilename: file.name,
      compressedSize: compressed.size,
      format,
    };

    const slides = ctx.getSlides();
    const currentIndex = ctx.getCurrentIndex();
    const currentSlide = slides[currentIndex];
    if (!currentSlide) return;

    const updatedSlide = addImageToSlide(currentSlide, imageData);
    ctx.updateSlide(currentIndex, updatedSlide);
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

  // Setup auto-expanding textareas
  setupTextareaExpansion();
  setupDictationButtons(ctx);

  // Setup accordions with whimsical animations
  setupAccordion(content, { allowMultiple: true, addTrackedListener });

  // Setup custom selects
  setupCustomSelect(content, { addTrackedListener });


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

  addTrackedListener(
    document.getElementById('layout-apply-btn'),
    'click',
    () => handleLayoutApply(ctx)
  );

  addTrackedListener(
    document.getElementById('layout-add-btn'),
    'click',
    () => handleLayoutAdd(ctx)
  );

  addTrackedListener(
    document.getElementById('add-image-btn'),
    'click',
    () => handleImageAdd(ctx)
  );

  setupQuickEditSync(ctx);

  setupImageRemoveButtons({
    root: content,
    onRemove: (imageIndex) => handleImageRemove(ctx, imageIndex),
    addTrackedListener,
  });

  setupImageReplaceButtons({
    root: content,
    onReplace: (imageIndex) => handleImageReplace(ctx, imageIndex),
    addTrackedListener,
  });

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

    // Re-bind the change handler each render (old one is replaced)
    const picker = getImagePicker();
    const handlePickerChange = () => {
      const file = picker.files?.[0];
      if (file) {
        handleImageFile(ctx, file);
      }
      picker.value = '';
    };
    // Remove any previous handler before adding new one
    picker.onchange = handlePickerChange;

    // Only trigger file picker if clicking the empty state dropzone or the add button
    // We don't want to trigger it when clicking the list itself (unless on empty space?)
    // Actually, let's keep the click listener specific to the empty state dropzone if it exists
    const emptyDropzone = dropzone.querySelector('.edit-drawer__image-dropzone');
    if (emptyDropzone) {
        addTrackedListener(emptyDropzone, 'click', (event) => {
            event.preventDefault();
            picker.click();
        });
    }

    // Also attach to the add button if it exists
    const addBtn = document.getElementById('add-image-btn');
    if (addBtn) {
        addTrackedListener(addBtn, 'click', (event) => {
            event.preventDefault();
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
        handleImageFile(ctx, imageFile);
      }
    });
  }

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
