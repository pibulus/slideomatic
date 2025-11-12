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

import { escapeHtml, formatBytes, fileToBase64 } from './utils.js';
import {
  prepareSlideForEditing,
  restoreBase64FromTokens,
} from './base64-tokens.js';
import {
  buildImageManager,
  setupImageRemoveButtons,
  setupImageDragReorder,
  removeImageByIndex,
  reorderSlideImages,
  addImageToSlide,
  updateImageAltText,
} from './image-manager.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const AUTO_SAVE_DELAY_MS = 1000; // Auto-save after 1 second of idle typing

// ═══════════════════════════════════════════════════════════════════════════
// MODULE STATE - Event Listener Tracking
// ═══════════════════════════════════════════════════════════════════════════

let activeFormListeners = [];
let autoSaveTimeout = null;

/**
 * Clean up all event listeners before re-rendering form
 * Prevents memory leaks from accumulated listeners
 */
function cleanupFormListeners() {
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

  // Add deleteSlideAt if not present
  if (!context.deleteSlideAt) {
    context.deleteSlideAt = (index) => {
      const slides = context.getSlides();
      if (slides.length <= 1) {
        alert('Cannot delete the last slide!');
        return false;
      }
      slides.splice(index, 1);
      if (index >= slides.length) {
        context.currentIndex = slides.length - 1;
      }
      return true;
    };
  }

  return context;
}

function buildQuickEditFields(slide) {
  const type = slide.type || 'standard';
  let html = '<div class="edit-drawer__quick-edit">';

  html += `<div class="edit-drawer__field edit-drawer__field--readonly">
    <label class="edit-drawer__label">Type</label>
    <div class="edit-drawer__type-display">${escapeHtml(type)}</div>
  </div>`;

  if (type === 'title') {
    if ('eyebrow' in slide) {
      html += buildTextField('eyebrow', 'Eyebrow', slide.eyebrow || '');
    }
    html += buildTextField('title', 'Title', slide.title || '');
    if ('subtitle' in slide) {
      html += buildTextField('subtitle', 'Subtitle', slide.subtitle || '');
    }
  } else if (type === 'quote') {
    html += buildTextArea('quote', 'Quote', slide.quote || slide.headline || '');
    html += buildTextField('attribution', 'Attribution', slide.attribution || slide.body || '');
  } else {
    if ('headline' in slide || type === 'standard' || type === 'gallery' || type === 'grid') {
      html += buildTextField('headline', 'Headline', slide.headline || '');
    }
    if ('body' in slide || type === 'standard' || type === 'gallery') {
      const bodyValue = Array.isArray(slide.body) ? slide.body.join('\n') : (slide.body || '');
      html += buildTextArea('body', 'Body', bodyValue);
    }
  }

  html += buildImageManager(slide);

  html += '</div>';
  return html;
}

function buildTextField(id, label, value) {
  const escapedValue = escapeHtml(value ?? '');
  return `
    <div class="edit-drawer__field">
      <label class="edit-drawer__label" for="quick-edit-${id}">${escapeHtml(label)}</label>
      <input
        type="text"
        class="edit-drawer__input"
        id="quick-edit-${id}"
        data-field="${escapeHtml(id)}"
        value="${escapedValue}"
      />
    </div>
  `;
}

function buildTextArea(id, label, value) {
  const escapedValue = escapeHtml(value ?? '');
  return `
    <div class="edit-drawer__field">
      <label class="edit-drawer__label" for="quick-edit-${id}">${escapeHtml(label)}</label>
      <textarea
        class="edit-drawer__textarea edit-drawer__textarea--small"
        id="quick-edit-${id}"
        data-field="${escapeHtml(id)}"
        rows="3"
      >${escapedValue}</textarea>
    </div>
  `;
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
    if (!input.matches('[data-field]')) return;

    syncQuickEditToJSON();

    // Auto-save after idle typing
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => {
      autoSaveSlide(context);
    }, AUTO_SAVE_DELAY_MS);
  };

  addTrackedListener(content, 'input', handleInput);
}

function syncQuickEditToJSON() {
  const textarea = document.getElementById('slide-json-editor');
  if (!textarea) return;

  try {
    const slide = JSON.parse(textarea.value);
    const inputs = document.querySelectorAll('[data-field]');

    inputs.forEach((input) => {
      const field = input.dataset.field;
      let value = input.value;

      if (field === 'body' && value.includes('\n')) {
        const lines = value
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        value = lines.length ? lines : '';
      }

      if (value === '' || value == null) {
        delete slide[field];
      } else {
        slide[field] = value;
      }
    });

    textarea.value = JSON.stringify(slide, null, 2);
  } catch (error) {
    console.warn('Cannot sync quick-edit: invalid JSON');
  }
}

function autoSaveSlide(context) {
  const ctx = ensureContext(context);
  syncQuickEditToJSON();

  const textarea = document.getElementById('slide-json-editor');
  if (!textarea) return;

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

function showAutoSaveStatus(context) {
  const ctx = ensureContext(context);
  ctx.showHudStatus('✓ Saved', 'success');
  setTimeout(() => ctx.hideHudStatus(), 800);
}

function handleTemplateInsert(context) {
  const ctx = ensureContext(context);
  const select = document.getElementById('slide-template-select');
  if (!select) return;

  const type = select.value;
  if (!type) {
    alert('Select a slide type to add.');
    return;
  }

  const template = ctx.getSlideTemplate(type);
  if (!template) {
    alert(`No template available for type "${type}".`);
    return;
  }

  const insertIndex = ctx.getCurrentIndex() + 1;
  ctx.insertSlideAt(insertIndex, template, { activate: true });
  ctx.showHudStatus(`✨ Added ${type} template`, 'success');
  setTimeout(() => ctx.hideHudStatus(), 1600);
  renderEditForm(ctx);
  console.log(`✓ Added ${type} template slide`);
}

function handleDownloadDeck(context) {
  const ctx = ensureContext(context);
  const persisted = ctx.downloadDeck();
  if (persisted) {
    ctx.showHudStatus('💾 Deck downloaded', 'success');
    setTimeout(() => ctx.hideHudStatus(), 1600);
  }
}

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
  console.log('✓ Image removed from slide');
}

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

// Helper functions for image compression (simplified versions)
async function compressImageForEdit(file) {
  const MAX_SIZE = 2 * 1024 * 1024; // 2MB
  const TARGET_SIZE = 500 * 1024; // 500KB

  if (typeof imageCompression === 'undefined') {
    if (file.size > MAX_SIZE) {
      throw new Error('Image too large. Please use a smaller image (<2MB).');
    }
    return { file, format: file.type || 'image/png' };
  }

  if (file.size <= TARGET_SIZE) {
    return { file, format: file.type || 'image/png' };
  }

  try {
    const compressed = await imageCompression(file, {
      maxWidthOrHeight: 1920,
      maxSizeMB: TARGET_SIZE / (1024 * 1024),
      useWebWorker: true,
      fileType: 'image/webp'
    });

    if (compressed.size > MAX_SIZE) {
      throw new Error('Could not compress image below 2MB. Try a smaller source.');
    }

    return { file: compressed, format: 'image/webp' };
  } catch (error) {
    throw new Error(`Compression failed: ${error.message}`);
  }
}

function handleJsonToggle() {
  const container = document.getElementById('json-container');
  const jsonToggle = document.getElementById('json-toggle');
  if (!container || !jsonToggle) return;

  const icon = jsonToggle.querySelector('.edit-drawer__json-toggle-icon');
  const isOpen = container.style.display !== 'none';
  container.style.display = isOpen ? 'none' : 'block';
  if (icon) {
    icon.textContent = isOpen ? '▶' : '▼';
  }
}

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
  const quickEditHTML = buildQuickEditFields(currentSlide);

  content.innerHTML = `
    <form class="edit-drawer__form">
      ${quickEditHTML}

      <div class="edit-drawer__field edit-drawer__field--json">
        <button type="button" class="edit-drawer__json-toggle" id="json-toggle">
          <span class="edit-drawer__json-toggle-icon">▶</span>
          <span class="edit-drawer__json-toggle-text">Advanced (JSON Editor)</span>
        </button>
        <div class="edit-drawer__json-container" id="json-container" style="display: none;">
          <textarea
            class="edit-drawer__textarea"
            id="slide-json-editor"
            rows="20"
            style="font-family: var(--font-mono); font-size: 0.9rem;"
          >${JSON.stringify(displaySlide, null, 2)}</textarea>
        </div>
      </div>
      <div class="edit-drawer__field edit-drawer__field--template">
        <label class="edit-drawer__label">Change Layout</label>
        <select class="edit-drawer__select" id="slide-template-select">
          <option value="">Choose slide layout…</option>
          <option value="title">Title</option>
          <option value="standard">Standard</option>
          <option value="quote">Quote</option>
          <option value="split">Split</option>
          <option value="grid">Grid</option>
          <option value="pillars">Pillars</option>
          <option value="gallery">Gallery</option>
          <option value="image">Image</option>
          <option value="typeface">Typeface</option>
        </select>
      </div>

      <div class="edit-drawer__actions-section">
        <label class="edit-drawer__label">Slide Actions</label>
        <div class="edit-drawer__actions">
          <button type="button" class="edit-drawer__button edit-drawer__button--primary" id="save-slide-btn">
            🔒 LOCK IT IN
          </button>
          <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="duplicate-slide-btn">
            Duplicate Slide
          </button>
          <button type="button" class="edit-drawer__button edit-drawer__button--ghost" id="download-deck-btn">
            Save Deck JSON
          </button>
          <button type="button" class="edit-drawer__button edit-drawer__button--delete" id="delete-slide-btn">
            Delete Slide
          </button>
        </div>
      </div>
    </form>
  `;

  // Register all button click handlers with cleanup tracking
  addTrackedListener(
    document.getElementById('save-slide-btn'),
    'click',
    () => saveCurrentSlide(ctx)
  );

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
    () => handleDownloadDeck(ctx)
  );

  // Change layout dropdown - trigger immediately on selection
  addTrackedListener(
    document.getElementById('slide-template-select'),
    'change',
    (event) => {
      const select = event.target;
      if (select.value) {
        handleTemplateInsert(ctx);
        select.value = ''; // Reset dropdown after inserting
      }
    }
  );

  addTrackedListener(
    document.getElementById('json-toggle'),
    'click',
    handleJsonToggle
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

  const imageList = content.querySelector('.edit-drawer__image-list');
  setupImageDragReorder({
    container: imageList,
    onReorder: (fromIndex, toIndex) => handleImageReorder(ctx, fromIndex, toIndex),
    addTrackedListener,
  });

  // Setup alt text input event listeners using event delegation
  addTrackedListener(content, 'input', (event) => {
    const input = event.target;
    if (!input.matches('.edit-drawer__image-alt-input')) return;

    const imageIndex = Number.parseInt(input.dataset.imageIndex, 10);
    if (Number.isNaN(imageIndex)) return;
    const altText = input.value;
    handleImageAltUpdate(ctx, imageIndex, altText);
  });
}

export function saveCurrentSlide(context) {
  const ctx = ensureContext(context);
  syncQuickEditToJSON();

  const textarea = document.getElementById('slide-json-editor');
  if (!textarea) return;

  try {
    const editedSlide = JSON.parse(textarea.value);
    const slides = ctx.getSlides();
    const currentIndex = ctx.getCurrentIndex();
    const originalSlide = slides[currentIndex];

    if (!originalSlide) {
      throw new Error('No slide selected');
    }

    const restoredSlide = restoreBase64FromTokens(editedSlide, originalSlide);
    ctx.updateSlide(currentIndex, restoredSlide);
    ctx.replaceSlideAt(currentIndex);
    ctx.closeDrawer();

    // Bigger celebration for explicit save
    ctx.showHudStatus('🔒 LOCKED IN!', 'success');
    setTimeout(() => ctx.hideHudStatus(), 2000);

    // Add pulse animation to the save button before it closes
    const saveBtn = document.getElementById('save-slide-btn');
    if (saveBtn) {
      saveBtn.style.animation = 'pulse 0.3s ease';
    }

    console.log('✓ Slide locked in');
  } catch (error) {
    alert(`Invalid JSON: ${error.message}`);
  }
}

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
  console.log('✓ Slide duplicated');
}

export function deleteCurrentSlide(context) {
  const ctx = ensureContext(context);
  const slides = ctx.getSlides();
  const currentIndex = ctx.getCurrentIndex();

  if (slides.length <= 1) {
    alert('Cannot delete the last slide!');
    return;
  }

  const confirmed = confirm('Delete this slide? This cannot be undone.');
  if (!confirmed) return;

  const success = ctx.deleteSlideAt(currentIndex);
  if (success) {
    ctx.replaceSlideAt(ctx.getCurrentIndex());
    ctx.closeDrawer();
    ctx.showHudStatus('🗑️ Slide deleted', 'success');
    setTimeout(() => ctx.hideHudStatus(), 1600);
    console.log('✓ Slide deleted');
  }
}

