import { debug } from './constants.js';
import { autoLinkConfigs } from './state.js';
import { slidesRoot } from './dom-refs.js';
import { createImage, normalizeOrientation, generateGraphImage } from './image-render.js';
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
    <p>Please refresh the page or contact the deck owner.</p>
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
    const type = slide.type ?? 'standard';
    const section = document.createElement('section');
    section.className = `slide slide--${type}`;
    section.dataset.index = index;
    section.setAttribute('aria-hidden', 'true');

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
            const autoBadge = createBadge(`+ Slide ${index + 1}`);
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
        if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('badge')) {
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

    return section;
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

export function renderStandardSlide(section, slide) {
    if (slide.headline) {
        const headline = document.createElement('h2');
        setRichContent(headline, slide.headline);
        section.appendChild(headline);
    }

    appendBody(section, slide.body);

    if (slide.image) {
        section.appendChild(createImage(slide.image));
    }

    if (slide.footnote) {
        section.appendChild(createFootnote(slide.footnote));
    }
}

export function renderImageSlide(section, slide) {
    section.classList.add('slide--image');

    if (!slide.image || !slide.image.src) {
        const warning = document.createElement('p');
        warning.className = 'slide__error';
        warning.textContent = 'Image slide requires an image with a src.';
        section.appendChild(warning);
        return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'slide__image-wrapper';

    const imageElement = createImage(slide.image, 'slide__image slide__image--full', {
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
    const variants = Array.isArray(slide.variant)
        ? slide.variant
        : slide.variant
            ? [slide.variant]
            : [];
    variants.forEach((variant) => {
        if (!variant) return;
        section.classList.add(`slide--split--${variant}`);
    });

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
    content.className = 'slide__content';

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
        const placeholder = document.createElement('div');
        placeholder.className = 'graph-placeholder';

        const icon = document.createElement('div');
        icon.className = 'graph-placeholder__icon';
        icon.textContent = '📊';

        const text = document.createElement('div');
        text.className = 'graph-placeholder__text';
        text.textContent = slide.description || 'Generate a graph';

        const generateBtn = document.createElement('button');
        generateBtn.className = 'graph-generate-btn';
        generateBtn.textContent = 'Generate Graph';
        generateBtn.addEventListener('click', () => generateGraphImage(slide, graphContainer));

        placeholder.append(icon, text, generateBtn);
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

export function appendBody(container, body) {
    if (!body) return;
    const copy = Array.isArray(body) ? body : [body];
    copy.forEach((text) => {
        if (!text) return;
        const quoteElement = maybeCreateQuoteElement(text);
        if (quoteElement) {
            container.appendChild(quoteElement);
            return;
        }
        const paragraph = document.createElement('p');
        setRichContent(paragraph, text);
        container.appendChild(paragraph);
    });
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
    } catch (e) {
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


