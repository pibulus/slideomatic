import { slides, currentIndex } from './state.js';

export function toggleSpeakerNotes() {
  const modal = document.getElementById('notes-modal');
  if (!modal) return;

  const isOpen = modal.classList.contains('is-open');

  if (isOpen) {
    modal.classList.remove('is-open');
  } else {
    // Update notes content for current slide
    const currentSlide = slides[currentIndex];
    const slideTitle = document.getElementById('notes-slide-title');
    const notesText = document.getElementById('notes-text');

    if (slideTitle) {
      slideTitle.textContent = `Slide ${currentIndex + 1} of ${slides.length}`;
    }

    if (notesText) {
      const notes = currentSlide?.notes || currentSlide?.speaker_notes;
      if (notes) {
        notesText.textContent = notes;
      } else {
        notesText.textContent = 'No speaker notes for this slide.';
      }
    }

    modal.classList.add('is-open');
  }
}

export function initSpeakerNotes() {
  const notesModal = document.getElementById('notes-modal');
  if (notesModal) {
    const closeBtn = notesModal.querySelector('.notes-modal__close');
    const backdrop = notesModal.querySelector('.notes-modal__backdrop');

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        notesModal.classList.remove('is-open');
      });
    }

    if (backdrop) {
      backdrop.addEventListener('click', () => {
        notesModal.classList.remove('is-open');
      });
    }

    // Close on Escape
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && notesModal.classList.contains('is-open')) {
        notesModal.classList.remove('is-open');
      }
    });
  }
}
