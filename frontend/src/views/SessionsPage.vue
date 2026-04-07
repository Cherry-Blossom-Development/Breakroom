<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { sessions } from '@/stores/sessions'
import { authFetch } from '@/utilities/authFetch'

// --- Section tabs ---
const activeTab = ref('band')

// --- Bands state ---
const bands = ref([])
const bandsLoading = ref(false)
const bandsError = ref(null)

// Create band form
const showCreateBand = ref(false)
const newBandName = ref('')
const newBandDescription = ref('')
const createBandError = ref(null)
const creatingBand = ref(false)

// Band detail view
const activeBand = ref(null)         // full band object with members
const activeBandLoading = ref(false)
const inviteHandle = ref('')
const inviteError = ref(null)
const inviteSuccess = ref(null)
const inviting = ref(false)

// Edit band name inline
const editingBandName = ref(false)
const editBandNameValue = ref('')

async function loadBands() {
  bandsLoading.value = true
  bandsError.value = null
  try {
    const res = await authFetch('/api/bands')
    const data = await res.json()
    if (!res.ok) throw new Error(data.message)
    bands.value = data.bands
  } catch (err) {
    bandsError.value = err.message
  } finally {
    bandsLoading.value = false
  }
}

async function loadBandDetail(id) {
  activeBandLoading.value = true
  try {
    const res = await authFetch(`/api/bands/${id}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.message)
    activeBand.value = data.band
  } catch (err) {
    bandsError.value = err.message
  } finally {
    activeBandLoading.value = false
  }
}

async function createBand() {
  if (!newBandName.value.trim()) return
  creatingBand.value = true
  createBandError.value = null
  try {
    const res = await authFetch('/api/bands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newBandName.value.trim(), description: newBandDescription.value.trim() || undefined })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message)
    bands.value.push({ ...data.band, role: 'owner', status: 'active', member_count: 1 })
    newBandName.value = ''
    newBandDescription.value = ''
    showCreateBand.value = false
    activeBand.value = { ...data.band, my_role: 'owner', members: [] }
  } catch (err) {
    createBandError.value = err.message
  } finally {
    creatingBand.value = false
  }
}

async function deleteBand(id) {
  if (!confirm('Delete this band? This cannot be undone.')) return
  try {
    const res = await authFetch(`/api/bands/${id}`, { method: 'DELETE' })
    if (!res.ok) { const d = await res.json(); throw new Error(d.message) }
    bands.value = bands.value.filter(b => b.id !== id)
    if (activeBand.value?.id === id) activeBand.value = null
  } catch (err) {
    bandsError.value = err.message
  }
}

async function inviteMember() {
  if (!inviteHandle.value.trim()) return
  inviting.value = true
  inviteError.value = null
  inviteSuccess.value = null
  try {
    const res = await authFetch(`/api/bands/${activeBand.value.id}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: inviteHandle.value.trim() })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message)
    inviteSuccess.value = data.message
    inviteHandle.value = ''
  } catch (err) {
    inviteError.value = err.message
  } finally {
    inviting.value = false
  }
}

async function removeMember(userId) {
  if (!confirm('Remove this member from the band?')) return
  try {
    const res = await authFetch(`/api/bands/${activeBand.value.id}/members/${userId}`, { method: 'DELETE' })
    if (!res.ok) { const d = await res.json(); throw new Error(d.message) }
    activeBand.value.members = activeBand.value.members.filter(m => m.id !== userId)
    // update list count
    const b = bands.value.find(b => b.id === activeBand.value.id)
    if (b) b.member_count = Math.max(0, b.member_count - 1)
  } catch (err) {
    bandsError.value = err.message
  }
}

async function respondToInvite(bandId, action) {
  try {
    const res = await authFetch(`/api/bands/${bandId}/members/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    })
    if (!res.ok) { const d = await res.json(); throw new Error(d.message) }
    if (action === 'accept') {
      const b = bands.value.find(b => b.id === bandId)
      if (b) { b.status = 'active'; b.member_count++ }
    } else {
      bands.value = bands.value.filter(b => b.id !== bandId)
    }
  } catch (err) {
    bandsError.value = err.message
  }
}

async function saveBandName() {
  if (!editBandNameValue.value.trim() || editBandNameValue.value.trim() === activeBand.value.name) {
    editingBandName.value = false
    return
  }
  try {
    const res = await authFetch(`/api/bands/${activeBand.value.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editBandNameValue.value.trim() })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message)
    activeBand.value.name = data.band.name
    const b = bands.value.find(b => b.id === activeBand.value.id)
    if (b) b.name = data.band.name
    editingBandName.value = false
  } catch (err) {
    bandsError.value = err.message
  }
}

function startEditBandName() {
  editBandNameValue.value = activeBand.value.name
  editingBandName.value = true
}

// --- Instruments ---
const instruments = ref([])
async function loadInstruments() {
  try {
    const res = await authFetch('/api/instruments')
    const data = await res.json()
    if (res.ok) instruments.value = data.instruments
  } catch { /* non-critical */ }
}

// --- Band Practice upload state ---
const uploading = ref(false)
const uploadError = ref(null)
const selectedFile = ref(null)
const sessionName = ref('')
const recordedAt = ref(new Date().toISOString().split('T')[0])
const uploadBandId = ref('')
const fileInput = ref(null)

// --- Individual upload state ---
const indivUploading = ref(false)
const indivUploadError = ref(null)
const indivFile = ref(null)
const indivName = ref('')
const indivRecordedAt = ref(new Date().toISOString().split('T')[0])
const indivInstrumentId = ref('')
const indivUploadBandId = ref('')
const fileInputIndiv = ref(null)

// --- Live recording ---
const recordingFor = ref(null) // 'band' | 'individual' | null
const recordingSeconds = ref(0)
const audioLevel = ref(0) // 0–100, drives level meter
const micDevices = ref([])       // available audio input devices
const selectedMicId = ref('')    // '' = browser default
const recordingPreviewUrl = ref(null) // blob URL for post-recording preview
let _recordingStream = null
let _pcmSamples = []
let _recordingSampleRate = 48000
let _scriptProcessor = null
let _recordingInterval = null
let _audioContext = null
let _levelAnimFrame = null

async function refreshMicDevices() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices()
    micDevices.value = all.filter(d => d.kind === 'audioinput')
  } catch { /* ignore */ }
}

function _startLevelMeter(stream) {
  _audioContext = new AudioContext()
  _recordingSampleRate = _audioContext.sampleRate
  const source = _audioContext.createMediaStreamSource(stream)

  // Analyser for the visual level meter
  const analyser = _audioContext.createAnalyser()
  analyser.fftSize = 256
  source.connect(analyser)
  const data = new Uint8Array(analyser.frequencyBinCount)
  function tick() {
    analyser.getByteFrequencyData(data)
    const avg = data.reduce((a, b) => a + b, 0) / data.length
    audioLevel.value = Math.round((avg / 255) * 100)
    _levelAnimFrame = requestAnimationFrame(tick)
  }
  tick()

  // ScriptProcessorNode captures raw mono PCM for WAV encoding
  _scriptProcessor = _audioContext.createScriptProcessor(4096, 1, 1)
  _scriptProcessor.onaudioprocess = (e) => {
    _pcmSamples.push(new Float32Array(e.inputBuffer.getChannelData(0)))
  }
  source.connect(_scriptProcessor)
  _scriptProcessor.connect(_audioContext.destination) // must be connected to fire
}
function _stopLevelMeter() {
  if (_levelAnimFrame) { cancelAnimationFrame(_levelAnimFrame); _levelAnimFrame = null }
  if (_scriptProcessor) { _scriptProcessor.disconnect(); _scriptProcessor = null }
  if (_audioContext) { _audioContext.close(); _audioContext = null }
  audioLevel.value = 0
}

// WAV encoding helpers — writes uncompressed 16-bit mono PCM
function _writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
}
function _encodeWAV(samples, sampleRate) {
  const numChannels = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  _writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  _writeString(view, 8, 'WAVE')
  _writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)                                          // chunk size
  view.setUint16(20, 1, true)                                           // PCM format
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true)   // byte rate
  view.setUint16(32, numChannels * bytesPerSample, true)                // block align
  view.setUint16(34, bitsPerSample, true)
  _writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)
  let off = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(off, s < 0 ? s * 32768 : s * 32767, true)
    off += 2
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

function formatRecordingTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0')
  const s = (secs % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}
async function startRecording(context) {
  try {
    if (recordingPreviewUrl.value) { URL.revokeObjectURL(recordingPreviewUrl.value); recordingPreviewUrl.value = null }
    const audioConstraints = selectedMicId.value
      ? { deviceId: { exact: selectedMicId.value }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      : { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
    _recordingStream = stream

    // Permission just granted — populate device list with labels
    await refreshMicDevices()

    _pcmSamples = []
    _startLevelMeter(stream)
    recordingFor.value = context
    recordingSeconds.value = 0
    _recordingInterval = setInterval(() => recordingSeconds.value++, 1000)
  } catch {
    alert('Microphone access denied or unavailable.')
  }
}
function stopRecording() {
  // Disconnect PCM capture before stopping stream to avoid trailing silence
  if (_scriptProcessor) {
    _scriptProcessor.onaudioprocess = null
    _scriptProcessor.disconnect()
    _scriptProcessor = null
  }
  if (_recordingStream) {
    _recordingStream.getTracks().forEach(t => t.stop())
    _recordingStream = null
  }

  // Flatten collected PCM chunks and encode as uncompressed WAV
  const totalSamples = _pcmSamples.reduce((sum, c) => sum + c.length, 0)
  const flat = new Float32Array(totalSamples)
  let offset = 0
  for (const chunk of _pcmSamples) { flat.set(chunk, offset); offset += chunk.length }
  _pcmSamples = []

  const blob = _encodeWAV(flat, _recordingSampleRate)
  const file = new File([blob], `recording-${Date.now()}.wav`, { type: 'audio/wav' })
  console.log('[Recording] samples:', totalSamples, '| blob size:', blob.size, '| sample rate:', _recordingSampleRate)

  recordingPreviewUrl.value = URL.createObjectURL(blob)
  const ctx = recordingFor.value
  if (ctx === 'band') {
    selectedFile.value = file
    if (!sessionName.value) sessionName.value = defaultName()
  } else {
    indivFile.value = file
    if (!indivName.value) indivName.value = defaultName()
  }
  recordingFor.value = null
  recordingSeconds.value = 0
  clearInterval(_recordingInterval)

  _stopLevelMeter()
}

// --- Playback state ---
const playingId = ref(null)
const audioEl = ref(null)
const isPlaying = ref(false)

// --- Grouping state ---
const selectedYear = ref(null)
const collapsedMonths = ref(new Set())

// --- Rating popup ---
const ratingPopupId = ref(null)

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December']

// --- Helpers ---
function sessionDate(s) { return s.recorded_at || s.uploaded_at }
function sessionYear(s) { const d = sessionDate(s); return d ? new Date(d).getFullYear() : null }
function sessionMonth(s) { const d = sessionDate(s); return d ? new Date(d).getMonth() : null }

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}
function formatBytes(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
function defaultName() {
  return `Session - ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
}

// --- Year tabs ---
const availableYears = computed(() => {
  const years = new Set()
  for (const s of sessions.list) { const y = sessionYear(s); if (y) years.add(y) }
  return Array.from(years).sort((a, b) => b - a)
})

// --- Grouped sessions ---
const bandSessions = computed(() => sessions.list.filter(s => !s.session_type || s.session_type === 'band'))

const yearGroups = computed(() => {
  const list = (selectedYear.value
    ? bandSessions.value.filter(s => sessionYear(s) === selectedYear.value)
    : bandSessions.value)

  const byYear = {}
  for (const s of list) {
    const y = sessionYear(s) ?? 'Unknown'
    const m = sessionMonth(s) ?? 'Unknown'
    if (!byYear[y]) byYear[y] = {}
    if (!byYear[y][m]) byYear[y][m] = []
    byYear[y][m].push(s)
  }
  return Object.entries(byYear)
    .sort(([a], [b]) => (b === 'Unknown' ? -1 : a === 'Unknown' ? 1 : b - a))
    .map(([year, months]) => ({
      year,
      months: Object.entries(months)
        .sort(([a], [b]) => (b === 'Unknown' ? -1 : a === 'Unknown' ? 1 : b - a))
        .map(([month, items]) => ({
          month,
          label: month === 'Unknown' ? 'Unknown Date' : MONTH_NAMES[month],
          key: `${year}-${month}`,
          items
        }))
    }))
})

function toggleMonth(key) {
  const s = new Set(collapsedMonths.value)
  if (s.has(key)) s.delete(key); else s.add(key)
  collapsedMonths.value = s
}

// --- Playback ---
function playingSession() { return sessions.list.find(s => s.id === playingId.value) || null }

async function togglePlay(session) {
  if (playingId.value === session.id) {
    if (isPlaying.value) audioEl.value.pause(); else audioEl.value.play()
    return
  }
  playingId.value = session.id
  isPlaying.value = false
  await nextTick()
  audioEl.value.volume = 0.5
  audioEl.value.load()
  audioEl.value.play()
}
function onAudioPlay() { isPlaying.value = true }
function onAudioPause() { isPlaying.value = false }
function onAudioEnded() { isPlaying.value = false }
function onAudioMetadata() {
  // WAV files include duration in their header — no workaround needed.
}

// --- Upload ---
function onFileSelect(e) {
  const file = e.target.files[0]
  if (!file) return
  selectedFile.value = file
  if (!sessionName.value) sessionName.value = defaultName()
}
async function handleUpload() {
  if (!selectedFile.value) return
  uploading.value = true
  uploadError.value = null
  try {
    await sessions.upload(selectedFile.value, sessionName.value || defaultName(), recordedAt.value || null, uploadBandId.value || null)
    selectedFile.value = null; sessionName.value = ''; recordedAt.value = new Date().toISOString().split('T')[0]; uploadBandId.value = ''
    if (fileInput.value) fileInput.value.value = ''
  } catch (err) { uploadError.value = err.message }
  finally { uploading.value = false }
}

// --- Individual upload ---
function onIndivFileSelect(e) {
  const file = e.target.files[0]
  if (!file) return
  indivFile.value = file
  if (!indivName.value) indivName.value = defaultName()
}
async function handleIndivUpload() {
  if (!indivFile.value) return
  indivUploading.value = true
  indivUploadError.value = null
  try {
    await sessions.upload(indivFile.value, indivName.value || defaultName(), indivRecordedAt.value || null, indivUploadBandId.value || null, 'individual', indivInstrumentId.value || null)
    indivFile.value = null; indivName.value = ''; indivRecordedAt.value = new Date().toISOString().split('T')[0]; indivInstrumentId.value = ''; indivUploadBandId.value = ''
    if (fileInputIndiv.value) fileInputIndiv.value.value = ''
  } catch (err) { indivUploadError.value = err.message }
  finally { indivUploading.value = false }
}

// --- Individual sessions ---
const indivSessions = computed(() => sessions.list.filter(s => s.session_type === 'individual'))
const indivSelectedYear = ref(null)
const indivAvailableYears = computed(() => {
  const years = new Set()
  for (const s of indivSessions.value) { const y = sessionYear(s); if (y) years.add(y) }
  return Array.from(years).sort((a, b) => b - a)
})
const indivYearGroups = computed(() => {
  const list = indivSelectedYear.value
    ? indivSessions.value.filter(s => sessionYear(s) === indivSelectedYear.value)
    : indivSessions.value
  const byYear = {}
  for (const s of list) {
    const y = sessionYear(s) ?? 'Unknown'
    const m = sessionMonth(s) ?? 'Unknown'
    if (!byYear[y]) byYear[y] = {}
    if (!byYear[y][m]) byYear[y][m] = []
    byYear[y][m].push(s)
  }
  return Object.entries(byYear)
    .sort(([a], [b]) => (b === 'Unknown' ? -1 : a === 'Unknown' ? 1 : b - a))
    .map(([year, months]) => ({
      year,
      months: Object.entries(months)
        .sort(([a], [b]) => (b === 'Unknown' ? -1 : a === 'Unknown' ? 1 : b - a))
        .map(([month, items]) => ({
          month, label: month === 'Unknown' ? 'Unknown Date' : MONTH_NAMES[month],
          key: `indiv-${year}-${month}`, items
        }))
    }))
})

// --- Band Members sessions ---
const bandMemberSessions = ref([])
const bandMemberLoaded = ref(false)
const bandMemberBandFilter = ref('')
const bandMemberSelectedYear = ref(null)
const bmRatingPopupId = ref(null)

async function loadBandMemberSessions() {
  if (bandMemberLoaded.value) return
  try {
    const res = await fetch('/api/sessions/band-members', { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      bandMemberSessions.value = data.sessions
    }
  } catch (err) { console.error('Failed to load band member sessions:', err) }
  finally { bandMemberLoaded.value = true }
}

const filteredBandMemberSessions = computed(() => {
  if (!bandMemberBandFilter.value) return bandMemberSessions.value
  return bandMemberSessions.value.filter(s => String(s.band_id) === String(bandMemberBandFilter.value))
})

const bandMemberBands = computed(() => {
  const seen = new Set()
  const result = []
  for (const s of bandMemberSessions.value) {
    if (s.band_id && !seen.has(s.band_id)) {
      seen.add(s.band_id)
      result.push({ id: s.band_id, name: s.band_name })
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
})

const bandMemberAvailableYears = computed(() => {
  const years = new Set()
  for (const s of filteredBandMemberSessions.value) { const y = sessionYear(s); if (y) years.add(y) }
  return Array.from(years).sort((a, b) => b - a)
})

const bandMemberYearGroups = computed(() => {
  const list = bandMemberSelectedYear.value
    ? filteredBandMemberSessions.value.filter(s => sessionYear(s) === bandMemberSelectedYear.value)
    : filteredBandMemberSessions.value
  const byYear = {}
  for (const s of list) {
    const y = sessionYear(s) ?? 'Unknown'
    const m = sessionMonth(s) ?? 'Unknown'
    if (!byYear[y]) byYear[y] = {}
    if (!byYear[y][m]) byYear[y][m] = []
    byYear[y][m].push(s)
  }
  return Object.entries(byYear)
    .sort(([a], [b]) => (b === 'Unknown' ? -1 : a === 'Unknown' ? 1 : b - a))
    .map(([year, months]) => ({
      year,
      months: Object.entries(months)
        .sort(([a], [b]) => (b === 'Unknown' ? -1 : a === 'Unknown' ? 1 : b - a))
        .map(([month, items]) => ({
          month, label: month === 'Unknown' ? 'Unknown Date' : MONTH_NAMES[month],
          key: `bm-${year}-${month}`, items
        }))
    }))
})

function openBmRatingPopup(sessionId, event) {
  event.stopPropagation()
  bmRatingPopupId.value = bmRatingPopupId.value === sessionId ? null : sessionId
}

async function submitBandMemberRating(session, value) {
  const newRating = session.my_rating === value ? null : value
  try {
    const res = await fetch(`/api/sessions/${session.id}/rate`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: newRating })
    })
    if (!res.ok) throw new Error('Rating failed')
    const data = await res.json()
    const idx = bandMemberSessions.value.findIndex(s => s.id === session.id)
    if (idx !== -1) bandMemberSessions.value[idx] = { ...bandMemberSessions.value[idx], ...data }
  } catch (err) { console.error('Failed to rate:', err) }
  bmRatingPopupId.value = null
}

// --- Inline edits ---
async function saveName(session, newName) {
  if (!newName.trim() || newName.trim() === session.name) return
  try { await sessions.update(session.id, { name: newName.trim() }) }
  catch (err) { console.error('Failed to update name:', err) }
}
async function saveRecordedAt(session, value) {
  try { await sessions.update(session.id, { recorded_at: value || null }) }
  catch (err) { console.error('Failed to update date:', err) }
}
async function saveBand(session, value) {
  try { await sessions.update(session.id, { band_id: value ? parseInt(value, 10) : null }) }
  catch (err) { console.error('Failed to update band:', err) }
}
async function saveInstrument(session, value) {
  try { await sessions.update(session.id, { instrument_id: value ? parseInt(value, 10) : null }) }
  catch (err) { console.error('Failed to update instrument:', err) }
}

const activeBands = computed(() => bands.value.filter(b => b.status === 'active'))

// --- Rating popup ---
function openRatingPopup(sessionId, event) {
  event.stopPropagation()
  ratingPopupId.value = ratingPopupId.value === sessionId ? null : sessionId
}
function closeRatingPopup() { ratingPopupId.value = null; bmRatingPopupId.value = null }

async function submitRating(session, value) {
  // Clicking the current rating clears it
  const newRating = session.my_rating === value ? null : value
  try { await sessions.rate(session.id, newRating) }
  catch (err) { console.error('Failed to rate:', err) }
  ratingPopupId.value = null
}

// --- Delete ---
async function deleteSession(id) {
  if (!confirm('Delete this session? This cannot be undone.')) return
  if (playingId.value === id) { audioEl.value?.pause(); playingId.value = null }
  try { await sessions.remove(id) }
  catch (err) { console.error('Failed to delete:', err) }
}

// --- Mashups ---
const mashupSource = ref('')
const mashupSearch = ref('')
const mashupSelectedSession = ref(null)
const mashupPreviewUrl = ref(null)
const mashupFile = ref(null)
const mashupName = ref('')
const mashupRecordedAt = ref(new Date().toISOString().split('T')[0])
const mashupInstrumentId = ref('')
const mashupBandId = ref('')
const mashupUploading = ref(false)
const mashupUploadError = ref(null)
const mashupBackingAudioEl = ref(null)

const mashupSourceSessions = computed(() => {
  if (!mashupSource.value) return []
  if (mashupSource.value === 'own') return sessions.list
  const bandId = parseInt(mashupSource.value.replace('band-', ''), 10)
  return bandMemberSessions.value.filter(s => s.band_id === bandId)
})

const filteredMashupSessions = computed(() => {
  const q = mashupSearch.value.toLowerCase().trim()
  if (!q) return mashupSourceSessions.value
  return mashupSourceSessions.value.filter(s =>
    s.name.toLowerCase().includes(q) ||
    (s.uploader_handle && s.uploader_handle.toLowerCase().includes(q))
  )
})

async function startMashupRecording() {
  try {
    if (mashupPreviewUrl.value) { URL.revokeObjectURL(mashupPreviewUrl.value); mashupPreviewUrl.value = null }
    const audioConstraints = selectedMicId.value
      ? { deviceId: { exact: selectedMicId.value }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      : { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
    _recordingStream = stream
    await refreshMicDevices()
    _pcmSamples = []
    _startLevelMeter(stream)
    recordingFor.value = 'mashup'
    recordingSeconds.value = 0
    _recordingInterval = setInterval(() => recordingSeconds.value++, 1000)
    if (mashupBackingAudioEl.value) {
      mashupBackingAudioEl.value.currentTime = 0
      mashupBackingAudioEl.value.play()
    }
  } catch {
    alert('Microphone access denied or unavailable.')
  }
}

function stopMashupRecording() {
  if (mashupBackingAudioEl.value) {
    mashupBackingAudioEl.value.pause()
    mashupBackingAudioEl.value.currentTime = 0
  }
  if (_scriptProcessor) {
    _scriptProcessor.onaudioprocess = null
    _scriptProcessor.disconnect()
    _scriptProcessor = null
  }
  if (_recordingStream) {
    _recordingStream.getTracks().forEach(t => t.stop())
    _recordingStream = null
  }
  const totalSamples = _pcmSamples.reduce((sum, c) => sum + c.length, 0)
  const flat = new Float32Array(totalSamples)
  let offset = 0
  for (const chunk of _pcmSamples) { flat.set(chunk, offset); offset += chunk.length }
  _pcmSamples = []

  // OS-level echo processing often attenuates mic input when audio is playing through
  // speakers simultaneously. Normalize peak to 0.7 before encoding so the server's
  // EBU R128 normalization has adequate signal to work with.
  const peak = flat.reduce((max, s) => Math.max(max, Math.abs(s)), 0)
  if (peak > 0 && peak < 0.7) {
    const boost = 0.7 / peak
    for (let i = 0; i < flat.length; i++) flat[i] = Math.max(-1, Math.min(1, flat[i] * boost))
  }

  const blob = _encodeWAV(flat, _recordingSampleRate)
  mashupFile.value = new File([blob], `mashup-${Date.now()}.wav`, { type: 'audio/wav' })
  mashupPreviewUrl.value = URL.createObjectURL(blob)
  if (!mashupName.value) mashupName.value = defaultName()
  recordingFor.value = null
  recordingSeconds.value = 0
  clearInterval(_recordingInterval)
  _stopLevelMeter()
}

async function handleMashupUpload() {
  if (!mashupFile.value) return
  mashupUploading.value = true
  mashupUploadError.value = null
  try {
    await sessions.upload(mashupFile.value, mashupName.value || defaultName(), mashupRecordedAt.value || null, mashupBandId.value || null, 'individual', mashupInstrumentId.value || null)
    mashupFile.value = null
    mashupName.value = ''
    mashupRecordedAt.value = new Date().toISOString().split('T')[0]
    mashupInstrumentId.value = ''
    mashupBandId.value = ''
    if (mashupPreviewUrl.value) { URL.revokeObjectURL(mashupPreviewUrl.value); mashupPreviewUrl.value = null }
  } catch (err) {
    mashupUploadError.value = err.message
  } finally {
    mashupUploading.value = false
  }
}

onMounted(async () => {
  sessions.reset()
  await sessions.load()
  if (availableYears.value.length > 0) selectedYear.value = availableYears.value[0]
  document.addEventListener('click', closeRatingPopup)
  await Promise.all([loadBands(), loadInstruments(), loadBandMemberSessions()])
  await refreshMicDevices()
})
</script>

<template>
  <div class="page-container sessions-page">
    <header class="page-header">
      <h1>Sessions</h1>
      <p class="subtitle">Track and manage your recording sessions</p>
    </header>

    <!-- Section tabs -->
    <div class="section-tabs">
      <button class="section-tab" :class="{ active: activeTab === 'band' }" @click="activeTab = 'band'">Band Practice</button>
      <button class="section-tab" :class="{ active: activeTab === 'individual' }" @click="activeTab = 'individual'">Individual</button>
      <button class="section-tab" :class="{ active: activeTab === 'bands' }" @click="activeTab = 'bands'">Bands</button>
    </div>

    <!-- Individual tab -->
    <template v-if="activeTab === 'individual'">

      <!-- My Recordings -->
      <div class="indiv-section-heading">My Recordings</div>

      <!-- Upload card -->
      <div class="card">
        <h2 class="card-title">Upload Recording</h2>
        <div class="upload-form">
          <div class="file-row">
            <input ref="fileInputIndiv" type="file" accept="audio/*" @change="onIndivFileSelect"
                   class="file-input" id="indiv-audio-file" :disabled="indivUploading || recordingFor !== null" />
            <label for="indiv-audio-file" class="file-label" :class="{ 'has-file': indivFile, 'disabled': recordingFor !== null }">
              {{ indivFile ? indivFile.name : 'Choose audio file…' }}
            </label>
            <template v-if="recordingFor === 'individual'">
              <span class="rec-indicator">● {{ formatRecordingTime(recordingSeconds) }}</span>
              <div class="level-meter" title="Input level"><div class="level-fill" :style="{ width: audioLevel + '%' }"></div></div>
              <button class="rec-stop-btn" @click="stopRecording">Stop</button>
            </template>
            <template v-else>
              <select v-if="micDevices.length > 0" v-model="selectedMicId" class="mic-select" :disabled="indivUploading" title="Select microphone">
                <option value="">Default mic</option>
                <option v-for="d in micDevices" :key="d.deviceId" :value="d.deviceId">{{ d.label || `Mic ${d.deviceId.slice(0,6)}…` }}</option>
              </select>
              <button class="rec-btn" :disabled="recordingFor !== null || indivUploading"
                      @click="startRecording('individual')" title="Record from microphone">
                🎙 Record
              </button>
            </template>
          </div>
          <div class="fields-row">
            <div class="field">
              <label class="field-label">Name</label>
              <input v-model="indivName" type="text" class="text-input"
                     placeholder="Recording name" :disabled="indivUploading" />
            </div>
            <div class="field">
              <label class="field-label">Original recording date <span class="optional">(optional)</span></label>
              <input v-model="indivRecordedAt" type="date" class="text-input" :disabled="indivUploading" />
            </div>
            <div class="field">
              <label class="field-label">Instrument <span class="optional">(optional)</span></label>
              <select v-model="indivInstrumentId" class="text-input" :disabled="indivUploading">
                <option value="">— select instrument —</option>
                <option v-for="inst in instruments" :key="inst.id" :value="inst.id">{{ inst.name }}</option>
              </select>
            </div>
            <div class="field">
              <label class="field-label">Band <span class="optional">(optional)</span></label>
              <select v-model="indivUploadBandId" class="text-input" :disabled="indivUploading">
                <option value="">— no band —</option>
                <option v-for="b in activeBands" :key="b.id" :value="b.id">{{ b.name }}</option>
              </select>
            </div>
          </div>
          <div v-if="recordingPreviewUrl && !recordingFor" class="recording-preview">
            <span class="preview-label">Preview recording:</span>
            <audio controls :src="recordingPreviewUrl" @loadedmetadata="onAudioMetadata" style="height:32px;"></audio>
          </div>
          <p v-if="indivUploadError" class="error-msg">{{ indivUploadError }}</p>
          <button class="upload-btn" @click="handleIndivUpload" :disabled="!indivFile || indivUploading">
            {{ indivUploading ? 'Uploading…' : 'Upload' }}
          </button>
        </div>
      </div>

      <!-- Your Previous Recordings -->
      <div class="card sessions-card">
        <div class="sessions-header">
          <h2 class="card-title">Your Previous Recordings <span class="count">({{ indivSessions.length }})</span></h2>
          <div v-if="indivAvailableYears.length > 0" class="year-tabs">
            <button class="year-tab" :class="{ active: indivSelectedYear === null }" @click="indivSelectedYear = null">All</button>
            <button v-for="year in indivAvailableYears" :key="year"
                    class="year-tab" :class="{ active: indivSelectedYear === year }"
                    @click="indivSelectedYear = year">{{ year }}</button>
          </div>
        </div>

        <div v-if="indivSessions.length === 0" class="empty-state">
          No recordings yet. Upload one above.
        </div>

        <div v-else>
          <div v-for="group in indivYearGroups" :key="group.year" class="year-group">
            <div v-if="indivSelectedYear === null" class="year-heading">{{ group.year }}</div>
            <div v-for="mgroup in group.months" :key="mgroup.key" class="month-group">
              <button class="month-heading" @click="toggleMonth(mgroup.key)">
                <span class="month-chevron">{{ collapsedMonths.has(mgroup.key) ? '▶' : '▼' }}</span>
                {{ mgroup.label }}
                <span class="month-count">{{ mgroup.items.length }}</span>
              </button>
              <div v-if="!collapsedMonths.has(mgroup.key)" class="table-wrapper">
                <table class="sessions-table">
                  <thead>
                    <tr>
                      <th class="col-play"></th>
                      <th>Name</th>
                      <th>Recorded</th>
                      <th>Size</th>
                      <th>Rating</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <template v-for="session in mgroup.items" :key="session.id">
                    <tr :class="{ playing: playingId === session.id }">
                      <td class="col-play">
                        <button class="play-btn" @click="togglePlay(session)"
                                :title="playingId === session.id && isPlaying ? 'Pause' : 'Play'">
                          {{ playingId === session.id && isPlaying ? '⏸' : '▶' }}
                        </button>
                      </td>
                      <td class="col-name">
                        <input type="text" class="inline-edit" :value="session.name"
                               @blur="e => saveName(session, e.target.value)"
                               @keydown.enter="e => e.target.blur()" />
                        <select class="inline-edit band-select"
                                :value="session.instrument_id || ''"
                                @change="e => saveInstrument(session, e.target.value)">
                          <option value="">— no instrument —</option>
                          <option v-for="inst in instruments" :key="inst.id" :value="inst.id">{{ inst.name }}</option>
                        </select>
                      </td>
                      <td>
                        <input type="date" class="inline-edit date-edit"
                               :value="session.recorded_at ? session.recorded_at.slice(0, 10) : ''"
                               @change="e => saveRecordedAt(session, e.target.value)" />
                      </td>
                      <td class="muted">{{ formatBytes(session.file_size) }}</td>
                      <td class="col-rating">
                        <div class="rating-cell" @click.stop>
                          <span class="avg-rating" :class="{ unrated: !session.avg_rating }">
                            {{ session.avg_rating ? `★ ${session.avg_rating}` : '★ —' }}
                            <span v-if="session.rating_count > 0" class="rating-count">({{ session.rating_count }})</span>
                          </span>
                          <button class="rate-btn" :class="{ rated: session.my_rating }"
                                  @click="openRatingPopup(session.id, $event)"
                                  :title="session.my_rating ? `Your rating: ${session.my_rating}/10` : 'Rate this recording'">
                            {{ session.my_rating ? session.my_rating : 'Rate' }}
                          </button>
                          <div v-if="ratingPopupId === session.id" class="rating-popup" @click.stop>
                            <div class="popup-label">Your rating</div>
                            <div class="popup-numbers">
                              <button v-for="n in 10" :key="n" class="popup-num"
                                      :class="{ selected: session.my_rating === n }"
                                      @click="submitRating(session, n)">{{ n }}</button>
                            </div>
                            <button v-if="session.my_rating" class="popup-clear" @click="submitRating(session, null)">
                              Clear rating
                            </button>
                          </div>
                        </div>
                      </td>
                      <td>
                        <button class="delete-btn" @click="deleteSession(session.id)" title="Delete">✕</button>
                      </td>
                    </tr>
                    <tr v-if="playingId === session.id" class="player-row">
                      <td colspan="6">
                        <audio ref="audioEl" :src="`/api/sessions/${playingId}/stream`"
                               @play="onAudioPlay" @pause="onAudioPause" @ended="onAudioEnded"
                               @loadedmetadata="onAudioMetadata"
                               controls preload="metadata"></audio>
                      </td>
                    </tr>
                    </template>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Band Members -->
      <div class="indiv-section-heading">Band Members</div>
      <div class="card sessions-card">
        <div class="sessions-header">
          <h2 class="card-title">Band Members' Recordings <span class="count">({{ filteredBandMemberSessions.length }})</span></h2>
          <div class="bm-filters">
            <select v-model="bandMemberBandFilter" class="bm-band-select">
              <option value="">All Bands</option>
              <option v-for="b in bandMemberBands" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>
            <div v-if="bandMemberAvailableYears.length > 0" class="year-tabs">
              <button class="year-tab" :class="{ active: bandMemberSelectedYear === null }" @click="bandMemberSelectedYear = null">All</button>
              <button v-for="year in bandMemberAvailableYears" :key="year"
                      class="year-tab" :class="{ active: bandMemberSelectedYear === year }"
                      @click="bandMemberSelectedYear = year">{{ year }}</button>
            </div>
          </div>
        </div>

        <div v-if="filteredBandMemberSessions.length === 0" class="empty-state">
          No band member recordings yet.
        </div>

        <div v-else>
          <div v-for="group in bandMemberYearGroups" :key="group.year" class="year-group">
            <div v-if="bandMemberSelectedYear === null" class="year-heading">{{ group.year }}</div>
            <div v-for="mgroup in group.months" :key="mgroup.key" class="month-group">
              <button class="month-heading" @click="toggleMonth(mgroup.key)">
                <span class="month-chevron">{{ collapsedMonths.has(mgroup.key) ? '▶' : '▼' }}</span>
                {{ mgroup.label }}
                <span class="month-count">{{ mgroup.items.length }}</span>
              </button>
              <div v-if="!collapsedMonths.has(mgroup.key)" class="table-wrapper">
                <table class="sessions-table">
                  <thead>
                    <tr>
                      <th class="col-play"></th>
                      <th>Name</th>
                      <th>Recorded</th>
                      <th>Size</th>
                      <th>Rating</th>
                      <th>Band</th>
                    </tr>
                  </thead>
                  <tbody>
                    <template v-for="session in mgroup.items" :key="session.id">
                    <tr :class="{ playing: playingId === session.id }">
                      <td class="col-play">
                        <button class="play-btn" @click="togglePlay(session)"
                                :title="playingId === session.id && isPlaying ? 'Pause' : 'Play'">
                          {{ playingId === session.id && isPlaying ? '⏸' : '▶' }}
                        </button>
                      </td>
                      <td class="col-name">
                        <span class="session-name-text">{{ session.name }}</span>
                        <span v-if="session.instrument_name" class="session-sub">{{ session.instrument_name }}</span>
                        <span v-if="session.uploader_handle" class="session-sub muted">@{{ session.uploader_handle }}</span>
                      </td>
                      <td>{{ session.recorded_at ? session.recorded_at.slice(0, 10) : '—' }}</td>
                      <td class="muted">{{ formatBytes(session.file_size) }}</td>
                      <td class="col-rating">
                        <div class="rating-cell" @click.stop>
                          <span class="avg-rating" :class="{ unrated: !session.avg_rating }">
                            {{ session.avg_rating ? `★ ${session.avg_rating}` : '★ —' }}
                            <span v-if="session.rating_count > 0" class="rating-count">({{ session.rating_count }})</span>
                          </span>
                          <button class="rate-btn" :class="{ rated: session.my_rating }"
                                  @click="openBmRatingPopup(session.id, $event)"
                                  :title="session.my_rating ? `Your rating: ${session.my_rating}/10` : 'Rate this recording'">
                            {{ session.my_rating ? session.my_rating : 'Rate' }}
                          </button>
                          <div v-if="bmRatingPopupId === session.id" class="rating-popup" @click.stop>
                            <div class="popup-label">Your rating</div>
                            <div class="popup-numbers">
                              <button v-for="n in 10" :key="n" class="popup-num"
                                      :class="{ selected: session.my_rating === n }"
                                      @click="submitBandMemberRating(session, n)">{{ n }}</button>
                            </div>
                            <button v-if="session.my_rating" class="popup-clear" @click="submitBandMemberRating(session, null)">
                              Clear rating
                            </button>
                          </div>
                        </div>
                      </td>
                      <td class="muted">{{ session.band_name || '—' }}</td>
                    </tr>
                    <tr v-if="playingId === session.id" class="player-row">
                      <td colspan="6">
                        <audio ref="audioEl" :src="`/api/sessions/${playingId}/stream`"
                               @play="onAudioPlay" @pause="onAudioPause" @ended="onAudioEnded"
                               @loadedmetadata="onAudioMetadata"
                               controls preload="metadata"></audio>
                      </td>
                    </tr>
                    </template>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Mashups -->
      <div class="indiv-section-heading">Mashups</div>
      <div class="card mashup-card">

        <!-- Step 1: source selector -->
        <div class="field mashup-source-field">
          <label class="field-label">Choose a backing track source</label>
          <select v-model="mashupSource" class="text-input" @change="mashupSelectedSession = null; mashupSearch = ''"
                  :disabled="recordingFor === 'mashup'">
            <option value="">— select source —</option>
            <option value="own">Your Previous Recordings</option>
            <option v-for="b in activeBands" :key="b.id" :value="`band-${b.id}`">{{ b.name }}</option>
          </select>
        </div>

        <!-- Step 2: pick a recording -->
        <template v-if="mashupSource && !mashupSelectedSession">
          <div v-if="mashupSourceSessions.length === 0" class="empty-state" style="padding: 20px 0;">
            No recordings available from this source.
          </div>
          <template v-else>
            <input v-model="mashupSearch" class="text-input mashup-search" placeholder="Search recordings…" />
            <div class="mashup-pick-list">
              <div v-for="s in filteredMashupSessions" :key="s.id"
                   class="mashup-pick-item" @click="mashupSelectedSession = s">
                <span class="mashup-pick-name">{{ s.name }}</span>
                <div class="mashup-pick-meta">
                  <span v-if="s.uploader_handle" class="session-sub muted">@{{ s.uploader_handle }}</span>
                  <span class="session-sub muted">{{ formatDate(sessionDate(s)) }}</span>
                </div>
              </div>
              <div v-if="filteredMashupSessions.length === 0" class="empty-state" style="padding: 16px 0;">
                No matches.
              </div>
            </div>
          </template>
        </template>

        <!-- Step 3: selected backing track + record form -->
        <template v-if="mashupSelectedSession">
          <div class="mashup-backing-track">
            <div class="mashup-backing-label">Backing track</div>
            <div class="mashup-backing-name">{{ mashupSelectedSession.name }}</div>
            <div v-if="mashupSelectedSession.uploader_handle" class="session-sub muted" style="margin-bottom: 4px;">
              @{{ mashupSelectedSession.uploader_handle }}
            </div>
            <audio ref="mashupBackingAudioEl"
                   :src="`/api/sessions/${mashupSelectedSession.id}/stream`"
                   preload="metadata" style="display:none;"></audio>
            <button class="btn-ghost btn-sm mashup-change-btn"
                    :disabled="recordingFor === 'mashup'"
                    @click="mashupSelectedSession = null; mashupFile = null; mashupName = ''; if (mashupPreviewUrl) { URL.revokeObjectURL(mashupPreviewUrl); mashupPreviewUrl = null }">
              ← Change track
            </button>
          </div>

          <div class="mashup-divider"></div>

          <div class="upload-form">
            <div class="file-row">
              <template v-if="recordingFor === 'mashup'">
                <span class="rec-indicator">● {{ formatRecordingTime(recordingSeconds) }}</span>
                <div class="level-meter" title="Input level"><div class="level-fill" :style="{ width: audioLevel + '%' }"></div></div>
                <button class="rec-stop-btn" @click="stopMashupRecording">Stop</button>
              </template>
              <template v-else>
                <select v-if="micDevices.length > 0" v-model="selectedMicId" class="mic-select"
                        :disabled="mashupUploading" title="Select microphone">
                  <option value="">Default mic</option>
                  <option v-for="d in micDevices" :key="d.deviceId" :value="d.deviceId">
                    {{ d.label || `Mic ${d.deviceId.slice(0,6)}…` }}
                  </option>
                </select>
                <button class="rec-btn mashup-rec-btn"
                        :disabled="recordingFor !== null || mashupUploading"
                        @click="startMashupRecording"
                        title="Record from mic while backing track plays">
                  🎙 Record and Play
                </button>
              </template>
            </div>

            <div v-if="mashupPreviewUrl && !recordingFor" class="recording-preview">
              <span class="preview-label">Preview recording:</span>
              <audio controls :src="mashupPreviewUrl" style="height:32px;"></audio>
            </div>

            <div class="fields-row">
              <div class="field">
                <label class="field-label">Name</label>
                <input v-model="mashupName" type="text" class="text-input"
                       placeholder="Recording name" :disabled="mashupUploading" />
              </div>
              <div class="field">
                <label class="field-label">Original recording date <span class="optional">(optional)</span></label>
                <input v-model="mashupRecordedAt" type="date" class="text-input" :disabled="mashupUploading" />
              </div>
              <div class="field">
                <label class="field-label">Instrument <span class="optional">(optional)</span></label>
                <select v-model="mashupInstrumentId" class="text-input" :disabled="mashupUploading">
                  <option value="">— select instrument —</option>
                  <option v-for="inst in instruments" :key="inst.id" :value="inst.id">{{ inst.name }}</option>
                </select>
              </div>
              <div class="field">
                <label class="field-label">Band <span class="optional">(optional)</span></label>
                <select v-model="mashupBandId" class="text-input" :disabled="mashupUploading">
                  <option value="">— no band —</option>
                  <option v-for="b in activeBands" :key="b.id" :value="b.id">{{ b.name }}</option>
                </select>
              </div>
            </div>

            <p v-if="mashupUploadError" class="error-msg">{{ mashupUploadError }}</p>
            <button class="upload-btn" @click="handleMashupUpload" :disabled="!mashupFile || mashupUploading">
              {{ mashupUploading ? 'Uploading…' : 'Upload' }}
            </button>
          </div>
        </template>

      </div>

    </template>

    <!-- Bands tab -->
    <div v-if="activeTab === 'bands'" class="bands-area">
      <div v-if="bandsError" class="error-msg">{{ bandsError }}</div>

      <!-- Two-column layout: band list + detail pane -->
      <div class="bands-layout">

        <!-- Left: band list -->
        <div class="bands-list-col">
          <div class="bands-list-header">
            <h2 class="card-title">Your Bands</h2>
            <button class="btn-primary btn-sm" @click="showCreateBand = !showCreateBand; createBandError = null">
              {{ showCreateBand ? 'Cancel' : '+ New Band' }}
            </button>
          </div>

          <!-- Create band form -->
          <div v-if="showCreateBand" class="card create-band-card">
            <h3 class="form-section-title">Create a Band</h3>
            <div v-if="createBandError" class="error-msg">{{ createBandError }}</div>
            <label class="field-label">Band Name <span class="required">*</span></label>
            <input v-model="newBandName" class="text-input" placeholder="e.g. The Midnight Riffs" maxlength="100" @keyup.enter="createBand" />
            <label class="field-label">Description <span class="optional">(optional)</span></label>
            <textarea v-model="newBandDescription" class="text-input textarea" placeholder="What's this band about?" rows="3" maxlength="500" />
            <button class="btn-primary" :disabled="creatingBand || !newBandName.trim()" @click="createBand">
              {{ creatingBand ? 'Creating…' : 'Create Band' }}
            </button>
          </div>

          <!-- Pending invites -->
          <template v-if="bands.filter(b => b.status === 'invited').length > 0">
            <p class="list-section-label">Pending Invites</p>
            <div v-for="b in bands.filter(b => b.status === 'invited')" :key="b.id" class="band-invite-card card">
              <div class="band-invite-name">{{ b.name }}</div>
              <div class="band-invite-actions">
                <button class="btn-primary btn-sm" @click="respondToInvite(b.id, 'accept')">Accept</button>
                <button class="btn-ghost btn-sm" @click="respondToInvite(b.id, 'decline')">Decline</button>
              </div>
            </div>
          </template>

          <!-- Active bands -->
          <p class="list-section-label">{{ bands.filter(b => b.status === 'active').length > 0 ? 'My Bands' : '' }}</p>
          <div v-if="bandsLoading" class="empty-state">Loading…</div>
          <div v-else-if="bands.filter(b => b.status === 'active').length === 0 && !showCreateBand" class="empty-state">
            You are not in any bands yet.<br>Create one or wait for an invite.
          </div>
          <div
            v-for="b in bands.filter(b => b.status === 'active')"
            :key="b.id"
            class="band-list-item"
            :class="{ selected: activeBand?.id === b.id }"
            @click="loadBandDetail(b.id)"
          >
            <div class="band-list-name">{{ b.name }}</div>
            <div class="band-list-meta">{{ b.member_count }} member{{ b.member_count !== 1 ? 's' : '' }} &middot; {{ b.role }}</div>
          </div>
        </div>

        <!-- Right: band detail -->
        <div class="bands-detail-col">
          <div v-if="activeBandLoading" class="empty-state">Loading…</div>

          <div v-else-if="activeBand" class="card band-detail-card">
            <!-- Band name (editable for owners) -->
            <div class="band-detail-header">
              <div v-if="editingBandName" class="band-name-edit">
                <input v-model="editBandNameValue" class="text-input" @keyup.enter="saveBandName" @keyup.escape="editingBandName = false" />
                <button class="btn-primary btn-sm" @click="saveBandName">Save</button>
                <button class="btn-ghost btn-sm" @click="editingBandName = false">Cancel</button>
              </div>
              <div v-else class="band-name-row">
                <h2 class="band-detail-name">{{ activeBand.name }}</h2>
                <button v-if="activeBand.my_role === 'owner'" class="btn-ghost btn-sm" @click="startEditBandName">Edit</button>
                <button v-if="activeBand.my_role === 'owner'" class="btn-danger btn-sm" @click="deleteBand(activeBand.id)">Delete Band</button>
              </div>
              <p v-if="activeBand.description" class="band-description">{{ activeBand.description }}</p>
            </div>

            <!-- Members -->
            <h3 class="form-section-title">Members</h3>
            <div class="members-list">
              <div v-for="m in activeBand.members" :key="m.id" class="member-row">
                <div class="member-info">
                  <div class="member-name-line">
                    <span class="member-handle">@{{ m.handle }}</span>
                    <span v-if="m.first_name" class="member-name">{{ m.first_name }} {{ m.last_name }}</span>
                  </div>
                  <div class="member-badges">
                    <span class="member-role-badge" :class="m.role">{{ m.role }}</span>
                    <span v-if="m.status === 'invited'" class="member-role-badge invited">invited</span>
                  </div>
                </div>
                <button
                  v-if="activeBand.my_role === 'owner' && m.role !== 'owner'"
                  class="btn-ghost btn-sm btn-remove"
                  @click="removeMember(m.id)"
                >Remove</button>
              </div>
              <div v-if="activeBand.members.length === 0" class="empty-state-sm">No members yet.</div>
            </div>

            <!-- Invite form (owners only) -->
            <div v-if="activeBand.my_role === 'owner'" class="invite-section">
              <h3 class="form-section-title">Invite a Member</h3>
              <div v-if="inviteError" class="error-msg">{{ inviteError }}</div>
              <div v-if="inviteSuccess" class="success-msg">{{ inviteSuccess }}</div>
              <div class="invite-row">
                <input v-model="inviteHandle" class="text-input" placeholder="@handle" @keyup.enter="inviteMember" />
                <button class="btn-primary" :disabled="inviting || !inviteHandle.trim()" @click="inviteMember">
                  {{ inviting ? 'Inviting…' : 'Send Invite' }}
                </button>
              </div>
            </div>
          </div>

          <div v-else class="empty-state bands-empty-detail">
            Select a band to view details.
          </div>
        </div>
      </div>
    </div>

    <!-- Upload Card (Band Practice) -->
    <template v-if="activeTab === 'band'">
    <div class="card upload-card">
      <h2 class="card-title">Upload Recording</h2>
      <div class="upload-form">
        <div class="file-row">
          <input ref="fileInput" type="file" accept="audio/*" @change="onFileSelect"
                 class="file-input" id="audio-file" :disabled="uploading || recordingFor !== null" />
          <label for="audio-file" class="file-label" :class="{ 'has-file': selectedFile, 'disabled': recordingFor !== null }">
            {{ selectedFile ? selectedFile.name : 'Choose audio file…' }}
          </label>
          <template v-if="recordingFor === 'band'">
            <span class="rec-indicator">● {{ formatRecordingTime(recordingSeconds) }}</span>
            <div class="level-meter" title="Input level"><div class="level-fill" :style="{ width: audioLevel + '%' }"></div></div>
            <button class="rec-stop-btn" @click="stopRecording">Stop</button>
          </template>
          <template v-else>
            <select v-if="micDevices.length > 0" v-model="selectedMicId" class="mic-select" :disabled="uploading" title="Select microphone">
              <option value="">Default mic</option>
              <option v-for="d in micDevices" :key="d.deviceId" :value="d.deviceId">{{ d.label || `Mic ${d.deviceId.slice(0,6)}…` }}</option>
            </select>
            <button class="rec-btn" :disabled="recordingFor !== null || uploading"
                    @click="startRecording('band')" title="Record from microphone">
              🎙 Record
            </button>
          </template>
        </div>
        <div class="fields-row">
          <div class="field">
            <label class="field-label">Name</label>
            <input v-model="sessionName" type="text" class="text-input"
                   placeholder="Session name" :disabled="uploading" />
          </div>
          <div class="field">
            <label class="field-label">Original recording date <span class="optional">(optional)</span></label>
            <input v-model="recordedAt" type="date" class="text-input" :disabled="uploading" />
          </div>
          <div class="field">
            <label class="field-label">Band <span class="optional">(optional)</span></label>
            <select v-model="uploadBandId" class="text-input" :disabled="uploading">
              <option value="">— no band —</option>
              <option v-for="b in activeBands" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>
          </div>
        </div>
        <div v-if="recordingPreviewUrl && !recordingFor" class="recording-preview">
          <span class="preview-label">Preview recording:</span>
          <audio controls :src="recordingPreviewUrl" style="height:32px;"></audio>
        </div>
        <p v-if="uploadError" class="error-msg">{{ uploadError }}</p>
        <button class="upload-btn" @click="handleUpload" :disabled="!selectedFile || uploading">
          {{ uploading ? 'Uploading…' : 'Upload' }}
        </button>
      </div>
    </div>

    <!-- Sessions Card -->
    <div class="card sessions-card">
      <div class="sessions-header">
        <h2 class="card-title">Your Sessions <span class="count">({{ bandSessions.length }})</span></h2>
        <div v-if="availableYears.length > 0" class="year-tabs">
          <button class="year-tab" :class="{ active: selectedYear === null }" @click="selectedYear = null">All</button>
          <button v-for="year in availableYears" :key="year"
                  class="year-tab" :class="{ active: selectedYear === year }"
                  @click="selectedYear = year">{{ year }}</button>
        </div>
      </div>

      <div v-if="bandSessions.length === 0" class="empty-state">
        No sessions yet. Upload a recording above.
      </div>

      <div v-else>
        <div v-for="group in yearGroups" :key="group.year" class="year-group">
          <div v-if="selectedYear === null" class="year-heading">{{ group.year }}</div>

          <div v-for="mgroup in group.months" :key="mgroup.key" class="month-group">
            <button class="month-heading" @click="toggleMonth(mgroup.key)">
              <span class="month-chevron">{{ collapsedMonths.has(mgroup.key) ? '▶' : '▼' }}</span>
              {{ mgroup.label }}
              <span class="month-count">{{ mgroup.items.length }}</span>
            </button>

            <div v-if="!collapsedMonths.has(mgroup.key)" class="table-wrapper">
              <table class="sessions-table">
                <thead>
                  <tr>
                    <th class="col-play"></th>
                    <th>Name</th>
                    <th>Recorded</th>
                    <th>Size</th>
                    <th>Rating</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="session in mgroup.items" :key="session.id">
                  <tr :class="{ playing: playingId === session.id }">
                    <td class="col-play">
                      <button class="play-btn" @click="togglePlay(session)"
                              :title="playingId === session.id && isPlaying ? 'Pause' : 'Play'">
                        {{ playingId === session.id && isPlaying ? '⏸' : '▶' }}
                      </button>
                    </td>
                    <td class="col-name">
                      <input type="text" class="inline-edit" :value="session.name"
                             @blur="e => saveName(session, e.target.value)"
                             @keydown.enter="e => e.target.blur()" />
                      <select class="inline-edit band-select"
                              :value="session.band_id || ''"
                              @change="e => saveBand(session, e.target.value)">
                        <option value="">— no band —</option>
                        <option v-for="b in activeBands" :key="b.id" :value="b.id">{{ b.name }}</option>
                      </select>
                    </td>
                    <td>
                      <input type="date" class="inline-edit date-edit"
                             :value="session.recorded_at ? session.recorded_at.slice(0, 10) : ''"
                             @change="e => saveRecordedAt(session, e.target.value)" />
                    </td>
                    <td class="muted">{{ formatBytes(session.file_size) }}</td>
                    <td class="col-rating">
                      <div class="rating-cell" @click.stop>
                        <!-- Average display -->
                        <span class="avg-rating" :class="{ unrated: !session.avg_rating }">
                          {{ session.avg_rating ? `★ ${session.avg_rating}` : '★ —' }}
                          <span v-if="session.rating_count > 0" class="rating-count">({{ session.rating_count }})</span>
                        </span>
                        <!-- Rate button -->
                        <button class="rate-btn" :class="{ rated: session.my_rating }"
                                @click="openRatingPopup(session.id, $event)"
                                :title="session.my_rating ? `Your rating: ${session.my_rating}/10` : 'Rate this session'">
                          {{ session.my_rating ? session.my_rating : 'Rate' }}
                        </button>
                        <!-- Popup -->
                        <div v-if="ratingPopupId === session.id" class="rating-popup" @click.stop>
                          <div class="popup-label">Your rating</div>
                          <div class="popup-numbers">
                            <button v-for="n in 10" :key="n"
                                    class="popup-num"
                                    :class="{ selected: session.my_rating === n }"
                                    @click="submitRating(session, n)">{{ n }}</button>
                          </div>
                          <button v-if="session.my_rating" class="popup-clear" @click="submitRating(session, null)">
                            Clear rating
                          </button>
                        </div>
                      </div>
                    </td>
                    <td>
                      <button class="delete-btn" @click="deleteSession(session.id)" title="Delete">✕</button>
                    </td>
                  </tr>
                  <tr v-if="playingId === session.id" class="player-row">
                    <td colspan="6">
                      <audio ref="audioEl" :src="`/api/sessions/${playingId}/stream`"
                             @play="onAudioPlay" @pause="onAudioPause" @ended="onAudioEnded"
                             @loadedmetadata="onAudioMetadata"
                             controls preload="metadata"></audio>
                    </td>
                  </tr>
                  </template>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>

    </template>

  </div>
</template>

<style scoped>
.sessions-page { max-width: 1000px; padding-bottom: 100px; }

.page-header { margin-bottom: 28px; }
.page-header h1 { font-size: 2.2rem; font-weight: 700; color: var(--color-accent); margin: 0 0 8px; }
.subtitle { color: var(--color-text-muted); margin: 0; font-size: 1.1rem; }

.card { background: var(--color-background-card); border-radius: var(--card-radius); padding: 24px; box-shadow: var(--shadow-sm); margin-bottom: 24px; }
.card-title { font-size: 1.1rem; font-weight: 600; color: var(--color-text); margin: 0 0 20px; }
.count { font-weight: 400; color: var(--color-text-muted); font-size: 0.95rem; }

/* Upload */
.upload-form { display: flex; flex-direction: column; gap: 16px; }
.file-row { display: flex; }
.file-input { display: none; }
.file-label { display: inline-block; padding: 10px 18px; border: 1px dashed var(--color-border, #555); border-radius: 6px; cursor: pointer; color: var(--color-text-muted); font-size: 0.95rem; transition: border-color 0.15s, color 0.15s; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-label:hover { border-color: var(--color-accent); color: var(--color-accent); }
.file-label.has-file { color: var(--color-text); border-style: solid; border-color: var(--color-accent); }
.fields-row { display: flex; gap: 16px; flex-wrap: wrap; }
.field { flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 0.85rem; color: var(--color-text-muted); font-weight: 500; }
.optional { font-weight: 400; opacity: 0.7; }
.text-input { background: var(--color-background-input, var(--color-background)); border: 1px solid var(--color-border, #555); border-radius: 6px; padding: 8px 12px; color: var(--color-text); font-size: 0.95rem; width: 100%; box-sizing: border-box; }
.text-input:focus { outline: none; border-color: var(--color-accent); }
.error-msg { color: #e05555; font-size: 0.9rem; margin: 0; }
.upload-btn { align-self: flex-start; background: var(--color-accent); color: #fff; border: none; border-radius: 6px; padding: 10px 24px; font-size: 0.95rem; font-weight: 600; cursor: pointer; transition: opacity 0.15s; }
.upload-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.upload-btn:not(:disabled):hover { opacity: 0.85; }

/* Recording controls */
.file-row { align-items: center; gap: 10px; }
.file-label.disabled { opacity: 0.4; pointer-events: none; }
.mic-select { background: var(--color-bg-input, #2a2a2a); border: 1px solid var(--color-border, #555); border-radius: 6px; padding: 8px 10px; font-size: 0.85rem; color: var(--color-text-muted); cursor: pointer; flex-shrink: 0; max-width: 180px; }
.recording-preview { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.preview-label { font-size: 0.85rem; color: var(--color-text-muted); white-space: nowrap; }
.rec-btn { background: none; border: 1px solid var(--color-border, #555); border-radius: 6px; padding: 9px 14px; font-size: 0.9rem; color: var(--color-text-muted); cursor: pointer; white-space: nowrap; transition: all 0.15s; flex-shrink: 0; }
.rec-btn:not(:disabled):hover { border-color: #e05555; color: #e05555; }
.rec-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.rec-indicator { color: #e05555; font-weight: 700; font-size: 0.9rem; white-space: nowrap; flex-shrink: 0; animation: rec-pulse 1s ease-in-out infinite; }
@keyframes rec-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
.rec-stop-btn { background: #e05555; color: #fff; border: none; border-radius: 6px; padding: 9px 14px; font-size: 0.9rem; font-weight: 600; cursor: pointer; white-space: nowrap; flex-shrink: 0; transition: opacity 0.15s; }
.rec-stop-btn:hover { opacity: 0.85; }
.level-meter { width: 80px; height: 10px; background: var(--color-border, #444); border-radius: 5px; overflow: hidden; flex-shrink: 0; }
.level-fill { height: 100%; background: #4caf50; border-radius: 5px; transition: width 0.05s linear; }

/* Sessions header */
.sessions-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
.sessions-header .card-title { margin: 0; }
.year-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.year-tab { background: none; border: 1px solid var(--color-border, #555); border-radius: 20px; padding: 4px 14px; font-size: 0.85rem; color: var(--color-text-muted); cursor: pointer; transition: all 0.15s; }
.year-tab:hover { border-color: var(--color-accent); color: var(--color-accent); }
.year-tab.active { background: var(--color-accent); border-color: var(--color-accent); color: #fff; }

/* Grouping */
.year-heading { font-size: 1.1rem; font-weight: 700; color: var(--color-text); margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--color-border, #444); }
.year-group:first-child .year-heading { margin-top: 0; }
.month-heading { display: flex; align-items: center; gap: 8px; background: none; border: none; color: var(--color-text-muted); font-size: 0.9rem; font-weight: 600; cursor: pointer; padding: 8px 0; width: 100%; text-align: left; }
.month-heading:hover { color: var(--color-text); }
.month-chevron { font-size: 0.65rem; }
.month-count { margin-left: auto; font-size: 0.8rem; font-weight: 400; background: var(--color-background, #333); border-radius: 10px; padding: 1px 8px; }

/* Table */
.table-wrapper { overflow-x: auto; margin-bottom: 4px; }
.sessions-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
.sessions-table th { text-align: left; padding: 6px 10px; color: var(--color-text-muted); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid var(--color-border, #444); }
.sessions-table td { padding: 8px 10px; border-bottom: 1px solid var(--color-border, #2a2a2a); vertical-align: middle; }
.sessions-table tr:last-child td { border-bottom: none; }
.sessions-table tr.playing td { background: rgba(100, 180, 100, 0.06); }

.col-play { width: 36px; }
.play-btn { background: none; border: 1px solid var(--color-border, #555); border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--color-text-muted); font-size: 0.7rem; transition: all 0.15s; }
.play-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }

.inline-edit { background: transparent; border: 1px solid transparent; border-radius: 4px; padding: 3px 6px; color: var(--color-text); font-size: 0.88rem; width: 100%; box-sizing: border-box; transition: border-color 0.15s, background 0.15s; }
.inline-edit:hover { border-color: var(--color-border, #555); }
.inline-edit:focus { outline: none; border-color: var(--color-accent); background: var(--color-background-input, var(--color-background)); }
.date-edit { min-width: 120px; }
.muted { color: var(--color-text-muted); white-space: nowrap; }

/* Rating cell */
.col-rating { white-space: nowrap; }
.rating-cell { display: inline-flex; align-items: center; gap: 8px; position: relative; }

.avg-rating { font-size: 0.85rem; color: var(--color-accent); font-weight: 600; white-space: nowrap; }
.avg-rating.unrated { color: var(--color-text-muted); font-weight: 400; }
.rating-count { font-size: 0.75rem; font-weight: 400; color: var(--color-text-muted); }

.rate-btn { background: none; border: 1px solid var(--color-border, #555); border-radius: 4px; padding: 2px 8px; font-size: 0.8rem; color: var(--color-text-muted); cursor: pointer; transition: all 0.15s; white-space: nowrap; }
.rate-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }
.rate-btn.rated { border-color: var(--color-accent); color: var(--color-accent); font-weight: 600; }

/* Rating popup */
.rating-popup {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--color-background-card);
  border: 1px solid var(--color-border, #555);
  border-radius: 8px;
  padding: 12px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  z-index: 200;
  min-width: 200px;
}
.popup-label { font-size: 0.75rem; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
.popup-numbers { display: flex; gap: 4px; }
.popup-num { width: 24px; height: 24px; background: none; border: 1px solid var(--color-border, #555); border-radius: 4px; font-size: 0.8rem; color: var(--color-text-muted); cursor: pointer; padding: 0; transition: all 0.1s; }
.popup-num:hover { border-color: var(--color-accent); color: var(--color-accent); }
.popup-num.selected { background: var(--color-accent); border-color: var(--color-accent); color: #fff; font-weight: 600; }
.popup-clear { display: block; width: 100%; margin-top: 8px; background: none; border: none; color: var(--color-text-muted); font-size: 0.8rem; cursor: pointer; text-align: center; padding: 4px; }
.popup-clear:hover { color: #e05555; }

.delete-btn { background: none; border: none; color: var(--color-text-muted); cursor: pointer; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; transition: color 0.15s, background 0.15s; }
.delete-btn:hover { color: #e05555; background: rgba(224, 85, 85, 0.1); }

.empty-state { color: var(--color-text-muted); text-align: center; padding: 40px 0; font-size: 0.95rem; }

/* Inline player row */
.player-row td { padding: 6px 8px; background: var(--color-background-soft, #1e1e1e); border-top: none; }
.player-row audio { width: 100%; height: 36px; display: block; }
/* Two-layer name cell */
.col-name { min-width: 200px; }
.col-name .inline-edit { display: block; width: 100%; }
.band-select { margin-top: 4px; font-size: 0.8rem; color: var(--color-text-muted); background: transparent; border: none; border-bottom: 1px dashed var(--color-border); padding: 2px 0; width: 100%; cursor: pointer; }
.band-select:focus { outline: none; border-bottom-color: var(--color-accent); }
.band-select option { background: var(--color-background-card); color: var(--color-text); }


/* Section tabs */
.section-tabs { display: flex; gap: 0; margin-bottom: 24px; border-bottom: 2px solid var(--color-border, #444); }
.section-tab { background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -2px; padding: 10px 24px; font-size: 0.95rem; font-weight: 600; color: var(--color-text-muted); cursor: pointer; transition: color 0.15s, border-color 0.15s; }
.section-tab:hover { color: var(--color-text); }
.section-tab.active { color: var(--color-accent); border-bottom-color: var(--color-accent); }

/* Individual tab */
.indiv-section-heading { font-size: 1.1rem; font-weight: 700; color: var(--color-text); margin: 8px 0 12px; padding-left: 2px; border-left: 3px solid var(--color-accent); padding-left: 10px; }
.indiv-placeholder-card { padding: 32px 24px; }
.indiv-placeholder-msg { color: var(--color-text-muted); font-size: 0.95rem; margin: 0; }
.bm-filters { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.bm-band-select { background: var(--color-bg-input, #2a2a2a); border: 1px solid var(--color-border, #555); border-radius: 6px; padding: 5px 10px; font-size: 0.85rem; color: var(--color-text); }
.session-name-text { display: block; font-weight: 500; }
.session-sub { display: block; font-size: 0.8rem; color: var(--color-text-muted); }

/* Bands tab */
.bands-area { display: flex; flex-direction: column; gap: 16px; }
.bands-layout { display: grid; grid-template-columns: 280px 1fr; gap: 16px; align-items: start; }
@media (max-width: 768px) { .bands-layout { grid-template-columns: 1fr; } }

.bands-list-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.bands-list-header .card-title { margin: 0; }

.list-section-label { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-muted); margin: 16px 0 6px; }

.band-invite-card { padding: 12px 16px; margin-bottom: 8px; }
.band-invite-name { font-weight: 600; margin-bottom: 8px; }
.band-invite-actions { display: flex; gap: 8px; }

.band-list-item { padding: 12px 16px; border-radius: 8px; cursor: pointer; border: 1px solid var(--color-border); margin-bottom: 6px; transition: background 0.15s, border-color 0.15s; }
.band-list-item:hover { background: var(--color-background-card); }
.band-list-item.selected { border-color: var(--color-accent); background: var(--color-background-card); }
.band-list-name { font-weight: 600; }
.band-list-meta { font-size: 0.8rem; color: var(--color-text-muted); margin-top: 2px; }

.band-detail-card { padding: 24px; }
.band-detail-header { margin-bottom: 20px; }
.band-name-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.band-detail-name { margin: 0; font-size: 1.4rem; }
.band-name-edit { display: flex; align-items: center; gap: 8px; }
.band-description { color: var(--color-text-muted); margin: 8px 0 0; }

.members-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
.member-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: 6px; background: var(--color-background); }
.member-info { display: flex; flex-direction: column; gap: 3px; }
.member-name-line { display: flex; align-items: center; gap: 8px; }
.member-badges { display: flex; gap: 6px; }
.member-handle { font-weight: 600; }
.member-name { color: var(--color-text-muted); font-size: 0.9rem; }
.member-role-badge { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; padding: 2px 7px; border-radius: 99px; background: var(--color-border); color: var(--color-text-muted); }
.member-role-badge.owner { background: var(--color-accent); color: #fff; }
.member-role-badge.invited { background: transparent; border: 1px solid var(--color-text-muted); }
.empty-state-sm { color: var(--color-text-muted); font-size: 0.9rem; padding: 8px 0; }

.invite-section { border-top: 1px solid var(--color-border); padding-top: 20px; }
.invite-row { display: flex; gap: 10px; align-items: center; }
.invite-row .text-input { flex: 1; }

.create-band-card { padding: 20px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 10px; }
.form-section-title { font-size: 0.9rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-muted); margin: 0 0 4px; }
.textarea { resize: vertical; font-family: inherit; }
.required { color: var(--color-accent); }
.optional { color: var(--color-text-muted); font-weight: 400; font-size: 0.85em; }

.bands-empty-detail { padding: 60px 24px; text-align: center; }
.success-msg { color: #4caf50; font-size: 0.9rem; padding: 8px 12px; background: rgba(76,175,80,0.1); border-radius: 6px; }
.btn-danger { background: transparent; border: 1px solid #e53935; color: #e53935; }
.btn-danger:hover { background: rgba(229,57,53,0.1); }
.btn-remove { color: #e53935; border-color: #e53935; }

/* Mashups */
.mashup-card { display: flex; flex-direction: column; gap: 16px; }
.mashup-source-field { max-width: 320px; }
.mashup-search { margin-bottom: 4px; }
.mashup-pick-list { display: flex; flex-direction: column; gap: 4px; max-height: 280px; overflow-y: auto; border: 1px solid var(--color-border, #444); border-radius: 8px; padding: 6px; }
.mashup-pick-item { padding: 10px 12px; border-radius: 6px; cursor: pointer; transition: background 0.12s; }
.mashup-pick-item:hover { background: var(--color-background, #222); }
.mashup-pick-name { font-weight: 500; font-size: 0.9rem; }
.mashup-pick-meta { display: flex; gap: 10px; margin-top: 2px; }
.mashup-backing-track { background: var(--color-background, #1a1a1a); border: 1px solid var(--color-accent); border-radius: 8px; padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; }
.mashup-backing-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-accent); margin-bottom: 2px; }
.mashup-backing-name { font-weight: 600; font-size: 1rem; }
.mashup-change-btn { align-self: flex-start; margin-top: 6px; }
.mashup-divider { border: none; border-top: 1px solid var(--color-border, #444); margin: 0; }
.mashup-rec-btn { border-color: var(--color-accent); color: var(--color-accent); }
.mashup-rec-btn:not(:disabled):hover { background: var(--color-accent); color: #fff; border-color: var(--color-accent); }
</style>
