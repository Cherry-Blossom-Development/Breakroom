<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import LoadingSpinner from '@/components/LoadingSpinner.vue'

const router = useRouter()

const galleries = ref([])
const loading = ref(true)
const error = ref('')
const searchQuery = ref('')

onMounted(async () => {
  await loadGalleries()
})

async function loadGalleries() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch('/api/gallery/public', { credentials: 'include' })
    if (!res.ok) throw new Error('Failed to load galleries')
    const data = await res.json()
    galleries.value = data.galleries || []
  } catch (err) {
    error.value = 'Failed to load public galleries'
    console.error(err)
  } finally {
    loading.value = false
  }
}

const filteredGalleries = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return galleries.value
  return galleries.value.filter(g => {
    const artistName = `${g.artist.first_name || ''} ${g.artist.last_name || ''}`.toLowerCase()
    return g.gallery_name.toLowerCase().includes(q) ||
      artistName.includes(q) ||
      g.artist.handle.toLowerCase().includes(q)
  })
})

function artistName(g) {
  const { first_name, last_name, handle } = g.artist
  if (first_name || last_name) return `${first_name || ''} ${last_name || ''}`.trim()
  return handle
}

function getPhotoUrl(path) {
  return path ? `/api/uploads/${path}` : null
}

function getInitial(g) {
  return g.artist.first_name?.charAt(0) || g.artist.handle?.charAt(0) || '?'
}

function openGallery(g) {
  router.push(`/g/${g.gallery_url}`)
}
</script>

<template>
  <div class="page-container public-galleries-page">
    <h1>Public Galleries</h1>
    <p class="page-subtitle">Browse art galleries other artists have made public.</p>

    <input
      v-model="searchQuery"
      type="text"
      class="search-input"
      placeholder="Search by gallery name or artist..."
    />

    <div v-if="loading" class="loading"><LoadingSpinner size="small" /> Loading...</div>
    <div v-else-if="error" class="error-message">{{ error }}</div>
    <div v-else-if="filteredGalleries.length === 0" class="empty-state">
      {{ galleries.length === 0 ? 'No public galleries yet.' : 'No galleries match your search.' }}
    </div>

    <div v-else class="galleries-grid">
      <div
        v-for="gallery in filteredGalleries"
        :key="gallery.gallery_url"
        class="gallery-card"
        @click="openGallery(gallery)"
      >
        <div class="gallery-cover">
          <img v-if="gallery.cover_image_path" :src="getPhotoUrl(gallery.cover_image_path)" :alt="gallery.gallery_name" />
          <div v-else class="cover-placeholder">No preview</div>
        </div>
        <div class="gallery-info">
          <h3 class="gallery-name">{{ gallery.gallery_name }}</h3>
          <div class="gallery-artist">
            <div class="artist-avatar">
              <img v-if="getPhotoUrl(gallery.artist.photo_path)" :src="getPhotoUrl(gallery.artist.photo_path)" alt="" />
              <span v-else class="avatar-placeholder">{{ getInitial(gallery) }}</span>
            </div>
            <span class="artist-name">{{ artistName(gallery) }}</span>
          </div>
          <span class="artwork-count">{{ gallery.artwork_count }} artwork{{ gallery.artwork_count === 1 ? '' : 's' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.public-galleries-page {
  max-width: 1100px;
}

.page-subtitle {
  color: var(--color-text-muted);
  margin-top: -8px;
  margin-bottom: 20px;
}

.search-input {
  width: 100%;
  max-width: 400px;
  padding: 10px 14px;
  border-radius: var(--card-radius);
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  color: var(--color-text);
  margin-bottom: 24px;
}

.loading,
.empty-state,
.error-message {
  color: var(--color-text-muted);
  padding: 40px 0;
  text-align: center;
}

.galleries-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 20px;
}

.gallery-card {
  background: var(--color-background-soft);
  border-radius: var(--card-radius);
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.gallery-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.gallery-cover {
  aspect-ratio: 4/3;
  overflow: hidden;
  background: var(--color-background-mute);
}

.gallery-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.gallery-info {
  padding: 14px;
}

.gallery-name {
  margin: 0 0 8px;
  font-size: 1rem;
}

.gallery-artist {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.artist-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--color-background-mute);
  display: flex;
  align-items: center;
  justify-content: center;
}

.artist-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-placeholder {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-muted);
}

.artist-name {
  font-size: 0.9rem;
  color: var(--color-text-muted);
}

.artwork-count {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
</style>
