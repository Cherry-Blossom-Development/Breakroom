<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import LoadingSpinner from '../components/LoadingSpinner.vue'

const route = useRoute()

const session = ref(null)
const loading = ref(true)
const error = ref('')
const isPlaying = ref(false)
const audioElement = ref(null)
const currentTime = ref(0)
const duration = ref(0)

const sessionId = computed(() => route.params.id)

const streamUrl = computed(() => {
  if (!session.value) return null
  return `/api/sessions/${session.value.id}/public/stream`
})

const formattedDate = computed(() => {
  if (!session.value) return ''
  const dateStr = session.value.recorded_at || session.value.uploaded_at
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
})

const formattedDuration = computed(() => {
  const mins = Math.floor(duration.value / 60)
  const secs = Math.floor(duration.value % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
})

const formattedCurrentTime = computed(() => {
  const mins = Math.floor(currentTime.value / 60)
  const secs = Math.floor(currentTime.value % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
})

const progress = computed(() => {
  if (duration.value === 0) return 0
  return (currentTime.value / duration.value) * 100
})

onMounted(() => {
  fetchSession()
})

onUnmounted(() => {
  if (audioElement.value) {
    audioElement.value.pause()
  }
})

async function fetchSession() {
  loading.value = true
  error.value = ''

  try {
    const res = await fetch(`/api/sessions/${sessionId.value}/public`)
    if (!res.ok) {
      if (res.status === 404) {
        error.value = 'Session not found'
      } else {
        error.value = 'Failed to load session'
      }
      return
    }

    const data = await res.json()
    session.value = data.session

    // Set page title
    document.title = `${data.session.name} - Prosaurus`

    // Set up audio element
    setupAudio()
  } catch (err) {
    console.error('Error fetching session:', err)
    error.value = 'Failed to load session'
  } finally {
    loading.value = false
  }
}

function setupAudio() {
  if (!streamUrl.value) return

  audioElement.value = new Audio(streamUrl.value)

  audioElement.value.addEventListener('loadedmetadata', () => {
    duration.value = audioElement.value.duration
  })

  audioElement.value.addEventListener('timeupdate', () => {
    currentTime.value = audioElement.value.currentTime
  })

  audioElement.value.addEventListener('ended', () => {
    isPlaying.value = false
    currentTime.value = 0
  })

  audioElement.value.addEventListener('error', () => {
    error.value = 'Failed to load audio'
  })
}

function togglePlay() {
  if (!audioElement.value) return

  if (isPlaying.value) {
    audioElement.value.pause()
    isPlaying.value = false
  } else {
    audioElement.value.play()
    isPlaying.value = true
  }
}

function seek(event) {
  if (!audioElement.value || duration.value === 0) return

  const bar = event.currentTarget
  const rect = bar.getBoundingClientRect()
  const percent = (event.clientX - rect.left) / rect.width
  audioElement.value.currentTime = percent * duration.value
}

function formatFileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <main class="public-session-page">
    <div v-if="loading" class="loading">
      <LoadingSpinner size="small" /> Loading session...
    </div>

    <div v-else-if="error" class="error-container">
      <p class="error">{{ error }}</p>
      <router-link to="/" class="back-link">Go to homepage</router-link>
    </div>

    <div v-else-if="session" class="session-container">
      <!-- Session Header -->
      <header class="session-header">
        <div class="session-icon">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
          </svg>
        </div>
        <div class="session-info">
          <h1 class="session-title">{{ session.name }}</h1>
          <p v-if="session.uploader_handle" class="session-artist">
            by @{{ session.uploader_handle }}
          </p>
          <div class="session-meta">
            <span v-if="session.instrument_name" class="meta-item">{{ session.instrument_name }}</span>
            <span class="meta-item">{{ formattedDate }}</span>
            <span v-if="session.file_size" class="meta-item">{{ formatFileSize(session.file_size) }}</span>
          </div>
        </div>
      </header>

      <!-- Audio Player -->
      <div class="audio-player">
        <button class="play-button" @click="togglePlay" :aria-label="isPlaying ? 'Pause' : 'Play'">
          <svg v-if="!isPlaying" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
          </svg>
        </button>

        <div class="player-content">
          <div class="time-display">
            <span>{{ formattedCurrentTime }}</span>
            <span>{{ formattedDuration }}</span>
          </div>
          <div class="progress-bar" @click="seek">
            <div class="progress-fill" :style="{ width: progress + '%' }"></div>
          </div>
        </div>
      </div>

      <!-- Rating -->
      <div v-if="session.avg_rating || session.rating_count > 0" class="rating-info">
        <span class="rating-value">{{ session.avg_rating?.toFixed(1) || '—' }}</span>
        <span class="rating-label">/ 10</span>
        <span class="rating-count">({{ session.rating_count }} {{ session.rating_count === 1 ? 'rating' : 'ratings' }})</span>
      </div>

      <!-- Prosaurus Branding -->
      <footer class="prosaurus-footer">
        <p>Shared from <a href="/" target="_blank">Prosaurus</a></p>
      </footer>
    </div>
  </main>
</template>

<style scoped>
.public-session-page {
  min-height: 100vh;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 2rem;
  font-family: system-ui, -apple-system, sans-serif;
}

.loading {
  color: #fff;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 1.1rem;
}

.error-container {
  text-align: center;
  color: #fff;
}

.error {
  font-size: 1.25rem;
  margin-bottom: 1rem;
}

.back-link {
  color: #a78bfa;
  text-decoration: none;
}

.back-link:hover {
  text-decoration: underline;
}

.session-container {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border-radius: 1.5rem;
  padding: 2.5rem;
  max-width: 500px;
  width: 100%;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
}

.session-header {
  display: flex;
  gap: 1.5rem;
  margin-bottom: 2rem;
}

.session-icon {
  width: 80px;
  height: 80px;
  background: linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%);
  border-radius: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.session-icon svg {
  width: 40px;
  height: 40px;
  color: white;
}

.session-info {
  flex: 1;
  min-width: 0;
}

.session-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: #fff;
  margin: 0 0 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-artist {
  font-size: 1rem;
  color: #a78bfa;
  margin: 0 0 0.5rem;
}

.session-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.meta-item {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.6);
}

.meta-item:not(:last-child)::after {
  content: '•';
  margin-left: 0.75rem;
}

.audio-player {
  display: flex;
  align-items: center;
  gap: 1rem;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 1rem;
  padding: 1rem;
  margin-bottom: 1.5rem;
}

.play-button {
  width: 56px;
  height: 56px;
  background: linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s, box-shadow 0.15s;
  flex-shrink: 0;
}

.play-button:hover {
  transform: scale(1.05);
  box-shadow: 0 8px 25px rgba(167, 139, 250, 0.4);
}

.play-button svg {
  width: 28px;
  height: 28px;
  color: white;
}

.player-content {
  flex: 1;
  min-width: 0;
}

.time-display {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 0.5rem;
  font-variant-numeric: tabular-nums;
}

.progress-bar {
  height: 6px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
  cursor: pointer;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #a78bfa 0%, #7c3aed 100%);
  border-radius: 3px;
  transition: width 0.1s linear;
}

.rating-info {
  text-align: center;
  margin-bottom: 1.5rem;
}

.rating-value {
  font-size: 2rem;
  font-weight: 700;
  color: #fbbf24;
}

.rating-label {
  font-size: 1rem;
  color: rgba(255, 255, 255, 0.6);
}

.rating-count {
  display: block;
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 0.25rem;
}

.prosaurus-footer {
  text-align: center;
  padding-top: 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.prosaurus-footer p {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.4);
  margin: 0;
}

.prosaurus-footer a {
  color: #a78bfa;
  text-decoration: none;
  font-weight: 500;
}

.prosaurus-footer a:hover {
  text-decoration: underline;
}

@media (max-width: 480px) {
  .public-session-page {
    padding: 1rem;
  }

  .session-container {
    padding: 1.5rem;
  }

  .session-header {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .session-meta {
    justify-content: center;
  }
}
</style>
