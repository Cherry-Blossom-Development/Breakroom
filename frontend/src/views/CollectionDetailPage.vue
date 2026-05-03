<template>
  <main class="collection-detail-page page-container">

    <div class="page-header">
      <div class="header-left">
        <RouterLink to="/collections" class="back-link">← Collections</RouterLink>
        <h1>{{ collection?.name || 'Collection' }}</h1>
      </div>
      <button class="btn-primary" @click="openCreate">+ Add Item</button>
    </div>

    <div v-if="loading" class="loading-state">Loading…</div>

    <template v-else>
      <div v-if="items.length === 0" class="empty-state">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M3 9h18M9 21V9"/>
          </svg>
        </div>
        <p>No items yet. Add the first one!</p>
        <button class="btn-primary" @click="openCreate">+ Add Item</button>
      </div>

      <div v-else class="items-grid">
        <div v-for="item in items" :key="item.id" class="item-card">
          <div class="item-image-wrap">
            <img
              v-if="item.image_path"
              :src="`/api/uploads/${item.image_path}`"
              :alt="item.name"
              class="item-image"
            />
            <div v-else class="item-image-placeholder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </div>
          </div>
          <div class="item-body">
            <div class="item-name">{{ item.name }}</div>
            <div v-if="item.description" class="item-desc">{{ item.description }}</div>
            <div class="item-actions">
              <button class="btn-sm" @click="openEdit(item)">Edit</button>
              <button class="btn-sm btn-danger" @click="confirmDelete(item)">Delete</button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Add / Edit modal -->
    <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
      <div class="modal" role="dialog" :aria-label="editing ? 'Edit Item' : 'Add Item'">
        <h2 class="modal-title">{{ editing ? 'Edit Item' : 'Add Item' }}</h2>

        <div class="form-group">
          <label class="form-label">Name <span class="required">*</span></label>
          <input
            v-model="form.name"
            type="text"
            class="form-input"
            placeholder="e.g. Sunset Print"
            maxlength="255"
            autofocus
          />
        </div>

        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea
            v-model="form.description"
            class="form-textarea"
            placeholder="Describe this item…"
            rows="4"
          />
        </div>

        <div class="form-group">
          <label class="form-label">Image</label>
          <!-- Current image preview (edit mode) -->
          <div v-if="editing && editing.image_path && !newImageFile" class="current-image-wrap">
            <img :src="`/api/uploads/${editing.image_path}`" alt="Current image" class="current-image" />
            <button class="replace-btn" @click="triggerFileInput">Replace image</button>
          </div>
          <!-- File picker -->
          <div v-else class="file-drop" @click="triggerFileInput" @dragover.prevent @drop.prevent="onDrop">
            <template v-if="newImagePreview">
              <img :src="newImagePreview" alt="Preview" class="preview-image" />
              <button class="replace-btn" @click.stop="clearImage">Remove</button>
            </template>
            <template v-else>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28" class="drop-icon">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <span class="drop-label">Click or drag an image here</span>
              <span class="drop-hint">JPEG, PNG, GIF, WebP — max 10 MB</span>
            </template>
          </div>
          <input
            ref="fileInput"
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            style="display:none"
            @change="onFileChange"
          />
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
        <h2 class="modal-title">Delete Item?</h2>
        <p class="modal-text">
          Are you sure you want to delete <strong>{{ deletingItem?.name }}</strong>?
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
import { RouterLink, useRoute } from 'vue-router'
import { authFetch } from '@/utilities/authFetch'

const route = useRoute()
const collectionId = route.params.id

const collection = ref(null)
const items = ref([])
const loading = ref(true)

const showModal = ref(false)
const editing = ref(null)
const saving = ref(false)
const form = ref({ name: '', description: '' })
const newImageFile = ref(null)
const newImagePreview = ref(null)
const fileInput = ref(null)

const showDeleteConfirm = ref(false)
const deletingItem = ref(null)
const deleting = ref(false)

async function fetchCollection() {
  try {
    const res = await authFetch(`/api/collections/${collectionId}`)
    if (res.ok) collection.value = await res.json()
  } catch (err) {
    console.error('Failed to fetch collection:', err)
  }
}

async function fetchItems() {
  loading.value = true
  try {
    const res = await authFetch(`/api/collections/${collectionId}/items`)
    if (res.ok) items.value = await res.json()
  } catch (err) {
    console.error('Failed to fetch items:', err)
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  form.value = { name: '', description: '' }
  clearImage()
  showModal.value = true
}

function openEdit(item) {
  editing.value = item
  form.value = { name: item.name, description: item.description || '' }
  clearImage()
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  editing.value = null
  clearImage()
}

function triggerFileInput() {
  fileInput.value?.click()
}

function onFileChange(e) {
  const file = e.target.files?.[0]
  if (file) setImageFile(file)
}

function onDrop(e) {
  const file = e.dataTransfer.files?.[0]
  if (file) setImageFile(file)
}

function setImageFile(file) {
  newImageFile.value = file
  newImagePreview.value = URL.createObjectURL(file)
}

function clearImage() {
  newImageFile.value = null
  if (newImagePreview.value) {
    URL.revokeObjectURL(newImagePreview.value)
    newImagePreview.value = null
  }
  if (fileInput.value) fileInput.value.value = ''
}

async function save() {
  if (!form.value.name.trim() || saving.value) return
  saving.value = true
  try {
    const fd = new FormData()
    fd.append('name', form.value.name.trim())
    fd.append('description', form.value.description)
    if (newImageFile.value) fd.append('image', newImageFile.value)

    const url = editing.value
      ? `/api/collections/${collectionId}/items/${editing.value.id}`
      : `/api/collections/${collectionId}/items`
    const method = editing.value ? 'PUT' : 'POST'

    const res = await authFetch(url, { method, body: fd })
    if (res.ok) {
      closeModal()
      await fetchItems()
    }
  } catch (err) {
    console.error('Failed to save item:', err)
  } finally {
    saving.value = false
  }
}

function confirmDelete(item) {
  deletingItem.value = item
  showDeleteConfirm.value = true
}

async function executeDelete() {
  if (!deletingItem.value || deleting.value) return
  deleting.value = true
  try {
    const res = await authFetch(
      `/api/collections/${collectionId}/items/${deletingItem.value.id}`,
      { method: 'DELETE' }
    )
    if (res.ok) {
      showDeleteConfirm.value = false
      deletingItem.value = null
      await fetchItems()
    }
  } catch (err) {
    console.error('Failed to delete item:', err)
  } finally {
    deleting.value = false
  }
}

onMounted(() => {
  fetchCollection()
  fetchItems()
})
</script>

<style scoped>
.collection-detail-page {
  padding: 32px 20px;
  max-width: 1000px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 32px;
  flex-wrap: wrap;
}

.back-link {
  display: inline-block;
  color: var(--color-link);
  text-decoration: none;
  font-size: 0.88rem;
  margin-bottom: 6px;
}

.back-link:hover { text-decoration: underline; }

.page-header h1 {
  font-size: 1.8rem;
  color: var(--color-text);
  margin: 0;
}

/* ---- States ---- */
.loading-state {
  color: var(--color-text-secondary);
  padding: 60px 0;
  text-align: center;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  border: 2px dashed var(--color-border);
  border-radius: 12px;
  color: var(--color-text-secondary);
}

.empty-icon {
  margin: 0 auto 16px;
  color: var(--color-border);
  display: flex;
  justify-content: center;
}

.empty-state p {
  margin: 0 0 20px;
  font-size: 1rem;
}

/* ---- Items grid ---- */
.items-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 18px;
}

.item-card {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--color-background-soft, #fff);
  transition: box-shadow 0.15s;
}

.item-card:hover {
  box-shadow: 0 4px 16px rgba(0,0,0,0.1);
}

.item-image-wrap {
  width: 100%;
  aspect-ratio: 4/3;
  overflow: hidden;
  background: var(--color-background-soft, #f5f5f5);
}

.item-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.item-image-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-border);
}

.item-body {
  padding: 12px 14px;
}

.item-name {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--color-text);
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-desc {
  font-size: 0.82rem;
  color: var(--color-text-secondary);
  line-height: 1.4;
  margin-bottom: 10px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.item-actions {
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

.btn-primary:hover:not(:disabled) { opacity: 0.87; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

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

.btn-secondary:hover { border-color: var(--color-text-secondary); }

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

.btn-sm:hover { border-color: var(--color-text-secondary); }

.btn-danger {
  border-color: #e53e3e;
  color: #e53e3e;
}

.btn-danger:hover { background: rgba(229, 62, 62, 0.07); }

.btn-danger-solid { background: #e53e3e; }
.btn-danger-solid:hover:not(:disabled) { opacity: 0.87; }

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
  overflow-y: auto;
}

.modal {
  background: var(--color-background, #fff);
  border-radius: 12px;
  padding: 28px 32px;
  width: 100%;
  max-width: 480px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.2);
}

.modal-sm { max-width: 360px; }

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

.form-group { margin-bottom: 20px; }

.form-label {
  display: block;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 6px;
}

.required { color: #e53e3e; }

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

.form-input:focus { outline: none; border-color: var(--color-link); }

.form-textarea {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 0.95rem;
  color: var(--color-text);
  background: var(--color-background, #fff);
  box-sizing: border-box;
  resize: vertical;
  font-family: inherit;
  transition: border-color 0.15s;
}

.form-textarea:focus { outline: none; border-color: var(--color-link); }

/* ---- Image upload ---- */
.current-image-wrap {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.current-image {
  width: 100px;
  height: 80px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--color-border);
}

.replace-btn {
  font-size: 0.82rem;
  color: var(--color-link);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  margin-top: 4px;
}

.file-drop {
  border: 2px dashed var(--color-border);
  border-radius: 8px;
  padding: 24px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.file-drop:hover { border-color: var(--color-link); }

.drop-icon { color: var(--color-text-secondary); }

.drop-label {
  font-size: 0.9rem;
  color: var(--color-text);
  font-weight: 500;
}

.drop-hint {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
}

.preview-image {
  max-width: 180px;
  max-height: 140px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--color-border);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 28px;
}

@media (max-width: 600px) {
  .items-grid {
    grid-template-columns: 1fr 1fr;
  }
  .modal {
    padding: 20px;
  }
}

@media (max-width: 400px) {
  .items-grid {
    grid-template-columns: 1fr;
  }
}
</style>
