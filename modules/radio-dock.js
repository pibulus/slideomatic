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
  isRadioPlaying,
} from './radio.js';
import { escapeHtml } from './utils.js';
import { setupCustomSelect, setCustomSelectValue } from './custom-select.js';

let dockEl = null;

function buildDockMarkup() {
  const radioChannels = getRadioChannelList();
  const radioState = getRadioState();
  const activeRadioChannel = radioChannels.find((channel) => channel.id === radioState.channelId) || radioChannels[0];
  // Audio never autoplays on load, so the UI starts from actual playback —
  // the stored 'enabled' flag can be stale-true after a reload.
  const isRadioEnabled = isRadioPlaying() && !!activeRadioChannel;

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
  // The HUD RADIO button is the main switch on every screen size now
  const hudRadioBtn = document.getElementById('hud-radio-btn');

  if (!toggle || !select) return;

  const state = { channelId: getRadioState().channelId, enabled: isRadioPlaying() };
  const getActiveChannel = () => getChannelById(state.channelId);

  const updateVisualState = (enabled, channel = getActiveChannel()) => {
    toggle.classList.toggle('is-active', enabled);
    toggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    channelWrapper?.classList.toggle('is-visible', enabled);
    if (hudRadioBtn) {
      hudRadioBtn.classList.toggle('is-live', enabled);
      hudRadioBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    }
    if (pillEl) pillEl.textContent = enabled ? 'On' : 'Off';
    if (statusEl) {
      statusEl.textContent = enabled
        ? `${channel.shortLabel || channel.name} is live`
        : 'Off';
    }
  };

  updateVisualState(state.enabled, getActiveChannel());

  const toggleRadio = async () => {
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
      showHudStatus('📻 The radio got shy. Give it another tap', 'info');
      setTimeout(hideHudStatus, 2200);
      state.enabled = false;
      updateVisualState(false);
    }
  };

  toggle.addEventListener('click', toggleRadio);
  hudRadioBtn?.addEventListener('click', toggleRadio);

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
        showHudStatus('📻 Station change hiccup. Try again', 'info');
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

  const panel = document.getElementById('radio-dock-panel');
  const hudRadioBtn = document.getElementById('hud-radio-btn');

  const setOpen = (open) => {
    panel.hidden = !open;
    hudRadioBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  // Click flicks the radio on/off (wired in wireControls); right-click
  // summons the station picker above the HUD
  hudRadioBtn?.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    setOpen(panel.hidden);
  });

  document.addEventListener('pointerdown', (event) => {
    if (panel.hidden) return;
    if (dockEl.contains(event.target)) return;
    if (event.target instanceof Element && event.target.closest('#hud-radio-btn')) return;
    setOpen(false);
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
