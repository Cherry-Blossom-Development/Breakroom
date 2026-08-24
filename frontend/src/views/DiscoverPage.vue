<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import LoadingSpinner from '@/components/LoadingSpinner.vue'

const router = useRouter()

const showcases = ref([])
const galleries = ref([])
const loading = ref(true)
const error = ref('')
const searchQuery = ref('')

onMounted(async () => {
  await loadAll()
})

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const [galleryRes, storefrontRes] = await Promise.all([
      fetch('/api/gallery/public', { credentials: 'include' }),
      fetch('/api/storefront/public', { credentials: 'include' })
    ])
    if (!galleryRes.ok || !storefrontRes.ok) throw new Error('Failed to load')
    const galleryData = await galleryRes.json()
    const storefrontData = await storefrontRes.json()
    galleries.value = galleryData.galleries || []
    showcases.value = storefrontData.storefronts || []
  } catch (err) {
    error.value = 'Failed to load Discover content'
    console.error(err)
  } finally {
    loading.value = false
  }
}

function matchesQuery(name, artist, q) {
  const artistName = `${artist.first_name || ''} ${artist.last_name || ''}`.toLowerCase()
  return name.toLowerCase().includes(q) ||
    artistName.includes(q) ||
    artist.handle.toLowerCase().includes(q)
}

const filteredShowcases = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return showcases.value
  return showcases.value.filter(s => matchesQuery(s.page_title || s.store_url, s.artist, q))
})

const filteredGalleries = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return galleries.value
  return galleries.value.filter(g => matchesQuery(g.gallery_name, g.artist, q))
})

function artistName(artist) {
  const { first_name, last_name, handle } = artist
  if (first_name || last_name) return `${first_name || ''} ${last_name || ''}`.trim()
  return handle
}

function getPhotoUrl(path) {
  return path ? `/api/uploads/${path}` : null
}

function getInitial(artist) {
  return artist.first_name?.charAt(0) || artist.handle?.charAt(0) || '?'
}

function openShowcase(s) {
  router.push(`/store/${s.store_url}`)
}

function openGallery(g) {
  router.push(`/g/${g.gallery_url}`)
}
</script>

<template>
  <div class="page-container discover-page">
    <h1>Discover</h1>
    <p class="page-subtitle">Browse art galleries and artist showcases people have made discoverable.</p>

    <input
      v-model="searchQuery"
      type="text"
      class="search-input"
      placeholder="Search by name or artist..."
      aria-label="Search by name or artist"
    />

    <div v-if="loading" class="loading"><LoadingSpinner size="small" /> Loading...</div>
    <div v-else-if="error" class="error-message">{{ error }}</div>

    <template v-else>
      <section class="discover-section">
        <h2 class="section-heading">Showcases</h2>
        <div v-if="filteredShowcases.length === 0" class="empty-state">
          {{ showcases.length === 0 ? 'Nothing to discover yet.' : 'No showcases match your search.' }}
        </div>
        <div v-else class="discover-grid">
          <div
            v-for="showcase in filteredShowcases"
            :key="showcase.store_url"
            class="discover-card"
            tabindex="0"
            role="button"
            :aria-label="`Open ${showcase.page_title || showcase.store_url} showcase by ${artistName(showcase.artist)}, ${showcase.item_count} item${showcase.item_count === 1 ? '' : 's'}`"
            @click="openShowcase(showcase)"
            @keydown.enter="openShowcase(showcase)"
            @keydown.space.prevent="openShowcase(showcase)"
          >
            <div class="discover-cover" aria-hidden="true">
              <img v-if="showcase.cover_image_path" :src="getPhotoUrl(showcase.cover_image_path)" alt="" />
              <div v-else class="cover-placeholder">No preview</div>
            </div>
            <div class="discover-info" aria-hidden="true">
              <h3 class="discover-name">{{ showcase.page_title || showcase.store_url }}</h3>
              <div class="discover-artist">
                <div class="artist-avatar">
                  <img v-if="getPhotoUrl(showcase.artist.photo_path)" :src="getPhotoUrl(showcase.artist.photo_path)" alt="" />
                  <span v-else class="avatar-placeholder">{{ getInitial(showcase.artist) }}</span>
                </div>
                <span class="artist-name">{{ artistName(showcase.artist) }}</span>
              </div>
              <span class="item-count">{{ showcase.item_count }} item{{ showcase.item_count === 1 ? '' : 's' }}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="discover-section">
        <h2 class="section-heading">Galleries</h2>
        <div v-if="filteredGalleries.length === 0" class="empty-state">
          {{ galleries.length === 0 ? 'Nothing to discover yet.' : 'No galleries match your search.' }}
        </div>
        <div v-else class="discover-grid">
          <div
            v-for="gallery in filteredGalleries"
            :key="gallery.gallery_url"
            class="discover-card"
            tabindex="0"
            role="button"
            :aria-label="`Open ${gallery.gallery_name} gallery by ${artistName(gallery.artist)}, ${gallery.artwork_count} artwork${gallery.artwork_count === 1 ? '' : 's'}`"
            @click="openGallery(gallery)"
            @keydown.enter="openGallery(gallery)"
            @keydown.space.prevent="openGallery(gallery)"
          >
            <div class="discover-cover" aria-hidden="true">
              <img v-if="gallery.cover_image_path" :src="getPhotoUrl(gallery.cover_image_path)" alt="" />
              <div v-else class="cover-placeholder">No preview</div>
            </div>
            <div class="discover-info" aria-hidden="true">
              <h3 class="discover-name">{{ gallery.gallery_name }}</h3>
              <div class="discover-artist">
                <div class="artist-avatar">
                  <img v-if="getPhotoUrl(gallery.artist.photo_path)" :src="getPhotoUrl(gallery.artist.photo_path)" alt="" />
                  <span v-else class="avatar-placeholder">{{ getInitial(gallery.artist) }}</span>
                </div>
                <span class="artist-name">{{ artistName(gallery.artist) }}</span>
              </div>
              <span class="item-count">{{ gallery.artwork_count }} artwork{{ gallery.artwork_count === 1 ? '' : 's' }}</span>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.discover-page {
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
.error-message {
  color: var(--color-text-muted);
  padding: 40px 0;
  text-align: center;
}

.discover-section {
  margin-bottom: 36px;
}

.section-heading {
  font-size: 1.1rem;
  margin: 0 0 14px;
}

.empty-state {
  color: var(--color-text-muted);
  padding: 20px 0;
}

.discover-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 20px;
}

.discover-card {
  background: var(--color-background-soft);
  border-radius: var(--card-radius);
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.discover-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.discover-card:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.discover-cover {
  aspect-ratio: 4/3;
  overflow: hidden;
  background: var(--color-background-mute);
}

.discover-cover img {
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

.discover-info {
  padding: 14px;
}

.discover-name {
  margin: 0 0 8px;
  font-size: 1rem;
}

.discover-artist {
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

.item-count {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
</style>
