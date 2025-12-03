// ═══════════════════════════════════════════════════════════════════════════
// SomaFM Radio Helper
// ═══════════════════════════════════════════════════════════════════════════
// Tiny stateful helper to keep a single Audio instance alive, remember the
// preferred SomaFM channel, and expose simple enable/disable hooks for the UI.
// Keeps things deliberately small so UI code just worries about toggles.
// ═══════════════════════════════════════════════════════════════════════════

const CHANNEL_STORAGE_KEY = 'slideomatic.radio.channel';
const ENABLED_STORAGE_KEY = 'slideomatic.radio.enabled';

const FALLBACK_STORE = new Map();

const FAVORITE_CHANNELS = [
  {
    id: 'groovesalad',
    name: 'Groove Salad',
    shortLabel: 'Groove Salad',
    description: 'Downtempo ambient grooves for deep work.',
    stream: 'https://ice4.somafm.com/groovesalad-128-mp3',
  },
  {
    id: 'dronezone',
    name: 'Drone Zone',
    shortLabel: 'Drone Zone',
    description: 'Spacey, immersive drones for focus.',
    stream: 'https://ice4.somafm.com/dronezone-128-mp3',
  },
  {
    id: 'secretagent',
    name: 'Secret Agent',
    shortLabel: 'Secret Agent',
    description: 'Spy lounge + noir soundtracks.',
    stream: 'https://ice4.somafm.com/secretagent-128-mp3',
  },
  {
    id: 'defcon',
    name: 'DEF CON Radio',
    shortLabel: 'DEF CON',
    description: 'Hacker conference energy all day.',
    stream: 'https://ice4.somafm.com/defcon-128-mp3',
  },
  {
    id: 'lush',
    name: 'Lush',
    shortLabel: 'Lush',
    description: 'Dreamy shoegaze + vocals.',
    stream: 'https://ice4.somafm.com/lush-128-mp3',
  },
];

let audioElement = null;
let currentChannelId = getStoredValue(CHANNEL_STORAGE_KEY) || FAVORITE_CHANNELS[0].id;
let radioEnabled = getStoredValue(ENABLED_STORAGE_KEY) === 'true';

currentChannelId = ensureValidChannelId(currentChannelId);

function hasStorage() {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch (error) {
    console.warn('[Radio] localStorage unavailable:', error);
    return false;
  }
}

function getStoredValue(key) {
  if (!key) return null;
  if (hasStorage()) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      console.warn('[Radio] localStorage read failed:', error);
      return FALLBACK_STORE.get(key) ?? null;
    }
  }
  return FALLBACK_STORE.get(key) ?? null;
}

function setStoredValue(key, value) {
  if (!key) return;
  if (hasStorage()) {
    try {
      if (value === null) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, value);
      }
      return;
    } catch (error) {
      console.warn('[Radio] localStorage write failed:', error);
    }
  }
  if (value === null) {
    FALLBACK_STORE.delete(key);
  } else {
    FALLBACK_STORE.set(key, value);
  }
}

function ensureValidChannelId(channelId) {
  const fallback = FAVORITE_CHANNELS[0].id;
  if (!channelId) return fallback;
  const exists = FAVORITE_CHANNELS.find((channel) => channel.id === channelId);
  return exists ? exists.id : fallback;
}

function ensureAudio() {
  if (typeof window === 'undefined') return null;
  if (!audioElement) {
    audioElement = new Audio();
    audioElement.preload = 'none';
    audioElement.crossOrigin = 'anonymous';
    audioElement.volume = 0.8;
  }
  return audioElement;
}

function updateChannel(channelId) {
  const validId = ensureValidChannelId(channelId);
  currentChannelId = validId;
  setStoredValue(CHANNEL_STORAGE_KEY, validId);
  return getChannelById(validId);
}

async function startPlayback(channel) {
  const audio = ensureAudio();
  if (!audio) {
    throw new Error('Audio element unavailable');
  }

  if (!channel) {
    throw new Error('Channel missing');
  }

  if (audio.src !== channel.stream) {
    audio.src = channel.stream;
  }

  try {
    await audio.play();
    return channel;
  } catch (error) {
    console.error('[Radio] Playback failed', error);
    throw error;
  }
}

export function getRadioChannelList() {
  return [...FAVORITE_CHANNELS];
}

export function getChannelById(channelId) {
  return FAVORITE_CHANNELS.find((channel) => channel.id === channelId) || FAVORITE_CHANNELS[0];
}

export function getRadioState() {
  return {
    enabled: radioEnabled,
    channelId: currentChannelId,
  };
}

export function setRadioChannel(channelId) {
  return updateChannel(channelId);
}

export async function enableRadio(channelId = currentChannelId) {
  const channel = updateChannel(channelId);
  radioEnabled = true;
  setStoredValue(ENABLED_STORAGE_KEY, 'true');
  return startPlayback(channel);
}

export async function playRadio(channelId = currentChannelId) {
  const channel = updateChannel(channelId);
  return startPlayback(channel);
}

export function disableRadio() {
  const audio = ensureAudio();
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
  radioEnabled = false;
  setStoredValue(ENABLED_STORAGE_KEY, 'false');
}

export function isRadioEnabled() {
  return radioEnabled;
}

export function getCurrentChannel() {
  return getChannelById(currentChannelId);
}
