<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import LoadingSpinner from '../components/LoadingSpinner.vue'

const route = useRoute()
const router = useRouter()

const gallery = ref(null)
const artworks = ref([])
const currentArtwork = ref(null)
const loading = ref(true)
const error = ref('')

const galleryUrl = computed(() => route.params.galleryUrl)
const artworkId = computed(() => route.params.artworkId)

const artistName = computed(() => {
  if (!gallery.value?.artist) return ''
  const { first_name, last_name, handle } = gallery.value.artist
  if (first_name || last_name) {
    return `${first_name || ''} ${last_name || ''}`.trim()
  }
  return handle
})

const artistPhotoUrl = computed(() => {
  if (!gallery.value?.artist?.photo_path) return null
  return `/api/uploads/${gallery.value.artist.photo_path}`
})

onMounted(() => {
  fetchGallery()
})

watch([galleryUrl, artworkId], () => {
  if (artworkId.value && artworks.value.length > 0) {
    selectArtworkById(artworkId.value)
  } else if (!artworkId.value) {
    currentArtwork.value = null
  } else {
    fetchGallery()
  }
})

async function fetchGallery() {
  loading.value = true
  error.value = ''

  try {
    const res = await fetch(`/api/gallery/public/${galleryUrl.value}`)
    if (!res.ok) {
      if (res.status === 404) {
        error.value = 'Gallery not found'
      } else {
        error.value = 'Failed to load gallery'
      }
      return
    }

    const data = await res.json()
    gallery.value = data.gallery
    artworks.value = data.artworks

    // Set page title
    const artistFirstName = data.gallery.artist?.first_name || data.gallery.artist?.handle || ''
    document.title = `${data.gallery.gallery_name} - ${artistFirstName}'s Gallery`

    // Select artwork based on URL
    if (artworkId.value) {
      selectArtworkById(artworkId.value)
    }
  } catch (err) {
    console.error('Error fetching gallery:', err)
    error.value = 'Failed to load gallery'
  } finally {
    loading.value = false
  }
}

function selectArtworkById(id) {
  const artwork = artworks.value.find(a => a.id === parseInt(id))
  if (artwork) {
    currentArtwork.value = artwork
  } else {
    error.value = 'Artwork not found'
  }
}

function selectArtwork(artwork) {
  currentArtwork.value = artwork
  router.push({ name: 'publicGalleryArtwork', params: { galleryUrl: galleryUrl.value, artworkId: artwork.id } })
}

function closeArtwork() {
  currentArtwork.value = null
  router.push({ name: 'publicGallery', params: { galleryUrl: galleryUrl.value } })
}

function getImageUrl(imagePath) {
  return `/api/uploads/${imagePath}`
}

function formatDate(dateStr) {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

function goToArtistProfile() {
  if (gallery.value?.artist?.handle) {
    router.push({ name: 'publicProfile', params: { handle: gallery.value.artist.handle } })
  }
}

function navigateArtwork(direction) {
  if (!currentArtwork.value) return
  const currentIndex = artworks.value.findIndex(a => a.id === currentArtwork.value.id)
  let newIndex = currentIndex + direction
  if (newIndex < 0) newIndex = artworks.value.length - 1
  if (newIndex >= artworks.value.length) newIndex = 0
  selectArtwork(artworks.value[newIndex])
}
</script>

<template>
  <main class="public-gallery-page">
    <div v-if="loading" class="loading">
      <LoadingSpinner size="small" /> Loading gallery...
    </div>

    <div v-else-if="error" class="error-container">
      <p class="error">{{ error }}</p>
      <router-link to="/" class="back-link">Go to homepage</router-link>
    </div>

    <div v-else-if="gallery" class="gallery-container">
      <!-- Artist Header -->
      <header class="gallery-header" @click="goToArtistProfile">
        <div class="artist-photo">
          <img v-if="artistPhotoUrl" :src="artistPhotoUrl" :alt="artistName" />
          <div v-else class="photo-placeholder">{{ gallery.artist?.handle?.charAt(0)?.toUpperCase() || '?' }}</div>
        </div>
        <div class="artist-info">
          <h1 class="gallery-title">{{ gallery.gallery_name }}</h1>
          <p class="artist-name">by {{ artistName }}</p>
          <p v-if="gallery.artist?.bio" class="artist-bio">{{ gallery.artist.bio }}</p>
        </div>
      </header>

      <!-- Artwork Count -->
      <div class="artwork-count-bar">
        <span>{{ artworks.length }} {{ artworks.length === 1 ? 'artwork' : 'artworks' }}</span>
      </div>

      <!-- Artworks Grid -->
      <div v-if="artworks.length === 0" class="no-artworks">
        <p>No published artworks yet.</p>
      </div>

      <div v-else class="artworks-grid">
        <div
          v-for="artwork in artworks"
          :key="artwork.id"
          class="artwork-card"
          @click="selectArtwork(artwork)"
        >
          <div class="artwork-image">
            <img :src="getImageUrl(artwork.image_path)" :alt="artwork.title" />
          </div>
          <div class="artwork-info">
            <h3>{{ artwork.title }}</h3>
            <p class="date">{{ formatDate(artwork.created_at) }}</p>
          </div>
        </div>
      </div>

      <!-- Lightbox for single artwork view -->
      <div v-if="currentArtwork" class="lightbox" @click="closeArtwork">
        <div class="lightbox-content" @click.stop>
          <button class="lightbox-close" @click="closeArtwork">&times;</button>

          <button class="lightbox-nav prev" @click="navigateArtwork(-1)">&lsaquo;</button>

          <div class="lightbox-image">
            <img :src="getImageUrl(currentArtwork.image_path)" :alt="currentArtwork.title" />
          </div>

          <button class="lightbox-nav next" @click="navigateArtwork(1)">&rsaquo;</button>

          <div class="lightbox-details">
            <h2>{{ currentArtwork.title }}</h2>
            <p v-if="currentArtwork.description" class="description">{{ currentArtwork.description }}</p>
            <p class="meta">{{ formatDate(currentArtwork.created_at) }}</p>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.public-gallery-page {
  min-height: 100vh;
  background: var(--color-background-page);
}

.loading,
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 50vh;
  color: var(--color-text-muted);
}

.loading {
  flex-direction: row;
  gap: 10px;
}

.error {
  color: var(--color-error);
  margin-bottom: 20px;
}

.back-link {
  color: var(--color-accent);
  text-decoration: none;
}

.back-link:hover {
  text-decoration: underline;
}

.gallery-container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
}

/* Header */
.gallery-header {
  display: flex;
  align-items: flex-start;
  gap: 20px;
  padding: 30px;
  background: var(--color-background-card);
  border-radius: var(--card-radius);
  box-shadow: var(--shadow-md);
  margin-bottom: 20px;
  cursor: pointer;
  transition: box-shadow 0.2s;
}

.gallery-header:hover {
  box-shadow: var(--shadow-lg);
}

.artist-photo {
  flex-shrink: 0;
}

.artist-photo img {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  object-fit: cover;
}

.photo-placeholder {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  font-weight: bold;
}

.artist-info {
  flex: 1;
}

.gallery-title {
  margin: 0 0 5px;
  font-size: 1.8rem;
  color: var(--color-text);
}

.artist-name {
  margin: 0 0 8px;
  color: var(--color-text-muted);
  font-size: 1rem;
}

.artist-bio {
  margin: 0;
  color: var(--color-text-light);
  font-size: 0.9rem;
  line-height: 1.5;
}

/* Artwork count bar */
.artwork-count-bar {
  padding: 12px 20px;
  background: var(--color-background-soft);
  border-radius: var(--card-radius-sm);
  margin-bottom: 20px;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

/* No artworks */
.no-artworks {
  text-align: center;
  padding: 60px 20px;
  background: var(--color-background-card);
  border-radius: var(--card-radius);
  color: var(--color-text-muted);
}

/* Artworks Grid */
.artworks-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}

.artwork-card {
  background: var(--color-background-card);
  border-radius: var(--card-radius);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.artwork-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
}

.artwork-image {
  aspect-ratio: 4/3;
  overflow: hidden;
}

.artwork-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s;
}

.artwork-card:hover .artwork-image img {
  transform: scale(1.05);
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

.artwork-info .date {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

/* Lightbox */
.lightbox {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.95);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
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
  top: -50px;
  right: 0;
  background: none;
  border: none;
  color: white;
  font-size: 2.5rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  z-index: 10;
}

.lightbox-close:hover {
  color: var(--color-accent);
}

.lightbox-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  font-size: 3rem;
  cursor: pointer;
  padding: 20px 15px;
  border-radius: 8px;
  transition: background 0.2s;
  z-index: 10;
}

.lightbox-nav:hover {
  background: rgba(255, 255, 255, 0.2);
}

.lightbox-nav.prev {
  left: -80px;
}

.lightbox-nav.next {
  right: -80px;
}

.lightbox-image {
  max-width: 100%;
  max-height: 70vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lightbox-image img {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
  border-radius: 8px;
}

.lightbox-details {
  text-align: center;
  margin-top: 20px;
  color: white;
  max-width: 600px;
}

.lightbox-details h2 {
  margin: 0 0 12px;
  font-size: 1.5rem;
}

.lightbox-details .description {
  margin: 0 0 12px;
  color: rgba(255, 255, 255, 0.8);
  line-height: 1.6;
}

.lightbox-details .meta {
  margin: 0;
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.9rem;
}

/* Responsive */
@media (max-width: 768px) {
  .gallery-header {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .artworks-grid {
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  }

  .lightbox-nav {
    display: none;
  }
}

@media (max-width: 480px) {
  .artworks-grid {
    grid-template-columns: 1fr;
  }
}
</style>
