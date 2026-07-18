import {
  generateSlideFromPrompt,
  generateDeckFromPrompt,
  getVoiceAssistantContext,
  startSpeechCapture,
  transcribeSpeechToText,
} from './voice-modes.js';
import { generateAIImage } from './image-ai.js';
import { collectImagePaths } from './image-utils.js';
import { trapFocus } from './utils.js';

// KAZAM is the documented magic word: its letters (k, a, z, m) trigger no
// keyboard shortcuts, so typing it never fires Overview or the drawer.
// The old number codes stay alive for returning demon slayers.
const CHEAT_CODES = ['kazam', '666', '696969'];
const MAX_BUFFER = Math.max(...CHEAT_CODES.map(code => code.length));

let buffer = '';
let initialized = false;
let root;
let promptInput;
let statusEl;
let slideBtn;
let deckBtn;
let dictateBtn;
let unlockedLabel;
let previousFocus = null;
// Set when the console closes so a background image-gen loop stops making
// Gemini calls for a deck the user has already dismissed.
let imageGenAborted = false;
let dictationSession = null;

export function initCheatConsole() {
  if (initialized) return;
  root = document.getElementById('cheat-console');
  if (!root) return;

  promptInput = /** @type {HTMLTextAreaElement|null} */ (root.querySelector('#cheat-console-prompt'));
  statusEl = root.querySelector('#cheat-console-status');
  slideBtn = /** @type {HTMLButtonElement|null} */ (root.querySelector('#cheat-console-slide'));
  deckBtn = /** @type {HTMLButtonElement|null} */ (root.querySelector('#cheat-console-deck'));
  dictateBtn = /** @type {HTMLButtonElement|null} */ (root.querySelector('#cheat-console-dictate'));
  unlockedLabel = root.querySelector('#cheat-console-unlocked');
  const closeButtons = root.querySelectorAll('[data-cheat-close]');

  if (!promptInput || !slideBtn || !deckBtn || !dictateBtn || closeButtons.length === 0) return;

  document.addEventListener('keydown', handleGlobalKey, true);
  closeButtons.forEach((button) => button.addEventListener('click', hideConsole));

  slideBtn.addEventListener('click', () => handleCheatAction('slide'));
  deckBtn.addEventListener('click', () => handleCheatAction('deck'));
  dictateBtn.addEventListener('click', handleDictationToggle);

  initialized = true;
}

function handleGlobalKey(event) {
  if (event.key === 'Escape' && root?.classList.contains('is-open')) {
    event.preventDefault();
    event.stopPropagation();
    hideConsole();
    return;
  }

  if (event.key === 'Tab' && root?.classList.contains('is-open')) {
    trapFocus(event, root);
    return;
  }

  if (isEditableTarget(event.target) || hasBlockingModal()) {
    return;
  }

  if (!/^[a-z0-9]$/i.test(event.key)) {
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

// Touch path into the console — phones can't type kazam into thin air.
// Reached from the help modal's AI row.
export function openCheatConsole() {
  showConsole('kazam');
}

function showConsole(code) {
  if (!root || !promptInput) return;
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  root.removeAttribute('inert');
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
  imageGenAborted = true;
  stopDictationSession();
  root.classList.remove('is-open');
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('inert', '');
  document.body.classList.remove('cheat-console-open');
  if (document.activeElement === promptInput) {
    promptInput.blur();
  }
  if (previousFocus && typeof previousFocus.focus === 'function' && !root.contains(previousFocus)) {
    requestAnimationFrame(() => previousFocus?.focus({ preventScroll: true }));
  }
  previousFocus = null;
}

async function handleDictationToggle() {
  if (!promptInput || !dictateBtn) return;

  if (dictationSession) {
    const session = dictationSession;
    dictationSession = null;
    dictateBtn.disabled = true;
    dictateBtn.textContent = 'Wait';
    setStatus('Cleaning up transcript...', 'info');
    session.stop();
    return;
  }

  // No key gate: the Gemini proxy falls back to the shared server key, so
  // dictation works out of the box just like deck/slide generation.
  try {
    const token = { cancelled: false };
    setDictationButtonState('recording');
    setStatus('Recording prompt. Tap Mic again to stop.', 'info');
    const recorder = await startSpeechCapture({
      onStop: async (audioBlob) => {
        if (token.cancelled) return;
        try {
          setDictationButtonState('processing');
          setStatus('Cleaning transcript...', 'info');
          const transcript = await transcribeSpeechToText(audioBlob);
          insertPromptText(transcript);
          setStatus('Transcript added.', 'success');
        } catch (error) {
          setStatus(error?.message || 'That take got lost in the wires. Record it again', 'error');
        } finally {
          dictationSession = null;
          setDictationButtonState('idle');
          promptInput?.focus();
        }
      },
      onError: (error) => {
        if (token.cancelled) return;
        dictationSession = null;
        setDictationButtonState('idle');
        setStatus(error?.message || 'Recording hiccup. One more take', 'error');
      },
    });
    dictationSession = { stop: recorder.stop, token };
  } catch (error) {
    dictationSession = null;
    setDictationButtonState('idle');
    setStatus(error?.message || 'The mic would not wake up. Check browser permissions', 'error');
  }
}

function stopDictationSession() {
  if (!dictationSession) return;
  const session = dictationSession;
  dictationSession = null;
  session.token.cancelled = true;
  session.stop();
  setDictationButtonState('idle');
}

function setDictationButtonState(state) {
  if (!dictateBtn) return;
  dictateBtn.classList.toggle('is-recording', state === 'recording');
  dictateBtn.disabled = state === 'processing';
  dictateBtn.textContent = state === 'recording' ? 'Stop' : state === 'processing' ? 'Wait' : 'Mic';
  dictateBtn.setAttribute(
    'aria-label',
    state === 'recording' ? 'Stop dictation' : 'Dictate prompt'
  );
}

function insertPromptText(text) {
  if (!promptInput) return;
  const clean = (text || '').trim();
  if (!clean) return;

  const current = promptInput.value.trim();
  promptInput.value = current ? `${current}\n${clean}` : clean;
  promptInput.dispatchEvent(new Event('input', { bubbles: true }));
}

async function handleCheatAction(mode) {
  if (!promptInput || !slideBtn || !deckBtn) return;
  const prompt = promptInput.value.trim();
  if (!prompt) {
    setStatus('Add a description first, then let Gemini cook', 'info');
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
      // generateDeckFromPrompt reports where it actually inserted — reading
      // getCurrentIndex() before the long await pointed image generation at
      // the wrong slides whenever the user navigated during generation.
      const { slides, firstIndex } = await generateDeckFromPrompt(prompt, { insert: true, slideCount: 8 });
      setStatus('✨ Mini deck added! Generating images...', 'success');

      // Fire off image generation in the background for slides with empty image slots
      if (firstIndex != null) {
        generateImagesForNewSlides(slides, firstIndex);
      }
    }
  } catch (error) {
    setStatus(error?.message || 'That one fizzled. Give it another go', 'error');
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

  imageGenAborted = false;
  let attempted = 0;
  let generated = 0;
  for (const task of tasks) {
    if (imageGenAborted) {
      console.warn('Image generation aborted — console was closed.');
      return;
    }
    try {
      setStatus(`🎨 Generating image ${attempted + 1}/${tasks.length}...`, 'info');
      const ok = await generateAIImage(null, {
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
      if (ok) generated++;
    } catch (error) {
      console.warn(`Image generation failed for slide ${task.slideIndex}:`, error.message);
    }
    attempted++;
  }

  if (generated === tasks.length) {
    setStatus(`✨ Done! ${generated} image${generated !== 1 ? 's' : ''} generated.`, 'success');
  } else if (generated > 0) {
    setStatus(`✨ ${generated}/${tasks.length} images generated — retry the rest from the edit drawer.`, 'info');
  } else {
    setStatus('⚠️ Images didn\'t generate — use the ✨ button in the edit drawer to retry.', 'error');
  }
}

function setStatus(message, type) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.dataset.state = type;
}
