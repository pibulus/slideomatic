// ═══════════════════════════════════════════════════════════════════════════
// Voice Modes Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Encapsulates all voice-driven features for Slide-o-Matic.
// - Handles recording controls and button state
// - Integrates with Gemini APIs for slide/theme generation
// - Manages transcription flows and result application
//
// Dependencies: theme-manager.js (for applying generated themes)
// Used by: main.js
//
// ═══════════════════════════════════════════════════════════════════════════

import { applyTheme, setCurrentTheme, downloadTheme } from './theme-manager.js';

export const STORAGE_KEY_API = 'slideomatic_gemini_api_key';

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
let mediaRecorder = null;
let audioChunks = [];
let mediaStream = null;
let activeVoiceMode = null;
let voiceProcessing = false;

let isRecordingTheme = false;
let themeMediaRecorder = null;
let themeAudioChunks = [];
let themeMediaStream = null;

function setVoiceContext(partialContext = {}) {
  voiceContext = { ...defaultContext, ...partialContext };
}

function getVoiceContext() {
  return voiceContext;
}

export function getGeminiApiKey() {
  return localStorage.getItem(STORAGE_KEY_API) || '';
}

export function getVoiceAssistantContext() {
  return getVoiceContext();
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

  const addBtn = document.getElementById('add-btn');
  if (addBtn) {
    voiceButtons.add = addBtn;
    ensureButtonInitialized(addBtn, () => toggleVoiceRecording('add'));
    updateVoiceUI('add', 'idle');
  }

  const editBtn = document.getElementById('edit-btn');
  if (editBtn) {
    voiceButtons.edit = editBtn;
    ensureButtonInitialized(editBtn, () => toggleVoiceRecording('edit'));
  }

  const themeVoiceBtn = document.getElementById('theme-voice-btn');
  if (themeVoiceBtn) {
    ensureButtonInitialized(themeVoiceBtn, toggleVoiceTheme);
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

export function toggleVoiceRecording(mode = 'add') {
  const context = getVoiceContext();
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    context.openSettingsModal();
    context.showApiKeyStatus('error', 'Please add your Gemini API key to use voice features');
    return;
  }

  if (mode === 'edit') {
    const slides = context.getSlides();
    const slide = slides[context.getCurrentIndex()];
    if (!slide) {
      alert('No slide selected to edit.');
      return;
    }
  }

  if (voiceProcessing) {
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
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }
    });

    const mimeTypes = ['audio/webm', 'audio/ogg', 'audio/mp4', ''];
    let mimeType = '';
    for (const type of mimeTypes) {
      if (!type || MediaRecorder.isTypeSupported(type)) {
        mimeType = type;
        break;
      }
    }

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
        await processVoiceAction(currentMode, audioBlob);
      } finally {
        cleanupVoiceRecording({ resetButton: false });
        updateVoiceUI(currentMode, 'idle');
        voiceProcessing = false;
        activeVoiceMode = null;
      }
    };

    mediaRecorder.start(1000);
    isRecording = true;
    updateVoiceUI(mode, 'recording');
    console.log('🎙️ Recording started...');
  } catch (error) {
    console.error('❌ Error starting recording:', error);
    alert('Failed to access microphone. Please check permissions.');
    cleanupVoiceRecording({ resetButton: false });
    updateVoiceUI(mode, 'idle');
    activeVoiceMode = null;
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
  if (!button) return;

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

async function processVoiceAction(mode, audioBlob) {
  const action = mode === 'edit' ? processVoiceEditSlide : processVoiceToSlide;
  await action(audioBlob);
}

export async function processVoiceToSlide(audioBlob) {
  const context = getVoiceContext();
  try {
    console.log('🤖 Processing audio with Gemini...');
    const uiStart = performance.now();

    const base64Audio = await blobToBase64(audioBlob);
    const audioData = base64Audio.split(',')[1];

    const prompt = buildSlideDesignPrompt();
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      throw new Error('No API key set. Press S to open settings and add your Gemini API key.');
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
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
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Gemini API call failed');
    }

    const result = await response.json();
    const generatedText = result.candidates[0]?.content?.parts[0]?.text;
    if (!generatedText) {
      throw new Error('No response from Gemini');
    }

    const jsonMatch = generatedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ||
                      generatedText.match(/\{[\s\S]*\}/);

    const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : generatedText;
    const slideData = JSON.parse(jsonText);
    context.validateSlides([slideData]);

    const newIndex = insertSlideAfterCurrent(slideData);

    await ensureMinimumDelay(uiStart, 1300);
    context.showHudStatus('✨ Slide ready — Save Deck to export', 'success');
    context.setActiveSlide(newIndex);
    setTimeout(context.hideHudStatus, 2000);
    console.log('✅ Slide created and inserted!');
  } catch (error) {
    console.error('❌ Error processing voice:', error);
    context.showHudStatus(`❌ Failed: ${error.message}`, 'error');
    setTimeout(context.hideHudStatus, 4000);
  }
}

async function processVoiceEditSlide(audioBlob) {
  const context = getVoiceContext();
  try {
    const targetIndex = context.getCurrentIndex();
    const slides = context.getSlides();
    const slideToEdit = slides[targetIndex];
    if (!slideToEdit) {
      throw new Error('No slide selected to edit.');
    }

    console.log('🛠 Updating slide with Gemini...');
    const uiStart = performance.now();

    const base64Audio = await blobToBase64(audioBlob);
    const audioData = base64Audio.split(',')[1];
    const prompt = buildSlideEditPrompt(slideToEdit);
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      throw new Error('No API key set. Press S to open settings and add your Gemini API key.');
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
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
            temperature: 0.6,
            maxOutputTokens: 2048,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Gemini API call failed');
    }

    const result = await response.json();
    const generatedText = result.candidates[0]?.content?.parts[0]?.text;
    if (!generatedText) {
      throw new Error('No response from Gemini');
    }

    const jsonMatch = generatedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ||
                      generatedText.match(/\{[\s\S]*\}/);
    const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : generatedText;
    const updatedSlide = JSON.parse(jsonText);
    context.validateSlides([updatedSlide]);

    context.updateSlide(targetIndex, updatedSlide);
    context.replaceSlideAt(targetIndex);
    context.setOverviewCursor(targetIndex);

    await ensureMinimumDelay(uiStart, 1300);
    context.showHudStatus('✨ Slide updated — Save Deck to export', 'success');
    setTimeout(context.hideHudStatus, 2000);
    console.log('✅ Slide updated via Gemini!');
  } catch (error) {
    console.error('❌ Error updating slide:', error);
    context.showHudStatus(`❌ Update failed: ${error.message}`, 'error');
    setTimeout(context.hideHudStatus, 4000);
  }
}

export async function processVoiceToTheme(audioBlob) {
  const context = getVoiceContext();
  try {
    console.log('🎨 Generating theme with Gemini...');
    const uiStart = performance.now();

    const base64Audio = await blobToBase64(audioBlob);
    const audioData = base64Audio.split(',')[1];

    const prompt = buildThemeDesignPrompt();

    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      throw new Error('No API key set. Press S to open settings and add your Gemini API key.');
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
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
            temperature: 1.0,
            maxOutputTokens: 2048,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Gemini API call failed');
    }

    const result = await response.json();
    const generatedText = result.candidates[0]?.content?.parts[0]?.text;

    if (!generatedText) {
      throw new Error('No response from Gemini');
    }

    const jsonMatch = generatedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ||
                      generatedText.match(/\{[\s\S]*\}/);

    const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : generatedText;
    const themeData = JSON.parse(jsonText);

    const normalizedTheme = applyTheme(themeData);

    downloadTheme(normalizedTheme);
    setCurrentTheme(normalizedTheme, { source: '__ai__' });

    await ensureMinimumDelay(uiStart, 1500);
    context.showHudStatus('🎨 Theme created!', 'success');
    setTimeout(context.hideHudStatus, 2200);
    console.log('✅ Theme applied and downloaded!');
  } catch (error) {
    console.error('❌ Error processing theme:', error);
    context.showHudStatus(`❌ Failed to create theme: ${error.message}`, 'error');
    setTimeout(context.hideHudStatus, 4000);
  }
}

export function toggleVoiceTheme() {
  const context = getVoiceContext();
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    context.openSettingsModal();
    context.showApiKeyStatus('error', 'Please add your Gemini API key to use voice features');
    return;
  }

  if (isRecordingTheme) {
    stopVoiceThemeRecording();
  } else {
    startVoiceThemeRecording();
  }
}

async function startVoiceThemeRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }
    });

    themeMediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    themeAudioChunks = [];
    themeMediaStream = stream;

    themeMediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        themeAudioChunks.push(event.data);
      }
    };

    themeMediaRecorder.onstop = async () => {
      const audioBlob = new Blob(themeAudioChunks, { type: 'audio/webm' });
      await processVoiceToTheme(audioBlob);
      cleanupVoiceThemeRecording();
    };

    themeMediaRecorder.start(1000);
    isRecordingTheme = true;
    console.log('🎙️ Recording theme instructions...');
  } catch (error) {
    console.error('❌ Error starting theme recording:', error);
    alert('Failed to access microphone. Please check permissions.');
    cleanupVoiceThemeRecording();
  }
}

function stopVoiceThemeRecording() {
  if (!themeMediaRecorder || !isRecordingTheme) return;

  isRecordingTheme = false;
  if (themeMediaRecorder.state !== 'inactive') {
    themeMediaRecorder.stop();
  }
}

function cleanupVoiceThemeRecording() {
  if (themeMediaStream) {
    themeMediaStream.getTracks().forEach((track) => track.stop());
    themeMediaStream = null;
  }
  themeMediaRecorder = null;
  themeAudioChunks = [];
  isRecordingTheme = false;
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
    const slide = await requestGeminiJson(apiKey, prompt, {
      temperature: 0.65,
      maxOutputTokens: 2048,
    });

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
    context.showHudStatus(`❌ ${error.message}`, 'error');
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
      temperature: 0.7,
      maxOutputTokens: 4096,
    });

    const slidesArray = extractSlidesArray(payload);
    if (!slidesArray.length) {
      throw new Error('No slides returned');
    }

    context.validateSlides(slidesArray);

    if (insert) {
      let insertIndex = context.getCurrentIndex();
      slidesArray.forEach((slide, idx) => {
        insertIndex += 1;
        const shouldActivate = idx === slidesArray.length - 1;
        context.insertSlideAt(insertIndex, slide, { activate: shouldActivate });
      });
      const firstInserted = insertIndex - slidesArray.length + 1;
      context.setActiveSlide(firstInserted);
      context.setOverviewCursor(firstInserted);
    }

    context.showHudStatus(`✨ Added ${slidesArray.length} slides`, 'success');
    setTimeout(context.hideHudStatus, 2200);
    return slidesArray;
  } catch (error) {
    console.error('Gemini deck prompt failed:', error);
    context.showHudStatus(`❌ ${error.message}`, 'error');
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

function buildSlideDesignPrompt(description = null) {
  let basePrompt = `You are a slide designer for Slideomatic, a presentation system. Your job is to create a single slide JSON object based on the user's request.

RULES:
- Only respond with JSON (no markdown, no explanation)
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

function buildDeckDesignPrompt(description, desiredCount = 5) {
  const safeCount = Math.max(3, Math.min(desiredCount, 10));
  return `You are a presentation director for Slideomatic. Create an ordered array of ${safeCount} slide JSON objects that tell a cohesive story.

SCHEMA REQUIREMENTS:
- Each slide must follow the Slideomatic schema (same rules as buildSlideDesignPrompt) and include a "type".
- Vary slide types (mix of title, standard, split, gallery, quote, graph, pillars, etc.)
- Include descriptive image alt/search text when visuals are needed.
- Use "notes" field when extra presenter context is useful.

TONE + CONTENT:
- Follow this creative brief: ${description}
- Maintain consistent voice and theme.
- If data or stats are mentioned, include them.
- Ensure the deck flows logically with progression (intro → content → close).

OUTPUT:
- Return ONLY a JSON array (no markdown wrapper) of slide objects, or an object with a "slides" array.`;
}

function ensureApiKeyOrThrow(context) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    context.openSettingsModal?.();
    context.showApiKeyStatus?.('error', 'Add your Gemini API key to unlock AI cheats');
    throw new Error('Gemini API key required. Press S to add it.');
  }
  return apiKey;
}

async function requestGeminiJson(apiKey, prompt, generationConfig = {}) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 2048,
          ...generationConfig,
        },
      }),
    }
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
  } catch (error) {
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

function buildSlideEditPrompt(slide) {
  const slideJson = JSON.stringify(slide, null, 2);
  return `You are an expert Slideomatic editor. Update the existing slide JSON based on the user's voice instructions.

CURRENT SLIDE JSON:

\`\`\`json
${slideJson}
\`\`\`

RULES:
- Preserve the slide's "type" and required keys for that type.
- If the user requests additions or removals, update the relevant arrays (items, pillars, etc.).
- Keep badge/headline/body values unless the user explicitly changes them.
- Return ONLY a single valid JSON object with no commentary or markdown fences.
- If the request is unclear, make a best effort improvement while keeping the structure consistent.`;
}

function buildThemeDesignPrompt() {
  return `You are a theme designer for Slideomatic. Create a complete theme.json based on the user's voice description.

THEME SCHEMA - ALL fields required:
{
  "color-bg": "#fffbf3",
  "background-surface": "radial-gradient(...)",
  "background-overlay": "radial-gradient(...)",
  "background-opacity": "0.5",
  "slide-bg": "rgba(255, 251, 243, 0.88)",
  "slide-border-color": "#1b1b1b",
  "slide-border-width": "5px",
  "slide-shadow": "10px 10px 0 rgba(0, 0, 0, 0.3)",
  "color-surface": "#ff9ff3",
  "color-surface-alt": "#88d4ff",
  "color-accent": "#feca57",
  "badge-bg": "#feca57",
  "badge-color": "#1b1b1b",
  "color-ink": "#000000",
  "color-muted": "#2b2b2b",
  "border-width": "5px",
  "gutter": "clamp(32px, 5vw, 72px)",
  "radius": "12px",
  "font-sans": '"Inter", sans-serif',
  "font-mono": '"Space Mono", monospace',
  "shadow-sm": "6px 6px 0 rgba(0, 0, 0, 0.25)",
  "shadow-md": "10px 10px 0 rgba(0, 0, 0, 0.3)",
  "shadow-lg": "16px 16px 0 rgba(0, 0, 0, 0.35)",
  "shadow-xl": "24px 24px 0 rgba(0, 0, 0, 0.4)"
}

DESIGN GUIDELINES:
1. **Color Harmony** - Choose a cohesive palette based on the user's vibe
2. **Gradients** - Use for depth; solids acceptable for minimal styles
3. **Shadows** - Choose between neo-brutalist offsets or soft glows
4. **Borders** - Thick (5px+), thin (1-2px), or none (0px)
5. **Typography** - Suggest real font stacks
6. **Contrast** - Ensure readability (4.5:1)
7. **Vibe** - Match the user's description (playful, serious, retro, modern, etc.)

Return ONLY valid JSON. No markdown, no explanations.`;
}
