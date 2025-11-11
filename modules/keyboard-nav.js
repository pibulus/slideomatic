// ═══════════════════════════════════════════════════════════════════════════
// Keyboard Navigation Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Centralizes all keyboard shortcut handling for Slide-o-Matic.
// - Registers global key listeners
// - Dispatches key combos to supplied callbacks
// - Documents default keyboard behaviors in one place
//
// Dependencies: None (expects callbacks from main.js)
// Used by: main.js
//
// ═══════════════════════════════════════════════════════════════════════════

const defaultContext = {
  isOverview: () => false,
  moveOverviewCursorBy: () => {},
  exitOverview: () => {},
  getOverviewCursor: () => 0,
  toggleOverview: () => {},
  downloadDeck: () => {},
  toggleSpeakerNotes: () => {},
  setActiveSlide: () => {},
  getCurrentIndex: () => 0,
  getSlideCount: () => 0,
  toggleEditDrawer: () => {},
  toggleVoiceRecording: () => {},
  toggleThemeDrawer: () => {},
  openSettingsModal: () => {},
  closeSettingsModal: () => {},
  triggerDeckUpload: () => {},
  toggleKeyboardHelp: () => {},
  toggleSlideIndex: () => {},
};

let keyboardContext = { ...defaultContext };
let keydownHandler = null;

export function initKeyboardNav(partialContext = {}) {
  keyboardContext = { ...defaultContext, ...partialContext };

  if (keydownHandler) {
    document.removeEventListener('keydown', keydownHandler);
  }

  keydownHandler = (event) => {
    const target = event.target;
    if (
      target &&
      target instanceof HTMLElement &&
      (target.matches('input, textarea, select') || target.isContentEditable)
    ) {
      return;
    }

    const context = keyboardContext;
    const { key } = event;
    const lowerKey = key.toLowerCase();

    if (context.isOverview()) {
      if (key === 'ArrowRight') {
        event.preventDefault();
        context.moveOverviewCursorBy(1, 0);
        return;
      }
      if (key === 'ArrowLeft') {
        event.preventDefault();
        context.moveOverviewCursorBy(-1, 0);
        return;
      }
      if (key === 'ArrowDown') {
        event.preventDefault();
        context.moveOverviewCursorBy(0, 1);
        return;
      }
      if (key === 'ArrowUp') {
        event.preventDefault();
        context.moveOverviewCursorBy(0, -1);
        return;
      }
      if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        flashKeyFeedback('↵');
        context.exitOverview(context.getOverviewCursor());
        return;
      }
      if (key === 'Escape') {
        event.preventDefault();
        flashKeyFeedback('ESC');
        context.exitOverview();
        return;
      }
    }

    if (key === 'ArrowRight' || key === ' ') {
      event.preventDefault();
      flashKeyFeedback('→');
      context.setActiveSlide(context.getCurrentIndex() + 1);
      return;
    }

    if (key === 'ArrowLeft') {
      event.preventDefault();
      flashKeyFeedback('←');
      context.setActiveSlide(context.getCurrentIndex() - 1);
      return;
    }

    if (key === 'Home') {
      event.preventDefault();
      flashKeyFeedback('⇤');
      context.setActiveSlide(0);
      return;
    }

    if (key === 'End') {
      event.preventDefault();
      flashKeyFeedback('⇥');
      context.setActiveSlide(Math.max(0, context.getSlideCount() - 1));
      return;
    }

    if (lowerKey === 'o') {
      event.preventDefault();
      flashKeyFeedback('O');
      context.toggleOverview();
      return;
    }

    if (lowerKey === 'd') {
      event.preventDefault();
      flashKeyFeedback('D');
      context.downloadDeck();
      return;
    }

    if (lowerKey === 'n') {
      event.preventDefault();
      flashKeyFeedback('N');
      context.toggleSpeakerNotes();
      return;
    }

    if (lowerKey === 'u') {
      event.preventDefault();
      flashKeyFeedback('U');
      context.triggerDeckUpload();
      return;
    }

    if (lowerKey === 'e') {
      event.preventDefault();
      flashKeyFeedback('E');
      context.toggleEditDrawer();
      return;
    }

    if (lowerKey === 'v') {
      event.preventDefault();
      flashKeyFeedback('V');
      context.toggleVoiceRecording('add');
      return;
    }

    if (lowerKey === 't') {
      event.preventDefault();
      flashKeyFeedback('T');
      context.toggleThemeDrawer();
      return;
    }

    if (lowerKey === 's') {
      event.preventDefault();
      flashKeyFeedback('S');
      context.openSettingsModal();
      return;
    }

    if (lowerKey === 'i') {
      event.preventDefault();
      flashKeyFeedback('I');
      context.toggleSlideIndex();
      return;
    }

    if (lowerKey === '?' || (event.shiftKey && lowerKey === '/')) {
      event.preventDefault();
      flashKeyFeedback('?');
      context.toggleKeyboardHelp();
      return;
    }

    if (key === 'Escape') {
      context.closeSettingsModal();
    }
  };

  document.addEventListener('keydown', keydownHandler);

  return () => {
    if (keydownHandler) {
      document.removeEventListener('keydown', keydownHandler);
      keydownHandler = null;
    }
  };
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
