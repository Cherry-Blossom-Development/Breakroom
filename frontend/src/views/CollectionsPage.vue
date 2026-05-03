<template>
  <main class="collections-page page-container">

    <div class="page-header">
      <h1>Collections</h1>
      <button class="btn-primary" @click="openCreate">+ New Collection</button>
    </div>

    <!-- Store setup links -->
    <section class="setup-section">
      <h2 class="section-label">Store Setup</h2>
      <div class="setup-links">
        <RouterLink to="/collections/payment-setup" class="setup-link">
          <div class="setup-link-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="22" height="22">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
              <line x1="1" y1="10" x2="23" y2="10"/>
            </svg>
          </div>
          <div class="setup-link-text">
            <div class="setup-link-title">Payment Setup</div>
            <div class="setup-link-desc">Connect a payment method to receive sales</div>
          </div>
          <span class="setup-link-arrow">→</span>
        </RouterLink>
        <RouterLink to="/collections/shipping-setup" class="setup-link">
          <div class="setup-link-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="22" height="22">
              <rect x="1" y="3" width="15" height="13" rx="1"/>
              <path d="M16 8h4l3 3v5h-7V8z"/>
              <circle cx="5.5" cy="18.5" r="2.5"/>
              <circle cx="18.5" cy="18.5" r="2.5"/>
            </svg>
          </div>
          <div class="setup-link-text">
            <div class="setup-link-title">Shipping Setup</div>
            <div class="setup-link-desc">Configure shipping rates and destinations</div>
          </div>
          <span class="setup-link-arrow">→</span>
        </RouterLink>
      </div>
    </section>

    <!-- Collections list -->
    <section class="collections-section">
      <h2 class="section-label">Your Collections</h2>

      <div v-if="loading" class="loading-state">Loading...</div>

      <div v-else-if="collections.length === 0" class="empty-state">
        <p>You haven't created any collections yet.</p>
        <button class="btn-primary" @click="openCreate">Create your first collection</button>
      </div>

      <div v-else class="collections-grid">
        <div v-for="col in collections" :key="col.id" class="collection-card">
          <div
            class="card-preview"
            :style="{ backgroundColor: col.settings?.background_color || '#f5f5f5' }"
          ></div>
          <div class="card-body">
            <div class="card-name">{{ col.name }}</div>
            <div class="card-actions">
              <button class="btn-sm" @click="openEdit(col)">Edit</button>
              <button class="btn-sm btn-danger" @click="confirmDelete(col)">Delete</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Create / Edit modal -->
    <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
      <div class="modal" role="dialog" :aria-label="editing ? 'Edit Collection' : 'New Collection'">
        <h2 class="modal-title">{{ editing ? 'Edit Collection' : 'New Collection' }}</h2>

        <div class="form-group">
          <label class="form-label">Name</label>
          <input
            v-model="form.name"
            type="text"
            class="form-input"
            placeholder="e.g. Summer Prints"
            maxlength="255"
            @keydown.enter="save"
          />
        </div>

        <div class="form-group">
          <label class="form-label">Background Color</label>
          <div class="color-row">
            <input v-model="form.background_color" type="color" class="color-swatch" />
            <div class="color-preview" :style="{ backgroundColor: form.background_color }"></div>
            <span class="color-value">{{ form.background_color }}</span>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn-secondary" @click="closeModal">Cancel</button>
          <button
            class="btn-primary"
            :disabled="saving || !form.name.trim()"
            @click="save"
          >
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Delete confirmation modal -->
    <div v-if="showDeleteConfirm" class="modal-overlay" @click.self="showDeleteConfirm = false">
      <div class="modal modal-sm" role="dialog" aria-label="Confirm Delete">
        <h2 class="modal-title">Delete Collection?</h2>
        <p class="modal-text">
          Are you sure you want to delete <strong>{{ deletingCollection?.name }}</strong>?
          This cannot be undone.
        </p>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showDeleteConfirm = false">Cancel</button>
          <button class="btn-primary btn-danger-solid" :disabled="deleting" @click="executeDelete">
            {{ deleting ? 'Deleting…' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>

  </main>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { authFetch } from '@/utilities/authFetch'

const collections = ref([])
const loading = ref(true)
const showModal = ref(false)
const editing = ref(null)
const saving = ref(false)
const form = ref({ name: '', background_color: '#ffffff' })

const showDeleteConfirm = ref(false)
const deletingCollection = ref(null)
const deleting = ref(false)

async function fetchCollections() {
  loading.value = true
  try {
    const res = await authFetch('/api/collections')
    if (res.ok) collections.value = await res.json()
  } catch (err) {
    console.error('Failed to fetch collections:', err)
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  form.value = { name: '', background_color: '#ffffff' }
  showModal.value = true
}

function openEdit(col) {
  editing.value = col
  form.value = {
    name: col.name,
    background_color: col.settings?.background_color || '#ffffff'
  }
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  editing.value = null
}

async function save() {
  if (!form.value.name.trim() || saving.value) return
  saving.value = true
  try {
    const body = {
      name: form.value.name.trim(),
      settings: { background_color: form.value.background_color }
    }
    const url = editing.value ? `/api/collections/${editing.value.id}` : '/api/collections'
    const method = editing.value ? 'PUT' : 'POST'
    const res = await authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (res.ok) {
      closeModal()
      await fetchCollections()
    }
  } catch (err) {
    console.error('Failed to save collection:', err)
  } finally {
    saving.value = false
  }
}

function confirmDelete(col) {
  deletingCollection.value = col
  showDeleteConfirm.value = true
}

async function executeDelete() {
  if (!deletingCollection.value || deleting.value) return
  deleting.value = true
  try {
    const res = await authFetch(`/api/collections/${deletingCollection.value.id}`, { method: 'DELETE' })
    if (res.ok) {
      showDeleteConfirm.value = false
      deletingCollection.value = null
      await fetchCollections()
    }
  } catch (err) {
    console.error('Failed to delete collection:', err)
  } finally {
    deleting.value = false
  }
}

onMounted(fetchCollections)
</script>

<style scoped>
.collections-page {
  padding: 32px 20px;
  max-width: 1000px;
  margin: 0 auto;
}

/* ---- Header ---- */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 32px;
  gap: 16px;
}

.page-header h1 {
  font-size: 1.8rem;
  color: var(--color-text);
  margin: 0;
}

/* ---- Section labels ---- */
.section-label {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-secondary);
  margin: 0 0 12px;
}

/* ---- Setup section ---- */
.setup-section {
  margin-bottom: 40px;
}

.setup-links {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.setup-link {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  background: var(--color-background-soft, rgba(0,0,0,0.03));
  border: 1px solid var(--color-border);
  border-radius: 10px;
  text-decoration: none;
  color: var(--color-text);
  flex: 1;
  min-width: 220px;
  transition: border-color 0.15s, background 0.15s;
}

.setup-link:hover {
  border-color: var(--color-link);
  background: var(--color-background-soft, rgba(0,0,0,0.05));
}

.setup-link-icon {
  color: var(--color-link);
  flex-shrink: 0;
}

.setup-link-text {
  flex: 1;
}

.setup-link-title {
  font-weight: 600;
  font-size: 0.95rem;
  margin-bottom: 2px;
}

.setup-link-desc {
  font-size: 0.82rem;
  color: var(--color-text-secondary);
}

.setup-link-arrow {
  color: var(--color-text-secondary);
  font-size: 1.1rem;
  flex-shrink: 0;
}

/* ---- Collections grid ---- */
.collections-section {
  margin-bottom: 40px;
}

.loading-state {
  color: var(--color-text-secondary);
  padding: 40px 0;
  text-align: center;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  border: 2px dashed var(--color-border);
  border-radius: 12px;
  color: var(--color-text-secondary);
}

.empty-state p {
  margin: 0 0 20px;
  font-size: 1rem;
}

.collections-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}

.collection-card {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--color-background-soft, #fff);
  transition: box-shadow 0.15s;
}

.collection-card:hover {
  box-shadow: 0 4px 16px rgba(0,0,0,0.1);
}

.card-preview {
  height: 110px;
  width: 100%;
}

.card-body {
  padding: 12px 14px;
}

.card-name {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--color-text);
  margin-bottom: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-actions {
  display: flex;
  gap: 8px;
}

/* ---- Buttons ---- */
.btn-primary {
  background: var(--color-link);
  color: #fff;
  border: none;
  padding: 9px 18px;
  border-radius: 7px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
  white-space: nowrap;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.87;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: transparent;
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 9px 18px;
  border-radius: 7px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s;
}

.btn-secondary:hover {
  border-color: var(--color-text-secondary);
}

.btn-sm {
  font-size: 0.8rem;
  padding: 5px 12px;
  border-radius: 5px;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  transition: border-color 0.15s;
}

.btn-sm:hover {
  border-color: var(--color-text-secondary);
}

.btn-danger {
  border-color: #e53e3e;
  color: #e53e3e;
}

.btn-danger:hover {
  background: rgba(229, 62, 62, 0.07);
}

.btn-danger-solid {
  background: #e53e3e;
}

.btn-danger-solid:hover:not(:disabled) {
  opacity: 0.87;
}

/* ---- Modal ---- */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal {
  background: var(--color-background, #fff);
  border-radius: 12px;
  padding: 28px 32px;
  width: 100%;
  max-width: 440px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.2);
}

.modal-sm {
  max-width: 360px;
}

.modal-title {
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--color-text);
  margin: 0 0 24px;
}

.modal-text {
  color: var(--color-text-secondary);
  margin: 0 0 24px;
  line-height: 1.6;
}

.form-group {
  margin-bottom: 20px;
}

.form-label {
  display: block;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 6px;
}

.form-input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 0.95rem;
  color: var(--color-text);
  background: var(--color-background, #fff);
  box-sizing: border-box;
  transition: border-color 0.15s;
}

.form-input:focus {
  outline: none;
  border-color: var(--color-link);
}

.color-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.color-swatch {
  width: 44px;
  height: 44px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  cursor: pointer;
  padding: 2px;
  background: none;
}

.color-preview {
  width: 44px;
  height: 44px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  flex-shrink: 0;
}

.color-value {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  font-family: monospace;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 28px;
}

@media (max-width: 600px) {
  .setup-links {
    flex-direction: column;
  }

  .collections-grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 400px) {
  .collections-grid {
    grid-template-columns: 1fr;
  }
}
</style>
