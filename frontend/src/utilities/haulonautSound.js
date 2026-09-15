// Haulonaut sound effects. Module-singleton (like eventService.js) rather
// than a per-component composable, since there should only ever be one set
// of Howl instances and one mute/volume state for the whole game session --
// HaulonautPlayPage.vue imports the same refs it writes with, so the mute
// button and volume slider stay in sync with playback with no extra wiring.
//
// Phase 1: infra + a handful of core UI cues (open/click/success/error).
// Sounds are added here as the game grows; nothing else needs to change to
// add a new one beyond adding it to SOUND_FILES and calling playHaulonautSound.
import { Howl } from 'howler'
import { ref } from 'vue'

const STORAGE_KEY = 'haulonaut_sound_prefs'
const DEFAULT_VOLUME = 0.6

const SOUND_FILES = {
  click: '/sounds/haulonaut/ui-click.wav',
  open: '/sounds/haulonaut/ui-open.wav',
  success: '/sounds/haulonaut/ui-success.wav',
  error: '/sounds/haulonaut/ui-error.wav'
}

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return {
      muted: typeof saved.muted === 'boolean' ? saved.muted : false,
      volume: typeof saved.volume === 'number' ? saved.volume : DEFAULT_VOLUME
    }
  } catch {
    // private mode / disabled storage -- fall back to defaults
    return { muted: false, volume: DEFAULT_VOLUME }
  }
}

const prefs = loadPrefs()
export const soundMuted = ref(prefs.muted)
export const soundVolume = ref(prefs.volume)

function savePrefs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ muted: soundMuted.value, volume: soundVolume.value }))
  } catch {
    // non-fatal -- prefs just won't survive a reload
  }
}

// Howls are built lazily, one per key on first use, rather than all at
// import time -- most sessions never touch every sound in a given visit.
const howls = {}
function getHowl(key) {
  if (!(key in SOUND_FILES)) return null
  if (!howls[key]) {
    howls[key] = new Howl({ src: [SOUND_FILES[key]], volume: soundVolume.value })
  }
  return howls[key]
}

export function playHaulonautSound(key) {
  if (soundMuted.value) return
  const howl = getHowl(key)
  if (!howl) return
  howl.volume(soundVolume.value)
  howl.play()
}

export function toggleHaulonautSoundMuted() {
  soundMuted.value = !soundMuted.value
  savePrefs()
}

export function setHaulonautSoundVolume(value) {
  soundVolume.value = Math.max(0, Math.min(1, value))
  savePrefs()
}
