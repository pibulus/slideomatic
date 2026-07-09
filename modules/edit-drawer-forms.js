// ═══════════════════════════════════════════════════════════════════════════
// Edit Drawer Form Builders
// ═══════════════════════════════════════════════════════════════════════════
//
// Pure HTML generation functions for the edit drawer UI.
// Extracted from edit-drawer.js to reduce module size.
//
// ═══════════════════════════════════════════════════════════════════════════

import { escapeHtml } from './utils.js';
import { buildImageManager } from './slide-image-ui.js';
import { loadThemeLibrary, getCurrentThemePath } from './theme-manager.js';

export const LAYOUT_OPTIONS = [
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

export function getLayoutMeta(value) {
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
export function buildAccordion(title, content, options = {}) {
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
  const targetId = `quick-edit-${safeField}`;
  return `
    <div class="edit-drawer__dictate-field">
      <textarea
        class="edit-drawer__textarea"
        id="${targetId}"
        data-field="${safeField}"
        rows="4"
        placeholder="${escapeHtml(placeholder)}"
        aria-label="${escapeHtml(placeholder)}"
      >${escapeHtml(value ?? '')}</textarea>
      <button
        type="button"
        class="edit-drawer__dictate-btn"
        data-dictate-target="${targetId}"
        aria-label="Dictate ${escapeHtml(placeholder)}"
        title="Dictate ${escapeHtml(placeholder)}"
      >
        Mic
      </button>
    </div>
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

export function buildMainSections(slide) {
  const type = slide.type || 'standard';
  // Content first — it's the actual job. Theme is deck-level dressing and
  // was burying the fields below the fold on mobile.
  const sections = [
    type === 'split' ? buildSplitContentSection(slide) : buildCombinedContentSection(slide, type),
    buildLayoutControl(type, slide.layout),
    buildImagesSection(slide),
    buildThemeSection(),
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

  return buildAccordion('Content', fields.join(''), { startOpen: true });
}

export function buildActionsSection() {
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
    <div style="display: flex; gap: 10px;">
      <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="download-deck-btn" style="flex: 1;">
        Download JSON
      </button>
      <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="download-pdf-btn" style="flex: 1;">
        Download PDF
      </button>
    </div>
  `;

  return buildAccordion('Actions', content, { modifier: ' accordion--actions', startOpen: false });
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
        <div class="custom-select" id="standard-layout-select-wrapper" data-value="${escapeHtml(currentLayout || 'default')}">
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
        <div class="custom-select" id="split-layout-select-wrapper" data-value="${escapeHtml(currentVariant || 'default')}">
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
        <div class="custom-select" id="quote-layout-select-wrapper" data-value="${escapeHtml(currentVariant || 'simple')}">
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
    { value: 'themes/vaporwave.json', label: 'Vaporwave' },
    { value: 'themes/slack.json', label: 'Slack' },
    { value: 'themes/gameboy.json', label: 'Gameboy' },
  ];

  const savedThemes = library.map((entry) => ({
    value: `saved:${entry.name}`,
    label: `\u2728 ${entry.name}`,
  }));

  const allThemes = [...defaultThemes, ...savedThemes];
  const currentTheme = allThemes.find(t => currentPath.includes(t.value.replace('saved:', ''))) || defaultThemes[0];

  const themeOptions = allThemes.map(({ value, label }) => {
    const isSelected = currentTheme.value === value ? 'is-selected' : '';
    return `
      <button type="button" class="custom-select__option ${isSelected}" data-value="${escapeHtml(value)}">
        <span class="custom-select__option-label">${escapeHtml(label)}</span>
      </button>
    `;
  }).join('');

  const content = `
    <div class="accordion__group">
      <div class="custom-select" id="edit-theme-select" data-value="${escapeHtml(currentTheme.value)}">
        <button type="button" class="custom-select__trigger">
          <span class="custom-select__value">${escapeHtml(currentTheme.label)}</span>
          <span class="custom-select__arrow">\u25bc</span>
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

  return buildAccordion('Theme', content, { modifier: ' accordion--theme', startOpen: false });
}

export function buildAdvancedSection(slide) {
  // Slide data can come from strangers via share links — unescaped, a string
  // field containing </textarea><img onerror=...> would execute on drawer open.
  const jsonString = escapeHtml(JSON.stringify(slide, null, 2));
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
