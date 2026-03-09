<template>
  <section>
    <h1>Feature Flags</h1>

    <div class="features-layout">
      <!-- Left: feature list -->
      <div class="feature-list">
        <div class="feature-list-header">
          <h2>Features</h2>
          <button @click="openCreateModal">+ New Feature</button>
        </div>

        <div v-if="loading" class="status-msg">Loading...</div>
        <div v-else-if="features.length === 0" class="status-msg">No features yet.</div>

        <div
          v-for="f in features"
          :key="f.id"
          class="feature-card"
          :class="{ selected: selectedFeature?.id === f.id, inactive: !f.is_active }"
          @click="selectFeature(f)"
        >
          <div class="feature-card-top">
            <span class="feature-name">{{ f.name }}</span>
            <span class="feature-badge" :class="f.is_active ? 'badge-active' : 'badge-inactive'">
              {{ f.is_active ? 'Active' : 'Inactive' }}
            </span>
          </div>
          <div class="feature-key">{{ f.feature_key }}</div>
          <div class="feature-meta">{{ f.user_count }} user{{ f.user_count == 1 ? '' : 's' }} enrolled</div>
        </div>
      </div>

      <!-- Right: feature detail -->
      <div class="feature-detail" v-if="selectedFeature">
        <div class="detail-header">
          <div>
            <h2>{{ selectedFeature.name }}</h2>
            <div class="detail-key">Key: <code>{{ selectedFeature.feature_key }}</code></div>
            <div class="detail-desc" v-if="selectedFeature.description">{{ selectedFeature.description }}</div>
          </div>
          <div class="detail-actions">
            <button @click="openEditModal(selectedFeature)">Edit</button>
            <button class="btn-danger" @click="deleteFeature(selectedFeature)">Delete</button>
          </div>
        </div>

        <div class="detail-toggle">
          <label class="toggle-label">
            <input type="checkbox" v-model="selectedFeature.is_active" @change="toggleActive(selectedFeature)" />
            Feature is {{ selectedFeature.is_active ? 'active' : 'inactive' }}
          </label>
        </div>

        <div class="enrolled-section">
          <h3>Enrolled Users ({{ enrolledUsers.length }})</h3>

          <!-- Add by handle -->
          <div class="add-user-row">
            <input
              v-model="userSearch"
              placeholder="Search handle to add..."
              @input="searchUsers"
              @keydown.enter="addByHandle"
            />
            <button @click="addByHandle" :disabled="!userSearch.trim()">Add User</button>
          </div>

          <!-- Search results dropdown -->
          <div v-if="searchResults.length > 0" class="search-results">
            <div
              v-for="u in searchResults"
              :key="u.id"
              class="search-result-item"
              @click="addUser(u.handle)"
            >
              <strong>{{ u.handle }}</strong>
              <span v-if="u.first_name || u.last_name" class="user-name">{{ u.first_name }} {{ u.last_name }}</span>
            </div>
          </div>

          <!-- Add random % -->
          <div class="random-row">
            <input
              v-model.number="randomPercent"
              type="number"
              min="1"
              max="100"
              placeholder="%"
              class="percent-input"
            />
            <button @click="addRandom" :disabled="!randomPercent || randomPercent < 1 || randomPercent > 100">
              Add Random {{ randomPercent || '' }}%
            </button>
            <span v-if="randomResult" class="random-result">{{ randomResult }}</span>
          </div>

          <!-- Enrolled user list -->
          <div v-if="loadingUsers" class="status-msg">Loading users...</div>
          <table v-else-if="enrolledUsers.length > 0" class="users-table">
            <thead>
              <tr>
                <th>Handle</th>
                <th>Name</th>
                <th>Added</th>
                <th>Method</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in enrolledUsers" :key="u.id">
                <td>{{ u.handle }}</td>
                <td>{{ [u.first_name, u.last_name].filter(Boolean).join(' ') || '—' }}</td>
                <td>{{ formatDate(u.added_at) }}</td>
                <td><span class="method-badge" :class="'method-' + u.added_method">{{ u.added_method }}</span></td>
                <td><button class="btn-sm btn-danger" @click="removeUser(u.id)">Remove</button></td>
              </tr>
            </tbody>
          </table>
          <div v-else class="status-msg">No users enrolled yet.</div>
        </div>
      </div>

      <div class="feature-detail feature-detail-empty" v-else>
        <p>Select a feature to manage its enrolled users.</p>
      </div>
    </div>

    <!-- Create Feature Modal -->
    <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
      <div class="modal">
        <h2>New Feature Flag</h2>
        <form @submit.prevent="createFeature">
          <label>Name</label>
          <input v-model="newFeature.name" placeholder="e.g. Dark Mode Beta" required />
          <label>Key <span class="hint">(auto-generated, used in code)</span></label>
          <input v-model="newFeature.feature_key" placeholder="e.g. dark_mode_beta" required />
          <label>Description</label>
          <textarea v-model="newFeature.description" placeholder="What does this feature do?" rows="3"></textarea>
          <p v-if="createError" class="error">{{ createError }}</p>
          <div class="modal-actions">
            <button type="submit">Create</button>
            <button type="button" @click="showCreateModal = false">Cancel</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Edit Feature Modal -->
    <div v-if="showEditModal" class="modal-overlay" @click.self="showEditModal = false">
      <div class="modal">
        <h2>Edit Feature</h2>
        <form @submit.prevent="saveEdit">
          <label>Name</label>
          <input v-model="editFeature.name" required />
          <label>Description</label>
          <textarea v-model="editFeature.description" rows="3"></textarea>
          <p v-if="editError" class="error">{{ editError }}</p>
          <div class="modal-actions">
            <button type="submit">Save</button>
            <button type="button" @click="showEditModal = false">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, watch } from 'vue'

const features = ref([])
const loading = ref(true)
const selectedFeature = ref(null)
const enrolledUsers = ref([])
const loadingUsers = ref(false)

const showCreateModal = ref(false)
const newFeature = ref({ name: '', feature_key: '', description: '' })
const createError = ref('')

const showEditModal = ref(false)
const editFeature = ref({})
const editError = ref('')

const userSearch = ref('')
const searchResults = ref([])
const allUsers = ref([])

const randomPercent = ref(null)
const randomResult = ref('')

async function loadFeatures() {
  loading.value = true
  try {
    const res = await fetch('/api/features', { credentials: 'include' })
    const data = await res.json()
    features.value = data.features || []
    // Refresh selected feature data if one is selected
    if (selectedFeature.value) {
      const updated = features.value.find(f => f.id === selectedFeature.value.id)
      if (updated) selectedFeature.value = { ...updated }
    }
  } finally {
    loading.value = false
  }
}

async function loadEnrolledUsers() {
  if (!selectedFeature.value) return
  loadingUsers.value = true
  try {
    const res = await fetch(`/api/features/${selectedFeature.value.id}/users`, { credentials: 'include' })
    const data = await res.json()
    enrolledUsers.value = data.users || []
  } finally {
    loadingUsers.value = false
  }
}

async function loadAllUsers() {
  if (allUsers.value.length > 0) return
  const res = await fetch('/api/user/all', { credentials: 'include' })
  const data = await res.json()
  allUsers.value = data.users || []
}

function selectFeature(f) {
  selectedFeature.value = { ...f }
  enrolledUsers.value = []
  userSearch.value = ''
  searchResults.value = []
  randomPercent.value = null
  randomResult.value = ''
  loadEnrolledUsers()
  loadAllUsers()
}

function searchUsers() {
  const q = userSearch.value.toLowerCase().trim()
  if (!q) { searchResults.value = []; return }
  const enrolledIds = new Set(enrolledUsers.value.map(u => u.id))
  searchResults.value = allUsers.value.filter(u =>
    !enrolledIds.has(u.id) && (
      u.handle.toLowerCase().includes(q) ||
      (u.first_name || '').toLowerCase().includes(q) ||
      (u.last_name || '').toLowerCase().includes(q)
    )
  ).slice(0, 8)
}

async function addUser(handle) {
  const res = await fetch(`/api/features/${selectedFeature.value.id}/users`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle })
  })
  if (res.ok) {
    userSearch.value = ''
    searchResults.value = []
    await Promise.all([loadEnrolledUsers(), loadFeatures()])
  } else {
    const data = await res.json()
    alert(data.message || 'Failed to add user')
  }
}

function addByHandle() {
  const handle = userSearch.value.trim()
  if (handle) addUser(handle)
}

async function removeUser(userId) {
  if (!confirm('Remove this user from the feature?')) return
  const res = await fetch(`/api/features/${selectedFeature.value.id}/users/${userId}`, {
    method: 'DELETE',
    credentials: 'include'
  })
  if (res.ok) {
    await Promise.all([loadEnrolledUsers(), loadFeatures()])
  }
}

async function addRandom() {
  if (!randomPercent.value) return
  randomResult.value = ''
  const res = await fetch(`/api/features/${selectedFeature.value.id}/users/random`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ percent: randomPercent.value })
  })
  const data = await res.json()
  if (res.ok) {
    randomResult.value = `✓ Added ${data.added} user${data.added === 1 ? '' : 's'}`
    randomPercent.value = null
    await Promise.all([loadEnrolledUsers(), loadFeatures()])
  } else {
    randomResult.value = data.message || 'Failed'
  }
}

async function toggleActive(f) {
  await fetch(`/api/features/${f.id}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: f.name, description: f.description, is_active: f.is_active })
  })
  await loadFeatures()
}

// Auto-generate key from name
watch(() => newFeature.value.name, (name) => {
  newFeature.value.feature_key = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
})

function openCreateModal() {
  newFeature.value = { name: '', feature_key: '', description: '' }
  createError.value = ''
  showCreateModal.value = true
}

async function createFeature() {
  createError.value = ''
  const res = await fetch('/api/features', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newFeature.value)
  })
  const data = await res.json()
  if (res.ok) {
    showCreateModal.value = false
    await loadFeatures()
  } else {
    createError.value = data.message || 'Failed to create feature'
  }
}

function openEditModal(f) {
  editFeature.value = { ...f }
  editError.value = ''
  showEditModal.value = true
}

async function saveEdit() {
  editError.value = ''
  const res = await fetch(`/api/features/${editFeature.value.id}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: editFeature.value.name,
      description: editFeature.value.description,
      is_active: editFeature.value.is_active
    })
  })
  if (res.ok) {
    showEditModal.value = false
    selectedFeature.value = { ...editFeature.value }
    await loadFeatures()
  } else {
    const data = await res.json()
    editError.value = data.message || 'Failed to save'
  }
}

async function deleteFeature(f) {
  if (!confirm(`Delete feature "${f.name}"? This will remove all enrolled users.`)) return
  const res = await fetch(`/api/features/${f.id}`, { method: 'DELETE', credentials: 'include' })
  if (res.ok) {
    selectedFeature.value = null
    enrolledUsers.value = []
    await loadFeatures()
  }
}

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString()
}

loadFeatures()
</script>

<style scoped>
h1 { color: var(--color-text); margin-bottom: 20px; }
h2 { color: var(--color-text); margin: 0 0 4px; }
h3 { color: var(--color-text); margin: 0 0 12px; }

.features-layout {
  display: flex;
  gap: 24px;
  align-items: flex-start;
}

/* ---- Feature List ---- */
.feature-list {
  width: 260px;
  flex-shrink: 0;
}

.feature-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.feature-list-header h2 { font-size: 1rem; }

.feature-card {
  background: var(--color-background-card);
  border: 2px solid transparent;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.feature-card:hover { border-color: var(--color-accent); }
.feature-card.selected { border-color: var(--color-accent); background: var(--color-background-soft); }
.feature-card.inactive { opacity: 0.6; }

.feature-card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.feature-name { font-weight: 600; color: var(--color-text); font-size: 0.95rem; }

.feature-badge {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 10px;
  flex-shrink: 0;
}
.badge-active { background: #d4edda; color: #155724; }
.badge-inactive { background: #f8d7da; color: #721c24; }

.feature-key { font-size: 0.75rem; color: var(--color-text-muted, #888); margin-top: 4px; font-family: monospace; }
.feature-meta { font-size: 0.8rem; color: var(--color-text-light); margin-top: 4px; }

/* ---- Feature Detail ---- */
.feature-detail {
  flex: 1;
  background: var(--color-background-card);
  border-radius: 8px;
  padding: 20px;
  min-height: 300px;
}

.feature-detail-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted, #888);
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.detail-key { font-size: 0.8rem; color: var(--color-text-muted, #888); margin-top: 4px; }
.detail-key code { background: var(--color-background-soft); padding: 1px 5px; border-radius: 3px; }
.detail-desc { margin-top: 6px; color: var(--color-text-light); font-size: 0.9rem; }

.detail-actions { display: flex; gap: 8px; flex-shrink: 0; }

.detail-toggle {
  margin-bottom: 20px;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border);
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  color: var(--color-text);
  font-size: 0.9rem;
}

.toggle-label input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; }

/* ---- Enrolled Users ---- */
.enrolled-section { }

.add-user-row {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}

.add-user-row input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-background-input);
  color: var(--color-text);
  font-size: 0.9rem;
}

.search-results {
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  margin-bottom: 10px;
  overflow: hidden;
}

.search-result-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  cursor: pointer;
  color: var(--color-text);
  font-size: 0.9rem;
}

.search-result-item:hover { background: var(--color-background-soft); }

.user-name { color: var(--color-text-muted, #888); font-size: 0.85rem; }

.random-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.percent-input {
  width: 70px;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-background-input);
  color: var(--color-text);
  font-size: 0.9rem;
}

.random-result { font-size: 0.85rem; color: var(--color-accent); font-weight: 600; }

.users-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.users-table th, .users-table td {
  border: 1px solid var(--color-border);
  padding: 8px 10px;
  text-align: left;
  color: var(--color-text);
}

.users-table thead { background: var(--color-background-soft); }

.method-badge {
  font-size: 0.75rem;
  padding: 2px 7px;
  border-radius: 10px;
  font-weight: 600;
}
.method-manual { background: #cce5ff; color: #004085; }
.method-random { background: #fff3cd; color: #856404; }

/* ---- Shared ---- */
.status-msg { color: var(--color-text-muted, #888); font-style: italic; padding: 12px 0; }

.hint { font-size: 0.75rem; color: var(--color-text-muted, #888); font-weight: normal; }

button {
  padding: 8px 14px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  background: var(--color-accent);
  color: white;
  font-size: 0.9rem;
}
button:hover { background: var(--color-accent-hover); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
button[type="button"] { background: var(--color-button-secondary); color: var(--color-text); }
button[type="button"]:hover { background: var(--color-button-secondary-hover); }

.btn-danger { background: var(--color-error, #dc3545); }
.btn-danger:hover { background: #c82333; }
.btn-sm { padding: 4px 10px; font-size: 0.8rem; }

label { display: block; font-size: 0.85rem; color: var(--color-text-light); margin-bottom: 4px; margin-top: 12px; }
label:first-child { margin-top: 0; }

.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.modal {
  background: var(--color-background-card);
  color: var(--color-text);
  padding: 24px;
  border-radius: 10px;
  width: 440px;
  max-width: 90%;
}
.modal h2 { margin-top: 0; margin-bottom: 16px; }

.modal input, .modal textarea {
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-background-input);
  color: var(--color-text);
  font-size: 0.9rem;
  box-sizing: border-box;
  margin-bottom: 2px;
}
.modal textarea { resize: vertical; }

.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }

.error { color: var(--color-error); font-size: 0.85rem; margin: 6px 0 0; }
</style>
