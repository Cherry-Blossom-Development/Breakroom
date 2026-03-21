<script setup>
import { ref, onMounted } from 'vue'
import { sessions } from '@/stores/sessions'

const uploading = ref(false)
const uploadError = ref(null)
const selectedFile = ref(null)
const sessionName = ref('')
const recordedAt = ref('')
const fileInput = ref(null)

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatBytes(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function defaultName() {
  return `Session - ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
}

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

async function saveName(session, newName) {
  if (!newName.trim() || newName.trim() === session.name) return
  try {
    await sessions.update(session.id, { name: newName.trim() })
  } catch (err) {
    console.error('Failed to update name:', err)
  }
}

async function saveRecordedAt(session, value) {
  try {
    await sessions.update(session.id, { recorded_at: value || null })
  } catch (err) {
    console.error('Failed to update date:', err)
  }
}

async function deleteSession(id) {
  if (!confirm('Delete this session? This cannot be undone.')) return
  try {
    await sessions.remove(id)
  } catch (err) {
    console.error('Failed to delete session:', err)
  }
}

onMounted(async () => {
  await sessions.load()
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
          <input
            ref="fileInput"
            type="file"
            accept="audio/*"
            @change="onFileSelect"
            class="file-input"
            id="audio-file"
            :disabled="uploading"
          />
          <label for="audio-file" class="file-label" :class="{ 'has-file': selectedFile }">
            {{ selectedFile ? selectedFile.name : 'Choose audio file…' }}
          </label>
        </div>

        <div class="fields-row">
          <div class="field">
            <label class="field-label">Name</label>
            <input
              v-model="sessionName"
              type="text"
              class="text-input"
              placeholder="Session name"
              :disabled="uploading"
            />
          </div>
          <div class="field">
            <label class="field-label">Original recording date <span class="optional">(optional)</span></label>
            <input
              v-model="recordedAt"
              type="date"
              class="text-input"
              :disabled="uploading"
            />
          </div>
        </div>

        <p v-if="uploadError" class="error-msg">{{ uploadError }}</p>

        <button
          class="upload-btn"
          @click="handleUpload"
          :disabled="!selectedFile || uploading"
        >
          {{ uploading ? 'Uploading…' : 'Upload' }}
        </button>
      </div>
    </div>

    <!-- Sessions List -->
    <div class="card sessions-card">
      <h2 class="card-title">Your Sessions</h2>

      <div v-if="sessions.list.length === 0" class="empty-state">
        No sessions yet. Upload a recording above.
      </div>

      <div v-else class="table-wrapper">
        <table class="sessions-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Recorded</th>
              <th>Uploaded</th>
              <th>Size</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="session in sessions.list" :key="session.id">
              <td>
                <input
                  type="text"
                  class="inline-edit"
                  :value="session.name"
                  @blur="e => saveName(session, e.target.value)"
                  @keydown.enter="e => e.target.blur()"
                />
              </td>
              <td>
                <input
                  type="date"
                  class="inline-edit date-edit"
                  :value="session.recorded_at ? session.recorded_at.slice(0, 10) : ''"
                  @change="e => saveRecordedAt(session, e.target.value)"
                />
              </td>
              <td class="muted">{{ formatDate(session.uploaded_at) }}</td>
              <td class="muted">{{ formatBytes(session.file_size) }}</td>
              <td>
                <button class="delete-btn" @click="deleteSession(session.id)" title="Delete session">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sessions-page {
  max-width: 900px;
}

.page-header {
  margin-bottom: 28px;
}

.page-header h1 {
  font-size: 2.2rem;
  font-weight: 700;
  color: var(--color-accent);
  margin: 0 0 8px;
}

.subtitle {
  color: var(--color-text-muted);
  margin: 0;
  font-size: 1.1rem;
}

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

/* Upload form */
.upload-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.file-row {
  display: flex;
}

.file-input {
  display: none;
}

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

.file-label:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.file-label.has-file {
  color: var(--color-text);
  border-style: solid;
  border-color: var(--color-accent);
}

.fields-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.field {
  flex: 1;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 0.85rem;
  color: var(--color-text-muted);
  font-weight: 500;
}

.optional {
  font-weight: 400;
  opacity: 0.7;
}

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

.text-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.error-msg {
  color: #e05555;
  font-size: 0.9rem;
  margin: 0;
}

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

.upload-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.upload-btn:not(:disabled):hover {
  opacity: 0.85;
}

/* Sessions table */
.table-wrapper {
  overflow-x: auto;
}

.sessions-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.92rem;
}

.sessions-table th {
  text-align: left;
  padding: 8px 12px;
  color: var(--color-text-muted);
  font-weight: 600;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--color-border, #444);
}

.sessions-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border, #333);
  vertical-align: middle;
}

.sessions-table tr:last-child td {
  border-bottom: none;
}

.inline-edit {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 4px 8px;
  color: var(--color-text);
  font-size: 0.92rem;
  width: 100%;
  box-sizing: border-box;
  transition: border-color 0.15s, background 0.15s;
}

.inline-edit:hover {
  border-color: var(--color-border, #555);
}

.inline-edit:focus {
  outline: none;
  border-color: var(--color-accent);
  background: var(--color-background-input, var(--color-background));
}

.date-edit {
  min-width: 130px;
}

.muted {
  color: var(--color-text-muted);
  white-space: nowrap;
}

.empty-state {
  color: var(--color-text-muted);
  text-align: center;
  padding: 40px 0;
  font-size: 0.95rem;
}

.delete-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.85rem;
  transition: color 0.15s, background 0.15s;
}

.delete-btn:hover {
  color: #e05555;
  background: rgba(224, 85, 85, 0.1);
}
</style>
