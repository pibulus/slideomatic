// ═══════════════════════════════════════════════════════════════════════════
// Radio Dock
// ═══════════════════════════════════════════════════════════════════════════
//
// Floating SomaFM dock pinned to the bottom-left of the deck, next to the HUD.
// Moved out of the edit drawer so tunes are reachable while presenting, not
// just while editing. Reuses the .theme-radio panel styles (edit-drawer.css)
// and the custom-select component for the channel picker.
//
// Dependencies: radio.js (audio state), custom-select.js, hud.js (toasts)
// Used by: main.js
//
// ═══════════════════════════════════════════════════════════════════════════

import {
  getRadioChannelList,
  getRadioState,
  getChannelById,
  enableRadio,
  disableRadio,
  setRadioChannel,
} from './radio.js';
import { escapeHtml } from './utils.js';
import { setupCustomSelect, setCustomSelectValue } from './custom-select.js';

let dockEl = null;

function buildDockMarkup() {
  const radioChannels = getRadioChannelList();
  const radioState = getRadioState();
  const activeRadioChannel = radioChannels.find((channel) => channel.id === radioState.channelId) || radioChannels[0];
  const isRadioEnabled = radioState.enabled && !!activeRadioChannel;

  const radioOptions = radioChannels.map((channel) => {
    const isSelected = activeRadioChannel.id === channel.id ? 'is-selected' : '';
    return `
      <button type="button" class="custom-select__option ${isSelected}" data-value="${channel.id}">
        <span class="custom-select__option-label">${escapeHtml(channel.name)}</span>
        <span class="custom-select__option-desc">${escapeHtml(channel.description)}</span>
      </button>
    `;
  }).join('');

  return `
    <button type="button" class="radio-dock__pill${isRadioEnabled ? ' is-live' : ''}" id="radio-dock-pill"
      aria-haspopup="true" aria-expanded="false" title="SomaFM radio">
      <span class="radio-dock__pill-icon">📻</span>
      <span class="radio-dock__pill-eq" aria-hidden="true"><i></i><i></i><i></i></span>
    </button>
    <div class="radio-dock__panel" id="radio-dock-panel" hidden>
      <div class="theme-radio ${isRadioEnabled ? 'is-active' : ''}">
        <button type="button" class="theme-radio__toggle ${isRadioEnabled ? 'is-active' : ''}" id="theme-radio-toggle" aria-pressed="${isRadioEnabled ? 'true' : 'false'}">
          <span class="theme-radio__icon">📻</span>
          <span class="theme-radio__copy">
            <span class="theme-radio__label">SomaFM Radio</span>
            <span class="theme-radio__status" id="theme-radio-status">
              ${isRadioEnabled ? `${escapeHtml(activeRadioChannel.shortLabel || activeRadioChannel.name)} is live` : 'Off'}
            </span>
          </span>
          <span class="theme-radio__pill" id="theme-radio-pill">${isRadioEnabled ? 'On' : 'Off'}</span>
        </button>
        <div class="theme-radio__channels ${isRadioEnabled ? 'is-visible' : ''}" id="theme-radio-channel">
          <div class="custom-select custom-select--radio" id="theme-radio-select" data-value="${activeRadioChannel.id}">
            <button type="button" class="custom-select__trigger">
              <span class="custom-select__value">${escapeHtml(activeRadioChannel.name)}</span>
              <span class="custom-select__arrow">▼</span>
            </button>
            <div class="custom-select__dropdown">
              ${radioOptions}
            </div>
          </div>
          <p class="theme-radio__hint">Quick SomaFM vibes while you present. Toggle on, pick a station, done.</p>
        </div>
      </div>
    </div>
  `;
}

function wireControls() {
  const toggle = document.getElementById('theme-radio-toggle');
  const select = document.getElementById('theme-radio-select');
  const statusEl = document.getElementById('theme-radio-status');
  const pillEl = document.getElementById('theme-radio-pill');
  const channelWrapper = document.getElementById('theme-radio-channel');
  const dockPill = document.getElementById('radio-dock-pill');

  if (!toggle || !select || !dockPill) return;

  const state = { ...getRadioState() };
  const getActiveChannel = () => getChannelById(state.channelId);

  const updateVisualState = (enabled, channel = getActiveChannel()) => {
    toggle.classList.toggle('is-active', enabled);
    toggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    channelWrapper?.classList.toggle('is-visible', enabled);
    dockPill.classList.toggle('is-live', enabled);
    if (pillEl) pillEl.textContent = enabled ? 'On' : 'Off';
    if (statusEl) {
      statusEl.textContent = enabled
        ? `${channel.shortLabel || channel.name} is live`
        : 'Off';
    }
  };

  updateVisualState(state.enabled, getActiveChannel());

  toggle.addEventListener('click', async () => {
    if (state.enabled) {
      disableRadio();
      state.enabled = false;
      updateVisualState(false);
      const { showHudStatus, hideHudStatus } = await import('./hud.js');
      showHudStatus('⏹️ Radio paused', 'info');
      setTimeout(hideHudStatus, 1400);
      return;
    }

    try {
      const channel = await enableRadio(state.channelId);
      state.enabled = true;
      updateVisualState(true, channel);
      const { showHudStatus, hideHudStatus } = await import('./hud.js');
      showHudStatus(`📻 ${channel.name} is on`, 'success');
      setTimeout(hideHudStatus, 1800);
    } catch (error) {
      console.error('Failed to start radio', error);
      const { showHudStatus, hideHudStatus } = await import('./hud.js');
      showHudStatus('❌ Radio blocked', 'error');
      setTimeout(hideHudStatus, 2200);
      state.enabled = false;
      updateVisualState(false);
    }
  });

  select.addEventListener('customSelectChange', async (event) => {
    const nextId = event?.detail?.value;
    if (!nextId) return;
    const channel = setRadioChannel(nextId);
    state.channelId = channel.id;
    setCustomSelectValue(select, channel.id);

    if (state.enabled) {
      try {
        await enableRadio(channel.id);
        updateVisualState(true, channel);
        const { showHudStatus, hideHudStatus } = await import('./hud.js');
        showHudStatus(`🎶 ${channel.name}`, 'success');
        setTimeout(hideHudStatus, 1600);
      } catch (error) {
        console.error('Failed to switch radio station', error);
        const { showHudStatus, hideHudStatus } = await import('./hud.js');
        showHudStatus('⚠️ Could not switch station', 'warning');
        setTimeout(hideHudStatus, 2000);
      }
    } else {
      updateVisualState(false, channel);
    }
  });
}

export function initRadioDock() {
  if (dockEl) return;
  dockEl = document.createElement('div');
  dockEl.className = 'radio-dock';
  dockEl.id = 'radio-dock';
  dockEl.innerHTML = buildDockMarkup();
  document.body.appendChild(dockEl);

  const pill = document.getElementById('radio-dock-pill');
  const panel = document.getElementById('radio-dock-panel');

  const setOpen = (open) => {
    panel.hidden = !open;
    pill.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  pill.addEventListener('click', () => setOpen(panel.hidden));

  document.addEventListener('pointerdown', (event) => {
    if (!panel.hidden && !dockEl.contains(event.target)) setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) setOpen(false);
  });

  setupCustomSelect(dockEl, {});
  wireControls();
}

// Presenting clean: the H-key HUD toggle hides the dock too
export function setRadioDockHidden(hidden) {
  if (!dockEl) return;
  dockEl.dataset.hidden = hidden ? 'true' : 'false';
  if (hidden) {
    const panel = document.getElementById('radio-dock-panel');
    if (panel) panel.hidden = true;
  }
}
