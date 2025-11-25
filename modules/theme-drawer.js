// ═══════════════════════════════════════════════════════════════════════════
// Theme Drawer Module
// ═══════════════════════════════════════════════════════════════════════════
//
// Handles the theme drawer UI: opening/closing, populating the dropdown,
// saving themes, random/AI theme generation, and keeping the select UI synced
// with the current theme selection.
//
// ═══════════════════════════════════════════════════════════════════════════

import {
  createDrawer,
  openDrawer,
  closeDrawer,
} from './drawer-base.js';
import {
  themeDrawerInstance,
  setThemeDrawerInstance,
  setThemeDrawerOpen,
  editDrawerInstance,
} from './state.js';
import {
  loadThemeLibrary,
  saveThemeToLibrary,
  applyTheme,
  setCurrentTheme,
  getCurrentTheme,
  getCurrentThemePath,
  normalizeThemeTokens,
  hslToHex,
  hexToRgbaString,
  mixHexColors,
  applyAlpha,
  shiftHex,
  getAccessibleTextColor,
} from './theme-manager.js';
import { showHudStatus, hideHudStatus } from './hud.js';
import { clamp } from './utils.js';
import { getGeminiApiKey } from './voice-modes.js';

function ensureThemeDrawerInstance() {
  if (!themeDrawerInstance) {
    const instance = createDrawer({
      id: 'theme-drawer',
      onOpen: () => {
        const themeBtn = document.getElementById('theme-btn');
        setThemeDrawerOpen(true);
        themeBtn?.setAttribute('aria-expanded', 'true');
        themeBtn?.classList.add('is-active');
        const closeBtn = instance.element.querySelector('.theme-drawer__close');
        if (closeBtn && !closeBtn.dataset.listenerAttached) {
          closeBtn.addEventListener('click', () => closeDrawer(instance));
          closeBtn.dataset.listenerAttached = 'true';
        }
      },
      onClose: () => {
        const themeBtn = document.getElementById('theme-btn');
        setThemeDrawerOpen(false);
        themeBtn?.setAttribute('aria-expanded', 'false');
        themeBtn?.classList.remove('is-active');
      },
    });
    setThemeDrawerInstance(instance);
  }
  return themeDrawerInstance;
}

export function initThemeDrawer() {
  const drawer = ensureThemeDrawerInstance();
  const themeDrawerEl = drawer.element;
  const themeBtn = document.getElementById('theme-btn');
  const saveBtn = document.getElementById('theme-save-btn');
  const aiBtn = document.getElementById('theme-ai-btn');
  const randomBtn = document.getElementById('theme-random-btn');

  if (!themeDrawerEl) return;

  themeBtn?.setAttribute('aria-expanded', 'false');
  themeBtn?.classList.remove('is-active');

  if (themeBtn && !themeBtn.dataset.listenerAttached) {
    themeBtn.addEventListener('click', toggleThemeDrawer);
    themeBtn.dataset.listenerAttached = 'true';
  }

  const closeBtn = themeDrawerEl.querySelector('.theme-drawer__close');
  if (closeBtn && !closeBtn.dataset.listenerAttached) {
    closeBtn.addEventListener('click', () => closeDrawer(ensureThemeDrawerInstance()));
    closeBtn.dataset.listenerAttached = 'true';
  }

  setupThemeSelectDropdown();

  saveBtn?.addEventListener('click', handleSaveTheme);
  aiBtn?.addEventListener('click', () => handleAiTheme(aiBtn));
  randomBtn?.addEventListener('click', handleRandomTheme);

  populateThemeDropdown();
  syncThemeSelectUI();
}

export function toggleThemeDrawer() {
  const drawer = ensureThemeDrawerInstance();
  if (drawer.isOpen) {
    closeDrawer(drawer);
  } else {
    openThemeDrawer();
  }
}

export function openThemeDrawer() {
  const drawer = ensureThemeDrawerInstance();
  if (editDrawerInstance?.isOpen) {
    closeDrawer(editDrawerInstance, { restoreFocus: false });
  }
  loadThemeIntoEditor();
  populateThemeDropdown();
  syncThemeSelectUI();
  openDrawer(drawer);
}

export function closeThemeDrawer() {
  const drawer = ensureThemeDrawerInstance();
  closeDrawer(drawer);
}

function setupThemeSelectDropdown() {
  const trigger = document.getElementById('theme-select-trigger');
  const dropdown = document.getElementById('theme-select-dropdown');
  if (!trigger || !dropdown || trigger.dataset.listenerAttached) return;

  const closeDropdown = () => {
    trigger.classList.remove('is-open');
    dropdown.classList.remove('is-open');
  };

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = trigger.classList.contains('is-open');
    if (isOpen) {
      closeDropdown();
    } else {
      trigger.classList.add('is-open');
      dropdown.classList.add('is-open');
    }
  });
  trigger.dataset.listenerAttached = 'true';

  document.addEventListener('click', (event) => {
    if (!trigger.contains(event.target) && !dropdown.contains(event.target)) {
      closeDropdown();
    }
  });

  dropdown.addEventListener('click', async (event) => {
    const option = event.target.closest('.theme-select__option');
    if (!option) return;

    const themePath = option.dataset.value;
    const themeLabel = option.textContent;
    const valueSpan = trigger.querySelector('.theme-select__value');
    if (valueSpan) valueSpan.textContent = themeLabel;

    closeDropdown();

    dropdown.querySelectorAll('.theme-select__option').forEach((opt) => {
      opt.classList.toggle('is-selected', opt === option);
    });

    try {
      if (themePath.startsWith('saved:')) {
        const savedName = themePath.replace('saved:', '');
        const library = loadThemeLibrary();
        const entry = library.find((entry) => entry.name === savedName);
        if (entry) {
          const normalizedTheme = applyTheme(entry.theme);
          setCurrentTheme(normalizedTheme, { source: themePath });
        }
      } else {
        const response = await fetch(themePath, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Failed to load theme: ${response.status}`);
        const theme = await response.json();
        const normalizedTheme = applyTheme(theme);
        setCurrentTheme(normalizedTheme, { source: themePath });
      }
      showHudStatus('✨ Theme applied', 'success');
      setTimeout(hideHudStatus, 1600);
    } catch (error) {
      console.error('Failed to apply theme:', error);
      showHudStatus('❌ Theme failed', 'error');
      setTimeout(hideHudStatus, 2000);
    }
  });
}

function handleSaveTheme() {
  try {
    const theme = getCurrentTheme();
    const currentPath = getCurrentThemePath() || '';
    const basePath = resolveBaseThemePath(currentPath);
    let defaultName = '';
    if (basePath.startsWith('saved:')) {
      defaultName = basePath.replace('saved:', '');
    }

    const name = prompt('Name your theme:', defaultName);
    if (!name || !name.trim()) return;

    saveThemeToLibrary(name.trim(), theme);
    setCurrentTheme(theme, { source: `saved:${name.trim()}` });
    populateThemeDropdown();
    syncThemeSelectUI();

    showHudStatus('💾 Theme saved', 'success');
    setTimeout(hideHudStatus, 1600);
  } catch (error) {
    showHudStatus(`❌ ${error.message}`, 'error');
    setTimeout(hideHudStatus, 2000);
  }
}

async function handleAiTheme(aiBtn) {
  const description = prompt('Describe your theme:\n(e.g. "dark cyberpunk with neon greens" or "warm sunset beach vibes")');
  if (!description) return;

  try {
    showHudStatus('✨ Generating theme...', 'processing');
    aiBtn.disabled = true;

    const theme = await generateThemeWithAI(description);
    const normalizedTheme = applyTheme(theme);
    setCurrentTheme(normalizedTheme, { source: '__ai__' });
    loadThemeIntoEditor();

    showHudStatus('✨ Theme generated!', 'success');
    setTimeout(hideHudStatus, 1600);
  } catch (error) {
    showHudStatus(`❌ ${error.message}`, 'error');
    setTimeout(hideHudStatus, 3000);
  } finally {
    aiBtn.disabled = false;
  }
}

function handleRandomTheme() {
  try {
    const baseSource = resolveBaseThemePath(getCurrentThemePath() || '') || 'theme.json';
    const theme = generateRandomTheme();

    const normalizedTheme = applyTheme(theme);
    setCurrentTheme(normalizedTheme, { source: `random:${baseSource}` });
    loadThemeIntoEditor();

    showHudStatus('✨ Random theme applied!', 'success');
    setTimeout(hideHudStatus, 1600);
  } catch (error) {
    showHudStatus(`❌ ${error.message}`, 'error');
    setTimeout(hideHudStatus, 2000);
  }
}

export function loadThemeIntoEditor() {
  syncThemeSelectUI();
}

export function populateThemeDropdown() {
  const dropdown = document.getElementById('theme-select-dropdown');
  if (!dropdown) return;

  const library = loadThemeLibrary();
  const options = Array.from(dropdown.querySelectorAll('.theme-select__option'));
  options.forEach((option) => {
    const value = option.dataset.value || '';
    if (value.startsWith('saved:')) {
      option.remove();
    }
  });

  library.forEach((entry) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-select__option';
    button.dataset.value = `saved:${entry.name}`;
    button.textContent = `✨ ${entry.name}`;
    dropdown.appendChild(button);
  });
}

export function syncThemeSelectUI() {
  const trigger = document.getElementById('theme-select-trigger');
  const dropdown = document.getElementById('theme-select-dropdown');
  if (!trigger || !dropdown) return;

  const currentPath = getCurrentThemePath() || '';
  const basePath = resolveBaseThemePath(currentPath);
  const isRandom = currentPath.startsWith('random:');
  const valueSpan = trigger.querySelector('.theme-select__value');
  if (!valueSpan) return;

  const options = Array.from(dropdown.querySelectorAll('.theme-select__option'));
  const matchingOption = options.find((opt) => {
    const value = opt.dataset.value;
    if (!value) return false;
    return value === currentPath || value === basePath;
  });

  if (matchingOption) {
    const optionLabel = matchingOption.textContent.trim();
    valueSpan.textContent = isRandom ? `🎲 ${optionLabel}` : matchingOption.textContent;
    options.forEach((opt) => {
      opt.classList.toggle('is-selected', opt.dataset.value === basePath);
    });
  } else {
    valueSpan.textContent = isRandom ? '🎲 Custom Theme' : '🎨 Custom Theme';
    options.forEach((opt) => opt.classList.remove('is-selected'));
  }
}

async function generateThemeWithAI(description) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('No API key set. Press S to open settings and add your Gemini API key.');
  }

  const sanitizedDescription = typeof description === 'string'
    ? description.replace(/`/g, "'")
    : '';

  const prompt = `You are a theme designer for a presentation app called Slide-O-Matic.\n\nUser description:\n${sanitizedDescription || '(no additional description provided)'}\n\nProvide a JSON object with theme tokens.`;

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.9,
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

  const jsonMatch =
    generatedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ||
    generatedText.match(/\{[\s\S]*\}/);

  const jsonText = jsonMatch ? jsonMatch[1] || jsonMatch[0] : generatedText;
  const theme = JSON.parse(jsonText);

  return normalizeThemeTokens(theme);
}

function generateRandomTheme() {
  const baseTheme = getCurrentTheme();
  const source = getCurrentThemePath();
  const activeTheme = normalizeThemeTokens(baseTheme || {});
  const baseSource = resolveBaseThemePath(source || '');
  const randomizer = getThemeRandomizer(baseSource);
  const randomizedTheme = randomizer(activeTheme, { baseSource });
  return normalizeThemeTokens(randomizedTheme || activeTheme);
}

function resolveBaseThemePath(source = '') {
  let value = (source || '').trim();
  while (value.startsWith('random:')) {
    value = value.slice(7).trim();
  }
  return value;
}

function getThemeRandomizer(baseSource = '') {
  const normalized = baseSource.toLowerCase();

  if (
    normalized.startsWith('saved:') ||
    normalized === '__ai__' ||
    normalized === '__custom__' ||
    normalized === '__local__'
  ) {
    return randomizeCustomTheme;
  }

  if (normalized === '__random__') {
    return randomizeDefaultTheme;
  }

  if (normalized.endsWith('themes/gameboy.json')) {
    return randomizeGameboyTheme;
  }

  if (normalized.endsWith('themes/vaporwave.json')) {
    return randomizeVaporwaveTheme;
  }

  if (normalized.endsWith('themes/slack.json')) {
    return randomizeSlackTheme;
  }

  if (normalized.endsWith('theme.json')) {
    return randomizeDefaultTheme;
  }

  if (!baseSource) {
    return randomizeDefaultTheme;
  }

  return randomizeCustomTheme;
}

function randomizeDefaultTheme(theme, context = {}) {
  const baseHue = Math.floor(Math.random() * 360);
  const strategies = ['analogous', 'triadic', 'complementary', 'split-complementary', 'monochromatic'];
  const palette = generatePalette(baseHue, sample(strategies));

  const isDefaultBase = !context.baseSource || context.baseSource === 'theme.json';
  const isDark = isDefaultBase ? false : Math.random() < 0.25;

  const colorBg = isDark
    ? hslToHex(baseHue, clamp(22 + Math.random() * 12, 0, 100), clamp(14 + Math.random() * 10, 0, 100))
    : hslToHex(baseHue, clamp(28 + Math.random() * 20, 0, 100), clamp(88 + Math.random() * 6, 0, 100));

  const colorInk = isDefaultBase ? '#1b1b1b' : getAccessibleTextColor(colorBg);
  const colorMuted =
    colorInk === '#000000'
      ? mixHexColors('#000000', '#555555', 0.55)
      : mixHexColors('#ffffff', '#444444', 0.45);
  const badgeTextColor = getAccessibleTextColor(palette.accent);

  const borderCandidates = [
    theme['border-width'],
    theme['slide-border-width'],
    '4px',
    '5px',
    '6px',
  ].filter(Boolean);
  const borderWidth = sample(borderCandidates) || '5px';

  const shadowSets = [
    {
      sm: '6px 6px 0 rgba(0, 0, 0, 0.25)',
      md: '10px 10px 0 rgba(0, 0, 0, 0.3)',
      lg: '16px 16px 0 rgba(0, 0, 0, 0.35)',
      xl: '24px 24px 0 rgba(0, 0, 0, 0.4)',
    },
    {
      sm: '4px 4px 0 rgba(0, 0, 0, 0.22)',
      md: '8px 8px 0 rgba(0, 0, 0, 0.26)',
      lg: '12px 12px 0 rgba(0, 0, 0, 0.3)',
      xl: '18px 18px 0 rgba(0, 0, 0, 0.32)',
    },
    {
      sm: '0 4px 12px rgba(0, 0, 0, 0.18)',
      md: '0 8px 24px rgba(0, 0, 0, 0.22)',
      lg: '0 12px 36px rgba(0, 0, 0, 0.26)',
      xl: '0 18px 54px rgba(0, 0, 0, 0.3)',
    },
    {
      sm: theme['shadow-sm'],
      md: theme['shadow-md'],
      lg: theme['shadow-lg'],
      xl: theme['shadow-xl'],
    },
  ].filter((set) => set.sm && set.md && set.lg && set.xl);
  const shadows = sample(shadowSets) || shadowSets[0];

  const surfacePrimary = palette.primary;
  const surfaceSecondary = palette.secondary;
  const surfaceAccent = palette.accent;

  return {
    ...theme,
    'color-bg': colorBg,
    'background-surface': `radial-gradient(circle at 18% 22%, ${applyAlpha(surfacePrimary, 0.55)}, transparent 60%), radial-gradient(circle at 78% 32%, ${applyAlpha(surfaceSecondary, 0.55)}, transparent 60%), radial-gradient(circle at 48% 74%, ${applyAlpha(surfaceAccent, 0.35)}, transparent 62%), ${colorBg}`,
    'slide-bg': hexToRgbaString(colorBg, isDark ? 0.9 : 0.82),
    'slide-border-color': colorInk,
    'slide-border-width': borderWidth,
    'slide-shadow': shadows.md,
    'color-surface': surfacePrimary,
    'color-surface-alt': surfaceSecondary,
    'color-accent': surfaceAccent,
    'badge-bg': surfaceAccent,
    'badge-color': badgeTextColor,
    'color-ink': colorInk,
    'color-muted': colorMuted,
    'border-width': borderWidth,
    'shadow-sm': shadows.sm,
    'shadow-md': shadows.md,
    'shadow-lg': shadows.lg,
    'shadow-xl': shadows.xl,
  };
}

function randomizeGameboyTheme(theme) {
  const baseHue = Math.floor(Math.random() * 360);
  const light = hslToHex(baseHue, clamp(24 + Math.random() * 12, 0, 100), clamp(72 + Math.random() * 12, 0, 100));
  const medium = hslToHex(baseHue, clamp(30 + Math.random() * 14, 0, 100), clamp(56 + Math.random() * 10, 0, 100));
  const dark = hslToHex(baseHue, clamp(36 + Math.random() * 16, 0, 100), clamp(36 + Math.random() * 10, 0, 100));
  const deepest = hslToHex(baseHue, clamp(38 + Math.random() * 12, 0, 100), clamp(22 + Math.random() * 10, 0, 100));
  const borderWidth = theme['border-width'] || theme['slide-border-width'] || '6px';

  return {
    ...theme,
    'color-bg': light,
    'background-surface': `linear-gradient(135deg, ${medium} 0%, ${dark} 100%)`,
    'background-overlay': `repeating-linear-gradient(0deg, ${applyAlpha(deepest, 0.75)} 0px, transparent 1px, transparent 2px, ${applyAlpha(deepest, 0.75)} 3px)`,
    'slide-bg': hexToRgbaString(light, 0.82),
    'slide-border-color': deepest,
    'slide-border-width': borderWidth,
    'slide-shadow': `8px 8px 0 ${applyAlpha(deepest, 0.55)}`,
    'color-surface': medium,
    'color-surface-alt': dark,
    'color-accent': deepest,
    'badge-bg': medium,
    'badge-color': getAccessibleTextColor(medium),
    'color-ink': deepest,
    'color-muted': dark,
    'border-width': borderWidth,
    'shadow-sm': `4px 4px 0 ${applyAlpha(deepest, 0.8)}`,
    'shadow-md': `8px 8px 0 ${applyAlpha(deepest, 0.8)}`,
    'shadow-lg': `12px 12px 0 ${applyAlpha(deepest, 0.75)}`,
    'shadow-xl': `16px 16px 0 ${applyAlpha(deepest, 0.7)}`,
  };
}

function randomizeVaporwaveTheme(theme) {
  const baseHue = Math.floor(Math.random() * 360);
  const pink = hslToHex((baseHue + 320) % 360, 92, 68);
  const cyan = hslToHex((baseHue + 180) % 360, 95, 62);
  const mint = hslToHex((baseHue + 140) % 360, 90, 64);
  const purple = hslToHex((baseHue + 280) % 360, 80, 58);
  const neon = hslToHex((baseHue + 80) % 360, 95, 70);
  const ink = shiftHex(purple, -0.55);

  return {
    ...theme,
    'color-bg': pink,
    'background-surface': `linear-gradient(140deg, ${cyan} 0%, ${mint} 50%, ${purple} 100%)`,
    'background-overlay': theme['background-overlay'] || 'repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.08) 0px, transparent 2px, transparent 4px, rgba(255, 255, 255, 0.08) 6px), repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.08) 0px, transparent 2px, transparent 4px, rgba(255, 255, 255, 0.08) 6px)',
    'slide-bg': hexToRgbaString(pink, 0.82),
    'slide-border-color': cyan,
    'slide-shadow': `12px 12px 0 ${applyAlpha(cyan, 0.5)}`,
    'color-surface': purple,
    'color-surface-alt': mint,
    'color-accent': neon,
    'badge-bg': neon,
    'badge-color': getAccessibleTextColor(neon),
    'color-ink': ink,
    'color-muted': mixHexColors(ink, '#ffffff', 0.25),
    'shadow-sm': `8px 8px 0 ${applyAlpha(cyan, 0.42)}`,
    'shadow-md': `12px 12px 0 ${applyAlpha(cyan, 0.5)}`,
    'shadow-lg': `16px 16px 0 ${applyAlpha(cyan, 0.6)}`,
    'shadow-xl': `24px 24px 0 ${applyAlpha(cyan, 0.7)}`,
  };
}

function randomizeSlackTheme(theme) {
  const baseHue = Math.floor(Math.random() * 360);
  const backdrop = hslToHex(baseHue, 95, 58);
  const mid = hslToHex((baseHue + 12) % 360, 90, 46);
  const deep = hslToHex((baseHue + 200) % 360, 90, 40);
  const accent = hslToHex((baseHue + 140) % 360, 92, 52);
  const badgeBg = hslToHex((baseHue + 320) % 360, 92, 40);
  const ink = '#000000';

  return {
    ...theme,
    'color-bg': backdrop,
    'background-surface': `radial-gradient(circle at 25% 25%, ${backdrop} 0%, ${mid} 35%, ${deep} 100%)`,
    'slide-bg': hexToRgbaString(backdrop, 0.82),
    'slide-border-color': ink,
    'slide-shadow': `12px 12px 0 ${applyAlpha(ink, 0.85)}`,
    'color-surface': accent,
    'color-surface-alt': deep,
    'color-accent': ink,
    'badge-bg': badgeBg,
    'badge-color': getAccessibleTextColor(badgeBg),
    'color-ink': ink,
    'color-muted': mixHexColors(ink, '#666666', 0.45),
    'shadow-sm': `6px 6px 0 ${applyAlpha(ink, 0.9)}`,
    'shadow-md': `12px 12px 0 ${applyAlpha(ink, 0.9)}`,
    'shadow-lg': `18px 18px 0 ${applyAlpha(ink, 0.9)}`,
    'shadow-xl': `24px 24px 0 ${applyAlpha(ink, 0.9)}`,
  };
}

function randomizeCustomTheme(theme, context = {}) {
  const variant = randomizeDefaultTheme(theme, context);
  return {
    ...variant,
    'font-sans': theme['font-sans'],
    'font-mono': theme['font-mono'],
    'radius': theme['radius'],
    'background-overlay': theme['background-overlay'],
    'background-opacity': theme['background-opacity'],
  };
}

function generatePalette(baseHue, strategy = 'triadic') {
  let hues;
  switch (strategy) {
    case 'analogous':
      hues = [baseHue, (baseHue + 32) % 360, (baseHue + 64) % 360];
      break;
    case 'complementary':
      hues = [baseHue, (baseHue + 180) % 360, (baseHue + 30) % 360];
      break;
    case 'split-complementary':
      hues = [baseHue, (baseHue + 150) % 360, (baseHue + 210) % 360];
      break;
    case 'monochromatic':
      hues = [baseHue, baseHue, baseHue];
      break;
    default:
      hues = [baseHue, (baseHue + 120) % 360, (baseHue + 240) % 360];
  }

  const primary = hslToHex(hues[0], clamp(68 + Math.random() * 22, 0, 100), clamp(54 + Math.random() * 14, 0, 100));
  const secondary = hslToHex(hues[1], clamp(60 + Math.random() * 24, 0, 100), clamp(58 + Math.random() * 16, 0, 100));
  const accent = hslToHex(hues[2], clamp(70 + Math.random() * 20, 0, 100), clamp(52 + Math.random() * 18, 0, 100));

  return { primary, secondary, accent };
}

  let r = 0;
  let g = 0;
  let b = 0;

  if (hue < 60) {
    r = c; g = x; b = 0;
  } else if (hue < 120) {
    r = x; g = c; b = 0;
  } else if (hue < 180) {
    r = 0; g = c; b = x;
  } else if (hue < 240) {
    r = 0; g = x; b = c;
  } else if (hue < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  const toHex = (value) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToRgb(hex) {
  const sanitized = typeof hex === 'string' ? hex.replace('#', '') : '';
  if (sanitized.length !== 6 || Number.isNaN(Number.parseInt(sanitized, 16))) {
    return [255, 255, 255];
  }
  const intVal = Number.parseInt(sanitized, 16);
  const r = (intVal >> 16) & 255;
  const g = (intVal >> 8) & 255;
  const b = intVal & 255;
  return [r, g, b];
}

function hexToRgbaString(hex, alpha = 1) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function getRelativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const norm = channel / 255;
    return norm <= 0.03928 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function getContrastRatio(foregroundHex, backgroundHex) {
  const l1 = getRelativeLuminance(foregroundHex);
  const l2 = getRelativeLuminance(backgroundHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function getAccessibleTextColor(backgroundHex) {
  const blackContrast = getContrastRatio('#000000', backgroundHex);
  const whiteContrast = getContrastRatio('#ffffff', backgroundHex);
  return blackContrast >= whiteContrast ? '#000000' : '#ffffff';
}

function mixHexColors(colorA, colorB, ratio = 0.5) {
  const [r1, g1, b1] = hexToRgb(colorA);
  const [r2, g2, b2] = hexToRgb(colorB);
  const blend = (a, b) => Math.round(a * (1 - ratio) + b * ratio);
  return `#${[blend(r1, r2), blend(g1, g2), blend(b1, b2)]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

function applyAlpha(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function shiftHex(hex, amount = 0) {
  const ratio = clamp(Math.abs(amount), 0, 1);
  const target = amount >= 0 ? '#ffffff' : '#000000';
  return mixHexColors(hex, target, ratio);
}

function sample(list) {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  return list[Math.floor(Math.random() * list.length)];
}
