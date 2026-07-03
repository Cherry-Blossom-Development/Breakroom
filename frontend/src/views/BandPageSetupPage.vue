<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { authFetch } from '@/utilities/authFetch'

const route = useRoute()
const router = useRouter()
const bandId = route.params.id

const loading = ref(true)
const saving = ref(false)
const error = ref(null)
const saveError = ref(null)
const saveSuccess = ref(null)

const page = reactive({
  band_name: '',
  band_url: '',
  story: '',
  background_photo_url: null,
  background_photo_key: null,
  is_published: false,
})

const members = ref([])       // [{ id, handle, first_name, last_name, photo_url, instrument_ids }]
const instruments = ref([])   // [{ id, name }]
const sessions = ref([])      // [{ id, name, recorded_at, on_page, display_order }]

// Derived: ordered list of featured session IDs (in the order they appear in sessions)
const featuredSessionIds = computed(() =>
  sessions.value.filter(s => s.on_page).sort((a, b) => a.display_order - b.display_order).map(s => s.id)
)

const publicUrl = computed(() => {
  const base = import.meta.env.VITE_API_BASE_URL || ''
  return page.band_url ? `${base}/band/${page.band_url}` : null
})

// Background photo
const bgUploading = ref(false)
const bgFileInput = ref(null)

// Instrument saving state per member
const instrumentSaving = reactive({})

onMounted(async () => {
  try {
    const res = await authFetch(`/api/bands/${bandId}/page`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.message)
    Object.assign(page, {
      band_name: data.band_name,
      band_url: data.band_url,
      story: data.story,
      background_photo_url: data.background_photo_url,
      background_photo_key: data.background_photo_key,
      is_published: data.is_published,
    })
    members.value = data.members
    instruments.value = data.instruments
    sessions.value = data.sessions.map(s => ({ ...s, on_page: !!s.on_page }))
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
})

async function saveSettings() {
  saving.value = true
  saveError.value = null
  saveSuccess.value = null
  try {
    const res = await authFetch(`/api/bands/${bandId}/page`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        band_url: page.band_url.trim().toLowerCase() || null,
        story: page.story.trim() || null,
        is_published: page.is_published,
      })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message)
    saveSuccess.value = 'Settings saved'
    setTimeout(() => saveSuccess.value = null, 3000)
  } catch (err) {
    saveError.value = err.message
  } finally {
    saving.value = false
  }
}

async function uploadBackground(e) {
  const file = e.target.files[0]
  if (!file) return
  bgUploading.value = true
  saveError.value = null
  try {
    const form = new FormData()
    form.append('photo', file)
    const res = await authFetch(`/api/bands/${bandId}/page/background`, { method: 'POST', body: form })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message)
    page.background_photo_url = data.background_photo_url
    page.background_photo_key = data.background_photo_key
  } catch (err) {
    saveError.value = err.message
  } finally {
    bgUploading.value = false
    if (bgFileInput.value) bgFileInput.value.value = ''
  }
}

async function removeBackground() {
  if (!confirm('Remove background photo?')) return
  bgUploading.value = true
  try {
    const res = await authFetch(`/api/bands/${bandId}/page/background`, { method: 'DELETE' })
    if (!res.ok) { const d = await res.json(); throw new Error(d.message) }
    page.background_photo_url = null
    page.background_photo_key = null
  } catch (err) {
    saveError.value = err.message
  } finally {
    bgUploading.value = false
  }
}

async function saveInstruments(member) {
  instrumentSaving[member.id] = true
  try {
    const res = await authFetch(`/api/bands/${bandId}/page/members/${member.id}/instruments`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrumentIds: member.instrument_ids })
    })
    if (!res.ok) { const d = await res.json(); throw new Error(d.message) }
  } catch (err) {
    saveError.value = err.message
  } finally {
    delete instrumentSaving[member.id]
  }
}

function toggleInstrument(member, instrumentId) {
  const idx = member.instrument_ids.indexOf(instrumentId)
  if (idx === -1) member.instrument_ids.push(instrumentId)
  else member.instrument_ids.splice(idx, 1)
  saveInstruments(member)
}

async function saveSongs() {
  try {
    const ordered = sessions.value
      .filter(s => s.on_page)
      .sort((a, b) => a.display_order - b.display_order)
      .map(s => s.id)
    const res = await authFetch(`/api/bands/${bandId}/page/songs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds: ordered })
    })
    if (!res.ok) { const d = await res.json(); throw new Error(d.message) }
  } catch (err) {
    saveError.value = err.message
  }
}

function toggleSong(session) {
  session.on_page = !session.on_page
  saveSongs()
}

function moveSong(session, direction) {
  const featured = sessions.value.filter(s => s.on_page).sort((a, b) => a.display_order - b.display_order)
  const idx = featured.indexOf(session)
  const swapIdx = idx + direction
  if (swapIdx < 0 || swapIdx >= featured.length) return
  const tempOrder = featured[idx].display_order
  featured[idx].display_order = featured[swapIdx].display_order
  featured[swapIdx].display_order = tempOrder
  saveSongs()
}
</script>

<template>
  <main class="page-container">
    <div class="bps-header">
      <button class="btn-ghost btn-sm" @click="router.push('/sessions')">← Back to Sessions</button>
      <h1 class="bps-title">{{ page.band_name || 'Band Page' }} — Setup</h1>
    </div>

    <div v-if="loading" class="bps-loading">Loading…</div>
    <div v-else-if="error" class="error-msg">{{ error }}</div>

    <template v-else>
      <div v-if="saveError" class="error-msg bps-alert">{{ saveError }}</div>
      <div v-if="saveSuccess" class="success-msg bps-alert">{{ saveSuccess }}</div>

      <!-- ── Published toggle ── -->
      <div class="bps-card">
        <div class="bps-published-row">
          <div>
            <div class="bps-section-title">Publish Band Page</div>
            <div class="bps-hint" v-if="publicUrl">
              Public URL:
              <a :href="publicUrl" target="_blank" class="bps-url-link">{{ publicUrl }}</a>
            </div>
            <div class="bps-hint" v-else>Set a URL below to publish your page.</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" v-model="page.is_published" @change="saveSettings" />
            <span class="toggle-track"></span>
          </label>
        </div>
      </div>

      <!-- ── URL + Story ── -->
      <div class="bps-card">
        <div class="bps-section-title">Page Settings</div>
        <div class="bps-field">
          <label class="bps-label">Band URL</label>
          <div class="bps-url-row">
            <span class="bps-url-prefix">/band/</span>
            <input
              v-model="page.band_url"
              class="text-input bps-url-input"
              placeholder="my-band-name"
              @input="page.band_url = page.band_url.toLowerCase().replace(/[^a-z0-9-]/g, '')"
            />
          </div>
          <div class="bps-hint">Lowercase letters, numbers, and hyphens only.</div>
        </div>
        <div class="bps-field">
          <label class="bps-label">Custom Domain</label>
          <div class="bps-hint">
            Want your band page to live at your own domain, like <code>www.yourband.com</code>?
            Connect one — we handle DNS, SSL, and hosting automatically.
          </div>
          <RouterLink :to="`/band-setup/${bandId}/domain-setup`" class="domain-setup-link">
            Use your own domain →
          </RouterLink>
        </div>
        <div class="bps-field">
          <label class="bps-label">Band Story</label>
          <textarea
            v-model="page.story"
            class="bps-textarea"
            rows="6"
            placeholder="Tell the world about your band — how you formed, your style, your journey…"
          />
        </div>
        <button class="btn-primary" :disabled="saving" @click="saveSettings">
          {{ saving ? 'Saving…' : 'Save Settings' }}
        </button>
      </div>

      <!-- ── Background photo ── -->
      <div class="bps-card">
        <div class="bps-section-title">Background Photo</div>
        <div v-if="page.background_photo_url" class="bps-bg-preview-wrap">
          <img :src="page.background_photo_url" alt="Background" class="bps-bg-preview" />
          <button class="btn-ghost btn-sm bps-bg-remove" :disabled="bgUploading" @click="removeBackground">
            Remove
          </button>
        </div>
        <div v-else class="bps-bg-placeholder">No background photo set.</div>
        <div class="bps-field">
          <input ref="bgFileInput" type="file" accept="image/*" class="bps-file-input" id="bg-upload" @change="uploadBackground" :disabled="bgUploading" />
          <label for="bg-upload" class="btn-secondary bps-upload-label" :class="{ disabled: bgUploading }">
            {{ bgUploading ? 'Uploading…' : page.background_photo_url ? 'Replace Photo' : 'Upload Photo' }}
          </label>
        </div>
      </div>

      <!-- ── Members & Instruments ── -->
      <div class="bps-card">
        <div class="bps-section-title">Members &amp; Instruments</div>
        <div class="bps-hint">Check the instruments each member plays. Changes save automatically.</div>
        <div class="bps-members">
          <div v-for="member in members" :key="member.id" class="bps-member">
            <div class="bps-member-info">
              <img v-if="member.photo_url" :src="member.photo_url" alt="" class="bps-member-photo" />
              <div v-else class="bps-member-photo bps-member-photo-placeholder">
                {{ (member.first_name || member.handle)[0].toUpperCase() }}
              </div>
              <div>
                <div class="bps-member-name">{{ member.first_name }} {{ member.last_name }}</div>
                <div class="bps-member-handle">@{{ member.handle }}{{ member.role === 'owner' ? ' · owner' : '' }}</div>
              </div>
              <div v-if="instrumentSaving[member.id]" class="bps-saving-dot">saving…</div>
            </div>
            <div class="bps-instrument-grid">
              <label v-for="inst in instruments" :key="inst.id" class="bps-inst-chip" :class="{ active: member.instrument_ids.includes(inst.id) }">
                <input type="checkbox" :checked="member.instrument_ids.includes(inst.id)" @change="toggleInstrument(member, inst.id)" />
                {{ inst.name }}
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Featured Songs ── -->
      <div class="bps-card">
        <div class="bps-section-title">Featured Songs</div>
        <div class="bps-hint">Check songs to feature on your band page. Use arrows to reorder.</div>
        <div v-if="sessions.length === 0" class="empty-state-sm">No band sessions uploaded yet.</div>
        <div v-else class="bps-songs">
          <div v-for="session in [...sessions].sort((a, b) => {
            if (a.on_page !== b.on_page) return b.on_page - a.on_page
            return a.display_order - b.display_order
          })" :key="session.id" class="bps-song-row">
            <label class="bps-song-check">
              <input type="checkbox" :checked="session.on_page" @change="toggleSong(session)" />
            </label>
            <div class="bps-song-info">
              <div class="bps-song-name">{{ session.name || 'Untitled' }}</div>
              <div class="bps-song-meta">{{ session.uploader_handle }}{{ session.instrument_name ? ` · ${session.instrument_name}` : '' }}{{ session.recorded_at ? ` · ${new Date(session.recorded_at).toLocaleDateString()}` : '' }}</div>
            </div>
            <div v-if="session.on_page" class="bps-song-order">
              <button class="bps-order-btn" @click="moveSong(session, -1)" title="Move up">▲</button>
              <button class="bps-order-btn" @click="moveSong(session, 1)" title="Move down">▼</button>
            </div>
          </div>
        </div>
      </div>

      <!-- View public page link -->
      <div class="bps-footer" v-if="publicUrl && page.is_published">
        <a :href="publicUrl" target="_blank" class="btn-primary">View Public Page →</a>
      </div>
    </template>
  </main>
</template>

<style scoped>
.bps-header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
.bps-title { font-size: 1.4em; font-weight: 700; margin: 0; }
.bps-loading { padding: 40px; text-align: center; color: var(--color-text-muted); }
.bps-alert { margin-bottom: 16px; }

.bps-card {
  background: var(--color-background-card);
  border-radius: 10px;
  padding: 24px;
  margin-bottom: 20px;
  box-shadow: var(--shadow-sm);
}
.bps-section-title { font-size: 1.05em; font-weight: 600; margin-bottom: 14px; }
.bps-hint { font-size: 0.82em; color: var(--color-text-muted); margin-bottom: 10px; }
.bps-field { margin-bottom: 16px; }
.bps-label { display: block; font-size: 0.78em; text-transform: uppercase; letter-spacing: .5px; color: var(--color-text-light); margin-bottom: 6px; font-weight: 600; }

.domain-setup-link {
  display: inline-block;
  font-size: 0.82rem;
  color: var(--color-link);
  text-decoration: none;
  margin-top: 4px;
}
.domain-setup-link:hover { text-decoration: underline; }

.bps-url-row { display: flex; align-items: center; gap: 0; }
.bps-url-prefix { color: var(--color-text-muted); font-size: 0.9em; white-space: nowrap; padding: 8px 4px 8px 0; }
.bps-url-input { flex: 1; }
.bps-url-link { color: var(--color-accent); font-size: 0.85em; word-break: break-all; }

.bps-textarea { width: 100%; box-sizing: border-box; min-height: 120px; padding: 10px; border: 1px solid var(--color-border-medium); border-radius: 6px; background: var(--color-background-input); color: var(--color-text); resize: vertical; font-family: inherit; font-size: 0.95em; }

.bps-published-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.toggle-switch { position: relative; display: inline-block; width: 46px; height: 26px; flex-shrink: 0; }
.toggle-switch input { opacity: 0; width: 0; height: 0; }
.toggle-track { position: absolute; inset: 0; background: var(--color-border-medium); border-radius: 26px; cursor: pointer; transition: background .2s; }
.toggle-switch input:checked + .toggle-track { background: var(--color-accent); }
.toggle-track::before { content: ''; position: absolute; height: 20px; width: 20px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: transform .2s; }
.toggle-switch input:checked + .toggle-track::before { transform: translateX(20px); }

.bps-bg-preview-wrap { position: relative; margin-bottom: 12px; }
.bps-bg-preview { width: 100%; max-height: 200px; object-fit: cover; border-radius: 8px; }
.bps-bg-remove { position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,.5); color: white; border: none; }
.bps-bg-placeholder { color: var(--color-text-muted); font-size: 0.9em; margin-bottom: 12px; }
.bps-file-input { display: none; }
.bps-upload-label { cursor: pointer; }
.bps-upload-label.disabled { opacity: 0.6; pointer-events: none; }

.btn-secondary { display: inline-block; padding: 8px 18px; border: 2px solid var(--color-accent); border-radius: 6px; color: var(--color-accent); font-weight: 600; font-size: 0.9em; text-decoration: none; transition: background .2s, color .2s; background: transparent; cursor: pointer; }
.btn-secondary:hover { background: var(--color-accent); color: #fff; }

.bps-members { display: flex; flex-direction: column; gap: 20px; }
.bps-member { border: 1px solid var(--color-border); border-radius: 8px; padding: 16px; }
.bps-member-info { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.bps-member-photo { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.bps-member-photo-placeholder { background: var(--color-accent); color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1.1em; }
.bps-member-name { font-weight: 600; }
.bps-member-handle { font-size: 0.82em; color: var(--color-text-muted); }
.bps-saving-dot { font-size: 0.78em; color: var(--color-text-muted); margin-left: auto; }
.bps-instrument-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.bps-inst-chip { display: flex; align-items: center; gap: 5px; padding: 5px 10px; border: 1px solid var(--color-border-medium); border-radius: 20px; font-size: 0.85em; cursor: pointer; transition: background .15s, border-color .15s; user-select: none; }
.bps-inst-chip input { display: none; }
.bps-inst-chip.active { background: var(--color-accent); border-color: var(--color-accent); color: white; }
.bps-inst-chip:hover { border-color: var(--color-accent); }

.bps-songs { display: flex; flex-direction: column; gap: 8px; }
.bps-song-row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--color-border); border-radius: 8px; }
.bps-song-check input { width: 16px; height: 16px; cursor: pointer; }
.bps-song-info { flex: 1; min-width: 0; }
.bps-song-name { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bps-song-meta { font-size: 0.8em; color: var(--color-text-muted); }
.bps-song-order { display: flex; flex-direction: column; gap: 2px; }
.bps-order-btn { background: none; border: 1px solid var(--color-border-medium); border-radius: 4px; padding: 2px 6px; cursor: pointer; font-size: 0.7em; color: var(--color-text-light); }
.bps-order-btn:hover { background: var(--color-border); }

.bps-footer { text-align: center; margin-top: 8px; margin-bottom: 32px; }
</style>
