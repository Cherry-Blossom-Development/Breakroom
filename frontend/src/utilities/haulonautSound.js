// Haulonaut sound effects. Module-singleton (like eventService.js) rather
// than a per-component composable, since there should only ever be one set
// of Howl instances and one mute/volume state for the whole game session --
// HaulonautPlayPage.vue imports the same refs it writes with, so the mute
// button and volume slider stay in sync with playback with no extra wiring.
//
// Phase 1: infra + a handful of core UI cues (open/click/success/error).
// Sounds are added here as the game grows; nothing else needs to change to
// add a new one beyond adding it to SOUND_FILES and calling playHaulonautSound.
//
// Phase 4 adds a second, independent bus for looping ambience (see
// AMBIENT_FILES / playHaulonautAmbient below) -- separate mute/volume from
// the one-shot SFX bus above, since background audio is a different kind of
// decision (on by default here, but someone may want SFX without the drone,
// or vice versa).
import { Howl } from 'howler'
import { ref } from 'vue'

const STORAGE_KEY = 'haulonaut_sound_prefs'
const DEFAULT_VOLUME = 0.6
const DEFAULT_AMBIENT_VOLUME = 0.35

const SOUND_FILES = {
  click: '/sounds/haulonaut/ui-click.wav',
  open: '/sounds/haulonaut/ui-open.wav',
  success: '/sounds/haulonaut/ui-success.wav',
  error: '/sounds/haulonaut/ui-error.wav',
  // Phase 2: navigation + combat
  warp: '/sounds/haulonaut/warp.wav',
  drift: '/sounds/haulonaut/drift.wav',
  arrival: '/sounds/haulonaut/arrival.wav',
  presence: '/sounds/haulonaut/presence.wav',
  hit: '/sounds/haulonaut/hit.wav',
  damage: '/sounds/haulonaut/damage.wav',
  danger: '/sounds/haulonaut/danger.wav',
  death: '/sounds/haulonaut/death.wav',
  // Phase 3: trade/hail + landing/launch/docking
  notify: '/sounds/haulonaut/notify.wav',
  'trade-success': '/sounds/haulonaut/trade-success.wav',
  'trade-decline': '/sounds/haulonaut/trade-decline.wav',
  descent: '/sounds/haulonaut/descent.wav',
  entry: '/sounds/haulonaut/entry.wav',
  dock: '/sounds/haulonaut/dock.wav',
  launch: '/sounds/haulonaut/launch.wav',
  // Phase 5: polish (buggy movement, NPC-distinct presence, buggy landing events)
  'buggy-move': '/sounds/haulonaut/buggy-move.wav',
  'npc-presence': '/sounds/haulonaut/npc-presence.wav',
  'landing-event': '/sounds/haulonaut/landing-event.wav'
}

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return {
      muted: typeof saved.muted === 'boolean' ? saved.muted : false,
      volume: typeof saved.volume === 'number' ? saved.volume : DEFAULT_VOLUME,
      // Ambience defaults to ON (unlike SFX, this is a deliberate per-game
      // choice, not just "whatever the mute default happens to be").
      ambientMuted: typeof saved.ambientMuted === 'boolean' ? saved.ambientMuted : false,
      ambientVolume: typeof saved.ambientVolume === 'number' ? saved.ambientVolume : DEFAULT_AMBIENT_VOLUME
    }
  } catch {
    // private mode / disabled storage -- fall back to defaults
    return { muted: false, volume: DEFAULT_VOLUME, ambientMuted: false, ambientVolume: DEFAULT_AMBIENT_VOLUME }
  }
}

const prefs = loadPrefs()
export const soundMuted = ref(prefs.muted)
export const soundVolume = ref(prefs.volume)
export const ambientMuted = ref(prefs.ambientMuted)
export const ambientVolume = ref(prefs.ambientVolume)

function savePrefs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      muted: soundMuted.value,
      volume: soundVolume.value,
      ambientMuted: ambientMuted.value,
      ambientVolume: ambientVolume.value
    }))
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

// ---- Ambient bus (looping background beds) ----

const AMBIENT_FILES = {
  space: '/sounds/haulonaut/amb-space.wav',
  outpost: '/sounds/haulonaut/amb-outpost.wav',
  surface: '/sounds/haulonaut/amb-surface.wav'
}
const AMBIENT_FADE_MS = 800

const ambientHowls = {}
function getAmbientHowl(key) {
  if (!(key in AMBIENT_FILES)) return null
  if (!ambientHowls[key]) {
    ambientHowls[key] = new Howl({ src: [AMBIENT_FILES[key]], loop: true, volume: 0 })
  }
  return ambientHowls[key]
}

// Which ambient bed the caller last asked for (independent of ambientMuted --
// muting pauses playback but remembers the key, so unmuting resumes the
// right bed instead of needing the caller to re-request it).
let currentAmbientKey = null

function fadeOutAndPause(howl) {
  if (!howl.playing()) return
  howl.fade(howl.volume(), 0, AMBIENT_FADE_MS)
  setTimeout(() => howl.pause(), AMBIENT_FADE_MS)
}

// Crossfades to `key` ('space' | 'outpost' | 'surface'), or fades out to
// silence for a falsy key (e.g. during the landing-sequence montage, where
// the foreground SFX should carry the moment). Calling with the
// already-current key is a no-op, so callers can pass a plain computed
// context value straight into a watcher without tracking transitions
// themselves.
export function playHaulonautAmbient(key) {
  if (key === currentAmbientKey) return
  const prevKey = currentAmbientKey
  currentAmbientKey = key
  if (prevKey) {
    const prevHowl = ambientHowls[prevKey]
    if (prevHowl) fadeOutAndPause(prevHowl)
  }
  if (!key || ambientMuted.value) return
  const howl = getAmbientHowl(key)
  if (!howl) return
  if (!howl.playing()) howl.play()
  howl.fade(howl.volume(), ambientVolume.value, AMBIENT_FADE_MS)
}

export function stopHaulonautAmbient() {
  playHaulonautAmbient(null)
}

export function toggleHaulonautAmbientMuted() {
  ambientMuted.value = !ambientMuted.value
  savePrefs()
  if (!currentAmbientKey) return
  if (ambientMuted.value) {
    const howl = ambientHowls[currentAmbientKey]
    if (howl) fadeOutAndPause(howl)
  } else {
    const howl = getAmbientHowl(currentAmbientKey)
    if (howl) {
      if (!howl.playing()) howl.play()
      howl.fade(howl.volume(), ambientVolume.value, AMBIENT_FADE_MS)
    }
  }
}

export function setHaulonautAmbientVolume(value) {
  ambientVolume.value = Math.max(0, Math.min(1, value))
  savePrefs()
  if (currentAmbientKey && !ambientMuted.value) {
    const howl = ambientHowls[currentAmbientKey]
    if (howl) howl.volume(ambientVolume.value)
  }
}
