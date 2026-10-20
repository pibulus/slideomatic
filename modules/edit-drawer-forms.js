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
  // Dictation rides on Gemini — only offer the mic when a key is configured
  const hasAiKey = !!localStorage.getItem('slideomatic_gemini_api_key');
  const dictateButton = hasAiKey
    ? `
      <button
        type="button"
        class="edit-drawer__dictate-btn"
        data-dictate-target="${targetId}"
        aria-label="Dictate ${escapeHtml(placeholder)}"
        title="Dictate ${escapeHtml(placeholder)}"
      >
        Mic
      </button>`
    : '';
  return `
    <div class="edit-drawer__dictate-field">
      <textarea
        class="edit-drawer__textarea"
        id="${targetId}"
        data-field="${safeField}"
        rows="4"
        placeholder="${escapeHtml(placeholder)}"
        aria-label="${escapeHtml(placeholder)}"
      >${escapeHtml(value ?? '')}</textarea>${dictateButton}
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

  // Pillars cards (editable without touching raw JSON)
  if (type === 'pillars' && Array.isArray(slide.pillars)) {
    slide.pillars.forEach((pillar, idx) => {
      const copyVal = Array.isArray(pillar.copy) ? pillar.copy.join('\n') : (pillar.copy ?? pillar.text ?? pillar.body ?? '');
      const removeBtn = slide.pillars.length > 1
        ? `<button type="button" class="edit-drawer__image-remove" data-remove-pillar="${idx}" title="Remove pillar ${idx + 1}" aria-label="Remove pillar ${idx + 1}" style="margin-left: auto;">×</button>`
        : '';
      fields.push(`
        <div class="accordion__group" style="padding-top: 8px; border-top: 1px dashed rgba(0,0,0,0.18);">
          <div style="display: flex; align-items: center; margin-bottom: 6px;">
            <span style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-surface);">Card ${idx + 1}</span>
            ${removeBtn}
          </div>
          ${buildInputField(`pillars.${idx}.title`, pillar.title || '', `Card ${idx + 1} title`)}
          ${buildTextareaField(`pillars.${idx}.copy`, copyVal, `Card ${idx + 1} copy`)}
        </div>
      `);
    });
    fields.push(`
      <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="add-pillar-btn">
        + Add Card
      </button>
    `);
  }

  // Grid / Gallery item captions (editable without touching raw JSON)
  if ((type === 'grid' || type === 'gallery') && Array.isArray(slide.items) && slide.items.length > 0) {
    slide.items.forEach((item, idx) => {
      const copyVal = Array.isArray(item.copy) ? item.copy.join('\n') : (item.copy || '');
      fields.push(`
        <div class="accordion__group" style="padding-top: 8px; border-top: 1px dashed rgba(0,0,0,0.18);">
          <span style="display: block; font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-surface); margin-bottom: 6px;">Item ${idx + 1}</span>
          ${buildInputField(`items.${idx}.label`, item.label || '', `Item ${idx + 1} label`)}
          ${type === 'gallery' ? buildTextareaField(`items.${idx}.copy`, copyVal, `Item ${idx + 1} copy`) : ''}
        </div>
      `);
    });
  }

  if (fields.length === 0) return '';

  return buildAccordion('Content', fields.join(''), { startOpen: true });
}

export function buildActionsSection() {
  // Changes save themselves: the drawer autosaves as you type, closing it
  // is "done". No toggle, no Save button, no decision.
  const content = `
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
    <div class="accordion__group">
      <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="layout-add-btn" title="Add a new slide after this one using this type" style="width: 100%;">
        + Add New Slide of This Type
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

function resolveBaseThemeValue(source = '') {
  let value = (source || '').trim();
  while (value.startsWith('random:')) {
    value = value.slice(7).trim();
  }
  return value.replace(/^\/+/, '');
}

function buildThemeSection() {
  const library = loadThemeLibrary();
  const rawPath = getCurrentThemePath() || 'theme.json';
  const basePath = resolveBaseThemeValue(rawPath);
  const isRandom = rawPath.startsWith('random:');

  const defaultThemes = [
    { value: 'theme.json', label: 'Default' },
    { value: 'themes/vaporwave.json', label: 'Vaporwave' },
    { value: 'themes/slack.json', label: 'Slack' },
    { value: 'themes/gameboy.json', label: 'Gameboy' },
  ];

  const savedThemes = library.map((entry) => ({
    value: `saved:${entry.name}`,
    label: `★ ${entry.name}`,
  }));

  const allThemes = [...defaultThemes, ...savedThemes];
  const matchedTheme = allThemes.find((t) => basePath === t.value || basePath.endsWith(t.value));
  const currentTheme = matchedTheme || {
    value: basePath || 'theme.json',
    label: isRandom ? 'Shuffled Theme' : 'Custom Theme',
  };
  const displayLabel = matchedTheme && isRandom ? `${currentTheme.label} (Shuffled)` : currentTheme.label;

  const themeOptions = allThemes.map(({ value, label }) => {
    const isSelected = matchedTheme?.value === value ? 'is-selected' : '';
    return `
      <button type="button" class="custom-select__option ${isSelected}" data-value="${escapeHtml(value)}">
        <span class="custom-select__option-label">${escapeHtml(label)}</span>
      </button>
    `;
  }).join('');

  const content = `
    <div class="accordion__group">
      <label class="edit-drawer__label">Style</label>
      <div class="custom-select" id="edit-theme-select" data-value="${escapeHtml(currentTheme.value)}">
        <button type="button" class="custom-select__trigger">
          <span class="custom-select__value">${escapeHtml(displayLabel)}</span>
          <span class="custom-select__arrow">▼</span>
        </button>
        <div class="custom-select__dropdown">
          ${themeOptions}
        </div>
      </div>
    </div>
    <div class="accordion__group" style="display: flex; gap: 10px;">
      <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="theme-random-btn-inline" title="Shuffle colors within this style (T)" style="flex: 1;">
        Shuffle (T)
      </button>
      <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="theme-save-btn-inline" title="Save current look to your browser" style="flex: 1;">
        Save Theme
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
      class="edit-drawer__textarea edit-drawer__textarea--json"
      id="slide-json-editor"
      rows="20"
    >${jsonString}</textarea>
  `;
  return buildAccordion('Advanced JSON', content, { modifier: ' accordion--advanced', startOpen: false });
}
