<script setup>
import { reactive, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import LoadingSpinner from '@/components/LoadingSpinner.vue'

const router = useRouter()

// Each Discover section shows at most PAGE_SIZE items at a time (roughly
// two rows at the grid's widest breakpoint -- 4 columns) instead of every
// public gallery/showcase/blog on the site. "Load more" pages in the next
// batch from the server rather than growing an already-fetched full list,
// so this keeps working as the number of artists grows.
const PAGE_SIZE = 8

function createSection() {
  return reactive({ items: [], total: 0, offset: 0, loadingMore: false })
}

const showcaseSection = createSection()
const gallerySection = createSection()
const blogSection = createSection()

const loading = ref(true)
const hasLoadedOnce = ref(false)
const error = ref('')
const searchQuery = ref('')

let debounceTimer = null

onMounted(() => {
  loadAll()
})

onBeforeUnmount(() => {
  clearTimeout(debounceTimer)
})

watch(searchQuery, () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(loadAll, 350)
})

// Fetches one page for a section. `reset: true` replaces the list (a fresh
// search or the initial load); `reset: false` appends the next page onto
// what's already showing (a "Load more" click).
async function loadSectionPage(state, url, key, { reset }) {
  const offset = reset ? 0 : state.offset
  const params = new URLSearchParams({ limit: PAGE_SIZE, offset })
  const q = searchQuery.value.trim()
  if (q) params.set('q', q)

  const res = await fetch(`${url}?${params}`, { credentials: 'include' })
  if (!res.ok) throw new Error(`Failed to load ${key}`)
  const data = await res.json()
  const items = data[key] || []
  state.items = reset ? items : [...state.items, ...items]
  state.total = data.total || 0
  state.offset = offset + items.length
}

// Only the very first load shows the full-page spinner. Later calls (a
// debounced search) fetch in the background and swap section contents in
// place once done, so typing doesn't blank the whole page each time.
async function loadAll() {
  if (!hasLoadedOnce.value) loading.value = true
  error.value = ''
  try {
    await Promise.all([
      loadSectionPage(showcaseSection, '/api/storefront/public', 'storefronts', { reset: true }),
      loadSectionPage(gallerySection, '/api/gallery/public', 'galleries', { reset: true }),
      loadSectionPage(blogSection, '/api/blog/public', 'blogs', { reset: true })
    ])
  } catch (err) {
    error.value = 'Failed to load Discover content'
    console.error(err)
  } finally {
    loading.value = false
    hasLoadedOnce.value = true
  }
}

async function loadMore(state, url, key) {
  if (state.loadingMore || state.items.length >= state.total) return
  state.loadingMore = true
  try {
    await loadSectionPage(state, url, key, { reset: false })
  } catch (err) {
    console.error(err)
  } finally {
    state.loadingMore = false
  }
}

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

function openBlog(b) {
  router.push(`/b/${b.blog_url}`)
}
</script>

<template>
  <div class="page-container discover-page">
    <h1>Discover</h1>
    <p class="page-subtitle">Browse artist showcases, galleries, and blogs people have made discoverable.</p>

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
        <div v-if="showcaseSection.items.length === 0" class="empty-state">
          {{ searchQuery.trim() ? 'No showcases match your search.' : 'Nothing to discover yet.' }}
        </div>
        <template v-else>
          <div class="discover-grid">
            <div
              v-for="showcase in showcaseSection.items"
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
          <button
            v-if="showcaseSection.items.length < showcaseSection.total"
            class="load-more-btn"
            :disabled="showcaseSection.loadingMore"
            @click="loadMore(showcaseSection, '/api/storefront/public', 'storefronts')"
          >
            {{ showcaseSection.loadingMore ? 'Loading...' : `Load more (${showcaseSection.total - showcaseSection.items.length} more)` }}
          </button>
        </template>
      </section>

      <section class="discover-section">
        <h2 class="section-heading">Galleries</h2>
        <div v-if="gallerySection.items.length === 0" class="empty-state">
          {{ searchQuery.trim() ? 'No galleries match your search.' : 'Nothing to discover yet.' }}
        </div>
        <template v-else>
          <div class="discover-grid">
            <div
              v-for="gallery in gallerySection.items"
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
          <button
            v-if="gallerySection.items.length < gallerySection.total"
            class="load-more-btn"
            :disabled="gallerySection.loadingMore"
            @click="loadMore(gallerySection, '/api/gallery/public', 'galleries')"
          >
            {{ gallerySection.loadingMore ? 'Loading...' : `Load more (${gallerySection.total - gallerySection.items.length} more)` }}
          </button>
        </template>
      </section>

      <section class="discover-section">
        <h2 class="section-heading">Blogs</h2>
        <div v-if="blogSection.items.length === 0" class="empty-state">
          {{ searchQuery.trim() ? 'No blogs match your search.' : 'Nothing to discover yet.' }}
        </div>
        <template v-else>
          <div class="discover-grid">
            <div
              v-for="blogEntry in blogSection.items"
              :key="blogEntry.blog_url"
              class="discover-card"
              tabindex="0"
              role="button"
              :aria-label="`Open ${blogEntry.blog_name} blog by ${artistName(blogEntry.artist)}, ${blogEntry.post_count} post${blogEntry.post_count === 1 ? '' : 's'}${blogEntry.latest_post_title ? ', latest post ' + blogEntry.latest_post_title : ''}`"
              @click="openBlog(blogEntry)"
              @keydown.enter="openBlog(blogEntry)"
              @keydown.space.prevent="openBlog(blogEntry)"
            >
              <div class="discover-cover blog-cover" aria-hidden="true">
                <template v-if="blogEntry.latest_post_title">
                  <span class="blog-preview-label">Latest post</span>
                  <p class="blog-preview-title">{{ blogEntry.latest_post_title }}</p>
                  <p v-if="blogEntry.latest_post_excerpt" class="blog-preview-excerpt">{{ blogEntry.latest_post_excerpt }}</p>
                </template>
                <div v-else class="cover-placeholder">No preview</div>
              </div>
              <div class="discover-info" aria-hidden="true">
                <h3 class="discover-name">{{ blogEntry.blog_name }}</h3>
                <div class="discover-artist">
                  <div class="artist-avatar">
                    <img v-if="getPhotoUrl(blogEntry.artist.photo_path)" :src="getPhotoUrl(blogEntry.artist.photo_path)" alt="" />
                    <span v-else class="avatar-placeholder">{{ getInitial(blogEntry.artist) }}</span>
                  </div>
                  <span class="artist-name">{{ artistName(blogEntry.artist) }}</span>
                </div>
                <span class="item-count">{{ blogEntry.post_count }} post{{ blogEntry.post_count === 1 ? '' : 's' }}</span>
              </div>
            </div>
          </div>
          <button
            v-if="blogSection.items.length < blogSection.total"
            class="load-more-btn"
            :disabled="blogSection.loadingMore"
            @click="loadMore(blogSection, '/api/blog/public', 'blogs')"
          >
            {{ blogSection.loadingMore ? 'Loading...' : `Load more (${blogSection.total - blogSection.items.length} more)` }}
          </button>
        </template>
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

.load-more-btn {
  display: block;
  margin: 16px auto 0;
  padding: 8px 18px;
  border-radius: var(--card-radius);
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  color: var(--color-text);
  cursor: pointer;
  font-size: 0.9rem;
}

.load-more-btn:hover:not(:disabled) {
  background: var(--color-background-mute);
}

.load-more-btn:disabled {
  cursor: default;
  opacity: 0.7;
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

/* Blogs have no cover image, so their preview slot shows a teaser of the
   most recent post instead -- title + a short excerpt (see
   latest_post_title/latest_post_excerpt from GET /api/blog/public). */
.blog-cover {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 18px;
  background: linear-gradient(var(--color-background-mute), var(--color-background-soft));
}

.blog-preview-label {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-accent);
  margin-bottom: 6px;
}

.blog-preview-title {
  margin: 0 0 8px;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--color-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.blog-preview-excerpt {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.4;
  color: var(--color-text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
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
