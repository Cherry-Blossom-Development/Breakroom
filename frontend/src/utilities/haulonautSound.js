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
  syncDescentRoarUserGain()
}

export function setHaulonautSoundVolume(value) {
  soundVolume.value = Math.max(0, Math.min(1, value))
  savePrefs()
  syncDescentRoarUserGain()
}

// ---- Descent roar (procedural, Web Audio) ----
//
// The landing-sequence used to rely on two one-shot clips (`descent` at the
// start, `entry` when the flames appear) across a ~17s montage, which reads
// as exactly what it is: a short burst of noise, several seconds of
// silence, then another short burst. This replaces both with one
// continuous synthesized bed -- filtered noise plus a low engine tone --
// that's audible from the first frame of descent to touchdown, so there's
// never a silent gap. It's synthesized rather than a looped .wav because a
// looped clip has an audible seam every cycle; a Web Audio noise buffer
// with `loop = true` on a BufferSourceNode does not.
//
// Callers (see the landing-sequence phase machine in HaulonautPlayPage.vue)
// drive the "getting closer" feel by ramping `intensity` (0..1) up across
// approaching/closing/sweeping, spiking it hard right as the atmospheric-
// entry flames appear, then ramping back to 0 so it's silent by touchdown.
let descentAudioCtx = null
let descentNoiseSource = null
let descentFilter = null
let descentEngineOsc = null
let descentEngineGain = null
let descentIntensityGain = null
let descentUserGain = null

function buildNoiseBuffer(ctx) {
  const seconds = 2
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

// Keeps the roar's output in sync with the normal SFX mute/volume prefs
// even while it's mid-descent (e.g. the player mutes partway down) --
// mirrors the one-shot bus's soundMuted/soundVolume, just applied
// continuously instead of read once at play() time.
function syncDescentRoarUserGain() {
  if (!descentAudioCtx || !descentUserGain) return
  const now = descentAudioCtx.currentTime
  descentUserGain.gain.cancelScheduledValues(now)
  descentUserGain.gain.linearRampToValueAtTime(soundMuted.value ? 0 : soundVolume.value, now + 0.05)
}

export function startHaulonautDescentRoar() {
  if (descentAudioCtx) return // already running -- guards a double beginLandingSequence
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return // unsupported browser -- silently skip rather than throw
  const ctx = new Ctx()

  const noise = ctx.createBufferSource()
  noise.buffer = buildNoiseBuffer(ctx)
  noise.loop = true

  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 500
  filter.Q.value = 0.7

  const engineOsc = ctx.createOscillator()
  engineOsc.type = 'sawtooth'
  engineOsc.frequency.value = 55
  const engineGain = ctx.createGain()
  engineGain.gain.value = 0

  const intensityGain = ctx.createGain()
  intensityGain.gain.value = 0.08 // audible immediately, like distant background noise -- never a silent start
  const userGain = ctx.createGain()
  userGain.gain.value = soundMuted.value ? 0 : soundVolume.value

  noise.connect(filter)
  filter.connect(intensityGain)
  engineOsc.connect(engineGain)
  engineGain.connect(intensityGain)
  intensityGain.connect(userGain)
  userGain.connect(ctx.destination)

  noise.start()
  engineOsc.start()

  descentAudioCtx = ctx
  descentNoiseSource = noise
  descentFilter = filter
  descentEngineOsc = engineOsc
  descentEngineGain = engineGain
  descentIntensityGain = intensityGain
  descentUserGain = userGain
}

// Smoothly moves the roar toward `target` intensity (0..1) over
// `durationMs` -- both loudness and timbre (filter brightness + engine
// pitch/body) move together so "louder" reads as "closer", not just "gain
// went up".
export function rampHaulonautDescentRoarIntensity(target, durationMs) {
  if (!descentAudioCtx) return
  const ctx = descentAudioCtx
  const now = ctx.currentTime
  const clamped = Math.max(0, Math.min(1, target))
  const seconds = Math.max(0.01, durationMs / 1000)

  const level = 0.08 + clamped * 0.55
  descentIntensityGain.gain.cancelScheduledValues(now)
  descentIntensityGain.gain.setValueAtTime(descentIntensityGain.gain.value, now)
  descentIntensityGain.gain.linearRampToValueAtTime(level, now + seconds)

  descentFilter.frequency.cancelScheduledValues(now)
  descentFilter.frequency.setValueAtTime(descentFilter.frequency.value, now)
  descentFilter.frequency.linearRampToValueAtTime(500 + clamped * 2600, now + seconds)

  descentEngineGain.gain.cancelScheduledValues(now)
  descentEngineGain.gain.setValueAtTime(descentEngineGain.gain.value, now)
  descentEngineGain.gain.linearRampToValueAtTime(clamped * 0.5, now + seconds)

  descentEngineOsc.frequency.cancelScheduledValues(now)
  descentEngineOsc.frequency.setValueAtTime(descentEngineOsc.frequency.value, now)
  descentEngineOsc.frequency.linearRampToValueAtTime(55 + clamped * 70, now + seconds)
}

// The atmospheric-entry beat: a fast attack to a hot peak, distinct from
// the gradual approach swell, timed by the caller to land right as the
// flames appear on screen.
export function spikeHaulonautDescentRoar() {
  if (!descentAudioCtx) return
  const ctx = descentAudioCtx
  const now = ctx.currentTime
  const attack = 0.15

  descentIntensityGain.gain.cancelScheduledValues(now)
  descentIntensityGain.gain.setValueAtTime(descentIntensityGain.gain.value, now)
  descentIntensityGain.gain.linearRampToValueAtTime(1.0, now + attack)

  descentFilter.frequency.cancelScheduledValues(now)
  descentFilter.frequency.setValueAtTime(descentFilter.frequency.value, now)
  descentFilter.frequency.linearRampToValueAtTime(3400, now + attack)

  descentEngineGain.gain.cancelScheduledValues(now)
  descentEngineGain.gain.setValueAtTime(descentEngineGain.gain.value, now)
  descentEngineGain.gain.linearRampToValueAtTime(0.7, now + attack)
}

// Fades to silence over `fadeMs` and tears down the audio graph. Safe to
// call when nothing is running (e.g. a defensive cleanup call on unmount).
export function stopHaulonautDescentRoar(fadeMs = 400) {
  if (!descentAudioCtx) return
  const ctx = descentAudioCtx
  const noise = descentNoiseSource
  const osc = descentEngineOsc
  const now = ctx.currentTime
  const seconds = Math.max(0.01, fadeMs / 1000)

  descentIntensityGain.gain.cancelScheduledValues(now)
  descentIntensityGain.gain.setValueAtTime(descentIntensityGain.gain.value, now)
  descentIntensityGain.gain.linearRampToValueAtTime(0, now + seconds)

  setTimeout(() => {
    try { noise.stop() } catch { /* already stopped */ }
    try { osc.stop() } catch { /* already stopped */ }
    ctx.close()
  }, fadeMs + 50)

  descentAudioCtx = null
  descentNoiseSource = null
  descentFilter = null
  descentEngineOsc = null
  descentEngineGain = null
  descentIntensityGain = null
  descentUserGain = null
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
