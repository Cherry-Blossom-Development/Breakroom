<script setup>
import { ref, onMounted } from 'vue'
import LoadingSpinner from './LoadingSpinner.vue'

const news = ref([])
const loading = ref(true)
const error = ref(null)

const allSources = ref([])
const enabledSources = ref([])
const showSettings = ref(false)
const savingPrefs = ref(false)

const SOURCE_COLORS = {
  npr:          '#c8102e',
  bbc:          '#bb1919',
  guardian:     '#052962',
  abc:          '#00318c',
  cbs:          '#1c4f9c',
  aljazeera:    '#d4a017',
  usatoday:     '#009bff',
  hackernews:   '#ff6600',
  arstechnica:  '#ff4e00',
  theverge:     '#fa4b2a',
  pitchfork:    '#555',
  rollingstone: '#e8002d',
}

const fetchSources = async () => {
  try {
    const res = await fetch('/api/breakroom/news/sources', { credentials: 'include' })
    if (res.ok) allSources.value = await res.json()
  } catch { /* ignore */ }
}

const fetchPreferences = async () => {
  try {
    const res = await fetch('/api/breakroom/news/preferences', { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      enabledSources.value = data.enabled || ['npr']
    }
  } catch { /* ignore */ }
}

const fetchNews = async () => {
  loading.value = true
  error.value = null
  try {
    const res = await fetch('/api/breakroom/news', { credentials: 'include' })
    if (!res.ok) throw new Error('Failed to fetch news')
    const data = await res.json()
    news.value = data.items || []
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

const toggleSource = async (sourceId) => {
  const idx = enabledSources.value.indexOf(sourceId)
  if (idx >= 0) {
    enabledSources.value.splice(idx, 1)
  } else {
    enabledSources.value.push(sourceId)
  }

  savingPrefs.value = true
  try {
    await fetch('/api/breakroom/news/preferences', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: enabledSources.value }),
    })
  } catch { /* ignore */ } finally {
    savingPrefs.value = false
  }
}

const closeSettings = async () => {
  showSettings.value = false
  await fetchNews()
}

const formatTime = (dateStr) => {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (isNaN(date)) return ''
  const diffMs = Date.now() - date
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const openLink = (url) => {
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}

onMounted(async () => {
  await Promise.all([fetchSources(), fetchPreferences()])
  await fetchNews()
})
</script>

<template>
  <div class="news-widget">
    <!-- Header -->
    <div class="widget-header">
      <span class="widget-title">News</span>
      <button class="settings-btn" :class="{ active: showSettings }" @click="showSettings = !showSettings" title="Configure sources">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
      </button>
    </div>

    <!-- Settings panel -->
    <div v-if="showSettings" class="settings-panel">
      <div class="settings-header">
        <span>News Sources</span>
        <button class="done-btn" @click="closeSettings">Done</button>
      </div>
      <div class="sources-list">
        <label
          v-for="source in allSources"
          :key="source.id"
          class="source-row"
        >
          <span class="source-dot" :style="{ background: SOURCE_COLORS[source.id] || '#888' }"></span>
          <span class="source-name">{{ source.name }}</span>
          <input
            type="checkbox"
            :checked="enabledSources.includes(source.id)"
            @change="toggleSource(source.id)"
            :disabled="savingPrefs"
          />
        </label>
      </div>
    </div>

    <!-- News list -->
    <template v-else>
      <div v-if="loading" class="loading-state">
        <LoadingSpinner size="small" />
        <span>Loading news...</span>
      </div>

      <div v-else-if="error" class="error-state">
        <p>{{ error }}</p>
        <button @click="fetchNews">Retry</button>
      </div>

      <div v-else-if="news.length === 0" class="empty-state">
        <p>No sources selected.</p>
        <button class="select-btn" @click="showSettings = true">Select sources</button>
      </div>

      <div v-else class="news-list">
        <div
          v-for="(item, index) in news"
          :key="index"
          class="news-item"
          :style="{ borderLeftColor: SOURCE_COLORS[item.sourceId] || '#888' }"
          @click="openLink(item.link)"
        >
          <div class="news-header">
            <span class="news-source" :style="{ color: SOURCE_COLORS[item.sourceId] || '#888' }">{{ item.source }}</span>
            <span class="news-time">{{ formatTime(item.pubDate) }}</span>
          </div>
          <h3 class="news-title">{{ item.title }}</h3>
          <p v-if="item.description" class="news-desc">{{ item.description }}</p>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.news-widget {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-background-soft);
  overflow: hidden;
}

/* ── Header ── */
.widget-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.widget-title {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-secondary);
}

.settings-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  padding: 2px 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  transition: color 0.15s, background 0.15s;
}

.settings-btn:hover,
.settings-btn.active {
  color: var(--color-accent);
  background: var(--color-background-card);
}

/* ── Settings panel ── */
.settings-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border);
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.done-btn {
  background: var(--color-accent);
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 3px 10px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}

.done-btn:hover { opacity: 0.85; }

.sources-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.source-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  cursor: pointer;
  transition: background 0.12s;
}

.source-row:hover {
  background: var(--color-background-card);
}

.source-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.source-name {
  flex: 1;
  font-size: 0.85rem;
  color: var(--color-text);
}

.source-row input[type="checkbox"] {
  width: 15px;
  height: 15px;
  cursor: pointer;
  accent-color: var(--color-accent);
}

/* ── News list ── */
.news-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.news-item {
  background: var(--color-background-card);
  border-radius: var(--card-radius-sm);
  padding: var(--card-padding-compact);
  margin-bottom: 8px;
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: box-shadow 0.2s, transform 0.1s;
  border-left: 3px solid #888;
}

.news-item:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

.news-item:last-child { margin-bottom: 0; }

.news-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.news-source {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.news-time {
  font-size: 0.7rem;
  color: var(--color-text-light);
}

.news-title {
  margin: 0 0 4px;
  font-size: 0.85rem;
  font-weight: 600;
  line-height: 1.3;
  color: var(--color-text);
}

.news-desc {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--color-text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ── States ── */
.loading-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--color-text-light);
}

.error-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  text-align: center;
  color: var(--color-error);
  gap: 8px;
}

.error-state button,
.select-btn {
  padding: 6px 16px;
  background: var(--color-accent);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--color-text-light);
  font-size: 0.85rem;
}
</style>
