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

import { escapeHtml } from './utils.js';
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
} from './image-manager.js';

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

function setupQuickEditSync() {
  const inputs = document.querySelectorAll('[data-field]');
  inputs.forEach((input) => {
    input.addEventListener('input', () => {
      syncQuickEditToJSON();
    });
  });
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
        <label class="edit-drawer__label">Add Template</label>
        <div class="edit-drawer__template-controls">
          <select class="edit-drawer__select" id="slide-template-select">
            <option value="">Choose slide type…</option>
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
          <button type="button" class="edit-drawer__button" id="add-template-btn">
            Add Template
          </button>
        </div>
      </div>
      <button type="button" class="edit-drawer__button" id="save-slide-btn">
        Save & Reload
      </button>
      <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="duplicate-slide-btn">
        Duplicate Slide
      </button>
      <button type="button" class="edit-drawer__button edit-drawer__button--ghost" id="download-deck-btn">
        Save Deck JSON
      </button>
    </form>
  `;

  document.getElementById('save-slide-btn')?.addEventListener('click', () => {
    saveCurrentSlide(ctx);
  });

  document.getElementById('duplicate-slide-btn')?.addEventListener('click', () => {
    duplicateCurrentSlide(ctx);
  });

  document.getElementById('download-deck-btn')?.addEventListener('click', () => {
    handleDownloadDeck(ctx);
  });

  document.getElementById('add-template-btn')?.addEventListener('click', () => {
    handleTemplateInsert(ctx);
  });

  document.getElementById('json-toggle')?.addEventListener('click', handleJsonToggle);

  setupQuickEditSync();

  setupImageRemoveButtons({
    root: content,
    onRemove: (imageIndex) => handleImageRemove(ctx, imageIndex),
  });

  const imageList = content.querySelector('.edit-drawer__image-list');
  setupImageDragReorder({
    container: imageList,
    onReorder: (fromIndex, toIndex) => handleImageReorder(ctx, fromIndex, toIndex),
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
    ctx.showHudStatus('✨ Slide updated', 'success');
    setTimeout(() => ctx.hideHudStatus(), 1600);
    console.log('✓ Slide updated');
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

