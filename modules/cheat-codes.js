import { generateSlideFromPrompt, generateDeckFromPrompt, getVoiceAssistantContext } from './voice-modes.js';
import { generateAIImage } from './image-ai.js';
import { collectImagePaths } from './image-utils.js';

const CHEAT_CODES = ['xyzzy'];
const MAX_BUFFER = Math.max(...CHEAT_CODES.map(code => code.length));

let buffer = '';
let initialized = false;
let root;
let promptInput;
let statusEl;
let slideBtn;
let deckBtn;
let unlockedLabel;

export function initCheatConsole() {
  if (initialized) return;
  root = document.getElementById('cheat-console');
  if (!root) return;

  promptInput = /** @type {HTMLTextAreaElement|null} */ (root.querySelector('#cheat-console-prompt'));
  statusEl = root.querySelector('#cheat-console-status');
  slideBtn = /** @type {HTMLButtonElement|null} */ (root.querySelector('#cheat-console-slide'));
  deckBtn = /** @type {HTMLButtonElement|null} */ (root.querySelector('#cheat-console-deck'));
  unlockedLabel = root.querySelector('#cheat-console-unlocked');
  const closeBtn = root.querySelector('[data-cheat-close]');

  if (!promptInput || !slideBtn || !deckBtn || !closeBtn) return;

  document.addEventListener('keydown', handleGlobalKey, true);
  closeBtn.addEventListener('click', hideConsole);
  root.querySelector('.cheat-console__backdrop')?.addEventListener('click', hideConsole);

  slideBtn.addEventListener('click', () => handleCheatAction('slide'));
  deckBtn.addEventListener('click', () => handleCheatAction('deck'));

  initialized = true;
}

function handleGlobalKey(event) {
  if (event.key === 'Escape' && root?.classList.contains('is-open')) {
    event.preventDefault();
    event.stopPropagation();
    hideConsole();
    return;
  }

  if (isEditableTarget(event.target) || hasBlockingModal()) {
    return;
  }

  if (!/^[a-z]$/i.test(event.key)) {
    return;
  }

  const candidate = (buffer + event.key.toLowerCase()).slice(-MAX_BUFFER);
  const isPrefix = CHEAT_CODES.some(code => code.startsWith(candidate));
  if (isPrefix) {
    event.preventDefault();
    event.stopPropagation();
  }

  buffer = candidate;
  const hit = CHEAT_CODES.find(code => buffer.endsWith(code));
  if (hit) {
    showConsole(hit);
    buffer = '';
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (!isPrefix) buffer = '';
}

function isEditableTarget(target) {
  return Boolean(
    target &&
      (target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable)
  );
}

function hasBlockingModal() {
  return Boolean(!root?.classList.contains('is-open') && document.querySelector('.modal-base.is-open'));
}

function showConsole(code) {
  if (!root || !promptInput) return;
  root.classList.add('is-open');
  root.setAttribute('aria-hidden', 'false');
  document.body.classList.add('cheat-console-open');
  if (unlockedLabel) {
    unlockedLabel.textContent = `Cheat unlocked: ${code.toUpperCase()}`;
  }
  setStatus(`Cheat "${code}" unlocked. Describe what you want and let Gemini cook.`, 'info');
  promptInput.focus();
}

function hideConsole() {
  if (!root) return;
  root.classList.remove('is-open');
  root.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('cheat-console-open');
}

async function handleCheatAction(mode) {
  if (!promptInput || !slideBtn || !deckBtn) return;
  const prompt = promptInput.value.trim();
  if (!prompt) {
    setStatus('Add a description first.', 'error');
    promptInput.focus();
    return;
  }

  const triggerBtn = mode === 'slide' ? slideBtn : deckBtn;
  const otherBtn = mode === 'slide' ? deckBtn : slideBtn;
  triggerBtn.disabled = true;
  otherBtn.disabled = true;
  triggerBtn.textContent = mode === 'slide' ? 'Cooking...' : 'Researching...';
  setStatus('', 'info');

  try {
    if (mode === 'slide') {
      await generateSlideFromPrompt(prompt, { insert: true });
      setStatus('✨ Slide injected after the current one.', 'success');
    } else {
      const context = getVoiceAssistantContext();
      const insertAfter = context.getCurrentIndex();
      const slides = await generateDeckFromPrompt(prompt, { insert: true, slideCount: 8 });
      setStatus('✨ Mini deck added! Generating images...', 'success');

      // Fire off image generation in the background for slides with empty image slots
      generateImagesForNewSlides(slides, insertAfter + 1);
    }
  } catch (error) {
    setStatus(error?.message || 'Something went wrong.', 'error');
  } finally {
    triggerBtn.disabled = false;
    otherBtn.disabled = false;
    triggerBtn.textContent = mode === 'slide' ? 'Generate slide' : 'Generate starter deck';
  }
}

async function generateImagesForNewSlides(slidesData, firstSlideIndex) {
  const context = getVoiceAssistantContext();
  const allSlides = context.getSlides();

  // Collect slides that have image placeholders without src
  const tasks = [];
  for (let i = 0; i < slidesData.length; i++) {
    const slideIndex = firstSlideIndex + i;
    if (slideIndex >= allSlides.length) break;

    const slide = allSlides[slideIndex];
    const imagePaths = collectImagePaths(slide);

    for (let imgIdx = 0; imgIdx < imagePaths.length; imgIdx++) {
      const { image } = imagePaths[imgIdx];
      // Only generate for placeholders (has alt/search text but no src)
      if (image && !image.src && (image.alt || image.search)) {
        tasks.push({ slideIndex, imageIndex: imgIdx, image });
      }
    }
  }

  if (!tasks.length) {
    setStatus('✨ Mini deck added!', 'success');
    return;
  }

  let completed = 0;
  for (const task of tasks) {
    try {
      setStatus(`🎨 Generating image ${completed + 1}/${tasks.length}...`, 'info');
      await generateAIImage(null, {
        slideIndex: task.slideIndex,
        imageIndex: task.imageIndex,
        context: {
          slideIndex: task.slideIndex,
          headline: task.image.alt || task.image.search || '',
          body: '',
          slideType: 'standard',
        },
        alt: task.image.alt || task.image.search || '',
      });
      completed++;
    } catch (error) {
      console.warn(`Image generation failed for slide ${task.slideIndex}:`, error.message);
      completed++;
    }
  }

  setStatus(`✨ Done! ${completed} image${completed !== 1 ? 's' : ''} generated.`, 'success');
}

function setStatus(message, type) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.dataset.state = type;
}
