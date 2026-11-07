import { debug } from './constants.js';
import { autoLinkConfigs } from './state.js';
import { slidesRoot } from './dom-refs.js';
import { createImage, createImagePlaceholder, normalizeOrientation, generateGraphImage } from './image-render.js';
import { escapeHtml } from './utils.js';
import { navigateToDeckHome } from './navigation.js';

// ═══════════════════════════════════════════════════════════════════════════
// Slide Rendering Module
// ═══════════════════════════════════════════════════════════════════════════

function handleHomeBadgeClick(event) {
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigateToDeckHome();
}

function handleHomeBadgeKeydown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        navigateToDeckHome();
    }
}

export function attachSlideHomeBadge(badge) {
    if (badge.dataset.navHomeBound === 'true') return;
    badge.dataset.navHomeBound = 'true';
    badge.setAttribute('role', 'link');
    badge.tabIndex = 0;
    badge.addEventListener('click', handleHomeBadgeClick);
    badge.addEventListener('keydown', handleHomeBadgeKeydown);
}

export function renderLoadError(error) {
    const message = document.createElement('section');
    message.className = 'slide slide--error is-active';
    message.innerHTML = `
    <h2>Unable to load slides</h2>
    <p>Refresh the page or check the deck file.</p>
    ${error ? `<pre>${escapeHtml(error.message)}</pre>` : ''}
  `;
    slidesRoot.appendChild(message);
}

export function renderEmptyState() {
    const message = document.createElement('section');
    message.className = 'slide slide--empty is-active';
    message.innerHTML = `
    <h2>No slides available</h2>
    <p>Add slide data to <code>slides.json</code> to render this deck.</p>
  `;
    slidesRoot.appendChild(message);
}



// ═══════════════════════════════════════════════════════════════════════════
// Slide Construction
// ═══════════════════════════════════════════════════════════════════════════

export const renderers = {
    title: renderTitleSlide,
    standard: renderStandardSlide,
    scroll: renderScrollSlide,
    quote: renderQuoteSlide,
    split: renderSplitSlide,
    grid: renderGridSlide,
    pillars: renderPillarsSlide,
    gallery: renderGallerySlide,
    typeface: renderTypefaceSlide,
    image: renderImageSlide,
    graph: renderGraphSlide,
};

export function createSlide(slide, index, rendererMap = renderers) {
    try {
        return buildSlide(slide, index, rendererMap);
    } catch (error) {
        // Decks arrive from share links and hand-edited JSON; one bad slide
        // must not take down the whole deck (or strand the loading overlay).
        console.warn(`Slide ${index + 1} failed to render:`, error);
        return createBrokenSlide(index, error);
    }
}

function createBrokenSlide(index, error) {
    const section = document.createElement('section');
    section.className = 'slide slide--error';
    section.dataset.index = index;
    section.setAttribute('aria-hidden', 'true');
    section.setAttribute('role', 'group');
    section.setAttribute('aria-roledescription', 'slide');
    section.setAttribute('aria-label', `Slide ${index + 1}: failed to render`);
    const detail = error ? `<pre>${escapeHtml(String(error.message || error))}</pre>` : '';
    section.innerHTML = `
    <h2>This slide couldn't be rendered</h2>
    <p>Its data has a problem — press <kbd>E</kbd> to inspect and fix it.</p>
    ${detail}
  `;
    return section;
}

function buildSlide(slide, index, rendererMap = renderers) {
    const type = slide.type ?? 'standard';
    const section = document.createElement('section');
    section.className = `slide slide--${type}`;
    section.dataset.index = index;
    section.setAttribute('aria-hidden', 'true');
    section.setAttribute('role', 'group');
    section.setAttribute('aria-roledescription', 'slide');
    section.setAttribute('aria-label', getSlideAriaLabel(slide, index));

    if (slide.image) {
        debug('createSlide - Slide has image:', {
            index,
            srcPrefix: slide.image.src?.substring(0, 50),
            hasImage: !!slide.image,
            hasSrc: !!slide.image.src
        });
    }

    // Apply font preset or custom font
    if (slide.font) {
        const fontFamily = resolveFontFamily(slide.font);
        if (fontFamily) {
            section.style.fontFamily = fontFamily;
        }
    }

    const renderer = rendererMap[type] ?? renderStandardSlide;
    renderer(section, slide);

    const directBadge = Array.from(section.children).some((child) =>
        child.classList?.contains('badge')
    );
    const badgeDisabled =
        slide.badge === false || slide.autoBadge === false;
    const manualBadgeValue =
        typeof slide.badge === 'string'
            ? slide.badge.trim()
            : typeof slide.badge === 'number'
                ? String(slide.badge)
                : '';

    if (!directBadge && !badgeDisabled) {
        if (manualBadgeValue) {
            section.insertBefore(
                createBadge(manualBadgeValue),
                section.firstChild ?? null
            );
        } else if (slide.autoBadge !== false) {
            const autoBadge = createBadge(`Slide ${index + 1}`);
            autoBadge.dataset.badgeAuto = 'true';
            section.insertBefore(autoBadge, section.firstChild ?? null);
        }
    }

    const content = document.createElement('div');
    content.className = 'slide__content';

    const nodes = [];
    while (section.firstChild) {
        nodes.push(section.removeChild(section.firstChild));
    }

    nodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE && /** @type {Element} */ (node).classList.contains('badge')) {
            section.appendChild(node);
        } else {
            content.appendChild(node);
        }
    });

    section.appendChild(content);

    const rootBadge = section.querySelector(':scope > .badge');
    if (rootBadge) {
        attachSlideHomeBadge(rootBadge);
    }

    // The overview shows each card as a contact sheet: number plus the
    // section badge (or short title/type fallback) it belongs to. Stamped here
    // because the plaque is drawn with a pseudo-element, and pseudo-elements
    // can only read attributes.
    const overviewLabel =
        manualBadgeValue ||
        getPlainSlideText(slide.eyebrow ?? slide.title ?? slide.headline ?? slide.type ?? '');
    if (overviewLabel) {
        section.dataset.badge = ` · ${overviewLabel}`;
    } else {
        section.dataset.badge = '';
    }

    return section;
}

function getSlideAriaLabel(slide, index) {
    const title = getPlainSlideText(
        slide.title ??
        slide.headline ??
        slide.quote ??
        slide.eyebrow ??
        slide.badge
    );
    return title ? `Slide ${index + 1}: ${title}` : `Slide ${index + 1}`;
}

function getPlainSlideText(value) {
    if (Array.isArray(value)) {
        return value.map(getPlainSlideText).filter(Boolean).join(' ');
    }
    if (value === null || value === undefined || value === false) {
        return '';
    }
    return String(value).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function resolveFontFamily(font) {
    const presets = {
        sans: '"Inter", "Helvetica Neue", Arial, sans-serif',
        mono: '"Space Mono", "IBM Plex Mono", monospace',
        grotesk: '"Space Grotesk", sans-serif',
        jetbrains: '"JetBrains Mono", monospace',
        pixel: '"Press Start 2P", monospace',
    };

    // Check if it's a preset
    const lowerFont = font.toLowerCase();
    if (presets[lowerFont]) {
        return presets[lowerFont];
    }

    // Otherwise use as custom font (wrap in quotes if not already)
    if (font.includes('"') || font.includes("'")) {
        return font;
    }
    return `"${font}", sans-serif`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Renderers
// ═══════════════════════════════════════════════════════════════════════════

export function renderTitleSlide(section, slide) {
    if (slide.eyebrow) {
        section.appendChild(createBadge(slide.eyebrow));
    }

    if (slide.title) {
        const title = document.createElement('h1');
        title.textContent = slide.title;
        section.appendChild(title);
    }

    if (slide.subtitle) {
        const subtitle = document.createElement('p');
        subtitle.className = 'title__subtitle';
        setRichContent(subtitle, slide.subtitle);
        section.appendChild(subtitle);
    }

    if (Array.isArray(slide.media) && slide.media.length > 0) {
        section.appendChild(createMediaStrip(slide.media));
    }

    if (slide.footnote) {
        section.appendChild(createFootnote(slide.footnote));
    }
}

function addSafeVariantClasses(element, prefix, rawValue) {
    const values = Array.isArray(rawValue) ? rawValue : rawValue ? [rawValue] : [];
    values.forEach((val) => {
        String(val || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .forEach((token) => {
                const safeToken = token.replace(/[^a-zA-Z0-9_-]/g, '');
                if (safeToken) {
                    element.classList.add(`${prefix}${safeToken}`);
                }
            });
    });
}

export function renderStandardSlide(section, slide) {
    // Apply layout class if specified. Default behavior is stacked.
    if (slide.layout) {
        addSafeVariantClasses(section, 'slide--layout-', slide.layout);
    }

    const textGroup = document.createElement('div');
    textGroup.className = 'slide__standard-text';

    if (slide.headline) {
        const headline = document.createElement('h2');
        setRichContent(headline, slide.headline);
        textGroup.appendChild(headline);
    }

    appendBody(textGroup, slide.body);

    const visualStage = document.createElement('div');
    visualStage.className = 'slide__visual-stage';
    appendSlideVisualBlocks(visualStage, slide);

    // If a standard slide put its single visual representer inside `body` (and has
    // no top-level visual or image), promote that block into `.slide__visual-stage`
    // so side-by-side layouts and solo-embed slides place it as the visual centerpiece.
    if (!slide.image && visualStage.childNodes.length === 0) {
        const inlineVisuals = textGroup.querySelectorAll(
            ':scope > .code-card, :scope > .vector-chart, :scope > .slide-table-wrap, :scope > .video-card'
        );
        if (inlineVisuals.length === 1) {
            visualStage.appendChild(inlineVisuals[0]);
        }
    }

    const hasProseCopy = Boolean(
        textGroup.querySelector('p, ul, ol, blockquote, .callout, .body-heading')
    );
    if (!hasProseCopy && !slide.image && visualStage.childNodes.length > 0) {
        section.classList.add('slide--visual-solo');
    }

    if (textGroup.childNodes.length > 0) {
        section.appendChild(textGroup);
    }

    if (slide.image) {
        // Create image wrapper for better control
        const wrapper = document.createElement('div');
        wrapper.className = 'slide__image-wrapper';

        // Use full image style but contained in wrapper
        const imageElement = createImage(slide.image, 'slide__image', {
            orientationTarget: section,
        });
        wrapper.appendChild(imageElement);
        section.appendChild(wrapper);
        if (visualStage.childNodes.length > 0) {
            textGroup.append(...visualStage.childNodes);
        }
    } else if (visualStage.childNodes.length > 0) {
        section.appendChild(visualStage);
    }

    if (slide.footnote) {
        section.appendChild(createFootnote(slide.footnote));
    }
}

export function renderScrollSlide(section, slide) {
    section.classList.add('slide--scroll');
    addSafeVariantClasses(section, 'slide--scroll--', slide.variant);

    if (slide.headline) {
        const headline = document.createElement('h2');
        setRichContent(headline, slide.headline);
        section.appendChild(headline);
    }

    if (slide.lead) {
        const lead = document.createElement('p');
        lead.className = 'scroll__lead';
        setRichContent(lead, slide.lead);
        section.appendChild(lead);
    }

    if (slide.body || slide.code || slide.chart || slide.table || slide.video || slide.embed) {
        const body = document.createElement('div');
        body.className = 'scroll__body';
        appendBody(body, slide.body);
        appendSlideVisualBlocks(body, slide);
        section.appendChild(body);
    }

    if (slide.footnote) {
        section.appendChild(createFootnote(slide.footnote));
    }
}

export function renderImageSlide(section, slide) {
    section.classList.add('slide--image');

    // If no image object, create an empty one to trigger placeholder
    const imageObj = slide.image || {};
    
    // Create wrapper first
    const wrapper = document.createElement('div');
    wrapper.className = 'slide__image-wrapper';

    // createImage will handle placeholder generation if src is missing
    const imageElement = createImage(imageObj, 'slide__image slide__image--full', {
        orientationTarget: section,
    });
    wrapper.appendChild(imageElement);

    if (slide.caption) {
        const caption = document.createElement('div');
        caption.className = 'slide__image-caption';
        setRichContent(caption, slide.caption);
        wrapper.appendChild(caption);
    }

    section.appendChild(wrapper);
}

export function renderQuoteSlide(section, slide) {
    section.classList.add('slide--quote');
    if (slide.variant) {
        addSafeVariantClasses(section, 'slide--quote--', slide.variant);
    }

    const quoteText = slide.quote ?? slide.headline ?? '';
    const quote = document.createElement('blockquote');
    setRichContent(quote, quoteText);
    section.appendChild(quote);

    const attributionText = slide.attribution ?? slide.body;
    if (attributionText) {
        const cite = document.createElement('cite');
        setRichContent(cite, attributionText);
        section.appendChild(cite);
    }
}

export function renderSplitSlide(section, slide) {
    section.classList.add('slide--split');
    addSafeVariantClasses(section, 'slide--split--', slide.variant);

    if (slide.headline) {
        const headline = document.createElement('h2');
        setRichContent(headline, slide.headline);
        section.appendChild(headline);
    }

    const leftColumn = document.createElement('div');
    leftColumn.className = 'slide__column slide__column--left';
    const rightColumn = document.createElement('div');
    rightColumn.className = 'slide__column slide__column--right';

    renderColumn(leftColumn, slide.left);
    renderColumn(rightColumn, slide.right);

    section.append(leftColumn, rightColumn);
}

export function renderGridSlide(section, slide) {
    section.classList.add('slide--grid');

    if (slide.headline) {
        const headline = document.createElement('h2');
        setRichContent(headline, slide.headline);
        section.appendChild(headline);
    }

    appendBody(section, slide.body);

    if (Array.isArray(slide.items)) {
        const grid = document.createElement('div');
        grid.className = 'grid';

        slide.items.forEach((item) => {
            const figure = document.createElement('figure');
            if (item.image) {
                figure.appendChild(createImage(item.image));
            } else if (item.color) {
                const swatch = createColorBlock(item);
                figure.appendChild(swatch);
            }
            if (item.label) {
                const caption = document.createElement('figcaption');
                setRichContent(caption, item.label);
                figure.appendChild(caption);
            }
            grid.appendChild(figure);
        });

        section.appendChild(grid);
    }

    if (slide.footnote) {
        section.appendChild(createFootnote(slide.footnote));
    }
}

export function renderPillarsSlide(section, slide) {
    section.classList.add('slide--pillars');

    if (slide.headline) {
        const headline = document.createElement('h2');
        setRichContent(headline, slide.headline);
        section.appendChild(headline);
    }

    appendBody(section, slide.body);

    if (slide.image) {
        section.appendChild(createImage(slide.image));
    }

    if (Array.isArray(slide.pillars)) {
        const wrapper = document.createElement('div');
        wrapper.className = 'pillars';

        slide.pillars.forEach((pillar) => {
            const card = document.createElement('article');
            card.className = 'pillar';

            if (pillar.image) {
                const imageData =
                    typeof pillar.image === 'string'
                        ? { src: pillar.image, alt: pillar.title || '' }
                        : pillar.image;
                const img = createImage(imageData, 'pillar__image');
                card.appendChild(img);
            }

            if (pillar.title) {
                const heading = document.createElement('h3');
                setRichContent(heading, pillar.title);
                card.appendChild(heading);
            }

            const pillarCopy =
                pillar.copy ??
                pillar.text ??
                pillar.body ??
                pillar.description ??
                null;

            if (pillarCopy) {
                const copyLines = Array.isArray(pillarCopy) ? pillarCopy : [pillarCopy];
                copyLines.forEach((line) => {
                    if (!line) return;
                    const text = document.createElement('p');
                    setRichContent(text, line);
                    card.appendChild(text);
                });
            }

            wrapper.appendChild(card);
        });

        section.appendChild(wrapper);
    }

    if (slide.footnote) {
        section.appendChild(createFootnote(slide.footnote));
    }
}

export function renderGallerySlide(section, slide) {
    section.classList.add('slide--gallery');

    if (slide.headline) {
        const headline = document.createElement('h2');
        setRichContent(headline, slide.headline);
        section.appendChild(headline);
    }

    appendBody(section, slide.body);

    if (Array.isArray(slide.items)) {
        const gallery = document.createElement('div');
        gallery.className = 'gallery';

        slide.items.forEach((item) => {
            const card = document.createElement('article');
            card.className = 'gallery__item';

            if (item.image) {
                card.appendChild(createImage(item.image, 'gallery__image'));
            } else if (item.color) {
                card.appendChild(createColorBlock(item, 'gallery__color'));
            }

            if (item.label) {
                const label = document.createElement('span');
                label.className = 'gallery__label';
                setRichContent(label, item.label);
                card.appendChild(label);
            }

            if (item.copy) {
                const copyLines = Array.isArray(item.copy) ? item.copy : [item.copy];
                copyLines.forEach((line) => {
                    if (!line) return;
                    const text = document.createElement('p');
                    text.className = 'gallery__copy';
                    setRichContent(text, line);
                    card.appendChild(text);
                });
            }

            gallery.appendChild(card);
        });

        section.appendChild(gallery);
    }

    if (slide.footnote) {
        section.appendChild(createFootnote(slide.footnote));
    }
}

export function renderGraphSlide(section, slide) {
    const content = document.createElement('div');
    content.className = 'slide__graph';

    if (slide.title) {
        const title = document.createElement('h2');
        title.textContent = slide.title;
        content.appendChild(title);
    }

    if (slide.description && !slide.imageData) {
        const description = document.createElement('p');
        description.className = 'graph-description';
        description.textContent = slide.description;
        content.appendChild(description);
    }

    const graphContainer = document.createElement('div');
    graphContainer.className = 'graph-container';

    if (slide.imageData) {
        const img = document.createElement('img');
        img.className = 'graph-image';
        img.src = slide.imageData;
        img.alt = slide.description || 'Generated graph';
        img.dataset.orientation = normalizeOrientation(slide.orientation);

        const regenerateBtn = document.createElement('button');
        regenerateBtn.className = 'graph-regenerate-btn';
        regenerateBtn.textContent = '🔄 Regenerate';
        regenerateBtn.addEventListener('click', () => generateGraphImage(slide, graphContainer));

        graphContainer.appendChild(img);
        graphContainer.appendChild(regenerateBtn);
    } else {
        const placeholder = createImagePlaceholder(
            {
                alt: slide.description || 'Describe and generate graph',
                __magicHandler: async () => generateGraphImage(slide, graphContainer),
            },
            'graph-placeholder',
            'graph'
        );
        graphContainer.appendChild(placeholder);
    }

    content.appendChild(graphContainer);
    section.appendChild(content);
    return section;
}

export function renderTypefaceSlide(section, slide) {
    section.classList.add('slide--typeface');

    if (slide.headline) {
        const headline = document.createElement('h2');
        setRichContent(headline, slide.headline);
        section.appendChild(headline);
    }

    if (slide.image) {
        section.appendChild(createImage(slide.image));
    }

    const fontArray = slide.fonts || slide.samples;
    if (Array.isArray(fontArray)) {
        const wrapper = document.createElement('div');
        wrapper.className = 'typeface-grid';

        fontArray.forEach((font) => {
            const card = document.createElement('article');
            card.className = 'typeface-card';

            const fontFamily = font.font;
            const displayText = font.text || font.sample || slide.sample || 'The quick brown fox jumps over the lazy dog';

            if (font.name) {
                const label = document.createElement('span');
                label.className = 'typeface-card__label';
                label.textContent = font.name;
                card.appendChild(label);
            }

            const sample = document.createElement('p');
            sample.className = 'typeface-card__sample';
            sample.style.fontFamily = fontFamily;
            if (font.weight) sample.style.fontWeight = font.weight;
            sample.textContent = displayText;
            card.appendChild(sample);

            if (font.note) {
                const note = document.createElement('span');
                note.className = 'typeface-card__note';
                note.textContent = font.note;
                card.appendChild(note);
            }

            wrapper.appendChild(card);
        });

        section.appendChild(wrapper);
    }

    appendBody(section, slide.body);

    if (slide.footnote) {
        section.appendChild(createFootnote(slide.footnote));
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

export function renderColumn(column, data = {}) {
    if (!data) return;
    const imageNode = data.image ? createImage(data.image) : null;
    const imageFirst = Boolean(data.imageFirst || data.imagePosition === 'top');

    if (data.badge) {
        column.appendChild(createBadge(data.badge));
    }
    if (data.headline) {
        const headline = document.createElement('h3');
        setRichContent(headline, data.headline);
        column.appendChild(headline);
    }

    if (imageFirst && imageNode) {
        column.appendChild(imageNode);
    }

    appendBody(column, data.body);

    if (!imageFirst && imageNode) {
        column.appendChild(imageNode);
    }

    if (data.footnote) {
        column.appendChild(createFootnote(data.footnote));
    }
}

export function appendSlideVisualBlocks(container, slide) {
    if (!slide || typeof slide !== 'object') return;
    if (slide.code && typeof slide.code === 'string') {
        container.appendChild(createCodeBlock({
            code: slide.code,
            lang: slide.lang || slide.language || '',
            title: slide.codeTitle || ''
        }));
    } else if (slide.code && typeof slide.code === 'object') {
        container.appendChild(createCodeBlock(slide.code));
    }
    if (slide.chart) {
        const chartSpec = typeof slide.chart === 'string'
            ? { chart: slide.chart, title: slide.chartTitle, unit: slide.unit, items: slide.items, labels: slide.labels, values: slide.values }
            : slide.chart;
        container.appendChild(createVectorChart(chartSpec));
    }
    if (slide.table && typeof slide.table === 'object') {
        container.appendChild(createTableBlock(slide.table));
    }
    if (slide.video || slide.embed) {
        container.appendChild(createVideoBlock(slide.video || slide.embed));
    }
}

export function appendBody(container, body) {
    if (!body) return;
    const copy = Array.isArray(body) ? body : [body];
    // Consecutive "- " lines group into one ul so decks can use real dot
    // points (the .slide ul li accent-bar styling was unreachable before)
    let listEl = null;
    let tableLines = [];

    const flushTableLines = () => {
        if (!tableLines.length) return;
        const parsedTable = parseMarkdownTable(tableLines);
        tableLines = [];
        if (parsedTable) {
            container.appendChild(createTableBlock(parsedTable));
        }
    };

    copy.forEach((text) => {
        if (!text) {
            listEl = null;
            flushTableLines();
            return;
        }

        // Group consecutive markdown pipe-table rows ("| Col A | Col B |")
        if (typeof text === 'string' && /^\s*\|.+\|\s*$/.test(text)) {
            listEl = null;
            tableLines.push(text.trim());
            return;
        }
        flushTableLines();

        if (typeof text === 'object') {
            listEl = null;
            // Object-form callout: { callout: "info"|"didyouknow"|"warning"|"pull", title, body }
            if (text.callout) {
                container.appendChild(createCallout(text));
                return;
            }
            // Object-form code card: { code: "...", lang?: "js", title?: "app.js" }
            if (typeof text.code === 'string') {
                container.appendChild(createCodeBlock(text));
                return;
            }
            // Object-form vector chart: { chart: "bar"|"hbar"|"donut", title, items, labels, values }
            if (text.chart) {
                container.appendChild(createVectorChart(text));
                return;
            }
            // Object-form data table: { table: { headers, rows } } or { headers, rows }
            if (text.table || Array.isArray(text.rows)) {
                container.appendChild(createTableBlock(text.table || text));
                return;
            }
            // Object-form video / embed: { video: "..." } or { embed: "..." }
            if (text.video || text.embed) {
                container.appendChild(createVideoBlock(text.video || text.embed || text));
                return;
            }
        }

        // Fenced code block shorthand inside a body string: ```lang\n...\n```
        if (typeof text === 'string') {
            const fenceMatch = text.match(/^\s*```([a-zA-Z0-9_-]*)(?:[ \t]+([^\n]+))?\n([\s\S]*?)```\s*$/);
            if (fenceMatch) {
                listEl = null;
                container.appendChild(createCodeBlock({
                    lang: fenceMatch[1] || '',
                    title: fenceMatch[2] || '',
                    code: fenceMatch[3].replace(/\n$/, ''),
                }));
                return;
            }
        }

        // String-form callout markers keep hand-written JSON readable:
        //   "!! text"  info box      "?! text"  did-you-know
        //   "?? text"  open question ">> text"  pull quote
        if (typeof text === 'string') {
            const markerMatch = text.match(/^\s*(!!|\?!|\?\?|>>)\s+([\s\S]+)$/);
            if (markerMatch) {
                listEl = null;
                const kinds = { '!!': 'info', '?!': 'didyouknow', '??': 'question', '>>': 'pull' };
                container.appendChild(createCallout({
                    callout: kinds[markerMatch[1]],
                    body: markerMatch[2]
                }));
                return;
            }
        }

        // Section subheading inside body copy: "## Heading" or "### Heading".
        // Lets a scroll page read as a document with real sections rather than
        // one long run of paragraphs.
        if (typeof text === 'string') {
            const headingMatch = text.match(/^\s*#{2,3}\s+(.+)$/);
            if (headingMatch) {
                listEl = null;
                const heading = document.createElement('h3');
                heading.className = 'body-heading';
                setRichContent(heading, headingMatch[1]);
                container.appendChild(heading);
                return;
            }
        }

        const bulletMatch = typeof text === 'string' && text.match(/^\s*[-•]\s+(.+)$/);
        if (bulletMatch) {
            if (!listEl) {
                listEl = document.createElement('ul');
                container.appendChild(listEl);
            }
            const item = document.createElement('li');
            setRichContent(item, bulletMatch[1]);
            listEl.appendChild(item);
            return;
        }
        listEl = null;
        const quoteElement = maybeCreateQuoteElement(text);
        if (quoteElement) {
            container.appendChild(quoteElement);
            return;
        }
        const paragraph = document.createElement('p');
        setRichContent(paragraph, text);
        container.appendChild(paragraph);
    });
    flushTableLines();
}

const CALLOUT_LABELS = {
    info: 'Note',
    didyouknow: 'Did you know',
    warning: 'Careful',
    question: 'Open question',
    pull: 'Margin note'
};

export function createCallout(data) {
    const kind = CALLOUT_LABELS[data.callout] ? data.callout : 'info';
    const box = document.createElement('div');
    box.className = `callout callout--${kind}`;

    const label = document.createElement('div');
    label.className = 'callout__label';
    label.textContent = data.label || CALLOUT_LABELS[kind];
    box.appendChild(label);

    if (data.title) {
        const title = document.createElement('div');
        title.className = 'callout__title';
        setRichContent(title, data.title);
        box.appendChild(title);
    }

    const bodyEl = document.createElement('div');
    bodyEl.className = 'callout__body';
    setRichContent(bodyEl, data.body || '');
    box.appendChild(bodyEl);

    return box;
}

export function createBadge(label) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    setRichContent(badge, label);
    return badge;
}

export function createFootnote(text) {
    const footnote = document.createElement('p');
    footnote.className = 'slide__footnote';
    setRichContent(footnote, text);
    return footnote;
}

export function createMediaStrip(media) {
    const container = document.createElement('div');
    container.className = 'media-strip';

    media.forEach((item) => {
        if (item.image) {
            container.appendChild(createImage(item.image, 'media-strip__image'));
        } else if (item.color) {
            container.appendChild(createColorBlock(item, 'media-strip__color'));
        }
    });

    return container;
}

export function createColorBlock(item, className = 'gallery__color') {
    const block = document.createElement('div');
    block.className = className;
    block.style.background = item.color;
    if (item.label) {
        block.textContent = item.label;
    }
    return block;
}

export function setRichContent(element, html) {
    if (html == null) return;
    element.innerHTML = parseMarkdown(html);
    applyAutoLinksToElement(element);
}

function parseMarkdown(text) {
    if (typeof text !== 'string') return text;

    let safe = escapeHtml(text);

    safe = safe
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.+?)__/g, '<strong>$1</strong>')
        .replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '<em>$1</em>')
        .replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');

    safe = safe.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
        const sanitizedUrl = sanitizeUrl(url);
        if (!sanitizedUrl) {
            return linkText;
        }
        return `<a href="${sanitizedUrl}" rel="noopener noreferrer">${linkText}</a>`;
    });

    return safe;
}

function sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return null;

    const trimmed = url.trim();
    if (!trimmed) return null;

    try {
        const parsed = new URL(trimmed, window.location.href);
        const safeProtocols = ['http:', 'https:', 'mailto:', 'tel:'];
        if (safeProtocols.includes(parsed.protocol)) {
            return parsed.href;
        }
        return null;
  } catch (_error) {
        if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
            return trimmed;
        }
        return null;
    }
}

function maybeCreateQuoteElement(raw) {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const quoteMatch = trimmed.match(/^(["“])(.*?)(["”])(?:\s*(?:[—–-]{1,2})\s*(.+))?$/s);
    if (!quoteMatch) {
        return null;
    }

    const [, , quoteBody, , attribution] = quoteMatch;
    const block = document.createElement('blockquote');
    block.className = 'quote-block';

    const quoteSpan = document.createElement('span');
    setRichContent(quoteSpan, quoteBody.trim());
    block.append(...quoteSpan.childNodes);

    if (attribution) {
        const cite = document.createElement('cite');
        setRichContent(cite, attribution.trim());
        block.appendChild(cite);
    }

    return block;
}

function applyAutoLinksToElement(element) {
    if (!autoLinkConfigs.length || !element) return;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node || !node.nodeValue || !node.nodeValue.trim()) {
                return NodeFilter.FILTER_REJECT;
            }
            if (node.parentElement && node.parentElement.closest('a')) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        },
    });

    const textNodes = [];
    let current;
    while ((current = walker.nextNode())) {
        textNodes.push(current);
    }

    textNodes.forEach((node) => {
        const original = node.nodeValue;
        const matches = [];

        autoLinkConfigs.forEach((config) => {
            config.regex.lastIndex = 0;
            let match;
            while ((match = config.regex.exec(original)) !== null) {
                matches.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    text: match[0],
                    config,
                });
            }
        });

        if (!matches.length) return;
        matches.sort((a, b) => a.start - b.start);

        const filtered = [];
        let lastEnd = -1;
        matches.forEach((match) => {
            if (match.start < lastEnd) return;
            filtered.push(match);
            lastEnd = match.end;
        });

        const fragment = document.createDocumentFragment();
        let cursor = 0;
        filtered.forEach((match) => {
            if (match.start > cursor) {
                fragment.appendChild(
                    document.createTextNode(original.slice(cursor, match.start))
                );
            }
            fragment.appendChild(createAutoLink(match.text, match.config));
            cursor = match.end;
        });

        if (cursor < original.length) {
            fragment.appendChild(
                document.createTextNode(original.slice(cursor))
            );
        }

        node.parentNode.replaceChild(fragment, node);
    });
}

function createAutoLink(text, config) {
    const anchor = document.createElement('a');
    anchor.textContent = text;
    anchor.href = buildAutoLinkHref(text, config);
    if (config.openInNewTab) {
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
    }
    anchor.className = 'auto-link';
    return anchor;
}

function buildAutoLinkHref(text, config) {
    if (config.urlTemplate) {
        return config.urlTemplate.replace(/%s/g, encodeURIComponent(text.trim()));
    }
    if (config.url) {
        return config.url;
    }
    const query = config.search ?? text;
    return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(
        query
    )}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Visual Representers: Code Cards, Ruled Tables, Vector Charts, Video Embeds
// ═══════════════════════════════════════════════════════════════════════════

const MAX_HIGHLIGHT_CHARS = 20_000;
const CODE_KEYWORDS = new Set([
    'const', 'let', 'var', 'function', 'return', 'async', 'await', 'import',
    'export', 'from', 'default', 'if', 'else', 'for', 'while', 'switch',
    'case', 'break', 'new', 'class', 'extends', 'try', 'catch', 'finally',
    'throw', 'true', 'false', 'null', 'undefined', 'def', 'elif', 'None',
    'True', 'False', 'curl', 'git', 'npm', 'node', 'deno', 'bash', 'sh',
    'ssh', 'docker', 'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES',
    'UPDATE', 'DELETE', 'JOIN', 'ORDER', 'BY', 'LIMIT',
]);

function isIdentStart(ch) {
    const code = ch.charCodeAt(0);
    return (
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        code === 95 ||
        code === 36
    );
}

function isIdentPart(ch) {
    const code = ch.charCodeAt(0);
    return (
        isIdentStart(ch) ||
        (code >= 48 && code <= 57)
    );
}

function isDigit(ch) {
    const code = ch.charCodeAt(0);
    return code >= 48 && code <= 57;
}

export function highlightCodeHtml(rawCode = '') {
    const fullSource = String(rawCode ?? '');
    const source = fullSource.length > MAX_HIGHLIGHT_CHARS
        ? fullSource.slice(0, MAX_HIGHLIGHT_CHARS)
        : fullSource;
    const remainder = fullSource.length > MAX_HIGHLIGHT_CHARS
        ? fullSource.slice(MAX_HIGHLIGHT_CHARS)
        : '';

    const len = source.length;
    let out = '';
    let i = 0;

    while (i < len) {
        const ch = source[i];
        const next = i + 1 < len ? source[i + 1] : '';

        // Line comment: // or #
        if ((ch === '/' && next === '/') || ch === '#') {
            let end = source.indexOf('\n', i);
            if (end === -1) end = len;
            out += `<span class="tok-comment">${escapeHtml(source.slice(i, end))}</span>`;
            i = end;
            continue;
        }

        // Block comment: /* ... */
        if (ch === '/' && next === '*') {
            let end = source.indexOf('*/', i + 2);
            if (end === -1) end = len;
            else end += 2;
            out += `<span class="tok-comment">${escapeHtml(source.slice(i, end))}</span>`;
            i = end;
            continue;
        }

        // Single-pass string literal: "...", '...', `...` (never backtracks)
        if (ch === '"' || ch === "'" || ch === '`') {
            const quote = ch;
            let j = i + 1;
            while (j < len) {
                const c = source[j];
                if (c === '\\') {
                    j += 2;
                    continue;
                }
                if (c === quote) {
                    j += 1;
                    break;
                }
                if (c === '\n' && quote !== '`') {
                    break;
                }
                j += 1;
            }
            out += `<span class="tok-string">${escapeHtml(source.slice(i, Math.min(j, len)))}</span>`;
            i = Math.min(j, len);
            continue;
        }

        // CLI flag after whitespace: -x or --flag-name
        if (
            (ch === ' ' || ch === '\t' || ch === '\n') &&
            next === '-' &&
            i + 2 < len &&
            (source[i + 2] === '-' || isIdentPart(source[i + 2]))
        ) {
            let j = i + 2;
            if (source[j] === '-') j += 1;
            const flagStart = j;
            while (j < len && (isIdentPart(source[j]) || source[j] === '-')) {
                j += 1;
            }
            if (j > flagStart) {
                out += `<span class="tok-flag">${escapeHtml(source.slice(i, j))}</span>`;
                i = j;
                continue;
            }
        }

        // Number literal at word boundary
        if (isDigit(ch) && (i === 0 || !isIdentPart(source[i - 1]))) {
            let j = i + 1;
            while (j < len && isDigit(source[j])) j += 1;
            if (j < len && source[j] === '.' && j + 1 < len && isDigit(source[j + 1])) {
                j += 1;
                while (j < len && isDigit(source[j])) j += 1;
            }
            if (j < len && source[j] === '%') j += 1;
            if (j === len || !isIdentPart(source[j])) {
                out += `<span class="tok-number">${escapeHtml(source.slice(i, j))}</span>`;
                i = j;
                continue;
            }
        }

        // Identifier or keyword
        if (isIdentStart(ch) && (i === 0 || !isIdentPart(source[i - 1]))) {
            let j = i + 1;
            while (j < len && isIdentPart(source[j])) j += 1;
            const word = source.slice(i, j);
            if (CODE_KEYWORDS.has(word)) {
                out += `<span class="tok-keyword">${escapeHtml(word)}</span>`;
            } else {
                out += escapeHtml(word);
            }
            i = j;
            continue;
        }

        out += escapeHtml(ch);
        i += 1;
    }

    if (remainder) {
        out += escapeHtml(remainder);
    }
    return out;
}

export function createCodeBlock(spec = {}) {
    const rawCode = typeof spec === 'string' ? spec : String(spec.code ?? '');
    const lang = typeof spec === 'object' ? String(spec.lang || spec.language || '').trim() : '';
    const title = typeof spec === 'object' ? String(spec.title || spec.filename || '').trim() : '';

    const card = document.createElement('div');
    card.className = 'code-card';

    const header = document.createElement('div');
    header.className = 'code-card__header';

    const dots = document.createElement('span');
    dots.className = 'code-card__dots';
    dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = '<i></i><i></i><i></i>';
    header.appendChild(dots);

    const label = document.createElement('span');
    label.className = 'code-card__title';
    label.textContent = title || lang || 'snippet';
    header.appendChild(label);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'code-card__copy';
    copyBtn.textContent = 'Copy';
    copyBtn.setAttribute('aria-label', 'Copy code snippet');
    copyBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(rawCode).then(() => {
                copyBtn.textContent = 'Copied';
                setTimeout(() => {
                    copyBtn.textContent = 'Copy';
                }, 1400);
            }).catch(() => {});
        }
    });
    header.appendChild(copyBtn);

    const pre = document.createElement('pre');
    pre.className = 'code-card__pre';
    const codeEl = document.createElement('code');
    if (lang) {
        codeEl.dataset.lang = lang;
    }
    codeEl.innerHTML = highlightCodeHtml(rawCode);
    pre.appendChild(codeEl);

    card.append(header, pre);
    return card;
}

export function parseMarkdownTable(lines = []) {
    if (!Array.isArray(lines) || lines.length < 2) return null;
    const parseRow = (line) =>
        line
            .trim()
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((cell) => cell.trim());

    const firstRow = parseRow(lines[0]);
    const secondRow = parseRow(lines[1]);
    const isSeparator = secondRow.every((cell) => /^:?-{2,}:?$/.test(cell));

    if (isSeparator) {
        const rows = lines.slice(2).map(parseRow).filter((r) => r.some(Boolean));
        return { headers: firstRow, rows };
    }
    return {
        headers: [],
        rows: lines.map(parseRow).filter((r) => r.some(Boolean)),
    };
}

export function createTableBlock(spec = {}) {
    const headers = Array.isArray(spec.headers) ? spec.headers : [];
    const rows = Array.isArray(spec.rows) ? spec.rows : [];

    const wrap = document.createElement('div');
    wrap.className = 'slide-table-wrap';

    if (spec.title) {
        const caption = document.createElement('div');
        caption.className = 'slide-table__title';
        setRichContent(caption, String(spec.title));
        wrap.appendChild(caption);
    }

    const table = document.createElement('table');
    table.className = 'slide-table';

    if (headers.length > 0) {
        const thead = document.createElement('thead');
        const tr = document.createElement('tr');
        headers.forEach((cell) => {
            const th = document.createElement('th');
            setRichContent(th, String(cell ?? ''));
            tr.appendChild(th);
        });
        thead.appendChild(tr);
        table.appendChild(thead);
    }

    const tbody = document.createElement('tbody');
    rows.forEach((row) => {
        if (!Array.isArray(row)) return;
        const tr = document.createElement('tr');
        row.forEach((cell) => {
            const td = document.createElement('td');
            setRichContent(td, String(cell ?? ''));
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
}

export function createVectorChart(spec = {}) {
    const kind = String(spec.chart || spec.type || 'bar').toLowerCase();
    const unit = spec.unit ? String(spec.unit) : '';
    const prefix = spec.prefix ? String(spec.prefix) : '';

    let items = [];
    if (Array.isArray(spec.items)) {
        items = spec.items.map((item) => ({
            label: String(item.label ?? item.name ?? ''),
            value: Number(item.value ?? 0) || 0,
        }));
    } else if (Array.isArray(spec.labels) && Array.isArray(spec.values)) {
        items = spec.labels.map((label, idx) => ({
            label: String(label ?? ''),
            value: Number(spec.values[idx] ?? 0) || 0,
        }));
    }

    const figure = document.createElement('figure');
    figure.className = `vector-chart vector-chart--${kind}`;

    if (spec.title) {
        const figcap = document.createElement('figcaption');
        figcap.className = 'vector-chart__title';
        figcap.textContent = String(spec.title);
        figure.appendChild(figcap);
    }

    if (!items.length) {
        return figure;
    }

    const maxVal = Math.max(...items.map((d) => Math.abs(d.value)), 1);
    const paletteVars = [
        'var(--color-surface, #ff9ff3)',
        'var(--color-accent, #feca57)',
        'var(--color-surface-alt, #70d6ff)',
        'var(--badge-bg, #ff9f43)',
    ];

    if (kind === 'donut') {
        const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0) || 1;
        const radius = 64;
        const circumference = 2 * Math.PI * radius;
        let offset = 0;

        const circles = items.map((item, idx) => {
            const fraction = Math.max(0, item.value) / total;
            const dash = fraction * circumference;
            const fill = paletteVars[idx % paletteVars.length];
            const seg = `<circle cx="90" cy="90" r="${radius}" fill="none" stroke="${fill}" stroke-width="28" stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" />`;
            offset += dash;
            return seg;
        }).join('');

        const wrap = document.createElement('div');
        wrap.className = 'vector-chart__donut-wrap';
        wrap.innerHTML = `
          <svg class="vector-chart__svg vector-chart__svg--donut" viewBox="0 0 180 180" role="img" aria-label="${escapeHtml(spec.title || 'Donut chart')}">
            <circle cx="90" cy="90" r="${radius}" fill="none" stroke="rgba(30,23,20,0.1)" stroke-width="28" />
            <g transform="rotate(-90 90 90)">${circles}</g>
            <circle cx="90" cy="90" r="${radius - 14}" fill="none" stroke="var(--color-ink, #1e1714)" stroke-width="2.5" />
            <circle cx="90" cy="90" r="${radius + 14}" fill="none" stroke="var(--color-ink, #1e1714)" stroke-width="2.5" />
          </svg>
        `;

        const legend = document.createElement('div');
        legend.className = 'vector-chart__legend';
        items.forEach((item, idx) => {
            const row = document.createElement('div');
            row.className = 'vector-chart__legend-row';
            const swatch = document.createElement('span');
            swatch.className = 'vector-chart__swatch';
            swatch.style.background = paletteVars[idx % paletteVars.length];
            const label = document.createElement('span');
            label.className = 'vector-chart__legend-label';
            label.textContent = item.label;
            const val = document.createElement('span');
            val.className = 'vector-chart__legend-value';
            val.textContent = `${prefix}${item.value}${unit}`;
            row.append(swatch, label, val);
            legend.appendChild(row);
        });
        wrap.appendChild(legend);
        figure.appendChild(wrap);
        return figure;
    }

    if (kind === 'hbar') {
        const list = document.createElement('div');
        list.className = 'vector-chart__hbars';
        items.forEach((item, idx) => {
            const pct = Math.max(4, Math.round((Math.abs(item.value) / maxVal) * 100));
            const row = document.createElement('div');
            row.className = 'vector-chart__hbar-row';

            const label = document.createElement('span');
            label.className = 'vector-chart__hbar-label';
            label.textContent = item.label;

            const track = document.createElement('div');
            track.className = 'vector-chart__hbar-track';
            const fill = document.createElement('div');
            fill.className = 'vector-chart__hbar-fill';
            fill.style.width = `${pct}%`;
            fill.style.background = paletteVars[idx % paletteVars.length];
            track.appendChild(fill);

            const val = document.createElement('span');
            val.className = 'vector-chart__hbar-value';
            val.textContent = `${prefix}${item.value}${unit}`;

            row.append(label, track, val);
            list.appendChild(row);
        });
        figure.appendChild(list);
        return figure;
    }

    // Default: vertical bar chart ("bar")
    const cols = document.createElement('div');
    cols.className = 'vector-chart__bars';
    items.forEach((item, idx) => {
        const pct = Math.max(6, Math.round((Math.abs(item.value) / maxVal) * 100));
        const col = document.createElement('div');
        col.className = 'vector-chart__bar-col';

        const val = document.createElement('span');
        val.className = 'vector-chart__bar-value';
        val.textContent = `${prefix}${item.value}${unit}`;

        const well = document.createElement('div');
        well.className = 'vector-chart__bar-well';
        const bar = document.createElement('div');
        bar.className = 'vector-chart__bar-fill';
        bar.style.height = `${pct}%`;
        bar.style.background = paletteVars[idx % paletteVars.length];
        well.appendChild(bar);

        const label = document.createElement('span');
        label.className = 'vector-chart__bar-label';
        label.textContent = item.label;

        col.append(val, well, label);
        cols.appendChild(col);
    });
    figure.appendChild(cols);
    return figure;
}

function resolveEmbedInfo(rawUrl = '') {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) return null;
    try {
        const parsed = new URL(trimmed, window.location.origin);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        const host = parsed.hostname.replace(/^www\./, '').toLowerCase();

        // YouTube
        if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
            let videoId = '';
            if (host === 'youtu.be') {
                videoId = parsed.pathname.slice(1).split('/')[0];
            } else if (parsed.pathname.startsWith('/embed/')) {
                videoId = parsed.pathname.split('/')[2] || '';
            } else if (parsed.pathname.startsWith('/shorts/')) {
                videoId = parsed.pathname.split('/')[2] || '';
            } else {
                videoId = parsed.searchParams.get('v') || '';
            }
            if (/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
                return {
                    kind: 'youtube',
                    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`,
                    posterUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                    provider: 'YouTube',
                    href: trimmed,
                };
            }
        }

        // Vimeo
        if (host === 'vimeo.com' || host === 'player.vimeo.com') {
            const match = parsed.pathname.match(/\/(?:video\/)?(\d+)/);
            if (match) {
                return {
                    kind: 'vimeo',
                    embedUrl: `https://player.vimeo.com/video/${match[1]}?autoplay=1`,
                    posterUrl: '',
                    provider: 'Vimeo',
                    href: trimmed,
                };
            }
        }

        // Loom
        if (host === 'loom.com') {
            const match = parsed.pathname.match(/\/(?:share|embed)\/([a-f0-9]{20,40})/i);
            if (match) {
                return {
                    kind: 'loom',
                    embedUrl: `https://www.loom.com/embed/${match[1]}?autoplay=1`,
                    posterUrl: '',
                    provider: 'Loom',
                    href: trimmed,
                };
            }
        }

        return {
            kind: 'video',
            src: parsed.href,
            href: trimmed,
        };
    } catch {
        if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('images/') || trimmed.startsWith('media/')) {
            return {
                kind: 'video',
                src: trimmed,
                href: trimmed,
            };
        }
        return null;
    }
}

export function createVideoBlock(spec = {}) {
    const raw = typeof spec === 'string' ? { src: spec } : spec;
    const src = raw.src || raw.video || raw.embed || raw.url || '';
    const captionText = raw.caption || raw.title || raw.label || '';
    const info = resolveEmbedInfo(src);

    const figure = document.createElement('figure');
    figure.className = 'video-card';
    if (!info) return figure;

    if (info.kind === 'video') {
        const video = document.createElement('video');
        video.className = 'video-card__player';
        video.src = info.src;
        video.playsInline = true;
        if (raw.poster) video.poster = raw.poster;
        if (raw.loop) {
            video.loop = true;
            video.muted = true;
            video.autoplay = true;
        } else {
            video.controls = true;
            video.preload = 'metadata';
        }
        figure.appendChild(video);
    } else {
        // Lite-embed card: zero third-party iframe until the user clicks Play
        const stage = document.createElement('div');
        stage.className = 'video-card__stage';
        const poster = raw.poster || info.posterUrl;
        if (poster) {
            const safePosterUrl = String(poster).replace(/["\\()\r\n]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
            stage.style.backgroundImage = `url("${safePosterUrl}")`;
        }

        const playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.className = 'video-card__play';
        playBtn.setAttribute('aria-label', `Play ${info.provider} video${captionText ? `: ${captionText}` : ''}`);
        playBtn.innerHTML = `<span class="video-card__play-icon" aria-hidden="true">▶</span><span class="video-card__play-label">Play ${escapeHtml(info.provider)}</span>`;

        playBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            const iframe = document.createElement('iframe');
            iframe.className = 'video-card__iframe';
            iframe.src = info.embedUrl;
            iframe.title = captionText || `${info.provider} video`;
            iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
            iframe.allowFullscreen = true;
            stage.replaceChildren(iframe);
        });

        stage.appendChild(playBtn);
        figure.appendChild(stage);
    }

    if (captionText) {
        const figcap = document.createElement('figcaption');
        figcap.className = 'video-card__caption';
        setRichContent(figcap, String(captionText));
        figure.appendChild(figcap);
    }

    return figure;
}
