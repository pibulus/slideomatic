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
  moveOverviewCursorBy: (_x, _y) => {},
  exitOverview: (_targetIndex) => {},
  getOverviewCursor: () => 0,
  toggleOverview: () => {},
  toggleSpeakerNotes: () => {},
  setActiveSlide: (_index) => {},
  getCurrentIndex: () => 0,
  getSlideCount: () => 0,
  toggleEditDrawer: () => {},
  openDeckPanel: () => {},
  toggleVoiceRecording: (_mode) => {},
  openSettingsModal: () => {},
  closeSettingsModal: () => {},
  toggleKeyboardHelp: () => {},
  toggleSlideIndex: () => {},
  toggleHud: () => {},
  toggleRadio: () => {},
};

let keyboardContext = { ...defaultContext };
let keydownHandler = null;

export function initKeyboardNav(partialContext = {}) {
  keyboardContext = { ...defaultContext, ...partialContext };

  if (keydownHandler) {
    document.removeEventListener('keydown', keydownHandler);
  }

  keydownHandler = (event) => {
    // Never hijack browser/system shortcuts: Cmd+D used to download the
    // deck instead of bookmarking, Ctrl+U opened the file picker over
    // view-source, Cmd+S opened Settings over save-page, etc.
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    const target = event.target;
    if (
      target &&
      target instanceof HTMLElement &&
      (target.matches('input, textarea, select') || target.isContentEditable)
    ) {
      return;
    }

    // Disable global shortcuts if a modal is open
    // We allow drawers to stay open while navigating or toggling other drawers
    if (document.querySelector('.modal-base.is-open, .cheat-console.is-open, .slide-index.is-open')) {
      return;
    }

    const context = keyboardContext;
    const { key } = event;
    const lowerKey = key.toLowerCase();

    const isInteractiveTarget =
      target instanceof HTMLElement &&
      Boolean(
        target.closest(
          'button, a, summary, [role="button"], [role="tab"], [role="radio"], .edit-drawer.is-open'
        )
      );

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
      if (key === 'Enter' || (key === ' ' && !isInteractiveTarget)) {
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
      if (key === 'Home' || key === 'End') {
        // Jump the grid cursor instead of falling through to setActiveSlide,
        // which would tear the deck out of overview mid-layout.
        event.preventDefault();
        flashKeyFeedback(key === 'Home' ? '⇤' : '⇥');
        context.moveOverviewCursorBy(key === 'Home' ? -9999 : 9999, 0);
        return;
      }
    }

    if (key === 'ArrowRight' || (key === ' ' && !isInteractiveTarget)) {
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

    if (lowerKey === 'n') {
      event.preventDefault();
      flashKeyFeedback('N');
      context.toggleSpeakerNotes();
      return;
    }

    if (lowerKey === 'e') {
      event.preventDefault();
      const drawerIsOpen = context.toggleEditDrawer();
      if (!drawerIsOpen) {
        flashKeyFeedback('E');
      }
      return;
    }

    if (lowerKey === 'v') {
      event.preventDefault();
      flashKeyFeedback('V');
      context.toggleVoiceRecording('add');
      return;
    }

    if (lowerKey === 's') {
      event.preventDefault();
      flashKeyFeedback('S');
      context.openDeckPanel();
      return;
    }

    if (lowerKey === 'h') {
      event.preventDefault();
      flashKeyFeedback('H');
      context.toggleHud();
      return;
    }

    if (lowerKey === 'i') {
      event.preventDefault();
      flashKeyFeedback('I');
      context.toggleSlideIndex();
      return;
    }

    if (lowerKey === 'r') {
      event.preventDefault();
      flashKeyFeedback('R');
      context.toggleRadio();
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

function flashKeyFeedback() {
  // Key feedback HUD disabled intentionally.
}
