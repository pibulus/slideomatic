const FOCUSABLE_SELECTORS = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

let getSlides = () => [];
let getCurrentIndex = () => 0;
let setActiveSlide = () => {};

let panel = null;
let panelContent = null;
let listEl = null;
let entries = [];
let isOpen = false;
let previousFocus = null;

export function initSlideIndex({ getSlides: gs, getCurrentIndex: gci, setActiveSlide: sas }) {
  getSlides = typeof gs === 'function' ? gs : getSlides;
  getCurrentIndex = typeof gci === 'function' ? gci : getCurrentIndex;
  setActiveSlide = typeof sas === 'function' ? sas : setActiveSlide;
  ensurePanel();
}

export function refreshSlideIndex() {
  ensurePanel();
  if (!listEl) return;
  entries = getSlides()
    .map((slide, index) => ({ slide, index }))
    .filter(({ slide }) => slide && slide.type !== '_schema');

  listEl.innerHTML = '';

  if (entries.length === 0) {
    const emptyState = document.createElement('li');
    emptyState.className = 'slide-index__empty';
    emptyState.textContent = 'No slides available.';
    listEl.appendChild(emptyState);
    return;
  }

  entries.forEach(({ slide, index }) => {
    const item = document.createElement('li');
    item.className = 'slide-index__item';
    item.dataset.slideIndex = String(index);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'slide-index__button';

    const number = document.createElement('span');
    number.className = 'slide-index__number';
    number.textContent = String(index + 1).padStart(2, '0');

    const label = document.createElement('span');
    label.className = 'slide-index__label';
    label.textContent = deriveSlideLabel(slide, index);

    button.append(number, label);
    button.addEventListener('click', () => {
      closeSlideIndex();
      setActiveSlide(index);
    });

    item.appendChild(button);
    listEl.appendChild(item);
  });

  updateSlideIndexHighlight(getCurrentIndex());
}

export function toggleSlideIndex() {
  if (isOpen) {
    closeSlideIndex();
  } else {
    openSlideIndex();
  }
}

export function openSlideIndex() {
  ensurePanel();
  if (isOpen) return;
  refreshSlideIndex();
  if (!entries.length) return;

  isOpen = true;
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  panel.classList.add('is-open');
  panel.setAttribute('aria-hidden', 'false');
  document.addEventListener('keydown', handleKeydown, true);
  updateSlideIndexHighlight(getCurrentIndex());

  const currentButton = listEl?.querySelector(`.slide-index__item[data-slide-index="${getCurrentIndex()}"] button`);
  requestAnimationFrame(() => {
    (currentButton || panelContent)?.focus({ preventScroll: true });
  });
}

export function closeSlideIndex() {
  if (!isOpen || !panel) return;

  isOpen = false;
  panel.classList.remove('is-open');
  panel.setAttribute('aria-hidden', 'true');
  document.removeEventListener('keydown', handleKeydown, true);

  const target = previousFocus && typeof previousFocus.focus === 'function'
    ? previousFocus
    : document.getElementById('index-btn');
  requestAnimationFrame(() => target?.focus());
  previousFocus = null;
}

export function updateSlideIndexHighlight(activeIndex) {
  if (!listEl) return;
  listEl.querySelectorAll('.slide-index__item.is-current').forEach((item) => {
    item.classList.remove('is-current');
  });
  const currentItem = listEl.querySelector(`.slide-index__item[data-slide-index="${activeIndex}"]`);
  if (currentItem) {
    currentItem.classList.add('is-current');
    if (isOpen) {
      currentItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
}

function handleKeydown(event) {
  if (!isOpen || !panelContent) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeSlideIndex();
    return;
  }
  if (event.key === 'Tab') {
    trapFocus(event, panelContent);
  }
}

function ensurePanel() {
  if (panel) return;

  panel = document.createElement('div');
  panel.id = 'slide-index';
  panel.className = 'slide-index';
  panel.setAttribute('aria-hidden', 'true');

  const backdrop = document.createElement('div');
  backdrop.className = 'slide-index__backdrop';
  backdrop.dataset.indexClose = 'true';

  panelContent = document.createElement('aside');
  panelContent.className = 'slide-index__panel';
  panelContent.setAttribute('role', 'dialog');
  panelContent.setAttribute('aria-modal', 'true');
  panelContent.setAttribute('aria-label', 'Slide index');

  const header = document.createElement('header');
  header.className = 'slide-index__header';

  const title = document.createElement('h2');
  title.className = 'slide-index__title';
  title.textContent = 'Slide Index';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'slide-index__close';
  closeBtn.setAttribute('aria-label', 'Close slide index');
  closeBtn.dataset.indexClose = 'true';
  closeBtn.textContent = '×';

  header.append(title, closeBtn);

  listEl = document.createElement('ol');
  listEl.className = 'slide-index__list';

  const footer = document.createElement('div');
  footer.className = 'slide-index__footer';
  footer.textContent = 'Jump anywhere without leaving flow.';

  panelContent.append(header, listEl, footer);
  panel.append(backdrop, panelContent);
  document.body.appendChild(panel);

  panel.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.dataset.indexClose === 'true') {
      closeSlideIndex();
    }
  });
}

function deriveSlideLabel(slide, index) {
  const primary = slide?.title || slide?.headline || slide?.quote || slide?.description;
  const secondary = slide?.badge;
  let text = primary || secondary || `Slide ${index + 1}`;
  if (secondary && primary) {
    text = `${secondary} — ${primary}`;
  }
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

function trapFocus(event, container) {
  if (event.key !== 'Tab') return;
  const focusable = getFocusableElements(container);
  if (focusable.length === 0) {
    event.preventDefault();
    container.setAttribute('tabindex', '-1');
    container.focus({ preventScroll: true });
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const isShift = event.shiftKey;
  const active = document.activeElement;

  if (!isShift && active === last) {
    event.preventDefault();
    first.focus();
  } else if (isShift && active === first) {
    event.preventDefault();
    last.focus();
  }
}

function getFocusableElements(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTORS)).filter(
    (el) =>
      !el.hasAttribute('disabled') &&
      el.getAttribute('tabindex') !== '-1' &&
      typeof el.focus === 'function' &&
      (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0)
  );
}
