<script setup>
import { ref, onMounted } from 'vue'

const updates = ref([])
const loading = ref(true)
const error = ref(null)

const fetchUpdates = async () => {
  loading.value = true
  error.value = null

  try {
    const response = await fetch('/api/breakroom/updates?limit=20', {
      credentials: 'include'
    })

    if (!response.ok) {
      throw new Error('Failed to fetch updates')
    }

    const data = await response.json()
    updates.value = data.updates
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

const formatDate = (dateStr) => {
  const date = new Date(dateStr)
  const now = new Date()

  // Compare calendar days, not time difference
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.round((nowDay - dateDay) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return 'Today'
  } else if (diffDays === 1) {
    return 'Yesterday'
  } else if (diffDays < 7) {
    return `${diffDays} days ago`
  } else {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    })
  }
}

const formatTime = (dateStr) => {
  const date = new Date(dateStr)
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

onMounted(() => {
  fetchUpdates()
})
</script>

<template>
  <div class="updates-widget">
    <!-- Loading state -->
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <span>Loading updates...</span>
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="error-state">
      <span class="error-icon">!</span>
      <p>{{ error }}</p>
      <button @click="fetchUpdates">Retry</button>
    </div>

    <!-- Updates list -->
    <div v-else-if="updates.length > 0" class="updates-list">
      <div
        v-for="update in updates"
        :key="update.id"
        class="update-item"
      >
        <div class="update-time">
          <span class="date">{{ formatDate(update.created_at) }}</span>
          <span class="time">{{ formatTime(update.created_at) }}</span>
        </div>
        <div class="update-content">
          <p>{{ update.summary }}</p>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="empty-state">
      <p>No updates yet</p>
    </div>
  </div>
</template>

<style scoped>
.updates-widget {
  height: 100%;
  overflow-y: auto;
  background: var(--color-background-soft);
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-light);
  gap: 12px;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 20px;
  text-align: center;
  color: var(--color-error);
}

.error-icon {
  width: 32px;
  height: 32px;
  background: var(--color-error-bg);
  color: var(--color-error);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  margin-bottom: 8px;
}

.error-state button {
  margin-top: 12px;
  padding: 6px 16px;
  background: var(--color-accent);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.error-state button:hover {
  background: var(--color-accent-hover);
}

.updates-list {
  padding: 8px;
}

.update-item {
  background: var(--color-background-card);
  border-radius: var(--card-radius-sm);
  padding: var(--card-padding-compact);
  margin-bottom: 8px;
  box-shadow: var(--shadow-sm);
  border-left: 3px solid var(--color-accent);
}

.update-item:last-child {
  margin-bottom: 0;
}

.update-time {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 0.75rem;
}

.update-time .date {
  color: var(--color-accent);
  font-weight: 600;
}

.update-time .time {
  color: var(--color-text-light);
}

.update-content p {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.4;
  color: var(--color-text-secondary);
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-light);
}

.empty-state p {
  margin: 0;
}
</style>
