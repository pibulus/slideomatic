// ═══════════════════════════════════════════════════════════════════════════
// Touch Navigation Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Handles touch gestures for mobile navigation:
// - Swipe left/right to change slides
// - Respects overview mode (disables swipe when active)
//
// Dependencies: None (expects callbacks from main.js)
// Used by: main.js
//
// ═══════════════════════════════════════════════════════════════════════════

const SWIPE_THRESHOLD = 50; // Minimum distance to trigger swipe

let touchStartX = 0;
let touchStartY = 0;
let touchContext = {
  setActiveSlide: () => {},
  getCurrentIndex: () => 0,
  isOverview: () => false,
};

export function initTouchNav(partialContext = {}) {
  touchContext = { ...touchContext, ...partialContext };
  
  const target = document.body; // Listen on body to catch all swipes

  target.addEventListener('touchstart', handleTouchStart, { passive: true });
  target.addEventListener('touchend', handleTouchEnd, { passive: true });

  return () => {
    target.removeEventListener('touchstart', handleTouchStart);
    target.removeEventListener('touchend', handleTouchEnd);
  };
}

function handleTouchStart(event) {
  if (touchContext.isOverview()) return;
  
  // Ignore multi-touch gestures
  if (event.touches.length > 1) return;

  touchStartX = event.changedTouches[0].screenX;
  touchStartY = event.changedTouches[0].screenY;
}

function handleTouchEnd(event) {
  if (touchContext.isOverview()) return;

  const touchEndX = event.changedTouches[0].screenX;
  const touchEndY = event.changedTouches[0].screenY;

  handleSwipeGesture(touchStartX, touchStartY, touchEndX, touchEndY);
}

function handleSwipeGesture(startX, startY, endX, endY) {
  const deltaX = endX - startX;
  const deltaY = endY - startY;

  // Check if horizontal movement dominates vertical movement
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    // Horizontal swipe
    if (Math.abs(deltaX) > SWIPE_THRESHOLD) {
      if (deltaX > 0) {
        // Swipe Right -> Previous Slide
        touchContext.setActiveSlide(touchContext.getCurrentIndex() - 1);
      } else {
        // Swipe Left -> Next Slide
        touchContext.setActiveSlide(touchContext.getCurrentIndex() + 1);
      }
    }
  }
}
