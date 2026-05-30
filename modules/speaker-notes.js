import { slides, currentIndex } from './state.js';
import { trapFocus, focusFirstElement } from './utils.js';

let previousFocus = null;
let keydownHandler = null;

export function toggleSpeakerNotes() {
  const modal = document.getElementById('notes-modal');
  if (!modal) return;

  const isOpen = modal.classList.contains('is-open');

  if (isOpen) {
    closeSpeakerNotes(modal);
  } else {
    openSpeakerNotes(modal);
  }
}

function openSpeakerNotes(modal) {
  // Update notes content for current slide
  const currentSlide = slides[currentIndex];
  const slideTitle = document.getElementById('notes-slide-title');
  const notesText = document.getElementById('notes-text');

  if (slideTitle) {
    slideTitle.textContent = `Slide ${currentIndex + 1} of ${slides.length}`;
  }

  if (notesText) {
    const notes = currentSlide?.notes || currentSlide?.speaker_notes;
    notesText.textContent = notes || 'No speaker notes for this slide.';
  }

  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  modal.removeAttribute('inert');
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  focusFirstElement(modal);

  if (keydownHandler) {
    document.removeEventListener('keydown', keydownHandler, true);
  }
  keydownHandler = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSpeakerNotes(modal);
      return;
    }
    if (event.key === 'Tab') {
      trapFocus(event, modal);
    }
  };
  document.addEventListener('keydown', keydownHandler, true);
}

function closeSpeakerNotes(modal) {
  if (!modal.classList.contains('is-open')) return;

  if (keydownHandler) {
    document.removeEventListener('keydown', keydownHandler, true);
    keydownHandler = null;
  }

  const target = previousFocus && typeof previousFocus.focus === 'function'
    ? previousFocus
    : null;
  previousFocus = null;
  target?.focus({ preventScroll: true });

  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('inert', '');
}

export function initSpeakerNotes() {
  const notesModal = document.getElementById('notes-modal');
  if (notesModal) {
    const closeBtn = notesModal.querySelector('.notes-modal__close');
    const backdrop = notesModal.querySelector('.notes-modal__backdrop');

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        closeSpeakerNotes(notesModal);
      });
    }

    if (backdrop) {
      backdrop.addEventListener('click', () => {
        closeSpeakerNotes(notesModal);
      });
    }
  }
}
