<script setup>
import { ref, computed, onMounted } from 'vue'
import { authFetch } from '@/utilities/authFetch'
import LoadingSpinner from '@/components/LoadingSpinner.vue'

const settings = ref(null)
const artworks = ref([])
const loading = ref(true)
const saving = ref(false)
const uploading = ref(false)
const error = ref('')
const successMessage = ref('')

// Settings form
const galleryUrl = ref('')
const galleryName = ref('')
const urlAvailable = ref(true)
const urlChecking = ref(false)

// Upload modal
const showUploadModal = ref(false)
const uploadTitle = ref('')
const uploadDescription = ref('')
const uploadPublished = ref(false)
const uploadFile = ref(null)
const uploadPreview = ref(null)

// Edit modal
const showEditModal = ref(false)
const editingArtwork = ref(null)
const editTitle = ref('')
const editDescription = ref('')
const editPublished = ref(false)

// Delete confirmation
const showDeleteConfirm = ref(false)
const deletingArtwork = ref(null)

// Lightbox for viewing artwork
const showLightbox = ref(false)
const lightboxArtwork = ref(null)

const publicGalleryUrl = computed(() => {
  if (!settings.value?.gallery_url) return ''
  return `${window.location.origin}/g/${settings.value.gallery_url}`
})

const publishedCount = computed(() => {
  return artworks.value.filter(a => a.is_published).length
})

onMounted(async () => {
  await loadGalleryData()
})

async function loadGalleryData() {
  loading.value = true
  error.value = ''

  try {
    const [settingsRes, artworksRes] = await Promise.all([
      authFetch('/api/gallery/settings'),
      authFetch('/api/gallery/artworks')
    ])

    if (settingsRes.ok) {
      const data = await settingsRes.json()
      settings.value = data.settings
      if (data.settings) {
        galleryUrl.value = data.settings.gallery_url
        galleryName.value = data.settings.gallery_name
      }
    }

    if (artworksRes.ok) {
      const data = await artworksRes.json()
      artworks.value = data.artworks
    }
  } catch (err) {
    error.value = 'Failed to load gallery data'
    console.error(err)
  } finally {
    loading.value = false
  }
}

async function saveSettings() {
  saving.value = true
  error.value = ''
  successMessage.value = ''

  try {
    const method = settings.value ? 'PUT' : 'POST'
    const res = await authFetch('/api/gallery/settings', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gallery_url: galleryUrl.value,
        gallery_name: galleryName.value
      })
    })

    if (res.ok) {
      const data = await res.json()
      settings.value = data.settings
      successMessage.value = 'Settings saved successfully'
      setTimeout(() => successMessage.value = '', 3000)
    } else {
      const data = await res.json()
      error.value = data.message || 'Failed to save settings'
    }
  } catch (err) {
    error.value = 'Failed to save settings'
    console.error(err)
  } finally {
    saving.value = false
  }
}

let urlCheckTimeout = null
async function checkUrl() {
  if (!galleryUrl.value.trim()) {
    urlAvailable.value = true
    return
  }

  clearTimeout(urlCheckTimeout)
  urlCheckTimeout = setTimeout(async () => {
    urlChecking.value = true
    try {
      const res = await authFetch(`/api/gallery/check-url/${encodeURIComponent(galleryUrl.value)}`)
      if (res.ok) {
        const data = await res.json()
        urlAvailable.value = data.available
      }
    } catch (err) {
      console.error(err)
    } finally {
      urlChecking.value = false
    }
  }, 300)
}

function openUploadModal() {
  uploadTitle.value = ''
  uploadDescription.value = ''
  uploadPublished.value = false
  uploadFile.value = null
  uploadPreview.value = null
  showUploadModal.value = true
}

function handleFileSelect(event) {
  const file = event.target.files[0]
  if (file) {
    uploadFile.value = file
    const reader = new FileReader()
    reader.onload = (e) => {
      uploadPreview.value = e.target.result
    }
    reader.readAsDataURL(file)
  }
}

async function uploadArtwork() {
  if (!uploadFile.value || !uploadTitle.value.trim()) {
    error.value = 'Title and image are required'
    return
  }

  uploading.value = true
  error.value = ''

  try {
    const formData = new FormData()
    formData.append('image', uploadFile.value)
    formData.append('title', uploadTitle.value.trim())
    formData.append('description', uploadDescription.value)
    formData.append('isPublished', uploadPublished.value)

    const res = await authFetch('/api/gallery/artworks', {
      method: 'POST',
      body: formData
    })

    if (res.ok) {
      const data = await res.json()
      artworks.value.unshift(data.artwork)
      showUploadModal.value = false
      successMessage.value = 'Artwork uploaded successfully'
      setTimeout(() => successMessage.value = '', 3000)

      // Reload settings in case gallery was auto-created
      if (!settings.value) {
        const settingsRes = await authFetch('/api/gallery/settings')
        if (settingsRes.ok) {
          const settingsData = await settingsRes.json()
          settings.value = settingsData.settings
          if (settingsData.settings) {
            galleryUrl.value = settingsData.settings.gallery_url
            galleryName.value = settingsData.settings.gallery_name
          }
        }
      }
    } else {
      const data = await res.json()
      error.value = data.message || 'Failed to upload artwork'
    }
  } catch (err) {
    error.value = 'Failed to upload artwork'
    console.error(err)
  } finally {
    uploading.value = false
  }
}

function openEditModal(artwork) {
  editingArtwork.value = artwork
  editTitle.value = artwork.title
  editDescription.value = artwork.description || ''
  editPublished.value = artwork.is_published
  showEditModal.value = true
}

async function saveArtwork() {
  if (!editTitle.value.trim()) {
    error.value = 'Title is required'
    return
  }

  saving.value = true
  error.value = ''

  try {
    const res = await authFetch(`/api/gallery/artworks/${editingArtwork.value.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: editTitle.value.trim(),
        description: editDescription.value,
        isPublished: editPublished.value
      })
    })

    if (res.ok) {
      const data = await res.json()
      const index = artworks.value.findIndex(a => a.id === editingArtwork.value.id)
      if (index !== -1) {
        artworks.value[index] = data.artwork
      }
      showEditModal.value = false
      successMessage.value = 'Artwork updated successfully'
      setTimeout(() => successMessage.value = '', 3000)
    } else {
      const data = await res.json()
      error.value = data.message || 'Failed to update artwork'
    }
  } catch (err) {
    error.value = 'Failed to update artwork'
    console.error(err)
  } finally {
    saving.value = false
  }
}

function confirmDelete(artwork) {
  deletingArtwork.value = artwork
  showDeleteConfirm.value = true
}

async function deleteArtwork() {
  if (!deletingArtwork.value) return

  saving.value = true
  error.value = ''

  try {
    const res = await authFetch(`/api/gallery/artworks/${deletingArtwork.value.id}`, {
      method: 'DELETE'
    })

    if (res.ok) {
      artworks.value = artworks.value.filter(a => a.id !== deletingArtwork.value.id)
      showDeleteConfirm.value = false
      deletingArtwork.value = null
      successMessage.value = 'Artwork deleted successfully'
      setTimeout(() => successMessage.value = '', 3000)
    } else {
      const data = await res.json()
      error.value = data.message || 'Failed to delete artwork'
    }
  } catch (err) {
    error.value = 'Failed to delete artwork'
    console.error(err)
  } finally {
    saving.value = false
  }
}

async function togglePublished(artwork) {
  try {
    const res = await authFetch(`/api/gallery/artworks/${artwork.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: artwork.title,
        description: artwork.description,
        isPublished: !artwork.is_published
      })
    })

    if (res.ok) {
      const data = await res.json()
      const index = artworks.value.findIndex(a => a.id === artwork.id)
      if (index !== -1) {
        artworks.value[index] = data.artwork
      }
    }
  } catch (err) {
    console.error('Failed to toggle published status:', err)
  }
}

function openLightbox(artwork) {
  lightboxArtwork.value = artwork
  showLightbox.value = true
}

function closeLightbox() {
  showLightbox.value = false
  lightboxArtwork.value = null
}

function getImageUrl(imagePath) {
  return `/api/uploads/${imagePath}`
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

function copyGalleryUrl() {
  navigator.clipboard.writeText(publicGalleryUrl.value)
  successMessage.value = 'Gallery URL copied to clipboard'
  setTimeout(() => successMessage.value = '', 3000)
}
</script>

<template>
  <div class="page-container art-gallery-page">
    <header class="page-header">
      <h1>Art Gallery</h1>
      <p class="subtitle">Upload and display your artwork</p>
    </header>

    <div v-if="loading" class="loading"><LoadingSpinner size="small" /> Loading gallery...</div>

    <div v-else class="gallery-content">
      <!-- Success/Error Messages -->
      <div v-if="successMessage" class="message success">{{ successMessage }}</div>
      <div v-if="error" class="message error">{{ error }}</div>

      <!-- Gallery Settings Section -->
      <section class="settings-section">
        <h2>Gallery Settings</h2>
        <div class="settings-form">
          <div class="form-group">
            <label for="galleryName">Gallery Name</label>
            <input
              id="galleryName"
              v-model="galleryName"
              type="text"
              placeholder="My Art Gallery"
            />
          </div>
          <div class="form-group">
            <label for="galleryUrl">Gallery URL</label>
            <div class="url-input-wrapper">
              <span class="url-prefix">/g/</span>
              <input
                id="galleryUrl"
                v-model="galleryUrl"
                type="text"
                placeholder="my-gallery"
                @input="checkUrl"
              />
              <span v-if="urlChecking" class="url-status checking">Checking...</span>
              <span v-else-if="!urlAvailable" class="url-status unavailable">Taken</span>
              <span v-else-if="galleryUrl" class="url-status available">Available</span>
            </div>
          </div>
          <div class="settings-actions">
            <button
              class="btn-primary"
              :disabled="saving || !urlAvailable"
              @click="saveSettings"
            >
              {{ saving ? 'Saving...' : 'Save Settings' }}
            </button>
            <div v-if="settings" class="public-url">
              <span>Public URL:</span>
              <a :href="publicGalleryUrl" target="_blank">{{ publicGalleryUrl }}</a>
              <button class="btn-copy" @click="copyGalleryUrl" title="Copy URL">
                Copy
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Artworks Section -->
      <section class="artworks-section">
        <div class="section-header">
          <h2>Your Artworks</h2>
          <div class="section-info">
            <span class="artwork-count">{{ artworks.length }} artworks</span>
            <span class="published-count">{{ publishedCount }} published</span>
            <button class="btn-primary" @click="openUploadModal">
              + Upload Artwork
            </button>
          </div>
        </div>

        <div v-if="artworks.length === 0" class="empty-state">
          <p>You haven't uploaded any artwork yet.</p>
          <button class="btn-primary" @click="openUploadModal">Upload Your First Artwork</button>
        </div>

        <div v-else class="artworks-grid">
          <div
            v-for="artwork in artworks"
            :key="artwork.id"
            class="artwork-card"
            :class="{ published: artwork.is_published }"
          >
            <div class="artwork-image" @click="openLightbox(artwork)">
              <img :src="getImageUrl(artwork.image_path)" :alt="artwork.title" />
              <div class="artwork-overlay">
                <span class="view-icon">View</span>
              </div>
            </div>
            <div class="artwork-info">
              <h3>{{ artwork.title }}</h3>
              <p v-if="artwork.description" class="description">{{ artwork.description }}</p>
              <p class="date">{{ formatDate(artwork.created_at) }}</p>
            </div>
            <div class="artwork-actions">
              <button
                class="btn-toggle"
                :class="{ active: artwork.is_published }"
                @click="togglePublished(artwork)"
                :title="artwork.is_published ? 'Unpublish' : 'Publish'"
              >
                {{ artwork.is_published ? 'Published' : 'Draft' }}
              </button>
              <button class="btn-edit" @click="openEditModal(artwork)">Edit</button>
              <button class="btn-delete" @click="confirmDelete(artwork)">Delete</button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- Upload Modal -->
    <div v-if="showUploadModal" class="modal-overlay" @click.self="showUploadModal = false">
      <div class="modal">
        <h3>Upload Artwork</h3>
        <div class="form-group">
          <label>Image (max 10MB)</label>
          <input type="file" accept="image/*" @change="handleFileSelect" />
          <div v-if="uploadPreview" class="upload-preview">
            <img :src="uploadPreview" alt="Preview" />
          </div>
        </div>
        <div class="form-group">
          <label>Title *</label>
          <input v-model="uploadTitle" type="text" placeholder="Artwork title" />
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea v-model="uploadDescription" placeholder="Optional description" rows="3"></textarea>
        </div>
        <div class="form-group checkbox">
          <label>
            <input type="checkbox" v-model="uploadPublished" />
            Publish immediately
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showUploadModal = false">Cancel</button>
          <button
            class="btn-primary"
            :disabled="uploading || !uploadFile || !uploadTitle.trim()"
            @click="uploadArtwork"
          >
            {{ uploading ? 'Uploading...' : 'Upload' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Edit Modal -->
    <div v-if="showEditModal" class="modal-overlay" @click.self="showEditModal = false">
      <div class="modal">
        <h3>Edit Artwork</h3>
        <div class="form-group">
          <label>Title *</label>
          <input v-model="editTitle" type="text" placeholder="Artwork title" />
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea v-model="editDescription" placeholder="Optional description" rows="3"></textarea>
        </div>
        <div class="form-group checkbox">
          <label>
            <input type="checkbox" v-model="editPublished" />
            Published
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showEditModal = false">Cancel</button>
          <button
            class="btn-primary"
            :disabled="saving || !editTitle.trim()"
            @click="saveArtwork"
          >
            {{ saving ? 'Saving...' : 'Save' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Delete Confirmation Modal -->
    <div v-if="showDeleteConfirm" class="modal-overlay" @click.self="showDeleteConfirm = false">
      <div class="modal modal-small">
        <h3>Delete Artwork</h3>
        <p>Are you sure you want to delete "{{ deletingArtwork?.title }}"? This cannot be undone.</p>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showDeleteConfirm = false">Cancel</button>
          <button class="btn-danger" :disabled="saving" @click="deleteArtwork">
            {{ saving ? 'Deleting...' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Lightbox -->
    <div v-if="showLightbox" class="lightbox-overlay" @click="closeLightbox">
      <div class="lightbox-content" @click.stop>
        <button class="lightbox-close" @click="closeLightbox">&times;</button>
        <img :src="getImageUrl(lightboxArtwork.image_path)" :alt="lightboxArtwork.title" />
        <div class="lightbox-info">
          <h3>{{ lightboxArtwork.title }}</h3>
          <p v-if="lightboxArtwork.description">{{ lightboxArtwork.description }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.art-gallery-page {
  max-width: 1200px;
}

.page-header {
  margin-bottom: 24px;
}

.page-header h1 {
  font-size: 2.2rem;
  font-weight: 700;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin: 0 0 8px;
}

.subtitle {
  color: var(--color-text-muted);
  margin: 0;
  font-size: 1.1rem;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 60px;
  color: var(--color-text-muted);
}

.message {
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 16px;
}

.message.success {
  background: var(--color-success-bg, rgba(52, 211, 153, 0.1));
  color: var(--color-success, #10b981);
  border: 1px solid var(--color-success, #10b981);
}

.message.error {
  background: var(--color-error-bg, rgba(239, 68, 68, 0.1));
  color: var(--color-error, #ef4444);
  border: 1px solid var(--color-error, #ef4444);
}

/* Settings Section */
.settings-section {
  background: var(--color-background-card);
  border-radius: var(--card-radius);
  padding: 24px;
  margin-bottom: 24px;
  box-shadow: var(--shadow-sm);
}

.settings-section h2 {
  margin: 0 0 20px;
  font-size: 1.3rem;
  color: var(--color-text);
}

.settings-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-weight: 500;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.form-group input[type="text"],
.form-group textarea {
  padding: 10px 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 1rem;
  background: var(--color-background);
  color: var(--color-text);
}

.form-group input:focus,
.form-group textarea:focus {
  outline: none;
  border-color: var(--color-accent);
}

.form-group.checkbox {
  flex-direction: row;
  align-items: center;
}

.form-group.checkbox label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.url-input-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
}

.url-prefix {
  color: var(--color-text-muted);
  font-family: monospace;
}

.url-input-wrapper input {
  flex: 1;
}

.url-status {
  font-size: 0.85rem;
  padding: 4px 10px;
  border-radius: 4px;
}

.url-status.checking {
  color: var(--color-text-muted);
}

.url-status.available {
  color: var(--color-success);
  background: var(--color-success-bg, rgba(52, 211, 153, 0.1));
}

.url-status.unavailable {
  color: var(--color-error);
  background: var(--color-error-bg, rgba(239, 68, 68, 0.1));
}

.settings-actions {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.public-url {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  color: var(--color-text-secondary);
}

.public-url a {
  color: var(--color-accent);
  text-decoration: none;
}

.public-url a:hover {
  text-decoration: underline;
}

.btn-copy {
  padding: 4px 10px;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.btn-copy:hover {
  background: var(--color-background-hover);
}

/* Artworks Section */
.artworks-section {
  background: var(--color-background-card);
  border-radius: var(--card-radius);
  padding: 24px;
  box-shadow: var(--shadow-sm);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;
}

.section-header h2 {
  margin: 0;
  font-size: 1.3rem;
  color: var(--color-text);
}

.section-info {
  display: flex;
  align-items: center;
  gap: 16px;
}

.artwork-count,
.published-count {
  font-size: 0.9rem;
  color: var(--color-text-muted);
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--color-text-muted);
}

.empty-state p {
  margin-bottom: 16px;
}

/* Artworks Grid */
.artworks-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

.artwork-card {
  background: var(--color-background-soft);
  border-radius: var(--card-radius);
  overflow: hidden;
  transition: transform 0.2s, box-shadow 0.2s;
}

.artwork-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.artwork-card.published {
  border: 2px solid var(--color-success);
}

.artwork-image {
  position: relative;
  aspect-ratio: 4/3;
  overflow: hidden;
  cursor: pointer;
}

.artwork-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s;
}

.artwork-image:hover img {
  transform: scale(1.05);
}

.artwork-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}

.artwork-image:hover .artwork-overlay {
  opacity: 1;
}

.view-icon {
  color: white;
  font-weight: 500;
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 20px;
}

.artwork-info {
  padding: 16px;
}

.artwork-info h3 {
  margin: 0 0 8px;
  font-size: 1.1rem;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.artwork-info .description {
  margin: 0 0 8px;
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.artwork-info .date {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.artwork-actions {
  display: flex;
  gap: 8px;
  padding: 0 16px 16px;
}

.artwork-actions button {
  flex: 1;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
  transition: background 0.2s;
}

.btn-toggle {
  background: var(--color-background);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border) !important;
}

.btn-toggle.active {
  background: var(--color-success);
  color: white;
  border-color: var(--color-success) !important;
}

.btn-edit {
  background: var(--color-button-secondary);
  color: var(--color-text-secondary);
}

.btn-edit:hover {
  background: var(--color-button-secondary-hover);
}

.btn-delete {
  background: var(--color-error-bg, rgba(239, 68, 68, 0.1));
  color: var(--color-error);
}

.btn-delete:hover {
  background: var(--color-error);
  color: white;
}

/* Buttons */
.btn-primary {
  padding: 10px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  border-radius: 8px;
  color: white;
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  padding: 10px 20px;
  background: var(--color-button-secondary);
  border: none;
  border-radius: 8px;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background 0.2s;
}

.btn-secondary:hover {
  background: var(--color-button-secondary-hover);
}

.btn-danger {
  padding: 10px 20px;
  background: var(--color-error);
  border: none;
  border-radius: 8px;
  color: white;
  cursor: pointer;
}

.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal {
  background: var(--color-background-card);
  border-radius: 12px;
  padding: 24px;
  width: 100%;
  max-width: 500px;
  max-height: 90vh;
  overflow-y: auto;
}

.modal.modal-small {
  max-width: 400px;
}

.modal h3 {
  margin: 0 0 20px;
  color: var(--color-text);
}

.modal p {
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.modal .form-group {
  margin-bottom: 16px;
}

.upload-preview {
  margin-top: 12px;
  border-radius: 8px;
  overflow: hidden;
  max-height: 200px;
}

.upload-preview img {
  width: 100%;
  height: auto;
  object-fit: contain;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
}

/* Lightbox */
.lightbox-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  padding: 20px;
}

.lightbox-content {
  position: relative;
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.lightbox-close {
  position: absolute;
  top: -40px;
  right: 0;
  background: none;
  border: none;
  color: white;
  font-size: 2rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.lightbox-content img {
  max-width: 100%;
  max-height: 80vh;
  object-fit: contain;
  border-radius: 8px;
}

.lightbox-info {
  text-align: center;
  margin-top: 16px;
  color: white;
}

.lightbox-info h3 {
  margin: 0 0 8px;
}

.lightbox-info p {
  margin: 0;
  color: rgba(255, 255, 255, 0.8);
}

/* Responsive */
@media (max-width: 600px) {
  .section-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .section-info {
    width: 100%;
    justify-content: space-between;
  }

  .settings-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .public-url {
    flex-direction: column;
    align-items: flex-start;
  }

  .artworks-grid {
    grid-template-columns: 1fr;
  }
}
</style>
