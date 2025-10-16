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
};

let slides = [];
let slideElements = [];
let currentIndex = 0;
let isOverview = false;
const preloadedImages = new Set();

initDeck();

async function initDeck() {
  try {
    slides = await loadSlides();
  } catch (error) {
    console.error("Failed to load slides", error);
    renderLoadError();
    return;
  }

  totalCounter.textContent = slides.length;

  if (!Array.isArray(slides) || slides.length === 0) {
    renderEmptyState();
    return;
  }

  slideElements = slides.map((slide, index) =>
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

  setActiveSlide(0);
}

async function loadSlides() {
  const response = await fetch("slides.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.json();
}

function renderLoadError() {
  const message = document.createElement("section");
  message.className = "slide slide--error is-active";
  message.innerHTML = `
    <h2>Unable to load slides</h2>
    <p>Please refresh the page or contact the deck owner.</p>
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

function handleKeyboard(event) {
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

  const renderer = rendererMap[type] ?? renderStandardSlide;
  renderer(section, slide);

  return section;
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
    subtitle.innerHTML = slide.subtitle;
    section.appendChild(subtitle);
  }

  if (Array.isArray(slide.media) && slide.media.length > 0) {
    section.appendChild(createMediaStrip(slide.media));
  }

  if (slide.footnote) {
    const footnote = document.createElement("p");
    footnote.className = "slide__footnote";
    footnote.textContent = slide.footnote;
    section.appendChild(footnote);
  }
}

function renderStandardSlide(section, slide) {
  if (slide.badge) {
    section.appendChild(createBadge(slide.badge));
  }

  if (slide.headline) {
    const headline = document.createElement("h2");
    headline.innerHTML = slide.headline;
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

function renderQuoteSlide(section, slide) {
  section.classList.add("slide--quote");
  const quote = document.createElement("blockquote");
  quote.innerHTML = slide.quote ?? "";
  section.appendChild(quote);

  if (slide.attribution) {
    const cite = document.createElement("cite");
    cite.innerHTML = slide.attribution;
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
    headline.innerHTML = slide.headline;
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
        caption.innerHTML = item.label;
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

  if (slide.badge) {
    section.appendChild(createBadge(slide.badge));
  }

  if (slide.headline) {
    const headline = document.createElement("h2");
    headline.innerHTML = slide.headline;
    section.appendChild(headline);
  }

  appendBody(section, slide.body);

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
        heading.innerHTML = pillar.title;
        card.appendChild(heading);
      }

      if (pillar.copy) {
        const copyLines = Array.isArray(pillar.copy) ? pillar.copy : [pillar.copy];
        copyLines.forEach((line) => {
          if (!line) return;
          const text = document.createElement("p");
          text.innerHTML = line;
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

  if (slide.badge) {
    section.appendChild(createBadge(slide.badge));
  }

  if (slide.headline) {
    const headline = document.createElement("h2");
    headline.innerHTML = slide.headline;
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
        label.innerHTML = item.label;
        card.appendChild(label);
      }

      if (item.copy) {
        const copyLines = Array.isArray(item.copy) ? item.copy : [item.copy];
        copyLines.forEach((line) => {
          if (!line) return;
          const text = document.createElement("p");
          text.className = "gallery__copy";
          text.innerHTML = line;
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

function renderColumn(column, data = {}) {
  if (!data) return;
  const imageNode = data.image ? createImage(data.image) : null;
  const imageFirst = Boolean(data.imageFirst || data.imagePosition === "top");

  if (data.badge) {
    column.appendChild(createBadge(data.badge));
  }
  if (data.headline) {
    const headline = document.createElement("h3");
    headline.innerHTML = data.headline;
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
    const paragraph = document.createElement("p");
    paragraph.innerHTML = text;
    container.appendChild(paragraph);
  });
}

function createBadge(label) {
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.innerHTML = label;
  return badge;
}

function createImage(image, className = "slide__image") {
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
  // Make images clickable to view full size
  img.style.cursor = 'pointer';
  return img;
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
  footnote.innerHTML = text;
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
