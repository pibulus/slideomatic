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

import { escapeHtml, fileToBase64 } from './utils.js';
import {
  prepareSlideForEditing,
  restoreBase64FromTokens,
} from './base64-tokens.js';
import {
  buildImageManager,
  setupImageRemoveButtons,
  setupImageReplaceButtons,
  setupImageAIButtons,
  setupImageDragReorder,
  removeImageByIndex,
  replaceImageByIndex,
  reorderSlideImages,
  addImageToSlide,
  updateImageAltText,
} from './slide-image-ui.js';
import { askAIForImage } from './image-ai.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const AUTO_SAVE_DELAY_MS = 2000; // Auto-save after 2 seconds of idle typing

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
    buildCombinedContentSection(slide, type),
    buildImagesSection(slide),
  ].filter(Boolean);
  return sections.join('');
}

function buildCombinedContentSection(slide, type) {
  const fields = [];

  // Label/Eyebrow
  if (Object.prototype.hasOwnProperty.call(slide, 'eyebrow')) {
    fields.push(buildInputField('eyebrow', slide.eyebrow || '', 'Label'));
  }

  // Headline
  const headlineDescriptor = resolveField(
    slide,
    type === 'title'
      ? ['title', 'headline']
      : type === 'quote'
        ? ['quote', 'headline']
        : ['headline', 'title']
  );
  const fallbackHeadlineField =
    type === 'title'
      ? 'title'
      : type === 'quote'
        ? 'quote'
        : 'headline';
  const headlineData = headlineDescriptor ?? { field: fallbackHeadlineField, value: '' };
  const headlinePlaceholder = type === 'quote' ? 'Quote' : 'Headline';
  fields.push(buildInputField(headlineData.field, headlineData.value, headlinePlaceholder));

  // Subtitle/Attribution
  let subtitleCandidates = [];
  let subtitlePlaceholder = 'Subtitle';
  let subtitleFallback = null;

  if (type === 'title') {
    subtitleCandidates = ['subtitle'];
    subtitleFallback = 'subtitle';
  } else if (type === 'quote') {
    subtitleCandidates = ['attribution'];
    subtitlePlaceholder = 'Source';
    subtitleFallback = 'attribution';
  } else {
    subtitleCandidates = ['subtitle'];
    subtitleFallback = 'subtitle';
  }

  const subtitleDescriptor = resolveField(slide, subtitleCandidates);
  const subtitleData = subtitleDescriptor ?? { field: subtitleFallback, value: '' };
  if (subtitleData.field) {
    fields.push(buildInputField(subtitleData.field, subtitleData.value, subtitlePlaceholder));
  }

  // Body
  const shouldShowBody =
    Object.prototype.hasOwnProperty.call(slide, 'body') ||
    ['standard', 'gallery', 'grid', 'pillars', 'split', 'image'].includes(type);
  
  if (shouldShowBody) {
    const bodyValue = Array.isArray(slide.body) ? slide.body.join('\n') : (slide.body || '');
    fields.push(buildTextareaField('body', bodyValue, 'Body copy'));
  }

  if (fields.length === 0) return '';

  const content = `
    <div class="edit-drawer__stack">
      ${fields.join('')}
    </div>
  `;

  return buildSection('Content', content);
}

function buildActionsSection() {
  const isAutoSave = localStorage.getItem('slideomatic_autosave') !== 'false';
  const checked = isAutoSave ? 'checked' : '';

  return buildSection(
    'Actions',
    `
      <div class="edit-drawer__actions-grid">
        <label class="edit-drawer__checkbox-label">
          <input type="checkbox" id="autosave-toggle" ${checked}>
          <span>Auto-save changes</span>
        </label>
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
        <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="download-deck-btn">
          Export
        </button>
      </div>
    `,
    { modifier: ' edit-drawer__section--actions' }
  );
}

function getLayoutDescription(value) {
  return getLayoutMeta(value)?.description || TYPE_NOTES[value] || '';
}

function buildLayoutControl(currentType) {
  const selectTitle = getLayoutDescription(currentType) || 'Choose slide type';
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
      <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="layout-apply-btn" title="Update this slide with the selected type">
        Update Slide
      </button>
      <button type="button" class="edit-drawer__button edit-drawer__button--primary" id="layout-add-btn" title="Add a new slide with the selected type">
        Add Slide
      </button>
    </div>
  `;

  return buildSection('Slide Type', content, { modifier: ' edit-drawer__section--layout' });
}

function buildImagesSection(slide) {
  return buildSection(
    'Images',
    `<div class="edit-drawer__stack edit-drawer__stack--images">${buildImageManager(slide)}</div>`,
    { modifier: ' edit-drawer__section--images' }
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
  
  // Also track the toggle change to save preference
  const autoSaveToggle = document.getElementById('autosave-toggle');
  if (autoSaveToggle) {
    addTrackedListener(autoSaveToggle, 'change', (e) => {
      if (e.target instanceof HTMLInputElement) {
        localStorage.setItem('slideomatic_autosave', String(e.target.checked));
      }
    });
  }
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

      if (field === 'body' && rawValue.includes('\n')) {
        const lines = rawValue
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        // @ts-ignore - Reassigning to array is intentional here
        finalValue = lines.length ? lines : '';
      }

      if (finalValue === '' || finalValue == null) {
        delete slide[field];
      } else {
        // @ts-ignore - Body can be an array
        slide[field] = finalValue;
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
  const select = document.getElementById('slide-layout-select');
  if (select instanceof HTMLSelectElement) {
    return select.value;
  }
  return '';
}

/**
 * @param {HTMLSelectElement} select
 */
function updateLayoutSelectTooltip(select) {
  if (!select) return;
  const desc = getLayoutDescription(select.value);
  if (desc) {
    select.title = desc;
  } else {
    select.removeAttribute('title');
  }
}

/**
 * @param {object} context
 */
function handleLayoutApply(context) {
  const layout = getSelectedLayoutValue();
  const ctx = ensureContext(context);
  if (!layout) {
    ctx.showHudStatus('Select a slide type first', 'warning');
    setTimeout(() => ctx.hideHudStatus(), 1500);
    return;
  }
  applyLayoutToCurrentSlide(ctx, layout);
}

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
    alert(`No template available for type "${layout}".`);
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
 * @param {object} ctx
 * @param {string} layout
 */
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
function handleDownloadDeck(context) {
  const ctx = ensureContext(context);
  const persisted = ctx.downloadDeck();
  if (persisted) {
    ctx.showHudStatus('💾 Deck downloaded', 'success');
    setTimeout(() => ctx.hideHudStatus(), 1600);
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
  console.log('✓ Image removed from slide');
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
  console.log('✓ Image replaced - src cleared, title preserved');
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
    ctx.showHudStatus('⚠️ Unable to add that image', 'error');
    setTimeout(() => ctx.hideHudStatus(), 2000);
  }
}

// Helper functions for image compression (simplified versions)
/**
 * @param {File} file
 */
async function compressImageForEdit(file) {
  const MAX_SIZE = 2 * 1024 * 1024; // 2MB
  const TARGET_SIZE = 500 * 1024; // 500KB

  // @ts-ignore - Global from script tag
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
    // @ts-ignore - Global from script tag
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

  addTrackedListener(
    document.getElementById('layout-add-btn'),
    'click',
    () => handleLayoutAdd(ctx)
  );

  const layoutSelect = document.getElementById('slide-layout-select');
  if (layoutSelect instanceof HTMLSelectElement) {
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

  setupImageReplaceButtons({
    root: content,
    onReplace: (imageIndex) => handleImageReplace(ctx, imageIndex),
    addTrackedListener,
  });

  const dropzone = document.getElementById('image-dropzone');
  if (dropzone) {
    let imagePicker = null;
    const getImagePicker = () => {
      if (imagePicker) return imagePicker;
      imagePicker = document.createElement('input');
      imagePicker.type = 'file';
      imagePicker.accept = 'image/*';
      imagePicker.style.display = 'none';
      imagePicker.addEventListener('change', () => {
        const file = imagePicker.files?.[0];
        if (file) {
          handleImageFile(ctx, file);
        }
        imagePicker.value = '';
      });
      document.body.appendChild(imagePicker);
      return imagePicker;
    };

    addTrackedListener(dropzone, 'click', (event) => {
      event.preventDefault();
      getImagePicker().click();
    });

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

  setupImageAIButtons({
    root: content,
    onAI: (imageIndex) => {
      const currentSlide = ctx.getSlides()[ctx.getCurrentIndex()];
      if (!currentSlide) return;
      
      const context = {
        slideIndex: ctx.getCurrentIndex(),
        headline: currentSlide.headline || currentSlide.title || '',
        body: Array.isArray(currentSlide.body) ? currentSlide.body.join(' ') : (currentSlide.body || ''),
        slideType: currentSlide.type || 'standard'
      };

      askAIForImage(null, {
        context,
        slideIndex: ctx.getCurrentIndex(),
        imageIndex,
        onSuccess: () => renderEditForm(ctx)
      });
    },
    addTrackedListener
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
export function saveCurrentSlide(context) {
  const ctx = ensureContext(context);
  syncQuickEditToJSON();

  const textarea = document.getElementById('slide-json-editor');
  if (!(textarea instanceof HTMLTextAreaElement)) return;

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
  console.log('✓ Slide duplicated');
}

/**
 * @param {object} context
 */
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
