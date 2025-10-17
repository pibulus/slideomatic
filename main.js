const slidesRoot = document.getElementById("slides");
const currentCounter = document.querySelector("[data-counter-current]");
const totalCounter = document.querySelector("[data-counter-total]");
const progressBar = document.querySelector("[data-progress]");

const renderers = {
  title: renderTitleSlide,
  standard: renderStandardSlide,
  quote: renderQuoteSlide,
  split: renderSplitSlide,
  grid: renderGridSlide,
  pillars: renderPillarsSlide,
  gallery: renderGallerySlide,
  typeface: renderTypefaceSlide,
  image: renderImageSlide,
};

let slides = [];
let slideElements = [];
let currentIndex = 0;
let isOverview = false;
const preloadedImages = new Set();
let autoLinkConfigs = [];

initDeck();

async function initDeck() {
  await loadAndApplyTheme();
  await loadAutoLinks();

  try {
    slides = await loadSlides();
    validateSlides(slides);
  } catch (error) {
    console.error("Failed to load slides", error);
    renderLoadError(error);
    return;
  }

  // Filter out schema/docs slides before rendering
  const renderableSlides = slides.filter(slide => slide.type !== "_schema");

  totalCounter.textContent = renderableSlides.length;

  if (!Array.isArray(renderableSlides) || renderableSlides.length === 0) {
    renderEmptyState();
    return;
  }

  slideElements = renderableSlides.map((slide, index) =>
    createSlide(slide, index, renderers)
  );

  const fragment = document.createDocumentFragment();
  slideElements.forEach((slide) => {
    slide.style.visibility = "hidden";
    slide.style.pointerEvents = "none";
    fragment.appendChild(slide);
  });
  slidesRoot.appendChild(fragment);

  document.addEventListener("keydown", handleKeyboard);
  slidesRoot.addEventListener("click", handleSlideClick);
  document.addEventListener("click", handleImageModalTrigger);

  // Setup deck upload
  const uploadInput = document.getElementById('deck-upload');
  if (uploadInput) {
    uploadInput.addEventListener('change', handleDeckUpload);
  }

  // Setup voice button
  const voiceBtn = document.getElementById('voice-btn');
  if (voiceBtn) {
    voiceBtn.addEventListener('click', toggleVoiceRecording);
  }

  setActiveSlide(0);
}

async function loadSlides() {
  const response = await fetch(resolveSlidesPath(), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.json();
}

async function loadAndApplyTheme() {
  try {
    const response = await fetch(resolveThemePath(), { cache: "no-store" });
    if (!response.ok) return;
    const theme = await response.json();
    applyTheme(theme);
  } catch (error) {
    console.warn("Unable to load custom theme, using defaults.", error);
  }
}

function resolveThemePath() {
  const params = new URLSearchParams(window.location.search);
  const themeParam = params.get("theme");
  if (!themeParam) return "theme.json";
  if (themeParam.endsWith(".json")) {
    return themeParam;
  }
  if (themeParam.includes("/")) {
    return `${themeParam}.json`;
  }
  return `themes/${themeParam}.json`;
}

function applyTheme(theme) {
  if (!theme || typeof theme !== "object") return;
  const root = document.documentElement;
  Object.entries(theme).forEach(([token, value]) => {
    if (value == null) return;
    root.style.setProperty(`--${token}`, value);
  });
}

function resolveSlidesPath() {
  const params = new URLSearchParams(window.location.search);
  const slidesParam = params.get("slides");
  if (!slidesParam) {
    return "slides.json";
  }
  if (slidesParam.endsWith(".json")) {
    return slidesParam;
  }
  return `${slidesParam}.json`;
}

async function loadAutoLinks() {
  try {
    const response = await fetch("autolinks.json", { cache: "no-store" });
    if (!response.ok) return;
    const links = await response.json();
    if (!Array.isArray(links)) return;
    autoLinkConfigs = links
      .filter((link) => Boolean(link?.term))
      .map((link) => ({
        term: link.term,
        search: link.search,
        url: link.url,
        urlTemplate: link.urlTemplate,
        openInNewTab: link.openInNewTab !== false,
        regex: new RegExp(escapeRegExp(link.term), "gi"),
      }));
  } catch (error) {
    console.warn("Unable to load autolinks.json", error);
    autoLinkConfigs = [];
  }
}

function renderLoadError(error) {
  const message = document.createElement("section");
  message.className = "slide slide--error is-active";
  message.innerHTML = `
    <h2>Unable to load slides</h2>
    <p>Please refresh the page or contact the deck owner.</p>
    ${error ? `<pre>${error.message}</pre>` : ""}
  `;
  slidesRoot.appendChild(message);
}

function renderEmptyState() {
  const message = document.createElement("section");
  message.className = "slide slide--empty is-active";
  message.innerHTML = `
    <h2>No slides available</h2>
    <p>Add slide data to <code>slides.json</code> to render this deck.</p>
  `;
  slidesRoot.appendChild(message);
}

function validateSlides(data) {
  if (!Array.isArray(data)) {
    throw new Error("Slides data must be an array.");
  }

  const allowedTypes = new Set([
    "title",
    "standard",
    "quote",
    "split",
    "grid",
    "pillars",
    "gallery",
    "typeface",
    "image",
    "_schema"  // Special type for documentation - ignored during render
  ]);

  data.forEach((slide, index) => {
    if (!slide || typeof slide !== "object") {
      throw new Error(`Slide ${index} is not an object.`);
    }

    if (slide.type && !allowedTypes.has(slide.type)) {
      throw new Error(
        `Slide ${index} has unsupported type "${slide.type}". Allowed types: ${[...allowedTypes].join(", ")}.`
      );
    }

    if (slide.type === "split") {
      if (!slide.left || !slide.right) {
        throw new Error(`Slide ${index} (${slide.badge ?? slide.headline ?? "Split slide"}) is missing left/right content.`);
      }
    }

    if (slide.type === "pillars") {
      if (!Array.isArray(slide.pillars) || slide.pillars.length === 0) {
        throw new Error(`Slide ${index} (${slide.badge ?? slide.headline ?? "Pillars slide"}) requires a non-empty pillars array.`);
      }
    }

    if (slide.type === "gallery") {
      if (!Array.isArray(slide.items) || slide.items.length === 0) {
        throw new Error(`Slide ${index} (${slide.badge ?? slide.headline ?? "Gallery slide"}) requires a non-empty items array.`);
      }
    }

    if (slide.type === "image") {
      if (!slide.image || typeof slide.image !== "object" || !slide.image.src) {
        throw new Error(`Slide ${index} (${slide.badge ?? slide.headline ?? "Image slide"}) requires an image.src value.`);
      }
    }
  });
}

function handleKeyboard(event) {
  const target = event.target;
  if (
    target &&
    target instanceof HTMLElement &&
    (target.matches("input, textarea, select") ||
      target.isContentEditable ||
      target.closest("#edit-drawer"))
  ) {
    return;
  }

  if (event.key === "ArrowRight" || event.key === " ") {
    event.preventDefault();
    if (isOverview) return;
    flashKeyFeedback('→');
    setActiveSlide(currentIndex + 1);
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    if (isOverview) return;
    flashKeyFeedback('←');
    setActiveSlide(currentIndex - 1);
  }

  if (event.key === "Home") {
    event.preventDefault();
    if (isOverview) return;
    flashKeyFeedback('⇤');
    setActiveSlide(0);
  }

  if (event.key === "End") {
    event.preventDefault();
    if (isOverview) return;
    flashKeyFeedback('⇥');
    setActiveSlide(slideElements.length - 1);
  }

  if (event.key.toLowerCase() === "o") {
    event.preventDefault();
    flashKeyFeedback('O');
    toggleOverview();
  }

  if (event.key === "Escape" && isOverview) {
    event.preventDefault();
    flashKeyFeedback('ESC');
    exitOverview();
  }

  if (event.key.toLowerCase() === "d") {
    event.preventDefault();
    flashKeyFeedback('D');
    downloadDeck();
  }

  if (event.key.toLowerCase() === "u") {
    event.preventDefault();
    flashKeyFeedback('U');
    const uploadInput = document.getElementById('deck-upload');
    if (uploadInput) uploadInput.click();
  }

  if (event.key.toLowerCase() === "e") {
    event.preventDefault();
    flashKeyFeedback('E');
    toggleEditDrawer();
  }

  if (event.key.toLowerCase() === "v") {
    event.preventDefault();
    flashKeyFeedback('V');
    toggleVoiceRecording();
  }

  if (event.key.toLowerCase() === "t") {
    event.preventDefault();
    flashKeyFeedback('T');
    toggleVoiceTheme();
  }

  if (event.key.toLowerCase() === "s") {
    event.preventDefault();
    flashKeyFeedback('S');
    openSettingsModal();
  }

  if (event.key === "Escape") {
    closeSettingsModal();
  }
}

function flashKeyFeedback(key) {
  const feedback = document.createElement('div');
  feedback.className = 'key-feedback';
  feedback.textContent = key;
  document.body.appendChild(feedback);

  requestAnimationFrame(() => {
    feedback.classList.add('active');
  });

  setTimeout(() => {
    feedback.classList.remove('active');
    setTimeout(() => feedback.remove(), 300);
  }, 400);
}

function handleSlideClick(event) {
  if (!isOverview) return;
  const targetSlide = event.target.closest(".slide");
  if (!targetSlide) return;
  const targetIndex = Number.parseInt(targetSlide.dataset.index, 10);
  if (Number.isNaN(targetIndex)) return;
  exitOverview(targetIndex);
}

function toggleOverview() {
  if (isOverview) {
    exitOverview();
    return;
  }
  enterOverview();
}

function enterOverview() {
  document.body.dataset.mode = "overview";
  slideElements.forEach((slide) => {
    slide.style.visibility = "visible";
    slide.style.pointerEvents = "auto";
    slide.setAttribute("aria-hidden", "false");
  });
  isOverview = true;
}

function exitOverview(targetIndex = currentIndex) {
  delete document.body.dataset.mode;
  isOverview = false;
  slideElements.forEach((slide, index) => {
    if (index === targetIndex) return;
    slide.style.visibility = "hidden";
    slide.style.pointerEvents = "none";
    slide.setAttribute("aria-hidden", "true");
  });
  setActiveSlide(targetIndex);
}

function setActiveSlide(nextIndex) {
  const clamped = clamp(nextIndex, 0, slideElements.length - 1);
  if (clamped === currentIndex && slideElements[currentIndex].classList.contains("is-active")) {
    updateHud();
    return;
  }

  // Save reference to old slide before changing index
  const oldSlide = slideElements[currentIndex];

  // Remove active from old slide
  oldSlide.classList.remove("is-active");
  oldSlide.classList.add("is-leaving");
  oldSlide.style.pointerEvents = "none";
  oldSlide.setAttribute("aria-hidden", "true");

  // Clean up old slide after transition
  setTimeout(() => {
    oldSlide.classList.remove("is-leaving");
    if (!oldSlide.classList.contains("is-active")) {
      oldSlide.style.visibility = "hidden";
    }
  }, 400);

  // Update to new index
  currentIndex = clamped;

  // Show new slide immediately
  const newSlide = slideElements[currentIndex];
  newSlide.style.visibility = "visible";
  newSlide.style.pointerEvents = isOverview ? "none" : "auto";
  newSlide.setAttribute("aria-hidden", "false");
  newSlide.scrollTop = 0;
  slideElements[currentIndex].classList.add("is-active");
  slideElements[currentIndex].scrollIntoView({ block: "center" });

  updateHud();
  preloadSlideImages(currentIndex);
  preloadSlideImages(currentIndex + 1);
  preloadSlideImages(currentIndex + 2);
}

function updateHud() {
  // Animate counter change
  const counterEl = currentCounter.parentElement;
  counterEl.classList.add('updating');
  setTimeout(() => counterEl.classList.remove('updating'), 300);

  currentCounter.textContent = currentIndex + 1;
  const progress = ((currentIndex + 1) / slideElements.length) * 100;
  progressBar.style.width = `${progress}%`;
}

function createSlide(slide, index, rendererMap) {
  const type = slide.type ?? "standard";
  const section = document.createElement("section");
  section.className = `slide slide--${type}`;
  section.dataset.index = index;
  section.setAttribute("aria-hidden", "true");

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
    child.classList?.contains("badge")
  );
  const badgeDisabled =
    slide.badge === false || slide.autoBadge === false;
  const manualBadgeValue =
    typeof slide.badge === "string"
      ? slide.badge.trim()
      : typeof slide.badge === "number"
      ? String(slide.badge)
      : "";

  if (!directBadge && !badgeDisabled) {
    if (manualBadgeValue) {
      section.insertBefore(
        createBadge(manualBadgeValue),
        section.firstChild ?? null
      );
    } else if (slide.autoBadge !== false) {
      const autoBadge = createBadge(`+ Slide ${index + 1}`);
      autoBadge.dataset.badgeAuto = "true";
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

function preloadImage(src) {
  if (!src || preloadedImages.has(src)) return;
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  preloadedImages.add(src);
}

function preloadSlideImages(index) {
  const slide = slideElements[index];
  if (!slide) return;
  const images = slide.querySelectorAll("img[data-modal-src]");
  images.forEach((img) => {
    const src = img.dataset.modalSrc || img.currentSrc || img.src;
    preloadImage(src);
  });
}

function renderTitleSlide(section, slide) {
  if (slide.eyebrow) {
    section.appendChild(createBadge(slide.eyebrow));
  }

  if (slide.title) {
    const title = document.createElement("h1");
    title.textContent = slide.title;
    section.appendChild(title);
  }

  if (slide.subtitle) {
    const subtitle = document.createElement("p");
    subtitle.className = "title__subtitle";
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

function renderStandardSlide(section, slide) {
  if (slide.headline) {
    const headline = document.createElement("h2");
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

function renderImageSlide(section, slide) {
  section.classList.add("slide--image");

  if (!slide.image || !slide.image.src) {
    const warning = document.createElement("p");
    warning.className = "slide__error";
    warning.textContent = "Image slide requires an image with a src.";
    section.appendChild(warning);
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "slide__image-wrapper";

  const imageElement = createImage(slide.image, "slide__image slide__image--full", {
    orientationTarget: section,
  });
  wrapper.appendChild(imageElement);

  if (slide.caption) {
    const caption = document.createElement("div");
    caption.className = "slide__image-caption";
    setRichContent(caption, slide.caption);
    wrapper.appendChild(caption);
  }

  section.appendChild(wrapper);
}

function renderQuoteSlide(section, slide) {
  section.classList.add("slide--quote");

  // Support both 'quote' and 'headline' for the main quote text
  const quoteText = slide.quote ?? slide.headline ?? "";
  const quote = document.createElement("blockquote");
  setRichContent(quote, quoteText);
  section.appendChild(quote);

  // Support both 'attribution' and 'body' for the attribution/subtext
  const attributionText = slide.attribution ?? slide.body;
  if (attributionText) {
    const cite = document.createElement("cite");
    setRichContent(cite, attributionText);
    section.appendChild(cite);
  }
}

function renderSplitSlide(section, slide) {
  section.classList.add("slide--split");
  const variants = Array.isArray(slide.variant)
    ? slide.variant
    : slide.variant
    ? [slide.variant]
    : [];
  variants.forEach((variant) => {
    if (!variant) return;
    section.classList.add(`slide--split--${variant}`);
  });

  const leftColumn = document.createElement("div");
  leftColumn.className = "slide__column slide__column--left";
  const rightColumn = document.createElement("div");
  rightColumn.className = "slide__column slide__column--right";

  renderColumn(leftColumn, slide.left);
  renderColumn(rightColumn, slide.right);

  section.append(leftColumn, rightColumn);
}

function renderGridSlide(section, slide) {
  section.classList.add("slide--grid");

  if (slide.headline) {
    const headline = document.createElement("h2");
    setRichContent(headline, slide.headline);
    section.appendChild(headline);
  }

  appendBody(section, slide.body);

  if (Array.isArray(slide.items)) {
    const grid = document.createElement("div");
    grid.className = "grid";

    slide.items.forEach((item) => {
      const figure = document.createElement("figure");
      if (item.image) {
        figure.appendChild(createImage(item.image));
      } else if (item.color) {
        const swatch = createColorBlock(item);
        figure.appendChild(swatch);
      }
      if (item.label) {
        const caption = document.createElement("figcaption");
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

function renderPillarsSlide(section, slide) {
  section.classList.add("slide--pillars");

  if (slide.headline) {
    const headline = document.createElement("h2");
    setRichContent(headline, slide.headline);
    section.appendChild(headline);
  }

  appendBody(section, slide.body);

  if (slide.image) {
    section.appendChild(createImage(slide.image));
  }

  if (Array.isArray(slide.pillars)) {
    const wrapper = document.createElement("div");
    wrapper.className = "pillars";

    slide.pillars.forEach((pillar) => {
      const card = document.createElement("article");
      card.className = "pillar";

      if (pillar.image) {
        const imageData =
          typeof pillar.image === "string"
            ? { src: pillar.image, alt: pillar.title || "" }
            : pillar.image;
        const img = createImage(imageData, "pillar__image");
        card.appendChild(img);
      }

      if (pillar.title) {
        const heading = document.createElement("h3");
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
          const text = document.createElement("p");
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

function renderGallerySlide(section, slide) {
  section.classList.add("slide--gallery");

  if (slide.headline) {
    const headline = document.createElement("h2");
    setRichContent(headline, slide.headline);
    section.appendChild(headline);
  }

  appendBody(section, slide.body);

  if (Array.isArray(slide.items)) {
    const gallery = document.createElement("div");
    gallery.className = "gallery";

    slide.items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "gallery__item";

      if (item.image) {
        card.appendChild(createImage(item.image, "gallery__image"));
      } else if (item.color) {
        card.appendChild(createColorBlock(item, "gallery__color"));
      }

      if (item.label) {
        const label = document.createElement("span");
        label.className = "gallery__label";
        setRichContent(label, item.label);
        card.appendChild(label);
      }

      if (item.copy) {
        const copyLines = Array.isArray(item.copy) ? item.copy : [item.copy];
        copyLines.forEach((line) => {
          if (!line) return;
          const text = document.createElement("p");
          text.className = "gallery__copy";
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

function renderTypefaceSlide(section, slide) {
  section.classList.add("slide--typeface");

  if (slide.headline) {
    const headline = document.createElement("h2");
    setRichContent(headline, slide.headline);
    section.appendChild(headline);
  }

  if (slide.image) {
    section.appendChild(createImage(slide.image));
  }

  // Support both 'fonts' (detailed) and 'samples' (simple) array formats
  const fontArray = slide.fonts || slide.samples;
  if (Array.isArray(fontArray)) {
    const wrapper = document.createElement("div");
    wrapper.className = "typeface-grid";

    fontArray.forEach((font) => {
      const card = document.createElement("article");
      card.className = "typeface-card";

      // Handle both formats: {name, font, sample} and {font, text}
      const fontFamily = font.font;
      const displayText = font.text || font.sample || slide.sample || "The quick brown fox jumps over the lazy dog";

      if (font.name) {
        const label = document.createElement("span");
        label.className = "typeface-card__label";
        label.textContent = font.name;
        card.appendChild(label);
      }

      const sample = document.createElement("p");
      sample.className = "typeface-card__sample";
      sample.style.fontFamily = fontFamily;
      if (font.weight) sample.style.fontWeight = font.weight;
      sample.textContent = displayText;
      card.appendChild(sample);

      if (font.note) {
        const note = document.createElement("span");
        note.className = "typeface-card__note";
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

function renderColumn(column, data = {}) {
  if (!data) return;
  const imageNode = data.image ? createImage(data.image) : null;
  const imageFirst = Boolean(data.imageFirst || data.imagePosition === "top");

  if (data.badge) {
    column.appendChild(createBadge(data.badge));
  }
  if (data.headline) {
    const headline = document.createElement("h3");
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

function appendBody(container, body) {
  if (!body) return;
  const copy = Array.isArray(body) ? body : [body];
  copy.forEach((text) => {
    if (!text) return;
    const quoteElement = maybeCreateQuoteElement(text);
    if (quoteElement) {
      container.appendChild(quoteElement);
      return;
    }
    const paragraph = document.createElement("p");
    setRichContent(paragraph, text);
    container.appendChild(paragraph);
  });
}

function createBadge(label) {
  const badge = document.createElement("span");
  badge.className = "badge";
  setRichContent(badge, label);
  return badge;
}

function createImage(image, className = "slide__image", options = {}) {
  if (!image || !image.src) {
    return createImagePlaceholder(image, className);
  }
  const img = document.createElement("img");
  img.className = className;
  img.src = image.src;
  img.alt = image.alt ?? "";
  img.dataset.modalSrc = image.modalSrc ?? image.src;
  if (image.alt) {
    img.dataset.modalAlt = image.alt;
  }
  if (image.loading) {
    img.loading = image.loading;
  } else {
    img.loading = "lazy";
  }
  img.decoding = image.decoding ?? "async";
  if (image.aspectRatio) {
    img.style.aspectRatio = image.aspectRatio;
  }
  if (image.objectFit) {
    img.style.objectFit = image.objectFit;
  }
  if (image.objectPosition) {
    img.style.objectPosition = image.objectPosition;
  }
  if (image.fullBleed) {
    img.classList.add("slide__image--full");
  }
  if (image.border === false) {
    img.classList.add("slide__image--borderless");
  }
  const orientationTarget = options.orientationTarget;
  const rawOrientation =
    typeof image.orientation === "string" ? image.orientation.trim() : image.orientation;
  const explicitOrientation = normalizeOrientation(rawOrientation);
  const orientationLocked =
    image.lockOrientation === true ||
    (typeof rawOrientation === "string" && /!$/.test(rawOrientation));
  const applyOrientation = (orientation) => {
    if (!orientation) return;
    img.dataset.orientation = orientation;
    if (orientationTarget) {
      orientationTarget.dataset.orientation = orientation;
    }
  };
  if (explicitOrientation) {
    applyOrientation(explicitOrientation);
  }
  const updateOrientationFromNatural = () => {
    const orientation = deriveOrientationFromDimensions(
      img.naturalWidth,
      img.naturalHeight
    );
    if (!orientation) return;
    if (!explicitOrientation || (!orientationLocked && orientation !== explicitOrientation)) {
      applyOrientation(orientation);
    }
  };
  if (img.complete && img.naturalWidth && img.naturalHeight) {
    updateOrientationFromNatural();
  } else {
    img.addEventListener("load", updateOrientationFromNatural, { once: true });
  }
  // Make images clickable to view full size
  img.style.cursor = 'pointer';
  return img;
}

function createImagePlaceholder(image = {}, className = "slide__image") {
  const baseClasses = String(className)
    .split(/\s+/)
    .filter(Boolean);

  const placeholder = document.createElement("button");
  placeholder.type = "button";
  placeholder.className = [...baseClasses, "image-placeholder"].join(" ");

  const query =
    image.alt ||
    image.search ||
    image.label ||
    image.caption ||
    image.query ||
    "";
  const trimmedQuery = query.trim();

  const icon = document.createElement("span");
  icon.className = "image-placeholder__icon";
  icon.textContent = "🔍";

  const text = document.createElement("span");
  text.className = "image-placeholder__text";
  text.textContent = trimmedQuery
    ? `Search “${trimmedQuery}”`
    : "Add reference image";

  placeholder.append(icon, text);

  if (trimmedQuery) {
    placeholder.dataset.searchQuery = trimmedQuery;
    placeholder.setAttribute("aria-label", `Search images for ${trimmedQuery}`);
    placeholder.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const url = buildImageSearchUrl(trimmedQuery);
      window.open(url, "_blank", "noopener");
    });
  } else {
    placeholder.disabled = true;
    placeholder.classList.add("is-disabled");
    placeholder.setAttribute(
      "aria-label",
      "Add reference image (no search query)"
    );
  }

  return placeholder;
}

function buildImageSearchUrl(query) {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("tbm", "isch");
  url.searchParams.set("q", query);
  return url.toString();
}

function normalizeOrientation(value) {
  if (!value) return null;
  const normalized = String(value).toLowerCase().replace(/!+$/, "");
  const alias = {
    poster: "portrait",
    "one-sheet": "portrait",
    flyer: "portrait",
    sheet: "portrait",
    banner: "landscape",
    widescreen: "landscape",
    panorama: "landscape",
  }[normalized];
  if (alias) {
    return alias;
  }
  if (["portrait", "landscape", "square"].includes(normalized)) {
    return normalized;
  }
  if (["vertical", "tall"].includes(normalized)) {
    return "portrait";
  }
  if (["horizontal", "wide"].includes(normalized)) {
    return "landscape";
  }
  return null;
}

function deriveOrientationFromDimensions(width, height) {
  if (!width || !height) return null;
  if (Math.abs(width - height) / Math.max(width, height) < 0.08) {
    return "square";
  }
  return width > height ? "landscape" : "portrait";
}

function handleImageModalTrigger(event) {
  if (isOverview) return;
  const trigger = event.target.closest("[data-modal-src]");
  if (!trigger) return;
  const src = trigger.dataset.modalSrc;
  if (!src) return;
  event.preventDefault();
  event.stopPropagation();
  openImageModal(src, trigger.dataset.modalAlt ?? trigger.alt ?? "");
}

function openImageModal(src, alt) {
  const modal = document.createElement('div');
  modal.className = 'image-modal';
  modal.innerHTML = `
    <div class="image-modal__backdrop"></div>
    <div class="image-modal__content">
      <img src="${src}" alt="${alt || ''}" loading="eager" decoding="sync" />
      <button class="image-modal__close" aria-label="Close">×</button>
    </div>
  `;

  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('is-active'));

  const closeModal = () => {
    modal.classList.remove('is-active');
    setTimeout(() => modal.remove(), 300);
  };

  modal.querySelector('.image-modal__backdrop').addEventListener('click', closeModal);
  modal.querySelector('.image-modal__close').addEventListener('click', closeModal);
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', escHandler);
    }
  });
}

function createFootnote(text) {
  const footnote = document.createElement("p");
  footnote.className = "slide__footnote";
  setRichContent(footnote, text);
  return footnote;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createMediaStrip(media) {
  const container = document.createElement("div");
  container.className = "media-strip";

  media.forEach((item) => {
    if (item.image) {
      container.appendChild(createImage(item.image, "media-strip__image"));
    } else if (item.color) {
      container.appendChild(createColorBlock(item, "media-strip__color"));
    }
  });

  return container;
}

function createColorBlock(item, className = "gallery__color") {
  const block = document.createElement("div");
  block.className = className;
  block.style.background = item.color;
  if (item.label) {
    block.textContent = item.label;
  }
  return block;
}

function setRichContent(element, html) {
  if (html == null) return;
  element.innerHTML = parseMarkdown(html);
  applyAutoLinksToElement(element);
}

function parseMarkdown(text) {
  if (typeof text !== 'string') return text;

  return text
    // Bold: **text** or __text__
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    // Italic: *text* or _text_ (but not inside words)
    .replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '<em>$1</em>')
    .replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<em>$1</em>')
    // Links: [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Code: `code`
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function maybeCreateQuoteElement(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const quoteMatch = trimmed.match(/^(["“])(.*?)(["”])(?:\s*(?:[—–-]{1,2})\s*(.+))?$/s);
  if (!quoteMatch) {
    return null;
  }

  const [, , quoteBody, , attribution] = quoteMatch;
  const block = document.createElement("blockquote");
  block.className = "quote-block";

  const quoteSpan = document.createElement("span");
  setRichContent(quoteSpan, quoteBody.trim());
  block.append(...quoteSpan.childNodes);

  if (attribution) {
    const cite = document.createElement("cite");
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
      if (node.parentElement && node.parentElement.closest("a")) {
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
  const anchor = document.createElement("a");
  anchor.textContent = text;
  anchor.href = buildAutoLinkHref(text, config);
  if (config.openInNewTab) {
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
  }
  anchor.className = "auto-link";
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

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ===================================================================
// DECK IMPORT/EXPORT
// ===================================================================

function downloadDeck() {
  const json = JSON.stringify(slides, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'slides.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  console.log('✓ Deck downloaded as slides.json');
}

function handleDeckUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const newSlides = JSON.parse(e.target.result);
      validateSlides(newSlides);

      // Replace current slides
      slides = newSlides;

      // Reload deck with new slides
      reloadDeck();

      console.log(`✓ Loaded ${slides.length} slides from ${file.name}`);
    } catch (error) {
      console.error('Failed to load deck:', error);
      alert(`Failed to load deck: ${error.message}`);
    }
  };

  reader.readAsText(file);

  // Reset input so the same file can be uploaded again
  event.target.value = '';
}

function reloadDeck() {
  // Clear existing slides
  slidesRoot.innerHTML = '';

  // Filter out schema slides
  const renderableSlides = slides.filter(slide => slide.type !== "_schema");

  totalCounter.textContent = renderableSlides.length;

  if (!Array.isArray(renderableSlides) || renderableSlides.length === 0) {
    renderEmptyState();
    return;
  }

  // Re-render all slides
  slideElements = renderableSlides.map((slide, index) =>
    createSlide(slide, index, renderers)
  );

  const fragment = document.createDocumentFragment();
  slideElements.forEach((slide) => {
    slide.style.visibility = "hidden";
    slide.style.pointerEvents = "none";
    fragment.appendChild(slide);
  });
  slidesRoot.appendChild(fragment);

  // Reset to first slide
  currentIndex = 0;
  setActiveSlide(0);
}

// ===================================================================
// EDIT DRAWER
// ===================================================================

let isEditDrawerOpen = false;

function toggleEditDrawer() {
  const drawer = document.getElementById('edit-drawer');
  if (!drawer) return;

  isEditDrawerOpen = !isEditDrawerOpen;

  if (isEditDrawerOpen) {
    drawer.classList.add('is-open');
    renderEditForm();
    // Setup close button
    const closeBtn = drawer.querySelector('.edit-drawer__close');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeEditDrawer);
    }
  } else {
    drawer.classList.remove('is-open');
  }
}

function closeEditDrawer() {
  isEditDrawerOpen = false;
  const drawer = document.getElementById('edit-drawer');
  if (drawer) drawer.classList.remove('is-open');
}

function renderEditForm() {
  const content = document.getElementById('edit-drawer-content');
  if (!content) return;

  const currentSlide = slides[currentIndex];
  if (!currentSlide) return;

  content.innerHTML = `
    <form class="edit-drawer__form">
      <div class="edit-drawer__field">
        <label class="edit-drawer__label">Slide JSON</label>
        <textarea
          class="edit-drawer__textarea"
          id="slide-json-editor"
          rows="20"
          style="font-family: var(--font-mono); font-size: 0.9rem;"
        >${JSON.stringify(currentSlide, null, 2)}</textarea>
      </div>
      <button type="button" class="edit-drawer__button" id="save-slide-btn">
        Save & Reload
      </button>
      <button type="button" class="edit-drawer__button edit-drawer__button--secondary" id="duplicate-slide-btn">
        Duplicate Slide
      </button>
    </form>
  `;

  // Setup save button
  document.getElementById('save-slide-btn')?.addEventListener('click', saveCurrentSlide);
  document.getElementById('duplicate-slide-btn')?.addEventListener('click', duplicateCurrentSlide);
}

function saveCurrentSlide() {
  const textarea = document.getElementById('slide-json-editor');
  if (!textarea) return;

  try {
    const updatedSlide = JSON.parse(textarea.value);
    slides[currentIndex] = updatedSlide;
    reloadDeck();
    closeEditDrawer();
    console.log('✓ Slide updated');
  } catch (error) {
    alert(`Invalid JSON: ${error.message}`);
  }
}

function duplicateCurrentSlide() {
  const currentSlide = slides[currentIndex];
  if (!currentSlide) return;

  // Deep clone the slide
  const duplicatedSlide = JSON.parse(JSON.stringify(currentSlide));

  // Insert after current slide
  slides.splice(currentIndex + 1, 0, duplicatedSlide);

  reloadDeck();

  // Move to the duplicated slide
  setTimeout(() => setActiveSlide(currentIndex + 1), 100);

  closeEditDrawer();
  console.log('✓ Slide duplicated');
}

// ===================================================================
// VOICE-TO-SLIDE
// ===================================================================

let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let mediaStream = null;

// ===================================================================
// API KEY MANAGEMENT
// ===================================================================

const STORAGE_KEY_API = 'slideomatic_gemini_api_key';

function getGeminiApiKey() {
  return localStorage.getItem(STORAGE_KEY_API) || '';
}

function toggleVoiceRecording() {
  // Check for API key first
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    openSettingsModal();
    showApiKeyStatus('error', 'Please add your Gemini API key to use voice features');
    return;
  }

  if (isRecording) {
    stopVoiceRecording();
  } else {
    startVoiceRecording();
  }
}

async function startVoiceRecording() {
  try {
    // Request microphone access
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }
    });

    // Find supported mime type
    const mimeTypes = ['audio/webm', 'audio/ogg', 'audio/mp4', ''];
    let mimeType = '';
    for (const type of mimeTypes) {
      if (!type || MediaRecorder.isTypeSupported(type)) {
        mimeType = type;
        break;
      }
    }

    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    audioChunks = [];
    mediaStream = stream;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' });
      await processVoiceToSlide(audioBlob);
      cleanupVoiceRecording();
    };

    mediaRecorder.start(1000); // Collect data every second
    isRecording = true;

    // Update button UI
    updateVoiceButtonState(true);

    console.log('🎙️ Recording started...');
  } catch (error) {
    console.error('❌ Error starting recording:', error);
    alert('Failed to access microphone. Please check permissions.');
    cleanupVoiceRecording();
  }
}

function stopVoiceRecording() {
  if (!mediaRecorder || !isRecording) return;

  isRecording = false;
  updateVoiceButtonState(false, true);

  if (mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

function cleanupVoiceRecording() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  mediaRecorder = null;
  audioChunks = [];
  isRecording = false;
  updateVoiceButtonState(false, false);
}

function updateVoiceButtonState(recording, processing) {
  const voiceBtn = document.getElementById('voice-btn');
  const hudStatus = document.getElementById('hud-status');
  if (!voiceBtn) return;

  if (recording) {
    voiceBtn.classList.add('is-recording');
    voiceBtn.textContent = 'Stop';
    voiceBtn.setAttribute('aria-label', 'Stop recording');

    // Show status
    if (hudStatus) {
      hudStatus.textContent = '🎙 Recording...';
      hudStatus.className = 'hud__status hud__status--recording is-visible';
    }
  } else if (processing) {
    voiceBtn.classList.add('is-processing');
    voiceBtn.classList.remove('is-recording');
    voiceBtn.textContent = 'Voice';

    // Show status
    if (hudStatus) {
      hudStatus.textContent = '⚡ Generating slide...';
      hudStatus.className = 'hud__status hud__status--processing is-visible';
    }
  } else {
    voiceBtn.classList.remove('is-recording', 'is-processing');
    voiceBtn.textContent = 'Voice';
    voiceBtn.setAttribute('aria-label', 'Voice to slide (V)');

    // Hide status
    if (hudStatus) {
      hudStatus.classList.remove('is-visible');
      setTimeout(() => {
        hudStatus.textContent = '';
        hudStatus.className = 'hud__status';
      }, 200);
    }
  }
}

async function processVoiceToSlide(audioBlob) {
  try {
    console.log('🤖 Processing audio with Gemini...');

    // Convert audio blob to base64
    const base64Audio = await blobToBase64(audioBlob);
    const audioData = base64Audio.split(',')[1]; // Remove data:audio/...;base64, prefix

    // Create the prompt with full slide schema
    const prompt = buildSlideDesignPrompt();

    // Check for API key first
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      throw new Error('No API key set. Press S to open settings and add your Gemini API key.');
    }

    // Call Gemini API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                text: prompt
              },
              {
                inlineData: {
                  mimeType: audioBlob.type || 'audio/webm',
                  data: audioData
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
          }
        })
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Gemini API call failed');
    }

    const result = await response.json();
    const generatedText = result.candidates[0]?.content?.parts[0]?.text;

    if (!generatedText) {
      throw new Error('No response from Gemini');
    }

    // Extract JSON from markdown code blocks if present
    const jsonMatch = generatedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ||
                      generatedText.match(/\{[\s\S]*\}/);

    const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : generatedText;
    const slideData = JSON.parse(jsonText);

    // Validate the slide
    validateSlides([slideData]);

    // Insert slide after current position
    insertSlideAfterCurrent(slideData);

    console.log('✅ Slide created and inserted!');
  } catch (error) {
    console.error('❌ Error processing voice:', error);
    alert(`Failed to create slide: ${error.message}`);
    updateVoiceButtonState(false, false);
  }
}

function buildSlideDesignPrompt() {
  return `You are a slide designer for Slideomatic, a presentation system. Your job is to create a single slide JSON object based on the user's voice description.

IMPORTANT RULES FOR IMAGE NAMES:
- Image "alt" text is used for Google Image Search, so make it FINDABLE but not TOO SPECIFIC
- Good: "vintage synthesizer", "mountain landscape sunset", "modern office workspace"
- Bad: "moog model d serial 12345", "mount everest north face 1996", "apple macbook pro m1 2021"
- Use common, searchable terms that will return good visual results
- Think like a user searching Google Images - what would find the RIGHT kind of image?

AVAILABLE SLIDE TYPES:
1. "title" - Big hero slide with title, subtitle, optional media strip
   Fields: type, title, subtitle, eyebrow, media (array of {image: {src, alt}}), footnote

2. "standard" - Headline + body + optional image
   Fields: type, headline, body (string or array), image {src, alt}, footnote

3. "quote" - Large quote with attribution
   Fields: type, quote, attribution

4. "split" - Two-column layout
   Fields: type, left {headline, body, image}, right {headline, body, image}

5. "grid" - Grid of images/colors
   Fields: type, headline, body, items (array of {image: {src, alt}, label})

6. "pillars" - Feature cards
   Fields: type, headline, pillars (array of {title, copy, image})

7. "gallery" - Visual gallery
   Fields: type, headline, items (array of {image, label, copy})

8. "image" - Full-bleed image slide
   Fields: type, image {src, alt}, caption

9. "typeface" - Font showcase
   Fields: type, headline, fonts (array of {name, font, sample})

AVAILABLE FONTS (use font field on ANY slide or in typeface showcase):
- Presets: "sans" (Inter), "mono" (Space Mono), "grotesk" (Space Grotesk), "jetbrains" (JetBrains Mono), "pixel" (Press Start 2P)
- Any system font: "Georgia", "Comic Sans MS", etc.
- Font can be set per-slide in root level: {"type": "quote", "font": "pixel", ...}

MARKDOWN & LINKS (use in headlines, body, quotes):
- Bold: **text** or __text__
- Italic: *text* or _text_
- Links: [text](url) - example: [Visit Site](https://example.com)
- Code: \`code\`
- Combine: **[Bold Link](url)**

DESIGN GUIDELINES:
- Choose the slide type that best fits the user's description
- For image searches, use FINDABLE alt text (see rules above)
- Keep headlines punchy (5-7 words max)
- Body text should be clear and concise
- Use markdown for emphasis, links, code snippets
- If user mentions multiple points, consider "pillars" or "grid"
- If user wants a visual focus, use "image" or "gallery"
- For quotes or testimonials, use "quote" type
- Badge field is optional - use for section labels
- Add font presets when user requests specific typography

Return ONLY valid JSON matching the schema. No markdown, no explanations.

Example output for "a slide about vintage synthesizers with some examples":
{
  "type": "grid",
  "headline": "Vintage Synthesizers",
  "body": "The machines that shaped electronic music",
  "items": [
    {"image": {"alt": "moog synthesizer"}, "label": "Moog"},
    {"image": {"alt": "roland jupiter synthesizer"}, "label": "Roland Jupiter"},
    {"image": {"alt": "arp odyssey synth"}, "label": "ARP Odyssey"}
  ]
}

Now listen to the audio and create the slide:`;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function insertSlideAfterCurrent(slideData) {
  // Insert after current index
  slides.splice(currentIndex + 1, 0, slideData);

  // Reload deck to render new slide
  reloadDeck();

  // Jump to the new slide
  setTimeout(() => {
    setActiveSlide(currentIndex + 1);
    updateVoiceButtonState(false, false);
  }, 100);
}

// ===================================================================
// VOICE-TO-THEME
// ===================================================================

let isRecordingTheme = false;
let themeMediaRecorder = null;
let themeAudioChunks = [];
let themeMediaStream = null;

function toggleVoiceTheme() {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    openSettingsModal();
    showApiKeyStatus('error', 'Please add your Gemini API key to use voice features');
    return;
  }

  if (isRecordingTheme) {
    stopVoiceThemeRecording();
  } else {
    startVoiceThemeRecording();
  }
}

async function startVoiceThemeRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }
    });

    const mimeTypes = ['audio/webm', 'audio/ogg', 'audio/mp4', ''];
    let mimeType = '';
    for (const type of mimeTypes) {
      if (!type || MediaRecorder.isTypeSupported(type)) {
        mimeType = type;
        break;
      }
    }

    themeMediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    themeAudioChunks = [];
    themeMediaStream = stream;

    themeMediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        themeAudioChunks.push(event.data);
      }
    };

    themeMediaRecorder.onstop = async () => {
      const audioBlob = new Blob(themeAudioChunks, { type: mimeType || 'audio/webm' });
      await processVoiceToTheme(audioBlob);
      cleanupVoiceThemeRecording();
    };

    themeMediaRecorder.start(1000);
    isRecordingTheme = true;

    showHudStatus('🎨 Recording theme...', 'recording');
    console.log('🎨 Recording theme description...');
  } catch (error) {
    console.error('❌ Error starting theme recording:', error);
    alert('Failed to access microphone. Please check permissions.');
    cleanupVoiceThemeRecording();
  }
}

function stopVoiceThemeRecording() {
  if (!themeMediaRecorder || !isRecordingTheme) return;

  isRecordingTheme = false;
  showHudStatus('🎨 Generating theme...', 'processing');

  if (themeMediaRecorder.state !== 'inactive') {
    themeMediaRecorder.stop();
  }
}

function cleanupVoiceThemeRecording() {
  if (themeMediaStream) {
    themeMediaStream.getTracks().forEach(track => track.stop());
    themeMediaStream = null;
  }
  themeMediaRecorder = null;
  themeAudioChunks = [];
  isRecordingTheme = false;
}

async function processVoiceToTheme(audioBlob) {
  try {
    console.log('🎨 Generating theme with Gemini...');

    const base64Audio = await blobToBase64(audioBlob);
    const audioData = base64Audio.split(',')[1];

    const prompt = buildThemeDesignPrompt();

    // Check for API key first
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      throw new Error('No API key set. Press S to open settings and add your Gemini API key.');
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: audioBlob.type || 'audio/webm',
                  data: audioData
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 1.0,  // Higher temp for more creative themes
            maxOutputTokens: 2048,
          }
        })
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Gemini API call failed');
    }

    const result = await response.json();
    const generatedText = result.candidates[0]?.content?.parts[0]?.text;

    if (!generatedText) {
      throw new Error('No response from Gemini');
    }

    const jsonMatch = generatedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ||
                      generatedText.match(/\{[\s\S]*\}/);

    const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : generatedText;
    const themeData = JSON.parse(jsonText);

    // Apply the new theme
    applyTheme(themeData);

    // Download theme.json automatically
    downloadTheme(themeData);

    showHudStatus('🎨 Theme created!', 'success');
    console.log('✅ Theme applied and downloaded!');
  } catch (error) {
    console.error('❌ Error processing theme:', error);
    alert(`Failed to create theme: ${error.message}`);
    hideHudStatus();
  }
}

function buildThemeDesignPrompt() {
  return `You are a theme designer for Slideomatic. Create a complete theme.json based on the user's voice description.

THEME SCHEMA - ALL fields required:
{
  "color-bg": "#fffbf3",                    // Main background color
  "background-surface": "radial-gradient(...)",  // Complex gradient or solid color
  "background-overlay": "radial-gradient(...)",  // Texture/pattern overlay or ""
  "background-opacity": "0.5",              // Opacity of overlay (0-1)
  "slide-bg": "rgba(255, 251, 243, 0.88)", // Slide background (can be transparent)
  "slide-border-color": "#1b1b1b",         // Slide border color
  "slide-border-width": "5px",             // Border thickness (0px for none)
  "slide-shadow": "10px 10px 0 rgba(0, 0, 0, 0.3)", // Neo-brutalist shadow
  "color-surface": "#ff9ff3",              // Primary accent color
  "color-surface-alt": "#88d4ff",          // Secondary accent
  "color-accent": "#feca57",               // Tertiary accent
  "badge-bg": "#feca57",                   // Badge background
  "badge-color": "#1b1b1b",                // Badge text color
  "color-ink": "#000000",                  // Primary text color
  "color-muted": "#2b2b2b",                // Secondary text color
  "border-width": "5px",                   // Global border width
  "gutter": "clamp(32px, 5vw, 72px)",      // Spacing unit
  "radius": "12px",                        // Border radius
  "font-sans": "\\"Inter\\", sans-serif",    // Sans font stack
  "font-mono": "\\"Space Mono\\", monospace", // Mono font stack
  "shadow-sm": "6px 6px 0 rgba(0, 0, 0, 0.25)",
  "shadow-md": "10px 10px 0 rgba(0, 0, 0, 0.3)",
  "shadow-lg": "16px 16px 0 rgba(0, 0, 0, 0.35)",
  "shadow-xl": "24px 24px 0 rgba(0, 0, 0, 0.4)"
}

DESIGN GUIDELINES:
1. **Color Harmony** - Choose a cohesive palette (pastel-punk, dark mode, neon, retro, etc.)
2. **Gradients** - Can use radial-gradient, linear-gradient, or solid colors
3. **Shadows** - Neo-brutalist (hard offset shadows) or soft (box-shadow with blur)
4. **Borders** - Can be thick (5px+), thin (1-2px), or none (0px)
5. **Typography** - Suggest real font stacks (serif, sans, mono, display)
6. **Contrast** - Ensure text is readable on backgrounds
7. **Vibe** - Match the mood the user describes (playful, serious, retro, modern, etc.)

STYLE ARCHETYPES:
- **Pastel Punk** (default): Soft pastels + chunky borders + hard shadows
- **Dark Brutalist**: Dark bg + neon accents + heavy borders
- **Minimal Clean**: White/light grays + subtle borders + no gradients
- **Retro Warm**: Warm browns/oranges + serif fonts + textured overlays
- **Neon Cyber**: Dark bg + bright neons + glowing shadows
- **Nature Soft**: Greens/earth tones + organic gradients + soft shadows

Return ONLY valid JSON. No markdown, no explanations.

Example for "dark cyberpunk with neon accents":
{
  "color-bg": "#0a0e27",
  "background-surface": "radial-gradient(circle at 20% 30%, rgba(255, 0, 255, 0.15), transparent 50%), radial-gradient(circle at 80% 70%, rgba(0, 255, 255, 0.15), transparent 50%), #0a0e27",
  "background-overlay": "repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.03) 0px, transparent 1px, transparent 2px, rgba(255, 255, 255, 0.03) 3px)",
  "background-opacity": "0.8",
  "slide-bg": "rgba(10, 14, 39, 0.95)",
  "slide-border-color": "#ff00ff",
  "slide-border-width": "3px",
  "slide-shadow": "0 0 20px rgba(255, 0, 255, 0.5), 0 0 40px rgba(0, 255, 255, 0.3)",
  "color-surface": "#ff00ff",
  "color-surface-alt": "#00ffff",
  "color-accent": "#ffff00",
  "badge-bg": "#ff00ff",
  "badge-color": "#0a0e27",
  "color-ink": "#ffffff",
  "color-muted": "#a0a0ff",
  "border-width": "2px",
  "gutter": "clamp(32px, 5vw, 72px)",
  "radius": "8px",
  "font-sans": "\\"Orbitron\\", \\"Arial\\", sans-serif",
  "font-mono": "\\"Share Tech Mono\\", monospace",
  "shadow-sm": "0 0 10px rgba(255, 0, 255, 0.4)",
  "shadow-md": "0 0 20px rgba(255, 0, 255, 0.5)",
  "shadow-lg": "0 0 30px rgba(255, 0, 255, 0.6)",
  "shadow-xl": "0 0 40px rgba(255, 0, 255, 0.7)"
}

Now listen to the audio and create the theme:`;
}

function downloadTheme(themeData) {
  const json = JSON.stringify(themeData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'theme.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  console.log('✓ Theme downloaded as theme.json');
}

// ===================================================================
// SETTINGS MODAL
// ===================================================================

function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  const input = document.getElementById('gemini-api-key');
  if (modal && input) {
    input.value = getGeminiApiKey();
    modal.classList.add('is-open');

    // Setup event listeners if not already set
    setupSettingsModalListeners();
  }
}

function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) {
    modal.classList.remove('is-open');
  }
}

function setupSettingsModalListeners() {
  // Close button
  const closeBtn = document.querySelector('.settings-modal__close');
  if (closeBtn && !closeBtn.dataset.listenerAttached) {
    closeBtn.addEventListener('click', closeSettingsModal);
    closeBtn.dataset.listenerAttached = 'true';
  }

  // Backdrop
  const backdrop = document.querySelector('.settings-modal__backdrop');
  if (backdrop && !backdrop.dataset.listenerAttached) {
    backdrop.addEventListener('click', closeSettingsModal);
    backdrop.dataset.listenerAttached = 'true';
  }

  // Save button
  const saveBtn = document.getElementById('save-api-key');
  if (saveBtn && !saveBtn.dataset.listenerAttached) {
    saveBtn.addEventListener('click', saveApiKey);
    saveBtn.dataset.listenerAttached = 'true';
  }

  // Test button
  const testBtn = document.getElementById('test-api-key');
  if (testBtn && !testBtn.dataset.listenerAttached) {
    testBtn.addEventListener('click', testApiKey);
    testBtn.dataset.listenerAttached = 'true';
  }

  // Clear button
  const clearBtn = document.getElementById('clear-api-key');
  if (clearBtn && !clearBtn.dataset.listenerAttached) {
    clearBtn.addEventListener('click', clearApiKey);
    clearBtn.dataset.listenerAttached = 'true';
  }

  // Toggle visibility button
  const toggleBtn = document.getElementById('toggle-api-key-visibility');
  if (toggleBtn && !toggleBtn.dataset.listenerAttached) {
    toggleBtn.addEventListener('click', toggleApiKeyVisibility);
    toggleBtn.dataset.listenerAttached = 'true';
  }
}

function saveApiKey() {
  const input = document.getElementById('gemini-api-key');
  const key = input.value.trim();

  if (key) {
    localStorage.setItem(STORAGE_KEY_API, key);
    showApiKeyStatus('success', '✓ API key saved successfully!');
  } else {
    showApiKeyStatus('error', 'Please enter a valid API key');
  }
}

async function testApiKey() {
  const key = getGeminiApiKey();

  if (!key) {
    showApiKeyStatus('error', 'No API key found. Please save one first.');
    return;
  }

  showApiKeyStatus('info', 'Testing connection...');

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'test' }] }]
        })
      }
    );

    if (response.ok) {
      showApiKeyStatus('success', '✓ Connection successful! Your API key is working.');
    } else {
      const error = await response.json();
      showApiKeyStatus('error', `Invalid API key or connection failed: ${error.error?.message || 'Unknown error'}`);
    }
  } catch (error) {
    showApiKeyStatus('error', 'Connection test failed. Please check your internet connection.');
  }
}

function clearApiKey() {
  if (confirm('Are you sure you want to clear your API key?')) {
    localStorage.removeItem(STORAGE_KEY_API);
    const input = document.getElementById('gemini-api-key');
    if (input) input.value = '';
    showApiKeyStatus('info', 'API key cleared');
  }
}

function toggleApiKeyVisibility() {
  const input = document.getElementById('gemini-api-key');
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
}

function showApiKeyStatus(type, message) {
  const status = document.getElementById('api-key-status');
  if (!status) return;

  status.className = `settings-field__status is-visible is-${type}`;
  status.textContent = message;

  // Auto-hide success/info messages after 3 seconds (keep errors visible)
  if (type !== 'error') {
    setTimeout(() => {
      status.classList.remove('is-visible');
    }, 3000);
  }
}

// ===================================================================
// HUD STATUS HELPERS
// ===================================================================

function showHudStatus(message, type = '') {
  const hudStatus = document.getElementById('hud-status');
  if (!hudStatus) return;

  hudStatus.textContent = message;
  hudStatus.className = `hud__status is-visible ${type ? `hud__status--${type}` : ''}`;
}

function hideHudStatus() {
  const hudStatus = document.getElementById('hud-status');
  if (!hudStatus) return;

  hudStatus.classList.remove('is-visible');
  setTimeout(() => {
    hudStatus.textContent = '';
    hudStatus.className = 'hud__status';
  }, 200);
}
