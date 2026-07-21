<script setup>
import { ref, onMounted, computed } from 'vue'
import { lyrics } from '@/stores/lyrics.js'
import LyricEditor from '@/components/LyricEditor.vue'
import SongModal from '@/components/SongModal.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import LoadingSpinner from '@/components/LoadingSpinner.vue'

const showLyricEditor = ref(false)
const showSongModal = ref(false)
const editingLyric = ref(null)
const editingSong = ref(null)
const promotingLyric = ref(null)
const selectedSong = ref(null)
const activeTab = ref('songs') // 'songs' or 'ideas'

// Screen-reader-only live region for action results (delete, promote, etc.)
const liveAnnouncement = ref('')

onMounted(async () => {
  await Promise.all([
    lyrics.fetchSongs(),
    lyrics.fetchStandaloneLyrics()
  ])
})

// Computed for filtering
const ownedSongs = computed(() => lyrics.songs.filter(s => s.role === 'owner'))
const collaboratingSongs = computed(() => lyrics.songs.filter(s => s.role !== 'owner'))

// Song functions
const createNewSong = () => {
  editingSong.value = null
  promotingLyric.value = null
  showSongModal.value = true
}

const editSong = (song) => {
  editingSong.value = song
  promotingLyric.value = null
  showSongModal.value = true
}

const promoteIdea = (lyric) => {
  editingSong.value = null
  promotingLyric.value = lyric
  showSongModal.value = true
}

const openSong = async (song) => {
  await lyrics.fetchSong(song.id)
  selectedSong.value = song
}

const closeSongDetail = () => {
  selectedSong.value = null
  lyrics.clearCurrentSong()
}

const deleteSong = async (song) => {
  if (confirm(`Are you sure you want to delete "${song.title}"? All lyrics in this song will become standalone ideas.`)) {
    await lyrics.deleteSong(song.id)
    liveAnnouncement.value = 'Song deleted'
  }
}

const onSongSaved = () => {
  showSongModal.value = false
  editingSong.value = null
  lyrics.fetchSongs()
}

const onSongSavedAndAddLyric = async (song) => {
  showSongModal.value = false
  editingSong.value = null
  await lyrics.fetchSongs()
  createNewLyric(song.id)
}

const onSongSavedAndPromote = async (song) => {
  showSongModal.value = false
  const idea = promotingLyric.value
  promotingLyric.value = null

  // Re-send the idea's existing fields -- PUT /lyrics/:id isn't a partial
  // patch, so anything omitted would be reset rather than left alone.
  await lyrics.updateLyric(idea.id, {
    song_id: song.id,
    title: idea.title,
    content: idea.content,
    section_type: idea.section_type,
    section_order: idea.section_order,
    mood: idea.mood,
    notes: idea.notes,
    status: idea.status,
    lyric_date: idea.lyric_date
  })

  await lyrics.fetchSongs()
  await openSong(song)
  liveAnnouncement.value = `Idea promoted to song: ${song.title}`
}

// Lyric functions
const createNewLyric = (songId = null) => {
  editingLyric.value = songId ? { song_id: songId } : null
  showLyricEditor.value = true
}

const editLyric = (lyric) => {
  editingLyric.value = lyric
  showLyricEditor.value = true
}

const deleteLyric = async (lyric) => {
  const preview = lyric.content.substring(0, 50) + (lyric.content.length > 50 ? '...' : '')
  if (confirm(`Delete this lyric?\n\n"${preview}"`)) {
    await lyrics.deleteLyric(lyric.id)
    liveAnnouncement.value = lyric.song_id ? 'Lyric deleted' : 'Idea deleted'
  }
}

const closeLyricEditor = () => {
  showLyricEditor.value = false
  editingLyric.value = null
}

const onLyricSaved = async () => {
  closeLyricEditor()
  if (selectedSong.value) {
    await lyrics.fetchSong(selectedSong.value.id)
  } else {
    await lyrics.fetchStandaloneLyrics()
  }
}

// Helpers
const formatDate = (dateStr) => {
  if (!dateStr) return ''
  // DATE columns come back as "YYYY-MM-DD"; parse without time zone shift
  const parts = dateStr.split('T')[0].split('-')
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

const statusColor = {
  idea: 'blue',
  writing: 'yellow',
  complete: 'green',
  recorded: 'purple',
  released: 'green',
  draft: 'yellow',
  'in-progress': 'yellow',
  archived: 'gray'
}

const getStatusBadgeColor = (status) => statusColor[status] || 'blue'

// Combined labels for screen readers, since each card is announced as one
// element -- mirrors what's visually scattered across the card into a
// single readable summary.
const songAccessibilityLabel = (song) => {
  const parts = [song.title, `Status: ${song.status}`]
  if (song.genre) parts.push(`Genre: ${song.genre}`)
  if (song.role) parts.push(`Role: ${song.role}`)
  const count = song.lyric_count || 0
  if (count > 0) parts.push(`${count} lyric${count === 1 ? '' : 's'}`)
  if (song.description) {
    parts.push(song.description.length > 80 ? song.description.slice(0, 80) + '...' : song.description)
  }
  return parts.join('. ')
}

const ideaAccessibilityLabel = (lyric) => {
  const parts = [lyric.content]
  if (lyric.mood) parts.push(`Mood: ${lyric.mood}`)
  parts.push(`Status: ${lyric.status}`)
  const date = lyric.lyric_date || lyric.updated_at
  if (date) parts.push(formatDate(date))
  return parts.join('. ')
}

const getSectionLabel = (type) => {
  const labels = {
    idea: 'Idea',
    verse: 'Verse',
    chorus: 'Chorus',
    bridge: 'Bridge',
    'pre-chorus': 'Pre-Chorus',
    hook: 'Hook',
    intro: 'Intro',
    outro: 'Outro',
    other: 'Other'
  }
  return labels[type] || type
}

const lyricAccessibilityLabel = (lyric) => {
  const parts = [getSectionLabel(lyric.section_type)]
  if (lyric.section_order) parts.push(`Number ${lyric.section_order}`)
  if (lyric.mood) parts.push(`Mood: ${lyric.mood}`)
  parts.push(lyric.content)
  const date = lyric.lyric_date || lyric.updated_at
  if (date) parts.push(formatDate(date))
  return parts.join('. ')
}
</script>

<template>
  <main class="lyrics-page page-container">
    <!-- Lyric Editor Modal -->
    <LyricEditor
      v-if="showLyricEditor"
      :lyric="editingLyric"
      :song-id="selectedSong?.id"
      :songs="lyrics.songs"
      @close="closeLyricEditor"
      @saved="onLyricSaved"
    />

    <!-- Song Modal -->
    <SongModal
      v-if="showSongModal"
      :song="editingSong"
      :promoting-lyric="promotingLyric"
      @close="showSongModal = false; promotingLyric = null"
      @saved="onSongSaved"
      @saved-add-lyric="onSongSavedAndAddLyric"
      @saved-promote="onSongSavedAndPromote"
    />

    <!-- Song Detail View -->
    <div v-if="selectedSong && lyrics.currentSong" class="song-detail">
      <div class="song-detail-header">
        <button class="btn-back" @click="closeSongDetail">&larr; Back to Songs</button>
        <div class="song-detail-title">
          <h1>{{ lyrics.currentSong.title }}</h1>
          <StatusBadge :color="getStatusBadgeColor(lyrics.currentSong.status)" soft>
            {{ lyrics.currentSong.status }}
          </StatusBadge>
        </div>
        <div class="song-detail-meta">
          <StatusBadge v-if="lyrics.currentSong.genre" color="gray" soft>{{ lyrics.currentSong.genre }}</StatusBadge>
          <StatusBadge color="gray" soft>{{ lyrics.currentSong.role }}</StatusBadge>
        </div>
        <p v-if="lyrics.currentSong.description" class="song-description">
          {{ lyrics.currentSong.description }}
        </p>
        <div class="song-detail-actions">
          <button class="btn-secondary" @click="editSong(lyrics.currentSong)">Edit Song</button>
          <button class="btn-primary" @click="createNewLyric(lyrics.currentSong.id)">+ Add Lyric</button>
        </div>
      </div>

      <!-- Collaborators -->
      <div v-if="lyrics.collaborators.length > 0" class="collaborators-section">
        <h3>Collaborators</h3>
        <div class="collaborator-list">
          <StatusBadge v-for="collab in lyrics.collaborators" :key="collab.user_id" color="gray" soft>
            {{ collab.first_name || collab.handle }} ({{ collab.role }})
          </StatusBadge>
        </div>
      </div>

      <!-- Lyrics List -->
      <div v-if="lyrics.loading" class="loading"><LoadingSpinner size="small" /> Loading lyrics...</div>
      <div v-else-if="lyrics.currentLyrics.length === 0" class="empty-state">
        <p>No lyrics yet for this song.</p>
        <p>Click "+ Add Lyric" to start writing!</p>
      </div>
      <div v-else class="lyrics-list">
        <div
          v-for="lyric in lyrics.currentLyrics"
          :key="lyric.id"
          class="lyric-card"
          tabindex="0"
          role="button"
          :aria-label="lyricAccessibilityLabel(lyric)"
          @click="editLyric(lyric)"
          @keydown.enter="editLyric(lyric)"
          @keydown.space.prevent="editLyric(lyric)"
        >
          <div class="lyric-header" aria-hidden="true">
            <span class="section-type">{{ getSectionLabel(lyric.section_type) }}</span>
            <span v-if="lyric.section_order" class="section-order">#{{ lyric.section_order }}</span>
            <span v-if="lyric.mood" class="mood-tag">{{ lyric.mood }}</span>
          </div>
          <div class="lyric-content" aria-hidden="true">{{ lyric.content }}</div>
          <div class="lyric-footer">
            <span class="lyric-date" aria-hidden="true">{{ formatDate(lyric.lyric_date || lyric.updated_at) }}</span>
            <div class="lyric-actions" @click.stop>
              <button class="btn-icon" @click="editLyric(lyric)">Edit</button>
              <button class="btn-icon btn-danger" @click="deleteLyric(lyric)">Delete</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Main List View -->
    <div v-else class="lyrics-container">
      <div class="lyrics-header">
        <h1>Lyric Lab</h1>
        <div class="header-actions">
          <button class="btn-secondary" @click="createNewLyric()">+ Quick Idea</button>
          <button class="btn-primary" @click="createNewSong">+ New Song</button>
        </div>
      </div>

      <!-- Tabs -->
      <div class="tabs">
        <button
          :class="['tab', { active: activeTab === 'songs' }]"
          @click="activeTab = 'songs'"
        >
          Songs ({{ lyrics.songs.length }})
        </button>
        <button
          :class="['tab', { active: activeTab === 'ideas' }]"
          @click="activeTab = 'ideas'"
        >
          Ideas ({{ lyrics.standaloneLyrics.length }})
        </button>
      </div>

      <div v-if="lyrics.loading" class="loading"><LoadingSpinner size="small" /> Loading...</div>

      <div v-else-if="lyrics.error" class="error">
        {{ lyrics.error }}
        <button @click="lyrics.clearError">Dismiss</button>
      </div>

      <!-- Songs Tab -->
      <div v-else-if="activeTab === 'songs'" class="tab-content">
        <div v-if="lyrics.songs.length === 0" class="empty-state">
          <p>You haven't created any songs yet.</p>
          <p>Click "+ New Song" to start organizing your lyrics!</p>
        </div>

        <template v-else>
          <!-- Owned Songs -->
          <div v-if="ownedSongs.length > 0" class="songs-section">
            <h3>My Songs</h3>
            <div class="songs-grid">
              <div
                v-for="song in ownedSongs"
                :key="song.id"
                class="song-card"
                tabindex="0"
                role="button"
                :aria-label="songAccessibilityLabel(song)"
                @click="openSong(song)"
                @keydown.enter="openSong(song)"
                @keydown.space.prevent="openSong(song)"
              >
                <div class="song-card-header" aria-hidden="true">
                  <h4>{{ song.title }}</h4>
                  <StatusBadge :color="getStatusBadgeColor(song.status)" soft>
                    {{ song.status }}
                  </StatusBadge>
                </div>
                <div v-if="song.genre" class="song-genre" aria-hidden="true">{{ song.genre }}</div>
                <div class="song-meta" aria-hidden="true">
                  <span>{{ song.lyric_count || 0 }} lyrics</span>
                  <span>{{ formatDate(song.song_date || song.updated_at) }}</span>
                </div>
                <div class="song-actions" @click.stop>
                  <button class="btn-icon" @click="editSong(song)">Edit</button>
                  <button class="btn-icon btn-danger" @click="deleteSong(song)">Delete</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Collaborating Songs -->
          <div v-if="collaboratingSongs.length > 0" class="songs-section">
            <h3>Collaborations</h3>
            <div class="songs-grid">
              <div
                v-for="song in collaboratingSongs"
                :key="song.id"
                class="song-card collab"
                tabindex="0"
                role="button"
                :aria-label="songAccessibilityLabel(song)"
                @click="openSong(song)"
                @keydown.enter="openSong(song)"
                @keydown.space.prevent="openSong(song)"
              >
                <div class="song-card-header" aria-hidden="true">
                  <h4>{{ song.title }}</h4>
                  <StatusBadge :color="getStatusBadgeColor(song.status)" soft>
                    {{ song.status }}
                  </StatusBadge>
                </div>
                <div class="song-owner" aria-hidden="true">by {{ song.owner_first_name || song.owner_handle }}</div>
                <div v-if="song.genre" class="song-genre" aria-hidden="true">{{ song.genre }}</div>
                <div class="song-meta" aria-hidden="true">
                  <span>{{ song.lyric_count || 0 }} lyrics</span>
                  <StatusBadge color="gray" soft>{{ song.role }}</StatusBadge>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- Ideas Tab -->
      <div v-else-if="activeTab === 'ideas'" class="tab-content">
        <div v-if="lyrics.standaloneLyrics.length === 0" class="empty-state">
          <p>No standalone ideas yet.</p>
          <p>Click "+ Quick Idea" to jot down a lyric fragment!</p>
        </div>

        <div v-else class="ideas-list">
          <div
            v-for="lyric in lyrics.standaloneLyrics"
            :key="lyric.id"
            class="idea-card"
            tabindex="0"
            role="button"
            :aria-label="ideaAccessibilityLabel(lyric)"
            @click="editLyric(lyric)"
            @keydown.enter="editLyric(lyric)"
            @keydown.space.prevent="editLyric(lyric)"
          >
            <div class="idea-content" aria-hidden="true">{{ lyric.content }}</div>
            <div class="idea-meta" aria-hidden="true">
              <StatusBadge v-if="lyric.mood" color="gray" soft>{{ lyric.mood }}</StatusBadge>
              <StatusBadge :color="getStatusBadgeColor(lyric.status)" soft>{{ lyric.status }}</StatusBadge>
              <span class="idea-date">{{ formatDate(lyric.lyric_date || lyric.updated_at) }}</span>
            </div>
            <div class="idea-actions" @click.stop>
              <button class="btn-icon btn-promote" @click="promoteIdea(lyric)">Promote to Song</button>
              <button class="btn-icon" @click="editLyric(lyric)">Edit</button>
              <button class="btn-icon btn-danger" @click="deleteLyric(lyric)">Delete</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="sr-only" aria-live="polite" role="status">{{ liveAnnouncement }}</div>
  </main>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.lyrics-page {
  max-width: 1000px;
  margin: 20px auto;
  padding: 0 20px;
}

.lyrics-container,
.song-detail {
  background: var(--color-background-card);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  min-height: calc(100vh - 140px);
}

/* Header */
.lyrics-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 25px;
  border-bottom: 1px solid var(--color-border);
}

.lyrics-header h1 {
  margin: 0;
  font-size: 1.5rem;
  color: var(--color-accent);
}

.header-actions {
  display: flex;
  gap: 10px;
}

/* Buttons */
.btn-primary {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.95rem;
  font-weight: 500;
}

.btn-primary:hover {
  background: var(--color-accent-hover);
}

.btn-secondary {
  background: var(--color-button-secondary);
  color: var(--color-text);
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.95rem;
  font-weight: 500;
}

.btn-secondary:hover {
  background: var(--color-button-secondary-hover);
}

.btn-back {
  background: none;
  border: none;
  color: var(--color-accent);
  cursor: pointer;
  font-size: 0.95rem;
  padding: 0;
  margin-bottom: 15px;
}

.btn-back:hover {
  text-decoration: underline;
}

.btn-icon {
  padding: 6px 12px;
  background: var(--color-button-secondary);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.btn-icon:hover {
  background: var(--color-button-secondary-hover);
}

.btn-danger {
  color: var(--color-error);
}

.btn-danger:hover {
  background: var(--color-error-bg);
}

.btn-promote {
  color: var(--color-accent);
}

.btn-promote:hover {
  background: var(--color-accent);
  color: white;
}

/* Tabs */
.tabs {
  display: flex;
  padding: 0 25px;
  border-bottom: 1px solid var(--color-border);
}

.tab {
  padding: 15px 20px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 0.95rem;
  font-weight: 500;
  transition: color 0.2s, border-color 0.2s;
}

.tab:hover {
  color: var(--color-text);
}

.tab.active {
  color: var(--color-accent);
  border-bottom-color: var(--color-accent);
}

.tab-content {
  padding: 20px 25px;
}

/* States */
.loading, .error, .empty-state {
  padding: 60px 20px;
  text-align: center;
  color: var(--color-text-light);
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.error {
  color: var(--color-error);
}

.error button {
  margin-top: 10px;
  background: none;
  border: 1px solid var(--color-error);
  color: var(--color-error);
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
}

/* Songs Grid */
.songs-section {
  margin-bottom: 30px;
}

.songs-section h3 {
  margin: 0 0 15px;
  color: var(--color-text);
  font-size: 1.1rem;
}

.songs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 15px;
}

.song-card {
  background: var(--color-background-soft);
  border-radius: var(--card-radius-sm);
  padding: 18px;
  cursor: pointer;
  transition: background 0.2s, box-shadow 0.2s;
}

.song-card:focus-visible,
.idea-card:focus-visible,
.lyric-card:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.song-card:hover {
  background: var(--color-background-hover);
  box-shadow: var(--shadow-sm);
}

.song-card.collab {
  border-left: 3px solid var(--color-accent);
}

.song-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.song-card h4 {
  margin: 0;
  color: var(--color-text);
  font-size: 1.05rem;
}

.song-owner {
  font-size: 0.85rem;
  color: var(--color-text-muted);
  margin-bottom: 6px;
}

.song-genre {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin-bottom: 10px;
}

.song-meta {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  color: var(--color-text-light);
  margin-bottom: 10px;
}

.song-actions {
  display: flex;
  gap: 8px;
}

/* Tags and badges handled by StatusBadge component */

/* Ideas List */
.ideas-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.idea-card {
  background: var(--color-background-soft);
  border-radius: var(--card-radius-sm);
  padding: 15px 18px;
  cursor: pointer;
  transition: background 0.2s;
}

.idea-card:hover {
  background: var(--color-background-hover);
}

.idea-content {
  color: var(--color-text);
  line-height: 1.5;
  margin-bottom: 10px;
  white-space: pre-wrap;
}

.idea-meta {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 8px;
}

.idea-date {
  font-size: 0.8rem;
  color: var(--color-text-light);
  margin-left: auto;
}

.idea-actions {
  display: flex;
  gap: 8px;
}

/* Song Detail View */
.song-detail {
  padding: 25px;
}

.song-detail-header {
  margin-bottom: 25px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--color-border);
}

.song-detail-title {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.song-detail-title h1 {
  margin: 0;
  color: var(--color-text);
  font-size: 1.8rem;
}

.song-detail-meta {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}

.song-description {
  color: var(--color-text-secondary);
  margin: 0 0 15px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.song-detail-actions {
  display: flex;
  gap: 10px;
}

/* Collaborators */
.collaborators-section {
  margin-bottom: 20px;
  padding: 15px;
  background: var(--color-background-soft);
  border-radius: var(--card-radius-sm);
}

.collaborators-section h3 {
  margin: 0 0 10px;
  font-size: 0.95rem;
  color: var(--color-text);
}

.collaborator-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* Lyrics List (in song detail) */
.lyrics-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.lyric-card {
  background: var(--color-background-soft);
  border-radius: var(--card-radius-sm);
  padding: 18px;
  cursor: pointer;
  transition: background 0.2s;
}

.lyric-card:hover {
  background: var(--color-background-hover);
}

.lyric-header {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
}

.section-type {
  font-weight: 600;
  color: var(--color-accent);
  font-size: 0.9rem;
}

.section-order {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.lyric-content {
  color: var(--color-text);
  line-height: 1.6;
  white-space: pre-wrap;
  margin-bottom: 12px;
}

.lyric-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.lyric-date {
  font-size: 0.8rem;
  color: var(--color-text-light);
}

.lyric-actions {
  display: flex;
  gap: 8px;
}

@media (max-width: 600px) {
  .lyrics-header {
    flex-direction: column;
    gap: 15px;
    align-items: flex-start;
  }

  .header-actions {
    width: 100%;
  }

  .header-actions button {
    flex: 1;
  }

  .songs-grid {
    grid-template-columns: 1fr;
  }

  .song-detail-title {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
