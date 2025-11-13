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

const LAYOUT_OPTIONS = [
  { value: 'title', label: 'Title', description: 'Hero intro' },
  { value: 'standard', label: 'Standard', description: 'Flexible content' },
  { value: 'quote', label: 'Quote', description: 'Pull quote' },
  { value: 'split', label: 'Split', description: 'Two-column' },
  { value: 'grid', label: 'Grid', description: '3-up highlights' },
  { value: 'pillars', label: 'Pillars', description: 'Stacked cards' },
  { value: 'gallery', label: 'Gallery', description: 'Image grid' },
  { value: 'image', label: 'Image', description: 'Hero visual' },
  { value: 'typeface', label: 'Typeface', description: 'Type specimen' },
];

const TYPE_NOTES = Object.fromEntries(
  LAYOUT_OPTIONS.map(({ value, description, label }) => [value, description || label])
);

function getLayoutMeta(value) {
  return LAYOUT_OPTIONS.find((option) => option.value === value);
}

function buildSection(title, content, options = {}) {
  if (!content) return '';
  const modifier = options.modifier ? ` ${options.modifier}` : '';
  return `
    <section class="edit-drawer__section${modifier}">
      <div class="edit-drawer__section-header">
        <p class="edit-drawer__section-title">${escapeHtml(title)}</p>
      </div>
      <div class="edit-drawer__section-body">
        ${content}
      </div>
    </section>
  `;
}

function buildInputField(field, value, placeholder) {
  const safeField = escapeHtml(field);
  return `
    <input
      type="text"
      class="edit-drawer__input"
      id="quick-edit-${safeField}"
      data-field="${safeField}"
      value="${escapeHtml(value ?? '')}"
      placeholder="${escapeHtml(placeholder)}"
      aria-label="${escapeHtml(placeholder)}"
    />
  `;
}

function buildTextareaField(field, value, placeholder) {
  const safeField = escapeHtml(field);
  return `
    <textarea
      class="edit-drawer__textarea"
      id="quick-edit-${safeField}"
      data-field="${safeField}"
      rows="4"
      placeholder="${escapeHtml(placeholder)}"
      aria-label="${escapeHtml(placeholder)}"
    >${escapeHtml(value ?? '')}</textarea>
  `;
}

function resolveField(slide, candidates) {
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(slide, key)) {
      return { field: key, value: slide[key] ?? '' };
    }
  }
  return null;
}

function buildMainSections(slide) {
  const type = slide.type || 'standard';
  const sections = [
    buildLayoutControl(type),
    buildLabelSection(slide),
    buildHeadlineSection(slide, type),
    buildSubtitleSection(slide, type),
    buildBodySection(slide, type),
    buildImagesSection(slide),
  ].filter(Boolean);
  return sections.join('');
}

function getLayoutDescription(value) {
  return getLayoutMeta(value)?.description || TYPE_NOTES[value] || '';
}

function buildLayoutControl(currentType) {
  const selectTitle = getLayoutDescription(currentType) || 'Choose layout';
  const options = LAYOUT_OPTIONS.map(({ value, label }) => {
    const selected = value === currentType ? 'selected' : '';
    const optionTitle = getLayoutDescription(value) || label;
    return `<option value="${value}" ${selected} title="${escapeHtml(optionTitle)}">${escapeHtml(label)}</option>`;
  }).join('');

  const content = `
    <div class="edit-drawer__layout-controls">
      <select class="edit-drawer__select" id="slide-layout-select" title="${escapeHtml(selectTitle)}">
        ${options}
      </select>
      <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="layout-apply-btn" title="Apply the selected layout to this slide">
        Apply layout
      </button>
    </div>
  `;

  return buildSection('Layout', content, { modifier: ' edit-drawer__section--layout' });
}

function buildLabelSection(slide) {
  if (!Object.prototype.hasOwnProperty.call(slide, 'eyebrow')) return '';
  return buildSection('Label', buildInputField('eyebrow', slide.eyebrow || '', 'Label'));
}

function buildHeadlineSection(slide, type) {
  const descriptor = resolveField(
    slide,
    type === 'title'
      ? ['title', 'headline']
      : type === 'quote'
        ? ['quote', 'headline']
        : ['headline', 'title']
  );
  const fallbackField =
    type === 'title'
      ? 'title'
      : type === 'quote'
        ? 'quote'
        : 'headline';

  const fieldData = descriptor ?? { field: fallbackField, value: '' };
  const placeholder = type === 'quote' ? 'Quote' : 'Headline';
  return buildSection('Headline', buildInputField(fieldData.field, fieldData.value, placeholder));
}

function buildSubtitleSection(slide, type) {
  let candidates = [];
  let placeholder = 'Subtitle';
  let title = 'Subtitle';
  let fallback = null;

  if (type === 'title') {
    candidates = ['subtitle'];
    fallback = 'subtitle';
  } else if (type === 'quote') {
    candidates = ['attribution'];
    placeholder = 'Source';
    title = 'Source';
    fallback = 'attribution';
  } else {
    candidates = ['subtitle'];
    fallback = 'subtitle';
  }

  const descriptor = resolveField(slide, candidates);
  if (!descriptor && !fallback) return '';
  const fieldData = descriptor ?? { field: fallback, value: '' };
  if (!fieldData.field) return '';
  return buildSection(title, buildInputField(fieldData.field, fieldData.value, placeholder));
}

function buildBodySection(slide, type) {
  const shouldShow =
    Object.prototype.hasOwnProperty.call(slide, 'body') ||
    ['standard', 'gallery', 'grid', 'pillars', 'split', 'image'].includes(type);
  if (!shouldShow) return '';
  const bodyValue = Array.isArray(slide.body) ? slide.body.join('\n') : (slide.body || '');
  return buildSection('Body', buildTextareaField('body', bodyValue, 'Body copy'));
}

function buildImagesSection(slide) {
  return buildSection(
    'Images',
    `<div class="edit-drawer__stack edit-drawer__stack--images">${buildImageManager(slide)}</div>`,
    { modifier: ' edit-drawer__section--images' }
  );
}

function buildActionsSection() {
  return buildSection(
    'Actions',
    `
      <div class="edit-drawer__actions-grid">
        <button type="button" class="edit-drawer__button edit-drawer__button--primary" id="save-slide-btn">
          Save
        </button>
        <div class="edit-drawer__actions-row">
          <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="duplicate-slide-btn">
            Duplicate
          </button>
          <button type="button" class="edit-drawer__button edit-drawer__button--delete" id="delete-slide-btn">
            Delete
          </button>
        </div>
        <button type="button" class="edit-drawer__link-button" id="download-deck-btn">
          Export
        </button>
      </div>
    `,
    { modifier: ' edit-drawer__section--actions' }
  );
}

function buildAdvancedSection(slide) {
  const jsonString = JSON.stringify(slide, null, 2);
  return `
    <section class="edit-drawer__section edit-drawer__section--advanced">
      <button type="button" class="edit-drawer__json-toggle" id="json-toggle" aria-expanded="false">
        <span class="edit-drawer__json-toggle-icon">▶</span>
        <span class="edit-drawer__json-toggle-text">Advanced JSON</span>
      </button>
      <div class="edit-drawer__json-container" id="json-container" hidden>
        <textarea
          class="edit-drawer__textarea"
          id="slide-json-editor"
          rows="20"
          style="font-family: var(--font-mono); font-size: 0.9rem;"
        >${jsonString}</textarea>
      </div>
    </section>
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

function getSelectedLayoutValue() {
  const select = document.getElementById('slide-layout-select');
  return select?.value || '';
}

function updateLayoutSelectTooltip(select) {
  if (!select) return;
  const desc = getLayoutDescription(select.value);
  if (desc) {
    select.title = desc;
  } else {
    select.removeAttribute('title');
  }
}

function handleLayoutApply(context) {
  const layout = getSelectedLayoutValue();
  const ctx = ensureContext(context);
  if (!layout) {
    ctx.showHudStatus('Select a layout first', 'warning');
    setTimeout(() => ctx.hideHudStatus(), 1500);
    return;
  }
  applyLayoutToCurrentSlide(ctx, layout);
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

function applyLayoutToCurrentSlide(ctx, layout) {
  const template = ctx.getSlideTemplate(layout);
  if (!template) {
    alert(`No template available for type "${layout}".`);
    return;
  }

  const slides = ctx.getSlides();
  const currentIndex = ctx.getCurrentIndex();
  const currentSlide = slides[currentIndex];
  if (!currentSlide) return;

  const mergedSlide = mergeSlideWithTemplate(template, currentSlide);
  ctx.updateSlide(currentIndex, mergedSlide);
  ctx.replaceSlideAt(currentIndex);
  renderEditForm(ctx);

  const label = getLayoutMeta(layout)?.label || layout;
  ctx.showHudStatus(`✨ Layout switched to ${label}`, 'success');
  setTimeout(() => ctx.hideHudStatus(), 1600);
}

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
  const isHidden = container.hasAttribute('hidden');

  if (isHidden) {
    container.removeAttribute('hidden');
    jsonToggle.setAttribute('aria-expanded', 'true');
    if (icon) icon.textContent = '▼';
  } else {
    container.setAttribute('hidden', '');
    jsonToggle.setAttribute('aria-expanded', 'false');
    if (icon) icon.textContent = '▶';
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

  addTrackedListener(
    document.getElementById('layout-apply-btn'),
    'click',
    () => handleLayoutApply(ctx)
  );

  const layoutSelect = document.getElementById('slide-layout-select');
  if (layoutSelect) {
    updateLayoutSelectTooltip(layoutSelect);
    addTrackedListener(layoutSelect, 'change', () => updateLayoutSelectTooltip(layoutSelect));
  }

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
    ctx.showHudStatus('✓ Slide saved', 'success');
    setTimeout(() => ctx.hideHudStatus(), 2000);

    // Add pulse animation to the save button before it closes
    const saveBtn = document.getElementById('save-slide-btn');
    if (saveBtn) {
      saveBtn.style.animation = 'pulse 0.3s ease';
    }

    console.log('✓ Slide saved');
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
