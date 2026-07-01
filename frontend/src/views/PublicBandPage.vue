<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const bandUrl = route.params.bandUrl

const loading = ref(true)
const notFound = ref(false)
const band = ref(null)

// Audio player state
const currentSongId = ref(null)
const audioEl = ref(null)
const playing = ref(false)
const currentTime = ref(0)
const duration = ref(0)

onMounted(async () => {
  try {
    const res = await fetch(`/api/band-page/${bandUrl}`)
    if (res.status === 404) { notFound.value = true; return }
    const data = await res.json()
    if (!res.ok) { notFound.value = true; return }
    band.value = data
  } catch {
    notFound.value = true
  } finally {
    loading.value = false
  }
})

function playSong(songId) {
  if (currentSongId.value === songId) {
    if (playing.value) { audioEl.value.pause(); playing.value = false }
    else { audioEl.value.play(); playing.value = true }
    return
  }
  currentSongId.value = songId
  playing.value = false
  currentTime.value = 0
  duration.value = 0
  // Wait for src to update then play
  setTimeout(() => {
    if (audioEl.value) {
      audioEl.value.play()
      playing.value = true
    }
  }, 50)
}

function onTimeUpdate() {
  currentTime.value = audioEl.value?.currentTime || 0
}
function onDurationChange() {
  duration.value = audioEl.value?.duration || 0
}
function onEnded() {
  playing.value = false
  currentTime.value = 0
}
function seek(e) {
  if (!audioEl.value || !duration.value) return
  const rect = e.currentTarget.getBoundingClientRect()
  const ratio = (e.clientX - rect.left) / rect.width
  audioEl.value.currentTime = ratio * duration.value
}

function formatTime(s) {
  if (!s || isNaN(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}
</script>

<template>
  <div class="bp-shell">
    <!-- Background -->
    <div
      class="bp-bg"
      :style="band?.background_photo_url ? `background-image: url(${band.background_photo_url})` : ''"
    />
    <div class="bp-overlay" />

    <div v-if="loading" class="bp-loading">Loading…</div>

    <div v-else-if="notFound" class="bp-not-found">
      <h1>Band page not found</h1>
      <p>This band page doesn't exist or hasn't been published yet.</p>
      <a href="/" class="bp-home-link">Go to Prosaurus</a>
    </div>

    <main v-else class="bp-content">

      <!-- Hero -->
      <div class="bp-hero">
        <h1 class="bp-band-name">{{ band.band_name }}</h1>
      </div>

      <!-- Story -->
      <section v-if="band.story" class="bp-section bp-story-section">
        <h2 class="bp-section-heading">Our Story</h2>
        <p class="bp-story">{{ band.story }}</p>
      </section>

      <!-- Members -->
      <section v-if="band.members?.length" class="bp-section">
        <h2 class="bp-section-heading">The Band</h2>
        <div class="bp-members">
          <div v-for="m in band.members" :key="m.id" class="bp-member-card">
            <img v-if="m.photo_url" :src="m.photo_url" :alt="m.handle" class="bp-member-photo" />
            <div v-else class="bp-member-photo bp-member-initials">
              {{ (m.first_name || m.handle)[0].toUpperCase() }}
            </div>
            <div class="bp-member-name">{{ m.first_name }} {{ m.last_name }}</div>
            <div class="bp-member-handle">@{{ m.handle }}</div>
            <div v-if="m.instruments?.length" class="bp-member-instruments">
              {{ m.instruments.join(' · ') }}
            </div>
          </div>
        </div>
      </section>

      <!-- Songs -->
      <section v-if="band.songs?.length" class="bp-section">
        <h2 class="bp-section-heading">Songs</h2>
        <div class="bp-songs">
          <div
            v-for="song in band.songs"
            :key="song.id"
            class="bp-song"
            :class="{ active: currentSongId === song.id }"
          >
            <button class="bp-play-btn" @click="playSong(song.id)" :aria-label="currentSongId === song.id && playing ? 'Pause' : 'Play'">
              <svg v-if="currentSongId === song.id && playing" viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                <polygon points="5,3 19,12 5,21"/>
              </svg>
            </button>

            <div class="bp-song-info">
              <div class="bp-song-name">{{ song.name || 'Untitled' }}</div>
              <div class="bp-song-meta">
                {{ song.uploader_handle }}{{ song.instrument_name ? ` · ${song.instrument_name}` : '' }}
              </div>

              <!-- Progress bar (shown when this song is loaded) -->
              <div v-if="currentSongId === song.id" class="bp-progress-wrap" @click="seek">
                <div class="bp-progress-bar">
                  <div class="bp-progress-fill" :style="{ width: duration ? `${(currentTime/duration)*100}%` : '0%' }" />
                </div>
                <div class="bp-progress-times">
                  <span>{{ formatTime(currentTime) }}</span>
                  <span>{{ formatTime(duration) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Hidden audio element -->
        <audio
          v-if="currentSongId"
          ref="audioEl"
          :src="`/api/band-page/${bandUrl}/songs/${currentSongId}/stream`"
          @timeupdate="onTimeUpdate"
          @durationchange="onDurationChange"
          @ended="onEnded"
          style="display:none"
        />
      </section>

      <footer class="bp-footer">
        <a href="https://www.prosaurus.com" class="bp-prosaurus-link">Powered by Prosaurus</a>
      </footer>
    </main>
  </div>
</template>

<style scoped>
.bp-shell {
  min-height: 100vh;
  position: relative;
  color: #fff;
}
.bp-bg {
  position: fixed;
  inset: 0;
  background-size: cover;
  background-position: center;
  background-color: #1a1a2e;
  z-index: 0;
}
.bp-overlay {
  position: fixed;
  inset: 0;
  background: linear-gradient(to bottom, rgba(0,0,0,.55) 0%, rgba(0,0,0,.7) 100%);
  z-index: 1;
}
.bp-loading, .bp-not-found {
  position: relative;
  z-index: 2;
  text-align: center;
  padding: 80px 20px;
}
.bp-not-found h1 { font-size: 2em; margin-bottom: 12px; }
.bp-home-link { color: #7eb3ff; }
.bp-content {
  position: relative;
  z-index: 2;
  max-width: 860px;
  margin: 0 auto;
  padding: 0 20px 60px;
}

/* Hero */
.bp-hero {
  text-align: center;
  padding: 100px 0 60px;
}
.bp-band-name {
  font-size: clamp(2.2em, 7vw, 4em);
  font-weight: 800;
  letter-spacing: -1px;
  text-shadow: 0 2px 20px rgba(0,0,0,.4);
  margin: 0;
}

/* Sections */
.bp-section {
  margin-bottom: 56px;
}
.bp-section-heading {
  font-size: 1.1em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 2px;
  opacity: 0.7;
  margin-bottom: 20px;
  border-bottom: 1px solid rgba(255,255,255,.2);
  padding-bottom: 10px;
}
.bp-story {
  font-size: 1.05em;
  line-height: 1.75;
  opacity: 0.9;
  white-space: pre-wrap;
}

/* Members */
.bp-members {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
}
.bp-member-card {
  text-align: center;
  width: 130px;
}
.bp-member-photo {
  width: 90px;
  height: 90px;
  border-radius: 50%;
  object-fit: cover;
  border: 3px solid rgba(255,255,255,.3);
  margin: 0 auto 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bp-member-initials {
  background: rgba(255,255,255,.2);
  font-size: 2em;
  font-weight: 700;
}
.bp-member-name { font-weight: 600; font-size: 0.95em; }
.bp-member-handle { font-size: 0.78em; opacity: 0.6; margin-top: 2px; }
.bp-member-instruments { font-size: 0.78em; opacity: 0.75; margin-top: 5px; font-style: italic; }

/* Songs */
.bp-songs { display: flex; flex-direction: column; gap: 8px; }
.bp-song {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 16px;
  background: rgba(255,255,255,.08);
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,.1);
  transition: background .15s;
}
.bp-song.active { background: rgba(255,255,255,.14); }
.bp-song:hover { background: rgba(255,255,255,.12); }
.bp-play-btn {
  width: 42px; height: 42px;
  border-radius: 50%;
  background: rgba(255,255,255,.15);
  border: 2px solid rgba(255,255,255,.4);
  color: white;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background .15s;
}
.bp-play-btn:hover { background: rgba(255,255,255,.25); }
.bp-song-info { flex: 1; min-width: 0; }
.bp-song-name { font-weight: 600; }
.bp-song-meta { font-size: 0.82em; opacity: 0.65; margin-top: 2px; }
.bp-progress-wrap { margin-top: 10px; cursor: pointer; }
.bp-progress-bar {
  height: 4px;
  background: rgba(255,255,255,.2);
  border-radius: 2px;
  overflow: hidden;
}
.bp-progress-fill {
  height: 100%;
  background: white;
  border-radius: 2px;
  transition: width .1s linear;
}
.bp-progress-times {
  display: flex;
  justify-content: space-between;
  font-size: 0.75em;
  opacity: 0.55;
  margin-top: 4px;
}

.bp-footer {
  text-align: center;
  margin-top: 48px;
  opacity: 0.4;
  font-size: 0.85em;
}
.bp-prosaurus-link { color: inherit; text-decoration: none; }
.bp-prosaurus-link:hover { text-decoration: underline; }
</style>
