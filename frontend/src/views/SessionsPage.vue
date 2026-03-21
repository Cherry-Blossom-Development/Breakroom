<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { sessions } from '@/stores/sessions'

// --- Upload state ---
const uploading = ref(false)
const uploadError = ref(null)
const selectedFile = ref(null)
const sessionName = ref('')
const recordedAt = ref('')
const fileInput = ref(null)

// --- Playback state ---
const playingId = ref(null)
const audioEl = ref(null)
const isPlaying = ref(false)

// --- Grouping state ---
const selectedYear = ref(null)
const collapsedMonths = ref(new Set())

// --- Helpers ---
function sessionDate(s) {
  return s.recorded_at || s.uploaded_at
}

function sessionYear(s) {
  const d = sessionDate(s)
  return d ? new Date(d).getFullYear() : null
}

function sessionMonth(s) {
  const d = sessionDate(s)
  return d ? new Date(d).getMonth() : null // 0-indexed
}

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December']

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
  for (const s of sessions.list) {
    const y = sessionYear(s)
    if (y) years.add(y)
  }
  return Array.from(years).sort((a, b) => b - a)
})

// --- Grouped sessions ---
const yearGroups = computed(() => {
  const list = selectedYear.value
    ? sessions.list.filter(s => sessionYear(s) === selectedYear.value)
    : sessions.list

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

function isMonthCollapsed(key) {
  return collapsedMonths.value.has(key)
}

function toggleMonth(key) {
  const s = new Set(collapsedMonths.value)
  if (s.has(key)) s.delete(key)
  else s.add(key)
  collapsedMonths.value = s
}

// --- Playback ---
function playingSession() {
  return sessions.list.find(s => s.id === playingId.value) || null
}

async function togglePlay(session) {
  if (playingId.value === session.id) {
    if (isPlaying.value) audioEl.value.pause()
    else audioEl.value.play()
    return
  }
  playingId.value = session.id
  isPlaying.value = false
  await nextTick()
  audioEl.value.load()
  audioEl.value.play()
}

function onAudioPlay() { isPlaying.value = true }
function onAudioPause() { isPlaying.value = false }
function onAudioEnded() { isPlaying.value = false }

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
    await sessions.upload(selectedFile.value, sessionName.value || defaultName(), recordedAt.value || null)
    selectedFile.value = null
    sessionName.value = ''
    recordedAt.value = ''
    if (fileInput.value) fileInput.value.value = ''
  } catch (err) {
    uploadError.value = err.message
  } finally {
    uploading.value = false
  }
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

async function setRating(session, value) {
  const newRating = session.rating === value ? null : value
  try { await sessions.update(session.id, { rating: newRating }) }
  catch (err) { console.error('Failed to update rating:', err) }
}

async function deleteSession(id) {
  if (!confirm('Delete this session? This cannot be undone.')) return
  if (playingId.value === id) {
    audioEl.value?.pause()
    playingId.value = null
  }
  try { await sessions.remove(id) }
  catch (err) { console.error('Failed to delete session:', err) }
}

onMounted(async () => {
  await sessions.load()
  if (availableYears.value.length > 0) selectedYear.value = availableYears.value[0]
})
</script>

<template>
  <div class="page-container sessions-page">
    <header class="page-header">
      <h1>Sessions</h1>
      <p class="subtitle">Track and manage your recording sessions</p>
    </header>

    <!-- Upload Card -->
    <div class="card upload-card">
      <h2 class="card-title">Upload Recording</h2>
      <div class="upload-form">
        <div class="file-row">
          <input ref="fileInput" type="file" accept="audio/*" @change="onFileSelect"
                 class="file-input" id="audio-file" :disabled="uploading" />
          <label for="audio-file" class="file-label" :class="{ 'has-file': selectedFile }">
            {{ selectedFile ? selectedFile.name : 'Choose audio file…' }}
          </label>
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
        <h2 class="card-title">Your Sessions <span class="count">({{ sessions.list.length }})</span></h2>

        <!-- Year tabs -->
        <div v-if="availableYears.length > 0" class="year-tabs">
          <button
            class="year-tab"
            :class="{ active: selectedYear === null }"
            @click="selectedYear = null"
          >All</button>
          <button
            v-for="year in availableYears"
            :key="year"
            class="year-tab"
            :class="{ active: selectedYear === year }"
            @click="selectedYear = year"
          >{{ year }}</button>
        </div>
      </div>

      <div v-if="sessions.list.length === 0" class="empty-state">
        No sessions yet. Upload a recording above.
      </div>

      <div v-else>
        <div v-for="group in yearGroups" :key="group.year" class="year-group">
          <!-- Only show year header when viewing All -->
          <div v-if="selectedYear === null" class="year-heading">{{ group.year }}</div>

          <div v-for="mgroup in group.months" :key="mgroup.key" class="month-group">
            <button class="month-heading" @click="toggleMonth(mgroup.key)">
              <span class="month-chevron">{{ isMonthCollapsed(mgroup.key) ? '▶' : '▼' }}</span>
              {{ mgroup.label }}
              <span class="month-count">{{ mgroup.items.length }}</span>
            </button>

            <div v-if="!isMonthCollapsed(mgroup.key)" class="table-wrapper">
              <table class="sessions-table">
                <thead>
                  <tr>
                    <th class="col-play"></th>
                    <th>Name</th>
                    <th>Recorded</th>
                    <th>Uploaded</th>
                    <th>Size</th>
                    <th>Rating</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="session in mgroup.items" :key="session.id"
                      :class="{ playing: playingId === session.id }">
                    <td class="col-play">
                      <button class="play-btn" @click="togglePlay(session)"
                              :title="playingId === session.id && isPlaying ? 'Pause' : 'Play'">
                        {{ playingId === session.id && isPlaying ? '⏸' : '▶' }}
                      </button>
                    </td>
                    <td>
                      <input type="text" class="inline-edit" :value="session.name"
                             @blur="e => saveName(session, e.target.value)"
                             @keydown.enter="e => e.target.blur()" />
                    </td>
                    <td>
                      <input type="date" class="inline-edit date-edit"
                             :value="session.recorded_at ? session.recorded_at.slice(0, 10) : ''"
                             @change="e => saveRecordedAt(session, e.target.value)" />
                    </td>
                    <td class="muted">{{ formatDate(session.uploaded_at) }}</td>
                    <td class="muted">{{ formatBytes(session.file_size) }}</td>
                    <td class="col-rating">
                      <div class="rating-row">
                        <button
                          v-for="n in 10" :key="n"
                          class="rating-btn"
                          :class="{ filled: session.rating >= n }"
                          @click="setRating(session, n)"
                          :title="`Rate ${n}/10`"
                        >{{ n }}</button>
                      </div>
                    </td>
                    <td>
                      <button class="delete-btn" @click="deleteSession(session.id)" title="Delete">✕</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Now Playing bar -->
    <div v-if="playingId !== null" class="now-playing-bar">
      <audio
        ref="audioEl"
        :src="`/api/sessions/${playingId}/stream`"
        @play="onAudioPlay"
        @pause="onAudioPause"
        @ended="onAudioEnded"
        controls
        preload="metadata"
      ></audio>
      <div class="now-playing-info">
        <span class="now-playing-label">Now Playing</span>
        <span class="now-playing-name">{{ playingSession()?.name }}</span>
      </div>
      <button class="now-playing-close" @click="() => { audioEl.pause(); playingId = null }" title="Close player">✕</button>
    </div>
  </div>
</template>

<style scoped>
.sessions-page {
  max-width: 1000px;
  padding-bottom: 100px; /* space for now-playing bar */
}

.page-header { margin-bottom: 28px; }
.page-header h1 {
  font-size: 2.2rem;
  font-weight: 700;
  color: var(--color-accent);
  margin: 0 0 8px;
}
.subtitle { color: var(--color-text-muted); margin: 0; font-size: 1.1rem; }

.card {
  background: var(--color-background-card);
  border-radius: var(--card-radius);
  padding: 24px;
  box-shadow: var(--shadow-sm);
  margin-bottom: 24px;
}
.card-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-text);
  margin: 0 0 20px;
}
.count { font-weight: 400; color: var(--color-text-muted); font-size: 0.95rem; }

/* Upload */
.upload-form { display: flex; flex-direction: column; gap: 16px; }
.file-row { display: flex; }
.file-input { display: none; }
.file-label {
  display: inline-block;
  padding: 10px 18px;
  border: 1px dashed var(--color-border, #555);
  border-radius: 6px;
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: 0.95rem;
  transition: border-color 0.15s, color 0.15s;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-label:hover { border-color: var(--color-accent); color: var(--color-accent); }
.file-label.has-file { color: var(--color-text); border-style: solid; border-color: var(--color-accent); }
.fields-row { display: flex; gap: 16px; flex-wrap: wrap; }
.field { flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 0.85rem; color: var(--color-text-muted); font-weight: 500; }
.optional { font-weight: 400; opacity: 0.7; }
.text-input {
  background: var(--color-background-input, var(--color-background));
  border: 1px solid var(--color-border, #555);
  border-radius: 6px;
  padding: 8px 12px;
  color: var(--color-text);
  font-size: 0.95rem;
  width: 100%;
  box-sizing: border-box;
}
.text-input:focus { outline: none; border-color: var(--color-accent); }
.error-msg { color: #e05555; font-size: 0.9rem; margin: 0; }
.upload-btn {
  align-self: flex-start;
  background: var(--color-accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 10px 24px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.upload-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.upload-btn:not(:disabled):hover { opacity: 0.85; }

/* Sessions header */
.sessions-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}
.sessions-header .card-title { margin: 0; }

/* Year tabs */
.year-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.year-tab {
  background: none;
  border: 1px solid var(--color-border, #555);
  border-radius: 20px;
  padding: 4px 14px;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.year-tab:hover { border-color: var(--color-accent); color: var(--color-accent); }
.year-tab.active {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: #fff;
}

/* Year / month grouping */
.year-heading {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-text);
  margin: 20px 0 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--color-border, #444);
}
.year-group:first-child .year-heading { margin-top: 0; }

.month-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  padding: 8px 0;
  width: 100%;
  text-align: left;
}
.month-heading:hover { color: var(--color-text); }
.month-chevron { font-size: 0.65rem; }
.month-count {
  margin-left: auto;
  font-size: 0.8rem;
  font-weight: 400;
  color: var(--color-text-muted);
  background: var(--color-background, #333);
  border-radius: 10px;
  padding: 1px 8px;
}

/* Table */
.table-wrapper { overflow-x: auto; margin-bottom: 4px; }
.sessions-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}
.sessions-table th {
  text-align: left;
  padding: 6px 10px;
  color: var(--color-text-muted);
  font-weight: 600;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--color-border, #444);
}
.sessions-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border, #2a2a2a);
  vertical-align: middle;
}
.sessions-table tr:last-child td { border-bottom: none; }
.sessions-table tr.playing td { background: rgba(var(--color-accent-rgb, 100,180,100), 0.06); }

.col-play { width: 36px; }
.play-btn {
  background: none;
  border: 1px solid var(--color-border, #555);
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: 0.7rem;
  transition: all 0.15s;
}
.play-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }

.inline-edit {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 3px 6px;
  color: var(--color-text);
  font-size: 0.88rem;
  width: 100%;
  box-sizing: border-box;
  transition: border-color 0.15s, background 0.15s;
}
.inline-edit:hover { border-color: var(--color-border, #555); }
.inline-edit:focus {
  outline: none;
  border-color: var(--color-accent);
  background: var(--color-background-input, var(--color-background));
}
.date-edit { min-width: 120px; }
.muted { color: var(--color-text-muted); white-space: nowrap; }

/* Rating */
.col-rating { white-space: nowrap; }
.rating-row { display: flex; gap: 2px; }
.rating-btn {
  background: none;
  border: 1px solid var(--color-border, #555);
  border-radius: 3px;
  width: 20px;
  height: 20px;
  font-size: 0.65rem;
  cursor: pointer;
  color: var(--color-text-muted);
  padding: 0;
  transition: all 0.1s;
  line-height: 1;
}
.rating-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }
.rating-btn.filled {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: #fff;
}

.delete-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.8rem;
  transition: color 0.15s, background 0.15s;
}
.delete-btn:hover { color: #e05555; background: rgba(224, 85, 85, 0.1); }

.empty-state {
  color: var(--color-text-muted);
  text-align: center;
  padding: 40px 0;
  font-size: 0.95rem;
}

/* Now Playing bar */
.now-playing-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--color-background-card);
  border-top: 1px solid var(--color-border, #444);
  padding: 10px 24px;
  display: flex;
  align-items: center;
  gap: 16px;
  z-index: 100;
  box-shadow: 0 -2px 12px rgba(0,0,0,0.2);
}
.now-playing-bar audio { flex: 1; min-width: 0; height: 36px; }
.now-playing-info {
  display: flex;
  flex-direction: column;
  min-width: 140px;
  max-width: 220px;
}
.now-playing-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-accent);
  font-weight: 600;
}
.now-playing-name {
  font-size: 0.88rem;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.now-playing-close {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 1rem;
  padding: 4px 8px;
  border-radius: 4px;
}
.now-playing-close:hover { color: var(--color-text); }
</style>
