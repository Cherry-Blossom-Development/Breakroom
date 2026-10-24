<script setup>
// Musician Profile section (Greywire site only): music bio, instruments and
// bands. Read-only on public profiles; editable on the owner's profile page,
// where each change is saved straight away and the server sends back the
// whole updated profile (backend/routes/profile.js, migration 094).
import { ref, computed, nextTick } from 'vue'
import RichTextEditor from './RichTextEditor.vue'

const props = defineProps({
  musician: { type: Object, default: null },
  editable: { type: Boolean, default: false }
})

const emit = defineEmits(['update:musician'])

const SKILL_LEVELS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'professional', label: 'Professional' }
]

const data = computed(() => props.musician || { bio: '', musicianOnly: false, instruments: [], bands: [] })

const error = ref(null)

function showError(message) {
  error.value = message
  setTimeout(() => { error.value = null }, 4000)
}

// Every write returns { musician }; pass it up so the parent's copy stays current
async function send(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined
  })
  const result = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(result.message || 'Something went wrong')
  }
  emit('update:musician', result.musician)
}

function skillLabel(value) {
  return SKILL_LEVELS.find(s => s.value === value)?.label
}

function instrumentDetails(inst) {
  const parts = []
  if (inst.skillLevel) parts.push(skillLabel(inst.skillLevel))
  if (inst.yearsPlaying !== null && inst.yearsPlaying !== undefined) {
    parts.push(`${inst.yearsPlaying} ${inst.yearsPlaying === 1 ? 'year' : 'years'}`)
  }
  return parts.join(' · ')
}

function bandYears(band) {
  if (band.isCurrent) return band.startYear ? `${band.startYear} – Present` : 'Current'
  if (band.startYear && band.endYear) {
    return band.startYear === band.endYear ? `${band.startYear}` : `${band.startYear} – ${band.endYear}`
  }
  return band.startYear ? `From ${band.startYear}` : (band.endYear ? `Until ${band.endYear}` : '')
}

// Music bio and the musician-only setting
const isEditingBio = ref(false)
const bioDraft = ref('')
const isSavingBio = ref(false)
const isSavingSetting = ref(false)

function startBioEdit() {
  bioDraft.value = data.value.bio || ''
  isEditingBio.value = true
}

async function saveBio() {
  isSavingBio.value = true
  try {
    await send('/api/profile/musician', 'PUT', { bio: bioDraft.value, musicianOnly: data.value.musicianOnly })
    isEditingBio.value = false
  } catch (err) {
    showError(err.message)
  } finally {
    isSavingBio.value = false
  }
}

async function toggleMusicianOnly(event) {
  isSavingSetting.value = true
  try {
    await send('/api/profile/musician', 'PUT', { bio: data.value.bio, musicianOnly: event.target.checked })
  } catch (err) {
    event.target.checked = !event.target.checked
    showError(err.message)
  } finally {
    isSavingSetting.value = false
  }
}

// Instruments
const instrumentOptions = ref([])
const showInstrumentModal = ref(false)
const editingInstrument = ref(null)
const isSavingInstrument = ref(false)
const instrumentModalCloseBtn = ref(null)
const instrumentForm = ref({ instrumentId: '', skillLevel: '', yearsPlaying: '', isPrimary: false })

// Instruments not on the profile yet, for the Add dropdown
const availableInstruments = computed(() => {
  const taken = new Set(data.value.instruments.map(i => i.instrumentId))
  return instrumentOptions.value.filter(i => !taken.has(i.id))
})

async function loadInstrumentOptions() {
  if (instrumentOptions.value.length > 0) return
  try {
    const res = await fetch('/api/instruments', { credentials: 'include' })
    if (!res.ok) throw new Error()
    instrumentOptions.value = (await res.json()).instruments
  } catch {
    showError('Could not load the instrument list')
  }
}

async function openInstrumentModal(inst = null) {
  editingInstrument.value = inst
  instrumentForm.value = inst
    ? { instrumentId: inst.instrumentId, skillLevel: inst.skillLevel || '', yearsPlaying: inst.yearsPlaying ?? '', isPrimary: inst.isPrimary }
    : { instrumentId: '', skillLevel: '', yearsPlaying: '', isPrimary: data.value.instruments.length === 0 }
  showInstrumentModal.value = true
  if (!inst) loadInstrumentOptions()
  nextTick(() => instrumentModalCloseBtn.value?.focus())
}

function closeInstrumentModal() {
  showInstrumentModal.value = false
  editingInstrument.value = null
}

async function saveInstrument() {
  isSavingInstrument.value = true
  try {
    const body = {
      instrumentId: instrumentForm.value.instrumentId,
      skillLevel: instrumentForm.value.skillLevel || null,
      yearsPlaying: instrumentForm.value.yearsPlaying === '' ? null : instrumentForm.value.yearsPlaying,
      isPrimary: instrumentForm.value.isPrimary
    }
    if (editingInstrument.value) {
      await send(`/api/profile/musician/instruments/${editingInstrument.value.id}`, 'PUT', body)
    } else {
      await send('/api/profile/musician/instruments', 'POST', body)
    }
    closeInstrumentModal()
  } catch (err) {
    showError(err.message)
  } finally {
    isSavingInstrument.value = false
  }
}

async function removeInstrument(inst) {
  if (!confirm(`Remove ${inst.name} from your instruments?`)) return
  try {
    await send(`/api/profile/musician/instruments/${inst.id}`, 'DELETE')
  } catch (err) {
    showError(err.message)
  }
}

// Bands
const showBandModal = ref(false)
const editingBand = ref(null)
const isSavingBand = ref(false)
const bandModalCloseBtn = ref(null)
const bandForm = ref({ bandName: '', role: '', startYear: '', endYear: '', isCurrent: false })

function openBandModal(band = null) {
  editingBand.value = band
  bandForm.value = band
    ? { bandName: band.bandName, role: band.role || '', startYear: band.startYear ?? '', endYear: band.endYear ?? '', isCurrent: band.isCurrent }
    : { bandName: '', role: '', startYear: '', endYear: '', isCurrent: false }
  showBandModal.value = true
  nextTick(() => bandModalCloseBtn.value?.focus())
}

function closeBandModal() {
  showBandModal.value = false
  editingBand.value = null
}

async function saveBand() {
  isSavingBand.value = true
  try {
    const body = {
      bandName: bandForm.value.bandName,
      role: bandForm.value.role,
      startYear: bandForm.value.startYear === '' ? null : bandForm.value.startYear,
      endYear: bandForm.value.isCurrent || bandForm.value.endYear === '' ? null : bandForm.value.endYear,
      isCurrent: bandForm.value.isCurrent
    }
    if (editingBand.value) {
      await send(`/api/profile/musician/bands/${editingBand.value.id}`, 'PUT', body)
    } else {
      await send('/api/profile/musician/bands', 'POST', body)
    }
    closeBandModal()
  } catch (err) {
    showError(err.message)
  } finally {
    isSavingBand.value = false
  }
}

async function removeBand(band) {
  if (!confirm(`Remove ${band.bandName} from your bands?`)) return
  try {
    await send(`/api/profile/musician/bands/${band.id}`, 'DELETE')
  } catch (err) {
    showError(err.message)
  }
}

const currentYear = new Date().getFullYear()
</script>

<template>
  <section class="musician-profile" aria-labelledby="musician-profile-title">
    <h2 id="musician-profile-title" class="musician-title">Musician Profile</h2>

    <div v-if="error" class="musician-error" role="alert">{{ error }}</div>

    <label v-if="editable" class="musician-only-toggle">
      <input
        type="checkbox"
        :checked="data.musicianOnly"
        :disabled="isSavingSetting"
        @change="toggleMusicianOnly"
      />
      <span>Show only my Musician Profile to others on Greywire</span>
    </label>

    <!-- Instruments -->
    <div class="musician-block">
      <div class="block-header">
        <h3>Instruments</h3>
        <button v-if="editable" @click="openInstrumentModal()" class="add-btn">+ Add Instrument</button>
      </div>
      <ul v-if="data.instruments.length > 0" class="instrument-list">
        <li v-for="inst in data.instruments" :key="inst.id" class="instrument-item">
          <div class="instrument-text">
            <span class="instrument-name">{{ inst.name }}</span>
            <span v-if="inst.isPrimary" class="primary-badge">Main</span>
            <span v-if="instrumentDetails(inst)" class="instrument-details">{{ instrumentDetails(inst) }}</span>
          </div>
          <div v-if="editable" class="item-actions">
            <button @click="openInstrumentModal(inst)" class="item-action-btn" title="Edit" :aria-label="`Edit ${inst.name}`">✎</button>
            <button @click="removeInstrument(inst)" class="item-action-btn delete" title="Remove" :aria-label="`Remove ${inst.name}`">&times;</button>
          </div>
        </li>
      </ul>
      <p v-else class="empty-text">{{ editable ? 'No instruments yet. Add the ones you play.' : 'No instruments listed yet.' }}</p>
    </div>

    <!-- Bands -->
    <div class="musician-block">
      <div class="block-header">
        <h3>Bands</h3>
        <button v-if="editable" @click="openBandModal()" class="add-btn">+ Add Band</button>
      </div>
      <div v-if="data.bands.length > 0" class="band-list">
        <div v-for="band in data.bands" :key="band.id" class="band-card">
          <div class="band-header">
            <div>
              <h4>{{ band.bandName }}</h4>
              <span v-if="band.role" class="band-role">{{ band.role }}</span>
            </div>
            <div v-if="editable" class="item-actions">
              <button @click="openBandModal(band)" class="item-action-btn" title="Edit" :aria-label="`Edit ${band.bandName}`">✎</button>
              <button @click="removeBand(band)" class="item-action-btn delete" title="Remove" :aria-label="`Remove ${band.bandName}`">&times;</button>
            </div>
          </div>
          <span v-if="bandYears(band)" class="band-years">{{ bandYears(band) }}</span>
        </div>
      </div>
      <p v-else class="empty-text">{{ editable ? 'No bands yet. Add the bands you play or have played in.' : 'No bands listed yet.' }}</p>
    </div>

    <!-- Music bio -->
    <div class="musician-block">
      <div class="block-header">
        <h3>Music Bio</h3>
        <button v-if="editable && !isEditingBio" @click="startBioEdit" class="add-btn">Edit</button>
      </div>
      <template v-if="!isEditingBio">
        <div v-if="data.bio" class="bio-text rich-content" v-safe-html="data.bio"></div>
        <p v-else class="empty-text">{{ editable ? 'No music bio yet. Tell people about your playing, influences and gear.' : 'No music bio yet.' }}</p>
      </template>
      <div v-else class="bio-edit">
        <RichTextEditor v-model="bioDraft" />
        <div class="form-actions">
          <button @click="saveBio" :disabled="isSavingBio" class="save-btn">{{ isSavingBio ? 'Saving...' : 'Save' }}</button>
          <button @click="isEditingBio = false" class="cancel-btn">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Instrument modal -->
    <div v-if="showInstrumentModal" class="modal-overlay" @click.self="closeInstrumentModal">
      <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="instrument-modal-title">
        <div class="modal-header">
          <h2 id="instrument-modal-title">{{ editingInstrument ? `Edit ${editingInstrument.name}` : 'Add Instrument' }}</h2>
          <button ref="instrumentModalCloseBtn" @click="closeInstrumentModal" class="modal-close" aria-label="Close">&times;</button>
        </div>
        <form @submit.prevent="saveInstrument" class="modal-form">
          <div v-if="!editingInstrument" class="form-group">
            <label for="instrumentSelect">Instrument *</label>
            <select id="instrumentSelect" v-model="instrumentForm.instrumentId" required>
              <option value="" disabled>Choose an instrument</option>
              <option v-for="opt in availableInstruments" :key="opt.id" :value="opt.id">{{ opt.name }}</option>
            </select>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="skillLevel">Skill level</label>
              <select id="skillLevel" v-model="instrumentForm.skillLevel">
                <option value="">Not set</option>
                <option v-for="s in SKILL_LEVELS" :key="s.value" :value="s.value">{{ s.label }}</option>
              </select>
            </div>
            <div class="form-group">
              <label for="yearsPlaying">Years playing</label>
              <input id="yearsPlaying" v-model="instrumentForm.yearsPlaying" type="number" min="0" max="100" step="1" />
            </div>
          </div>
          <div class="form-group checkbox-group">
            <label>
              <input type="checkbox" v-model="instrumentForm.isPrimary" />
              This is my main instrument
            </label>
          </div>
          <div class="form-actions">
            <button type="submit" :disabled="isSavingInstrument || !instrumentForm.instrumentId" class="save-btn">
              {{ isSavingInstrument ? 'Saving...' : (editingInstrument ? 'Save' : 'Add Instrument') }}
            </button>
            <button type="button" @click="closeInstrumentModal" class="cancel-btn">Cancel</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Band modal -->
    <div v-if="showBandModal" class="modal-overlay" @click.self="closeBandModal">
      <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="band-modal-title">
        <div class="modal-header">
          <h2 id="band-modal-title">{{ editingBand ? 'Edit Band' : 'Add Band' }}</h2>
          <button ref="bandModalCloseBtn" @click="closeBandModal" class="modal-close" aria-label="Close">&times;</button>
        </div>
        <form @submit.prevent="saveBand" class="modal-form">
          <div class="form-group">
            <label for="bandName">Band name *</label>
            <input id="bandName" v-model="bandForm.bandName" type="text" maxlength="100" required />
          </div>
          <div class="form-group">
            <label for="bandRole">Your role</label>
            <input id="bandRole" v-model="bandForm.role" type="text" maxlength="100" placeholder="e.g., Lead guitar, backing vocals" />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="bandStart">Start year</label>
              <input id="bandStart" v-model="bandForm.startYear" type="number" min="1900" :max="currentYear + 1" step="1" />
            </div>
            <div class="form-group">
              <label for="bandEnd">End year</label>
              <input id="bandEnd" v-model="bandForm.endYear" type="number" min="1900" :max="currentYear + 1" step="1" :disabled="bandForm.isCurrent" />
            </div>
          </div>
          <div class="form-group checkbox-group">
            <label>
              <input type="checkbox" v-model="bandForm.isCurrent" @change="bandForm.isCurrent && (bandForm.endYear = '')" />
              I'm currently in this band
            </label>
          </div>
          <div class="form-actions">
            <button type="submit" :disabled="isSavingBand" class="save-btn">
              {{ isSavingBand ? 'Saving...' : (editingBand ? 'Save' : 'Add Band') }}
            </button>
            <button type="button" @click="closeBandModal" class="cancel-btn">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<style scoped>
.musician-profile {
  margin-bottom: 20px;
}

.musician-profile:last-child {
  margin-bottom: 0;
}

.musician-title {
  font-size: 1.1rem;
  color: var(--color-text);
  margin: 0 0 12px 0;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border);
}

.musician-error {
  background: var(--color-error-bg);
  color: var(--color-error);
  padding: 10px 12px;
  border-radius: 6px;
  margin-bottom: 12px;
}

.musician-only-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  cursor: pointer;
}

.musician-only-toggle input {
  width: 16px;
  height: 16px;
}

.musician-block {
  margin-bottom: 18px;
}

.musician-block:last-of-type {
  margin-bottom: 0;
}

.block-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.block-header h3 {
  margin: 0;
  font-size: 1rem;
  color: var(--color-text);
}

.add-btn {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
}

.empty-text {
  color: var(--color-text-light);
  font-style: italic;
  margin: 0;
}

.instrument-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.instrument-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: var(--card-radius);
  padding: 10px 12px;
}

.instrument-text {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  min-width: 0;
}

.instrument-name {
  font-weight: 600;
  color: var(--color-text);
}

.primary-badge {
  background: var(--color-accent);
  color: white;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
}

.instrument-details {
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.band-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.band-card {
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: var(--card-radius);
  padding: 12px 15px;
}

.band-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.band-header h4 {
  margin: 0 0 3px 0;
  font-size: 1rem;
  color: var(--color-text);
}

.band-role {
  color: var(--color-accent);
  font-weight: 500;
  font-size: 0.95rem;
}

.band-years {
  display: block;
  margin-top: 6px;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  font-weight: 500;
}

.item-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.item-action-btn {
  background: none;
  border: 1px solid var(--color-border-medium);
  color: var(--color-text-muted);
  width: 28px;
  height: 28px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.item-action-btn:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.item-action-btn.delete:hover {
  color: var(--color-error);
  border-color: var(--color-error);
}

.bio-text {
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin: 0;
}

.bio-edit {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-actions {
  display: flex;
  gap: 10px;
  margin-top: 5px;
}

.save-btn {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: 10px 25px;
  border-radius: 6px;
  font-size: 0.95rem;
  cursor: pointer;
}

.save-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.cancel-btn {
  background: var(--color-button-secondary-bg);
  color: var(--color-text-muted);
  border: none;
  padding: 10px 25px;
  border-radius: 6px;
  font-size: 0.95rem;
  cursor: pointer;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--color-background-card);
  border-radius: 12px;
  width: 90%;
  max-width: 500px;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 20px;
  border-bottom: 1px solid var(--color-border-light);
}

.modal-header h2 {
  margin: 0;
  font-size: 1.15rem;
  color: var(--color-text);
}

.modal-close {
  background: none;
  border: none;
  font-size: 1.5rem;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.modal-form {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex: 1;
  min-width: 0;
}

.form-group label {
  font-weight: 600;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.form-group input,
.form-group select {
  padding: 10px;
  border: 1px solid var(--color-border-medium);
  border-radius: 6px;
  font-size: 0.95rem;
  font-family: inherit;
  background: var(--color-background-card);
  color: var(--color-text);
}

.form-group input:disabled {
  opacity: 0.5;
}

.form-row {
  display: flex;
  gap: 15px;
}

.checkbox-group label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: normal;
  cursor: pointer;
}

.checkbox-group input[type="checkbox"] {
  width: 16px;
  height: 16px;
}

@media (max-width: 480px) {
  .form-row {
    flex-direction: column;
    gap: 15px;
  }
}

.rich-content :deep(p) { margin: 0 0 0.75em; }
.rich-content :deep(p:last-child) { margin-bottom: 0; }
.rich-content :deep(ul),
.rich-content :deep(ol) { padding-left: 1.5em; margin: 0.5em 0; }
.rich-content :deep(h3) { font-size: 1.05rem; font-weight: 600; margin: 0.75em 0 0.4em; }
.rich-content :deep(strong) { font-weight: 700; }
.rich-content :deep(em) { font-style: italic; }
</style>
