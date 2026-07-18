// ═══════════════════════════════════════════════════════════════════════════
// Voice Modes Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Encapsulates all voice-driven features for Slide-o-Matic.
// - Voice-to-slide recording (V key) with toast feedback
// - Gemini proxy plumbing shared by slide/deck/dictation features
// - Speech capture + cleaned transcription for prompt mic buttons
//
// Used by: main.js, cheat-codes.js, edit-drawer.js, settings-modal.js
//
// ═══════════════════════════════════════════════════════════════════════════

import { debug } from './constants.js';
import { hideToastById } from './hud.js';

export const STORAGE_KEY_API = 'slideomatic_gemini_api_key';
export const GEMINI_TRANSCRIPTION_MODEL = 'gemini-flash-latest';
export const GEMINI_GENERATION_MODEL = 'gemini-flash-latest';

const defaultContext = {
  getCurrentIndex: () => 0,
  getSlides: () => [],
  insertSlideAt: (_index, _slide, _options) => {},
  replaceSlideAt: (_index, _options) => {},
  setActiveSlide: (_index) => {},
  setOverviewCursor: (_index) => {},
  updateSlide: (_index, _slide) => {},
  validateSlides: (_slides) => {},
  showHudStatus: (_message, _type) => {},
  hideHudStatus: () => {},
  showApiKeyStatus: (_type, _message) => {},
  openSettingsModal: () => {},
};

let voiceContext = { ...defaultContext };

const voiceButtons = {};

let isRecording = false;
// Set synchronously before the getUserMedia await — isRecording alone left a
// window where a double-press spawned two recorders sharing module state and
// leaked a hot mic.
let isStartingRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let mediaStream = null;
let activeVoiceMode = null;
let voiceProcessing = false;
let recordingCapTimer = null;
let voiceFallbackToastId = null;

// Netlify function payloads cap at 6MB; ~5 minutes of Opus stays safely under.
const MAX_RECORDING_MS = 5 * 60 * 1000;
const MIN_RECORDING_BYTES = 1024;

function setVoiceContext(partialContext = {}) {
  voiceContext = { ...defaultContext, ...partialContext };
}

function getVoiceContext() {
  return voiceContext;
}

export function getGeminiApiKey() {
  return localStorage.getItem(STORAGE_KEY_API) || '';
}

// Route Gemini calls through our Netlify proxy so the SHARED app key stays
// server-side. If the visitor pasted their own key, it's sent as `userKey` and
// the proxy uses theirs instead. Returns the raw fetch Response so existing
// callers keep using response.ok / response.json() unchanged.
const GEMINI_PROXY_URL = '/.netlify/functions/gemini';
export async function callGemini(model, payload, { signal } = {}) {
  const response = await fetch(GEMINI_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ model, payload, userKey: getGeminiApiKey() || undefined }),
  }).catch(() => null);

  if (response && response.status !== 404) return response;

  // Static hosting and `npm run dev` have no Netlify functions: when the
  // visitor pasted their own key, go direct instead of dying on a 404
  const key = getGeminiApiKey();
  if (!key) {
    return response || fetch(GEMINI_PROXY_URL, { method: 'POST' });
  }
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify(payload),
    }
  );
}

export function isVoiceBusy() {
  return isRecording || isStartingRecording || voiceProcessing;
}

export function getVoiceAssistantContext() {
  return getVoiceContext();
}

function getPreferredAudioMimeType() {
  const mimeTypes = ['audio/webm', 'audio/ogg', 'audio/mp4', ''];
  for (const type of mimeTypes) {
    if (!type || MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

export function canRecordSpeech() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}

export async function startSpeechCapture({ onStop, onError } = {}) {
  if (!canRecordSpeech()) {
    throw new Error('Voice recording is not supported in this browser.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }
  });

  const mimeType = getPreferredAudioMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];

  const stopTracks = () => {
    stream.getTracks().forEach((track) => track.stop());
  };

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  recorder.onstop = async () => {
    stopTracks();
    const audioBlob = new Blob(chunks, { type: mimeType || 'audio/webm' });
    if (typeof onStop === 'function') {
      await onStop(audioBlob);
    }
  };

  recorder.onerror = (event) => {
    stopTracks();
    if (typeof onError === 'function') {
      onError(event.error || new Error('The recording did not come through. One more take?'));
    }
  };

  recorder.start(1000);

  return {
    stop() {
      if (recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        stopTracks();
      }
    },
  };
}

export async function transcribeSpeechToText(audioBlob, options = {}) {
  const context = getVoiceContext();
  ensureApiKeyOrThrow(context);
  const base64Audio = await blobToBase64(audioBlob);
  const audioData = base64Audio.split(',')[1];
  const prompt = options.prompt || buildCleanTranscriptionPrompt();

  const response = await callGemini(
    GEMINI_TRANSCRIPTION_MODEL,
    {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: audioBlob.type || 'audio/webm',
                data: audioData,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 512,
      },
    },
    { signal: AbortSignal.timeout(options.timeout || 30_000) }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `Gemini could not hear that one (${response.status}). Try again`);
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts;
  const text = parts?.map((part) => part.text).filter(Boolean).join('\n').trim();
  if (!text) {
    throw new Error('No transcript returned');
  }

  return cleanupTranscript(text);
}

function ensureButtonInitialized(button, handler) {
  if (!button) return;
  if (!button.dataset.voiceInitialized) {
    button.addEventListener('click', handler);
    button.dataset.voiceInitialized = 'true';
  }
}

export function initVoiceButtons(partialContext = {}) {
  setVoiceContext(partialContext);

  // Check for MediaRecorder support
  const hasMediaRecorder = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

  if (!hasMediaRecorder) {
    console.warn('⚠️ Voice features disabled: MediaRecorder API not supported');
    disableVoiceButtons();
    return;
  }

  // The current HUD has no dedicated voice buttons — the V key is the entry
  // point and updateVoiceUI falls back to toasts. If a voice button returns
  // to the shell markup, this wires it up again.
  const addBtn = document.getElementById('add-btn');
  if (addBtn) {
    voiceButtons.add = addBtn;
    ensureButtonInitialized(addBtn, () => toggleVoiceRecording('add'));
    updateVoiceUI('add', 'idle');
  }
}

function disableVoiceButtons() {
  const buttons = ['add-btn', 'edit-btn', 'theme-voice-btn'];

  buttons.forEach(btnId => {
    const btn = document.getElementById(btnId);
    if (btn instanceof HTMLButtonElement) {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
      btn.title = 'Voice features require MediaRecorder API (not supported in this browser)';
      btn.setAttribute('aria-label', 'Voice recording unavailable');
    }
  });
}

export function hasGeminiKey() {
  return !!getGeminiApiKey();
}

export function toggleVoiceRecording(mode = 'add') {
  // Voice is opt-in: no pasted Gemini key, no voice. Point at Settings
  // instead of failing mid-recording.
  if (!hasGeminiKey()) {
    import('./hud.js').then(({ showHudStatus, hideHudStatus }) => {
      showHudStatus('🎙 Voice needs a Gemini key. Add one in Settings (S or the ? menu)', 'info');
      setTimeout(hideHudStatus, 3200);
    });
    return;
  }

  if (voiceProcessing || isStartingRecording) {
    return;
  }

  if (isRecording) {
    if (activeVoiceMode === mode) {
      stopVoiceRecording();
    }
    return;
  }

  startVoiceRecording(mode);
}

export async function startVoiceRecording(mode) {
  if (isStartingRecording || isRecording) return;
  isStartingRecording = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }
    });

    const mimeType = getPreferredAudioMimeType();

    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    audioChunks = [];
    mediaStream = stream;
    activeVoiceMode = mode;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const currentMode = activeVoiceMode || mode;
      const audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' });
      voiceProcessing = true;
      try {
        if (audioBlob.size < MIN_RECORDING_BYTES) {
          // Insta-taps produce empty blobs — don't burn an API call on them.
          const context = getVoiceContext();
          context.showHudStatus('🤏 Nothing recorded — hold the mic a moment longer', 'warning');
        } else {
          await processVoiceToSlide(audioBlob);
        }
      } finally {
        cleanupVoiceRecording({ resetButton: false });
        updateVoiceUI(currentMode, 'idle');
        voiceProcessing = false;
        activeVoiceMode = null;
      }
    };

    mediaRecorder.start(1000);
    isRecording = true;
    // Hard cap: a forgotten hot mic would eventually exceed the function
    // payload limit anyway — stop and process what we have.
    recordingCapTimer = setTimeout(() => {
      if (isRecording) {
        getVoiceContext().showHudStatus('⏱️ Recording capped at 5 minutes — processing…', 'warning');
        stopVoiceRecording();
      }
    }, MAX_RECORDING_MS);
    updateVoiceUI(mode, 'recording');
    debug('Recording started');
  } catch (error) {
    console.error('❌ Error starting recording:', error);
    const context = getVoiceContext();
    context.showHudStatus('🎙 The mic is not reachable. Check browser permissions', 'error');
    setTimeout(context.hideHudStatus, 3000);
    cleanupVoiceRecording({ resetButton: false });
    updateVoiceUI(mode, 'idle');
    activeVoiceMode = null;
  } finally {
    isStartingRecording = false;
  }
}

export function stopVoiceRecording() {
  if (!mediaRecorder || !isRecording) return;

  isRecording = false;
  if (activeVoiceMode) {
    updateVoiceUI(activeVoiceMode, 'processing');
  }

  if (mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

function cleanupVoiceRecording({ resetButton = true } = {}) {
  if (recordingCapTimer) {
    clearTimeout(recordingCapTimer);
    recordingCapTimer = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  mediaRecorder = null;
  audioChunks = [];
  isRecording = false;
  if (resetButton && activeVoiceMode) {
    updateVoiceUI(activeVoiceMode, 'idle');
  }
}

function updateVoiceUI(mode, state) {
  const button = voiceButtons[mode];
  const hudStatus = document.getElementById('hud-status');
  if (!button) {
    // No voice button in the current HUD (the V-key flow): fall back to
    // sticky toasts so recording is never an invisible hot mic. Dismiss by
    // id — hideHudStatus() pops the newest toast, which by idle time is the
    // success/error message the user actually needs to see.
    const context = getVoiceContext();
    if (state === 'recording') {
      voiceFallbackToastId = context.showHudStatus('🎙 Recording… press V to finish', 'processing');
    } else if (state === 'processing') {
      hideToastById(voiceFallbackToastId);
      voiceFallbackToastId = context.showHudStatus('🤖 Turning speech into a slide…', 'processing');
    } else if (voiceFallbackToastId != null) {
      hideToastById(voiceFallbackToastId);
      voiceFallbackToastId = null;
    }
    return;
  }

  const baseLabel = mode === 'edit' ? 'Edit' : 'Add';
  const shortcutHint = mode === 'add' ? ' (shortcut V)' : '';

  if (state === 'recording') {
    button.classList.add('is-recording');
    button.classList.remove('is-processing');
    button.textContent = 'Stop';
    button.setAttribute('aria-label', 'Stop recording');
    if (hudStatus) {
      hudStatus.textContent = '🎙 Recording...';
      hudStatus.className = 'hud__status hud__status--recording is-visible';
    }
    return;
  }

  if (state === 'processing') {
    button.classList.add('is-processing');
    button.classList.remove('is-recording');
    button.textContent = 'Processing...';
    button.setAttribute('aria-label', 'Processing voice input');
    if (hudStatus) {
      hudStatus.textContent = '🤖 Thinking...';
      hudStatus.className = 'hud__status hud__status--processing is-visible';
    }
    return;
  }

  button.classList.remove('is-recording', 'is-processing');
  button.textContent = baseLabel;
  button.setAttribute('aria-label', `${baseLabel} slide from voice${shortcutHint}`);
}

export async function processVoiceToSlide(audioBlob) {
  const context = getVoiceContext();
  try {
    debug('Processing audio with Gemini');
    const uiStart = performance.now();

    const base64Audio = await blobToBase64(audioBlob);
    const audioData = base64Audio.split(',')[1];

    const prompt = buildSlideDesignPrompt();

    const response = await callGemini(
      GEMINI_GENERATION_MODEL,
      {
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: audioBlob.type || 'audio/webm',
                  data: audioData,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
        },
      },
      { signal: AbortSignal.timeout(45_000) }
    );

    if (!response.ok) {
      // Non-JSON error bodies (e.g. a 404 from `npm run dev`, which has no
      // functions) shouldn't surface as "Unexpected token '<'".
      const error = await response.json().catch(() => null);
      throw new Error(error?.error?.message || `Gemini did not answer (${response.status}). Try again`);
    }

    const result = await response.json();
    // Safety-blocked responses come back with no candidates at all.
    const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!generatedText) {
      throw new Error('No response from Gemini');
    }

    const jsonMatch = generatedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ||
                      generatedText.match(/\{[\s\S]*\}/);

    const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : generatedText;
    const slideData = normalizeGeneratedSlide(JSON.parse(jsonText));
    context.validateSlides([slideData]);

    const newIndex = insertSlideAfterCurrent(slideData);

    await ensureMinimumDelay(uiStart, 1300);
    context.showHudStatus('✨ Slide ready — Save Deck to export', 'success');
    context.setActiveSlide(newIndex);
    setTimeout(context.hideHudStatus, 2000);
    debug('Slide created and inserted');
  } catch (error) {
    console.error('❌ Error processing voice:', error);
    context.showHudStatus(`🎙 ${error.message}`, 'error');
    setTimeout(context.hideHudStatus, 4000);
  }
}

export async function generateSlideFromPrompt(promptText, { insert = false } = {}) {
  const context = getVoiceContext();
  const request = (promptText || '').trim();
  if (!request) {
    throw new Error('Describe the slide you want first.');
  }

  const apiKey = ensureApiKeyOrThrow(context);
  context.showHudStatus('🪄 Summoning a slide...', 'info');

  try {
    const prompt = buildSlideDesignPrompt(request);
    const slide = normalizeGeneratedSlide(await requestGeminiJson(apiKey, prompt, {
      temperature: 0.65,
      maxOutputTokens: 2048,
    }));

    context.validateSlides([slide]);

    if (insert) {
      const newIndex = insertSlideAfterCurrent(slide);
      context.setActiveSlide(newIndex);
      context.setOverviewCursor(newIndex);
    }

    context.showHudStatus('✨ Slide ready', 'success');
    setTimeout(context.hideHudStatus, 2000);
    return slide;
  } catch (error) {
    console.error('Gemini slide prompt failed:', error);
    context.showHudStatus(`🎙 ${error.message}`, 'error');
    setTimeout(context.hideHudStatus, 3500);
    throw error;
  }
}

export async function generateDeckFromPrompt(promptText, { insert = false, slideCount = 5 } = {}) {
  const context = getVoiceContext();
  const request = (promptText || '').trim();
  if (!request) {
    throw new Error('Describe the deck you want first.');
  }

  const apiKey = ensureApiKeyOrThrow(context);
  context.showHudStatus('📚 Drafting a deck...', 'info');

  try {
    const prompt = buildDeckDesignPrompt(request, slideCount);
    const payload = await requestGeminiJson(apiKey, prompt, {
      temperature: 0.75,
      maxOutputTokens: 8192,
    }, { timeout: 60_000 });

    const slidesArray = extractSlidesArray(payload);
    if (!slidesArray.length) {
      throw new Error('No slides returned');
    }

    context.validateSlides(slidesArray);

    // The current index is read here, AFTER the long generation await — the
    // caller can't know it in advance (the user may have navigated while the
    // model worked), so the actual insert position is returned alongside.
    let firstInserted = null;
    if (insert) {
      let insertIndex = context.getCurrentIndex();
      slidesArray.forEach((slide, idx) => {
        insertIndex += 1;
        const shouldActivate = idx === slidesArray.length - 1;
        context.insertSlideAt(insertIndex, slide, { activate: shouldActivate });
      });
      firstInserted = insertIndex - slidesArray.length + 1;
      context.setActiveSlide(firstInserted);
      context.setOverviewCursor(firstInserted);
    }

    context.showHudStatus(`✨ Added ${slidesArray.length} slides`, 'success');
    setTimeout(context.hideHudStatus, 2200);
    return { slides: slidesArray, firstIndex: firstInserted };
  } catch (error) {
    console.error('Gemini deck prompt failed:', error);
    context.showHudStatus(`🎙 ${error.message}`, 'error');
    setTimeout(context.hideHudStatus, 3500);
    throw error;
  }
}

function insertSlideAfterCurrent(slideData) {
  const context = getVoiceContext();
  const newIndex = context.getCurrentIndex() + 1;
  context.insertSlideAt(newIndex, slideData, { activate: true });
  return newIndex;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function ensureMinimumDelay(startTimestamp, minimumMs = 1200) {
  const elapsed = performance.now() - startTimestamp;
  if (elapsed >= minimumMs) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, minimumMs - elapsed));
}

/**
 * Gemini sometimes hands back "image": "some description" instead of the
 * {src, alt} object the renderer expects. Coerce every image field so a
 * model quirk never produces a broken slide.
 */
function normalizeGeneratedSlide(slide) {
  const fixImage = (obj) => {
    if (obj && typeof obj.image === 'string') {
      obj.image = { src: '', alt: obj.image };
    }
  };
  fixImage(slide);
  if (Array.isArray(slide.items)) slide.items.forEach(fixImage);
  if (Array.isArray(slide.pillars)) slide.pillars.forEach(fixImage);
  fixImage(slide.left);
  fixImage(slide.right);
  return slide;
}

function buildSlideDesignPrompt(description = null) {
  let basePrompt = `You are a slide designer for Slideomatic, a presentation system. Your job is to create a single slide JSON object based on the user's request.

THE ONE-SLIDE PROMISE:
- You ALWAYS return exactly one good slide, whatever you receive. A two-minute
  ramble gets distilled to its single sharpest idea. One word becomes a bold
  statement slide. Never ask for more input, never apologize for thin material.
- Spoken input is thinking-out-loud: DISTILL it, do not transcribe it. Drop the
  filler, keep the spark.
- If the material is thin (one word, a vibe), have fun: a punchy statement
  slide, or a REAL quote from a famous person that fits the theme (type "quote"
  with a true attribution), or one surprising true fact. A little sass is
  welcome; nonsense is not.
- Slide copy is punchy: short headline, at most 3 short body lines. No
  corporate filler.

RULES:
- Only respond with JSON (no markdown, no explanation)
- "image" is ALWAYS an object {"src": "", "alt": "findable description"}, never a bare string
- Match the requested slide type if the user mentions one
- Assume images should have descriptive alt text using FINDABLE language (see examples below)
- If the user does not mention type, pick the best default: "standard" for text slides, "gallery" for lists of visuals, "quote" for quotes, "pillars" for feature lists
- Always include "type" key
- For text arrays (items, pillars), return arrays of objects with the expected keys
- If the user mentions notes/speaker notes, include "notes"
- If the user mentions fonts, add "font"
- Use proper punctuation and casing
- If the user mentions specific data or stats, include them in the body or list items

IMAGE ALT TEXT RULES:
- Alt text should describe the subject in a way that will retrieve good Google Images results (without being overly specific)
- Good examples: "mountain sunrise landscape", "retro synthesizer", "modern home office desk"
- Bad examples: "photo123", "image.png", "mount everest north face 1996"

AVAILABLE SLIDE TYPES:
1. "title" - Big hero slide with title, subtitle, optional media strip
2. "standard" - Headline + body + optional image
3. "quote" - Large quote with attribution
4. "split" - Two-column layout
5. "grid" - Image or color grid
6. "pillars" - Feature cards
7. "gallery" - Visual gallery
8. "image" - Full-bleed image
9. "graph" - AI-generated infographic/graph
10. "typeface" - Font showcase

`;

  if (description) {
    basePrompt += `\nUSER REQUEST:\n${description}\n`;
  } else {
    basePrompt += '\nThe request will be provided via audio input.';
  }

  basePrompt += '\nReturn ONLY valid JSON matching the schema. No markdown, no explanations.';
  return basePrompt;
}

function buildDeckDesignPrompt(description, desiredCount = 8) {
  const safeCount = Math.max(3, Math.min(desiredCount, 12));
  return `You are a presentation coach and researcher for Slideomatic. Create ${safeCount} slides that form a REAL, PRESENTABLE deck on this topic — not a skeleton or outline.

PHILOSOPHY:
This deck should be good enough to present TODAY, but obviously better once the person adds their own knowledge and examples. Think of it as a research springboard + starter kit:
- Include REAL facts, specific names, dates, and examples — not vague summaries
- Include WORKING links to real websites, articles, Wikipedia pages, YouTube videos, or resources (use well-known URLs that are likely to work — Wikipedia, YouTube, major publications, established tools)
- Include discussion questions that work BOTH as presentation talking points AND as research prompts for the person building the deck
- Leave visible threads — mention interesting tangents without fully explaining them, so the person naturally wants to dig deeper
- Use "notes" field for presenter tips, extra context, or "you might also look into..." suggestions

CONTENT STRATEGY:
The goal is dual-use content. Every slide should work as a real presentation slide AND open doors:
- A great quote makes them want to find more from that person
- A specific example makes them think "oh I know an even better one"
- A discussion question works in class AND sends the deck-builder down a rabbithole
- Real links give them a starting point to branch off from
- Mentioning a controversy or surprising fact makes them curious enough to explore

SLIDE MIX (vary these):
- 1 title slide with a compelling angle on the topic
- 4-5 content slides with real substance (facts, links, images, examples)
- 1-2 slides with discussion questions or provocations that could be used in a talk
- 1 closing slide that reframes the topic or leaves a thread to pull

STRICT SCHEMA — follow these EXACTLY:

VALID SLIDE TYPES (use ONLY these, never invent new ones):
- "title" — keys: type, title, subtitle, image:{src,alt}, notes
- "standard" — keys: type, badge, headline, body:["line","line"], image:{src,alt}, notes
- "quote" — keys: type, quote, attribution, notes
- "split" — keys: type, badge, headline, left:{}, right:{}, notes
- "pillars" — keys: type, badge, headline, pillars:[{title,body}], notes
- "gallery" — keys: type, badge, headline, items:[{image:{src,alt},caption}], notes
- "image" — keys: type, image:{src,alt}, notes
- "graph" — keys: type, badge, headline, description, notes

CRITICAL RULES:
- ONLY use the types listed above. Do NOT invent types like "discussion" or "closing"
- For discussion/closing slides, use "standard" type
- Links go INLINE in body text as markdown: "**[Display Text](https://real-url.com)**"
- Do NOT use separate "links" or "discussion_questions" arrays — embed everything in body text
- "body" is always an array of strings, each string is one line/bullet
- For quote slides: use "quote" (the text) and "attribution" (the person) — NOT "quote_text"/"quote_author"
- Image objects: { "src": "", "alt": "descriptive search text" } — leave src empty, the app will generate images
- All URLs in body text must be real, likely-working URLs (Wikipedia, YouTube, major publications)

TOPIC:
${description}

OUTPUT:
- Return ONLY a JSON array of slide objects, or an object with a "slides" array. No markdown wrapper, no \`\`\`json fences.`;
}

// Kept for signature/call-site compatibility. The Netlify proxy supplies a
// shared server-side key when the visitor hasn't pasted their own, so an empty
// key is fine here — never throw or force-open settings.
function ensureApiKeyOrThrow(_context) {
  return getGeminiApiKey();
}

function buildCleanTranscriptionPrompt() {
  return `Transcribe the attached speech into clean text for a prompt box.

Rules:
- Return only the cleaned transcript text.
- Do not add labels, quotes, timestamps, markdown, summary, or commentary.
- Remove filler words and stumbles such as "um", "uh", "er", "ah", "like" when used as filler, "you know", "sort of", and "kind of".
- Keep the speaker's meaning, proper nouns, concrete details, tone, and useful phrasing.
- Preserve intentional slang or emphasis when it helps the prompt.
- Use normal punctuation and sentence casing.`;
}

function cleanupTranscript(text) {
  return text
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/^(transcript|clean transcript|text)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function requestGeminiJson(apiKey, prompt, generationConfig = {}, { timeout = 30_000 } = {}) {
  // apiKey arg kept for signature compatibility; callGemini sources the key
  // (user's own if set, else the server-side app key via the proxy).
  const response = await callGemini(
    GEMINI_GENERATION_MODEL,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 2048,
        ...generationConfig,
      },
    },
    { signal: AbortSignal.timeout(timeout) }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `API error ${response.status}`);
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts;
  const text = parts?.map((part) => part.text).filter(Boolean).join('\n').trim();
  if (!text) {
    throw new Error('No response from Gemini');
  }

  return parseJsonPayload(text);
}

function parseJsonPayload(text) {
  const blockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const raw = blockMatch ? blockMatch[1] : text;
  try {
    return JSON.parse(raw);
  } catch {
    console.error('Failed to parse Gemini JSON:', raw);
    throw new Error('Gemini returned invalid JSON');
  }
}

function extractSlidesArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.slides)) return payload.slides;
  if (payload && Array.isArray(payload.deck)) return payload.deck;
  throw new Error('Expected an array of slides from Gemini');
}


