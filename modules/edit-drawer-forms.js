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
  { value: 'scroll', label: 'Scroll', description: 'Long-form page' },
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
  // Dictation routes through the Gemini proxy (which has a house key fallback),
  // so offer the mic whenever the browser supports MediaRecorder.
  const canDictate = Boolean(
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof window !== 'undefined' &&
    window.MediaRecorder
  );
  const dictateButton = canDictate
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

function serializeBodyForTextarea(body) {
  if (!body) return '';
  if (typeof body === 'string') return body;
  if (!Array.isArray(body)) return '';

  const markerMap = {
    info: '!!',
    didyouknow: '?!',
    question: '??',
    pull: '>>',
  };

  return body
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object' && entry.callout && !entry.title && typeof entry.body === 'string') {
        const prefix = markerMap[entry.callout] || '!!';
        return `${prefix} ${entry.body}`;
      }
      return null;
    })
    .filter((line) => line !== null)
    .join('\n');
}

function buildVisualBlockFields(slide, type) {
  if (type !== 'standard' && type !== 'scroll') return '';
  const blocks = [];

  // 1. Code block editor
  const codeSpec = slide.code
    ? (typeof slide.code === 'string'
      ? { code: slide.code, lang: slide.lang || '', title: slide.codeTitle || '' }
      : slide.code)
    : null;
  if (codeSpec) {
    blocks.push(`
      <div class="accordion__group" style="padding-top: 8px; border-top: 1px dashed rgba(var(--warm-black-rgb), 0.18);">
        <div style="display: flex; align-items: center; margin-bottom: 6px;">
          <span class="edit-drawer__sublabel" style="margin: 0;">Code Block</span>
          <button type="button" class="edit-drawer__image-remove" data-remove-block="code" title="Remove code block" aria-label="Remove code block" style="margin-left: auto;">×</button>
        </div>
        <div style="display: flex; gap: 8px;">
          ${buildInputField('visual.code.title', codeSpec.title || '', 'Filename / title')}
          ${buildInputField('visual.code.lang', codeSpec.lang || '', 'Language (js, bash…)')}
        </div>
        ${buildTextareaField('visual.code.code', codeSpec.code || '', 'Code snippet')}
      </div>
    `);
  }

  // 2. Vector chart editor
  const chartSpec = slide.chart
    ? (typeof slide.chart === 'string'
      ? { chart: slide.chart, title: slide.chartTitle || '', items: slide.items || [] }
      : slide.chart)
    : null;
  if (chartSpec) {
    const itemsLines = Array.isArray(chartSpec.items)
      ? chartSpec.items.map((item) => `${item.label ?? ''}: ${item.value ?? 0}`).join('\n')
      : '';
    blocks.push(`
      <div class="accordion__group" style="padding-top: 8px; border-top: 1px dashed rgba(var(--warm-black-rgb), 0.18);">
        <div style="display: flex; align-items: center; margin-bottom: 6px;">
          <span class="edit-drawer__sublabel" style="margin: 0;">Vector Chart</span>
          <button type="button" class="edit-drawer__image-remove" data-remove-block="chart" title="Remove chart" aria-label="Remove chart" style="margin-left: auto;">×</button>
        </div>
        <div style="display: flex; gap: 8px;">
          ${buildInputField('visual.chart.title', chartSpec.title || '', 'Chart title')}
          ${buildInputField('visual.chart.type', chartSpec.chart || 'bar', 'Type (bar, hbar, donut)')}
        </div>
        ${buildTextareaField('visual.chart.items', itemsLines, 'Label: Value (one per line)')}
      </div>
    `);
  }

  // 3. Ruled table editor
  const tableSpec = slide.table && typeof slide.table === 'object' ? slide.table : null;
  if (tableSpec) {
    const lines = [];
    if (Array.isArray(tableSpec.headers) && tableSpec.headers.length) {
      lines.push(tableSpec.headers.join(' | '));
    }
    if (Array.isArray(tableSpec.rows)) {
      tableSpec.rows.forEach((row) => {
        if (Array.isArray(row)) lines.push(row.join(' | '));
      });
    }
    blocks.push(`
      <div class="accordion__group" style="padding-top: 8px; border-top: 1px dashed rgba(var(--warm-black-rgb), 0.18);">
        <div style="display: flex; align-items: center; margin-bottom: 6px;">
          <span class="edit-drawer__sublabel" style="margin: 0;">Data Table</span>
          <button type="button" class="edit-drawer__image-remove" data-remove-block="table" title="Remove table" aria-label="Remove table" style="margin-left: auto;">×</button>
        </div>
        ${buildInputField('visual.table.title', tableSpec.title || '', 'Table title (optional)')}
        ${buildTextareaField('visual.table.rows', lines.join('\n'), 'Col 1 | Col 2 (first line = headers)')}
      </div>
    `);
  }

  // 4. Video / Embed editor
  const rawVideo = slide.video || slide.embed;
  const videoSpec = rawVideo
    ? (typeof rawVideo === 'string' ? { src: rawVideo, caption: '' } : rawVideo)
    : null;
  if (videoSpec) {
    blocks.push(`
      <div class="accordion__group" style="padding-top: 8px; border-top: 1px dashed rgba(var(--warm-black-rgb), 0.18);">
        <div style="display: flex; align-items: center; margin-bottom: 6px;">
          <span class="edit-drawer__sublabel" style="margin: 0;">Video / Embed</span>
          <button type="button" class="edit-drawer__image-remove" data-remove-block="video" title="Remove video" aria-label="Remove video" style="margin-left: auto;">×</button>
        </div>
        ${buildInputField('visual.video.src', videoSpec.src || videoSpec.video || videoSpec.embed || '', 'YouTube, Vimeo, Loom, or .mp4 URL')}
        ${buildInputField('visual.video.caption', videoSpec.caption || '', 'Caption (optional)')}
      </div>
    `);
  }

  // Add buttons for any block not currently attached
  const addButtons = [];
  if (!codeSpec) {
    addButtons.push('<button type="button" class="edit-drawer__button edit-drawer__button--secondary" data-add-block="code" style="flex: 1; min-width: 45%; padding: 6px 8px; font-size: 0.72rem;">+ Code</button>');
  }
  if (!chartSpec) {
    addButtons.push('<button type="button" class="edit-drawer__button edit-drawer__button--secondary" data-add-block="chart" style="flex: 1; min-width: 45%; padding: 6px 8px; font-size: 0.72rem;">+ Chart</button>');
  }
  if (!tableSpec) {
    addButtons.push('<button type="button" class="edit-drawer__button edit-drawer__button--secondary" data-add-block="table" style="flex: 1; min-width: 45%; padding: 6px 8px; font-size: 0.72rem;">+ Table</button>');
  }
  if (!videoSpec) {
    addButtons.push('<button type="button" class="edit-drawer__button edit-drawer__button--secondary" data-add-block="video" style="flex: 1; min-width: 45%; padding: 6px 8px; font-size: 0.72rem;">+ Video</button>');
  }

  if (addButtons.length > 0) {
    blocks.push(`
      <div style="display: flex; flex-wrap: wrap; gap: 8px; padding-top: 6px;">
        ${addButtons.join('')}
      </div>
    `);
  }

  return blocks.join('');
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
    // Theme first: it is a deck-level choice, not a property of this slide,
    // and hiding it at the bottom made it feel like an afterthought.
    buildThemeSection(),
    type === 'split' ? buildSplitContentSection(slide) : buildCombinedContentSection(slide, type),
    buildLayoutControl(type, slide.layout),
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
    ['standard', 'scroll', 'gallery', 'grid', 'pillars', 'split', 'image'].includes(type);

  if (shouldShowBody) {
    const bodyValue = serializeBodyForTextarea(slide.body);
    fields.push(buildTextareaField('body', bodyValue, 'Body copy'));
  }

  // Long-form opening paragraph (scroll pages)
  if (type === 'scroll' || Object.prototype.hasOwnProperty.call(slide, 'lead')) {
    fields.push(buildTextareaField('lead', slide.lead || '', 'Lead paragraph'));
  }

  // Visual Representers (Code, Chart, Table, Video)
  const visualControls = buildVisualBlockFields(slide, type);
  if (visualControls) {
    fields.push(visualControls);
  }

  // Pillars cards (editable without touching raw JSON)
  if (type === 'pillars' && Array.isArray(slide.pillars)) {
    slide.pillars.forEach((pillar, idx) => {
      const copyVal = Array.isArray(pillar.copy) ? pillar.copy.join('\n') : (pillar.copy ?? pillar.text ?? pillar.body ?? '');
      const removeBtn = slide.pillars.length > 1
        ? `<button type="button" class="edit-drawer__image-remove" data-remove-pillar="${idx}" title="Remove pillar ${idx + 1}" aria-label="Remove pillar ${idx + 1}" style="margin-left: auto;">×</button>`
        : '';
      fields.push(`
        <div class="accordion__group" style="padding-top: 8px; border-top: 1px dashed rgba(var(--warm-black-rgb), 0.18);">
          <div style="display: flex; align-items: center; margin-bottom: 6px;">
            <span class="edit-drawer__sublabel" style="margin: 0;">Card ${idx + 1}</span>
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
        <div class="accordion__group" style="padding-top: 8px; border-top: 1px dashed rgba(var(--warm-black-rgb), 0.18);">
          <span class="edit-drawer__sublabel">Item ${idx + 1}</span>
          ${buildInputField(`items.${idx}.label`, item.label || '', `Item ${idx + 1} label`)}
          ${type === 'gallery' ? buildTextareaField(`items.${idx}.copy`, copyVal, `Item ${idx + 1} copy`) : ''}
        </div>
      `);
    });
  }

  if (fields.length === 0) return '';

  return buildAccordion('Content', fields.join(''), { startOpen: true });
}

export function buildActionsSection({ index = 0, total = 1 } = {}) {
  const canMoveEarlier = index > 0;
  const canMoveLater = index < total - 1;
  // Changes save themselves: the drawer autosaves as you type, closing it
  // is "done". No toggle, no Save button, no decision.
  const content = `
    <div style="display: flex; gap: 10px;">
      <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="move-slide-earlier-btn" style="flex: 1;" ${canMoveEarlier ? '' : 'disabled'} title="Move slide earlier in deck">
        ← Move Earlier
      </button>
      <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="move-slide-later-btn" style="flex: 1;" ${canMoveLater ? '' : 'disabled'} title="Move slide later in deck">
        Move Later →
      </button>
    </div>
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
    ${buildInputField('headline', slide.headline || '', 'Slide Headline')}
    <div class="accordion__group">
      <p class="edit-drawer__sublabel">Left Column</p>
      ${buildInputField('left.headline', left.headline || '', 'Headline')}
      ${buildTextareaField('left.body', serializeBodyForTextarea(left.body), 'Body copy')}
    </div>
    <div class="accordion__group">
      <p class="edit-drawer__sublabel">Right Column</p>
      ${buildInputField('right.headline', right.headline || '', 'Headline')}
      ${buildTextareaField('right.body', serializeBodyForTextarea(right.body), 'Body copy')}
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
      <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="theme-random-btn-inline" title="Shuffle colours within this style" style="flex: 1;">
        Shuffle
      </button>
      <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="theme-save-btn-inline" title="Save current look locally" style="flex: 1;">
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
