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
import { setupAccordion } from './accordion.js';
import { setupCustomSelect, getCustomSelectValue } from './custom-select.js';
import {
  loadThemeLibrary,
  getCurrentThemePath,
} from './theme-manager.js';

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

/**
 * Build an accordion section with whimsical animations
 * @param {string} title - Section title
 * @param {string} content - HTML content for the accordion body
 * @param {Object} options - Configuration options
 * @param {string} options.icon - Optional icon emoji/text
 * @param {string} options.modifier - Optional CSS modifier class
 * @param {boolean} options.startOpen - Whether to start expanded (default: false)
 * @returns {string} HTML for accordion
 */
function buildAccordion(title, content, options = {}) {
  if (!content) return '';

  const {
    icon = '',
    modifier = '',
    startOpen = false,
  } = options;

  const openClass = startOpen ? ' is-open' : '';
  const iconHTML = icon ? `<span class="accordion__icon">${icon}</span>` : '';

  return `
    <section class="accordion${modifier}${openClass}">
      <button type="button" class="accordion__header">
        <h3 class="accordion__title">
          ${iconHTML}
          ${escapeHtml(title)}
        </h3>
        <span class="accordion__chevron">▼</span>
      </button>
      <div class="accordion__body">
        <div class="accordion__content accordion__stack">
          ${content}
        </div>
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

const STANDARD_LAYOUT_OPTIONS = [
  { value: 'default', label: 'Default (Image Right)' },
  { value: 'image-left', label: 'Image Left' },
  { value: 'image-top', label: 'Image Top' },
  { value: 'image-bottom', label: 'Image Bottom' },
];

const SPLIT_LAYOUT_OPTIONS = [
  { value: 'default', label: '50/50 Split' },
  { value: 'feature', label: 'Feature Card' },
];

// ... (existing code) ...

function buildMainSections(slide) {
  const type = slide.type || 'standard';
  const sections = [
    buildThemeSection(),
    buildLayoutControl(type, slide.layout),
    type === 'split' ? buildSplitContentSection(slide) : buildCombinedContentSection(slide, type),
    buildImagesSection(slide),
  ].filter(Boolean);
  return sections.join('');
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
    alert(`No template available for type "${layout}".`);
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

  return buildAccordion('Content', fields.join(''), { startOpen: true });
}

function buildActionsSection() {
  const isAutoSave = localStorage.getItem('slideomatic_autosave') !== 'false';
  const checked = isAutoSave ? 'checked' : '';
  const statusIcon = isAutoSave ? '✓' : '○';

  const content = `
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; background: rgba(255, 159, 243, 0.08); border-radius: var(--radius); border: 2px solid var(--color-surface); margin-bottom: 8px;">
      <label class="edit-drawer__checkbox-label" style="margin: 0; cursor: pointer; user-select: none;">
        <input type="checkbox" id="autosave-toggle" ${checked} style="accent-color: var(--color-surface); width: 18px; height: 18px;">
        <span style="font-weight: 600; color: var(--color-ink);">Auto-save changes</span>
      </label>
      <span style="font-family: var(--font-mono); font-size: 1.2rem; color: var(--color-surface);">${statusIcon}</span>
    </div>
    <button type="button" class="edit-drawer__button edit-drawer__button--primary" id="save-slide-btn">
      Save Changes
    </button>
    <div style="display: flex; gap: 10px;">
      <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="duplicate-slide-btn" style="flex: 1;">
        Duplicate
      </button>
      <button type="button" class="edit-drawer__button edit-drawer__button--delete" id="delete-slide-btn" style="flex: 1;">
        Delete
      </button>
    </div>
    <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="download-deck-btn">
      Export Deck
    </button>
  `;

  return buildAccordion('Actions', content, { modifier: ' accordion--actions', startOpen: false });
}

function getLayoutDescription(value) {
  return getLayoutMeta(value)?.description || TYPE_NOTES[value] || '';
}

const QUOTE_LAYOUT_OPTIONS = [
  { value: 'simple', label: 'Simple (Default)' },
  { value: 'card', label: 'Card Style' },
  { value: 'image-bg', label: 'Image Background' },
];

function buildLayoutControl(currentType, currentLayout) {
  const currentOption = LAYOUT_OPTIONS.find(opt => opt.value === currentType);
  const currentLabel = currentOption?.label || 'Select type';

  // Build custom select options
  const selectOptions = LAYOUT_OPTIONS.map(({ value, label, description }) => {
    const isSelected = value === currentType ? 'is-selected' : '';
    return `
      <button
        type="button"
        class="custom-select__option ${isSelected}"
        data-value="${value}"
        title="${escapeHtml(description)}"
      >
        <span class="custom-select__option-label">${escapeHtml(label)}</span>
        <span class="custom-select__option-desc">${escapeHtml(description)}</span>
      </button>
    `;
  }).join('');

  let layoutSelector = '';
  if (currentType === 'standard') {
    const layoutOptions = STANDARD_LAYOUT_OPTIONS.map(({ value, label }) => {
      const isSelected = (currentLayout || 'default') === value ? 'is-selected' : '';
      return `
        <button type="button" class="custom-select__option ${isSelected}" data-value="${value}">
          <span class="custom-select__option-label">${escapeHtml(label)}</span>
        </button>
      `;
    }).join('');

    const currentStandardLabel = STANDARD_LAYOUT_OPTIONS.find(opt => opt.value === (currentLayout || 'default'))?.label || 'Default (Image Right)';

    layoutSelector = `
      <div class="accordion__group">
        <label class="edit-drawer__label">Layout Variant</label>
        <div class="custom-select" id="standard-layout-select-wrapper" data-value="${currentLayout || 'default'}">
          <button type="button" class="custom-select__trigger">
            <span class="custom-select__value">${escapeHtml(currentStandardLabel)}</span>
            <span class="custom-select__arrow">▼</span>
          </button>
          <div class="custom-select__dropdown">
            ${layoutOptions}
          </div>
        </div>
      </div>
    `;
  } else if (currentType === 'split') {
    const currentVariant = Array.isArray(currentLayout) ? currentLayout[0] : currentLayout;
    const layoutOptions = SPLIT_LAYOUT_OPTIONS.map(({ value, label }) => {
      const isSelected = (currentVariant || 'default') === value ? 'is-selected' : '';
      return `
        <button type="button" class="custom-select__option ${isSelected}" data-value="${value}">
          <span class="custom-select__option-label">${escapeHtml(label)}</span>
        </button>
      `;
    }).join('');

    const currentSplitLabel = SPLIT_LAYOUT_OPTIONS.find(opt => opt.value === (currentVariant || 'default'))?.label || '50/50 Split';

    layoutSelector = `
      <div class="accordion__group">
        <label class="edit-drawer__label">Split Style</label>
        <div class="custom-select" id="split-layout-select-wrapper" data-value="${currentVariant || 'default'}">
          <button type="button" class="custom-select__trigger">
            <span class="custom-select__value">${escapeHtml(currentSplitLabel)}</span>
            <span class="custom-select__arrow">▼</span>
          </button>
          <div class="custom-select__dropdown">
            ${layoutOptions}
          </div>
        </div>
      </div>
    `;
  } else if (currentType === 'quote') {
    const currentVariant = currentLayout;
    const layoutOptions = QUOTE_LAYOUT_OPTIONS.map(({ value, label }) => {
      const isSelected = (currentVariant || 'simple') === value ? 'is-selected' : '';
      return `
        <button type="button" class="custom-select__option ${isSelected}" data-value="${value}">
          <span class="custom-select__option-label">${escapeHtml(label)}</span>
        </button>
      `;
    }).join('');

    const currentQuoteLabel = QUOTE_LAYOUT_OPTIONS.find(opt => opt.value === (currentVariant || 'simple'))?.label || 'Simple (Default)';

    layoutSelector = `
      <div class="accordion__group">
        <label class="edit-drawer__label">Quote Style</label>
        <div class="custom-select" id="quote-layout-select-wrapper" data-value="${currentVariant || 'simple'}">
          <button type="button" class="custom-select__trigger">
            <span class="custom-select__value">${escapeHtml(currentQuoteLabel)}</span>
            <span class="custom-select__arrow">▼</span>
          </button>
          <div class="custom-select__dropdown">
            ${layoutOptions}
          </div>
        </div>
      </div>
    `;
  }

  const content = `
    <div class="accordion__group">
      <div class="custom-select" id="slide-layout-select-wrapper" data-value="${currentType}">
        <button type="button" class="custom-select__trigger">
          <span class="custom-select__value">${escapeHtml(currentLabel)}</span>
          <span class="custom-select__arrow">▼</span>
        </button>
        <div class="custom-select__dropdown">
          ${selectOptions}
        </div>
      </div>
    </div>
    ${layoutSelector}
    <div class="accordion__group" style="display: flex; gap: 10px;">
      <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="layout-apply-btn" title="Update this slide with the selected type" style="flex: 1;">
        Update Slide
      </button>
      <button type="button" class="edit-drawer__button edit-drawer__button--primary" id="layout-add-btn" title="Add a new slide with the selected type" style="flex: 1;">
        Add Slide
      </button>
    </div>
  `;

  return buildAccordion('Slide Type', content, { startOpen: false });
}

function buildImagesSection(slide) {
  return buildAccordion(
    'Images',
    buildImageManager(slide),
    { modifier: ' accordion--images', startOpen: false }
  );
}

function buildSplitContentSection(slide) {
  const left = slide.left || {};
  const right = slide.right || {};

  const content = `
    <div class="accordion__group">
      <p style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-surface); margin: 0 0 8px 0;">Left Column</p>
      ${buildInputField('left.headline', left.headline || '', 'Headline')}
      ${buildTextareaField('left.body', Array.isArray(left.body) ? left.body.join('\n') : (left.body || ''), 'Body copy')}
    </div>
    <div class="accordion__group">
      <p style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-surface); margin: 0 0 8px 0;">Right Column</p>
      ${buildInputField('right.headline', right.headline || '', 'Headline')}
      ${buildTextareaField('right.body', Array.isArray(right.body) ? right.body.join('\n') : (right.body || ''), 'Body copy')}
    </div>
  `;

  return buildAccordion('Split Content', content, { startOpen: true });
}

function buildThemeSection() {
  // Build theme select options from library + defaults
  const library = loadThemeLibrary();
  const currentPath = getCurrentThemePath() || 'theme.json';

  const defaultThemes = [
    { value: 'theme.json', label: 'Default' },
    { value: 'themes/gameboy.json', label: 'Gameboy' },
    { value: 'themes/vaporwave.json', label: 'Vaporwave' },
    { value: 'themes/slack.json', label: 'Slack' },
  ];

  const savedThemes = library.map((entry) => ({
    value: `saved:${entry.name}`,
    label: `✨ ${entry.name}`,
  }));

  const allThemes = [...defaultThemes, ...savedThemes];
  const currentTheme = allThemes.find(t => currentPath.includes(t.value.replace('saved:', ''))) || defaultThemes[0];

  const themeOptions = allThemes.map(({ value, label }) => {
    const isSelected = currentTheme.value === value ? 'is-selected' : '';
    return `
      <button type="button" class="custom-select__option ${isSelected}" data-value="${value}">
        <span class="custom-select__option-label">${escapeHtml(label)}</span>
      </button>
    `;
  }).join('');

  const content = `
    <div class="accordion__group">
      <div class="custom-select" id="edit-theme-select" data-value="${currentTheme.value}">
        <button type="button" class="custom-select__trigger">
          <span class="custom-select__value">${escapeHtml(currentTheme.label)}</span>
          <span class="custom-select__arrow">▼</span>
        </button>
        <div class="custom-select__dropdown">
          ${themeOptions}
        </div>
      </div>
      <p style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--color-muted); margin-top: 8px;">
        Tip: Press <kbd style="padding: 2px 6px; background: rgba(255, 159, 243, 0.15); border-radius: 3px; font-family: var(--font-mono); font-size: 0.7rem;">T</kbd> to randomize
      </p>
    </div>
    <div class="accordion__group">
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
        <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="theme-save-btn-inline" title="Save current theme to library">
          Save Theme
        </button>
        <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="theme-random-btn-inline" title="Generate random variation">
          Randomize
        </button>
      </div>
      <button type="button" class="edit-drawer__button edit-drawer__button--primary" id="theme-ai-btn-inline" title="Generate theme with AI" style="width: 100%;">
        AI Theme
      </button>
    </div>
  `;

  return buildAccordion('Theme', content, { modifier: ' accordion--theme', startOpen: true });
}

function buildAdvancedSection(slide) {
  const jsonString = JSON.stringify(slide, null, 2);
  const content = `
    <textarea
      class="edit-drawer__textarea"
      id="slide-json-editor"
      rows="20"
      style="font-family: var(--font-mono); font-size: 0.9rem;"
    >${jsonString}</textarea>
  `;
  return buildAccordion('Advanced JSON', content, { modifier: ' accordion--advanced', startOpen: false });
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
  const MAX_SIZE = 500 * 1024; // 500KB hard cap
  const TARGET_SIZE = 400 * 1024; // 400KB ideal

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

  // Setup accordions with whimsical animations
  setupAccordion(content, { allowMultiple: true, addTrackedListener });

  // Setup custom selects
  setupCustomSelect(content, { addTrackedListener });

  // Setup theme button handlers (inline in edit drawer)
  const handleThemeChange = async (themePath) => {
    // Import theme functions dynamically
    const { applyTheme, setCurrentTheme } = await import('./theme-manager.js');
    const { showHudStatus, hideHudStatus } = await import('./hud.js');

    try {
      if (themePath.startsWith('saved:')) {
        const savedName = themePath.replace('saved:', '');
        const library = loadThemeLibrary();
        const entry = library.find((entry) => entry.name === savedName);
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
      showHudStatus('✨ Theme applied', 'success');
      setTimeout(hideHudStatus, 1600);
      // Re-render to update theme UI
      renderEditForm(ctx);
    } catch (error) {
      console.error('Failed to apply theme:', error);
    }
  };

  const themeSelect = document.getElementById('edit-theme-select');
  if (themeSelect) {
    themeSelect.addEventListener('customSelectChange', (e) => {
      handleThemeChange(e.detail.value);
    });
  }

  const handleSaveThemeInline = async () => {
    const { getCurrentTheme, saveThemeToLibrary, setCurrentTheme } = await import('./theme-manager.js');
    const { showHudStatus, hideHudStatus } = await import('./hud.js');

    try {
      const theme = getCurrentTheme();
      const currentPath = getCurrentThemePath() || '';
      const name = prompt('Name your theme:', '');
      if (!name || !name.trim()) return;

      saveThemeToLibrary(name.trim(), theme);
      setCurrentTheme(theme, { source: `saved:${name.trim()}` });
      showHudStatus('💾 Theme saved', 'success');
      setTimeout(hideHudStatus, 1600);
      renderEditForm(ctx);
    } catch (error) {
      console.error('Failed to save theme:', error);
    }
  };

  const handleRandomThemeInline = async () => {
    const { randomizeTheme } = await import('./theme-drawer.js');
    randomizeTheme();
    // Re-render to show updated theme in the selector
    setTimeout(() => renderEditForm(ctx), 100);
  };

  const handleAIThemeInline = async () => {
    const { showHudStatus, hideHudStatus } = await import('./hud.js');
    const { getGeminiApiKey } = await import('./voice-modes.js');
    const { getCurrentTheme, applyTheme, setCurrentTheme, getCurrentThemePath } = await import('./theme-manager.js');

    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      showHudStatus('⚠️ Set your Gemini API key in Settings (S) first', 'warning');
      setTimeout(hideHudStatus, 3000);
      return;
    }

    const prompt = window.prompt('Describe the theme vibe you want:', 'pastel punk with neon accents');
    if (!prompt || !prompt.trim()) return;

    const aiBtn = document.getElementById('theme-ai-btn-inline');
    if (aiBtn instanceof HTMLButtonElement) {
      aiBtn.disabled = true;
      aiBtn.textContent = 'Generating...';
    }

    try {
      showHudStatus('🤖 Asking Gemini for a theme...', 'info');

      const currentTheme = getCurrentTheme();
      const themePrompt = `You are a theme generator. Create a beautiful color theme based on this description: "${prompt}".

Return ONLY a JSON object with these exact fields (no markdown, no explanation):
{
  "primary": "#hex",
  "secondary": "#hex",
  "accent": "#hex",
  "background": "#hex",
  "surface": "#hex",
  "text": "#hex"
}

Make the colors harmonious and ensure good contrast for readability.`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: themePrompt }] }],
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      const textContent = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textContent) {
        throw new Error('No theme generated');
      }

      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Invalid theme format');
      }

      const aiTheme = JSON.parse(jsonMatch[0]);
      const mergedTheme = { ...currentTheme, ...aiTheme };
      const normalizedTheme = applyTheme(mergedTheme);

      setCurrentTheme(normalizedTheme, { source: `ai:${prompt.slice(0, 30)}` });

      showHudStatus('✨ AI theme applied!', 'success');
      setTimeout(hideHudStatus, 1600);
      renderEditForm(ctx);

    } catch (error) {
      console.error('AI theme generation failed:', error);
      showHudStatus('❌ Failed to generate theme', 'error');
      setTimeout(hideHudStatus, 2000);
    } finally {
      if (aiBtn instanceof HTMLButtonElement) {
        aiBtn.disabled = false;
        aiBtn.textContent = 'AI Theme';
      }
    }
  };

  addTrackedListener(document.getElementById('theme-save-btn-inline'), 'click', handleSaveThemeInline);
  addTrackedListener(document.getElementById('theme-random-btn-inline'), 'click', handleRandomThemeInline);
  addTrackedListener(document.getElementById('theme-ai-btn-inline'), 'click', handleAIThemeInline);

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

    // Only trigger file picker if clicking the empty state dropzone or the add button
    // We don't want to trigger it when clicking the list itself (unless on empty space?)
    // Actually, let's keep the click listener specific to the empty state dropzone if it exists
    const emptyDropzone = dropzone.querySelector('.edit-drawer__image-dropzone');
    if (emptyDropzone) {
        addTrackedListener(emptyDropzone, 'click', (event) => {
            event.preventDefault();
            getImagePicker().click();
        });
    }

    // Also attach to the add button if it exists
    const addBtn = document.getElementById('add-image-btn');
    if (addBtn) {
        addTrackedListener(addBtn, 'click', (event) => {
            event.preventDefault();
            getImagePicker().click();
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
