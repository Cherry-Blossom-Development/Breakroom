<script setup>
import { ref, onMounted } from 'vue'

const loading = ref(true)
const error = ref('')
const summary = ref(null)
const daily = ref([])

const windows = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 Days' },
  { key: '30d', label: 'Last 30 Days' },
]

const metricDefs = [
  { key: 'visits', label: 'Visitors', hasUnique: true },
  { key: 'logins', label: 'Logins', hasUnique: false },
  { key: 'signups', label: 'New Signups', hasUnique: false },
]

const platformLabels = { web: 'Web', android: 'Android', ios: 'iOS' }

function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const dailyDescending = ref([])

async function loadAnalytics() {
  loading.value = true
  error.value = ''
  try {
    const [summaryRes, dailyRes] = await Promise.all([
      fetch('/api/analytics/summary', { credentials: 'include' }),
      fetch('/api/analytics/daily', { credentials: 'include' }),
    ])
    if (!summaryRes.ok || !dailyRes.ok) throw new Error('Failed to load analytics')
    summary.value = await summaryRes.json()
    const dailyData = await dailyRes.json()
    daily.value = dailyData.days || []
    dailyDescending.value = [...daily.value].reverse()
  } catch (err) {
    error.value = 'Failed to load analytics data.'
  } finally {
    loading.value = false
  }
}

onMounted(loadAnalytics)
</script>

<template>
  <section class="page-container">
    <h1>Marketing</h1>

    <div v-if="loading" class="status-msg">Loading...</div>
    <div v-else-if="error" class="status-msg error">{{ error }}</div>

    <template v-else-if="summary">
      <div class="stat-grid">
        <div v-for="metric in metricDefs" :key="metric.key" class="stat-card">
          <h2>{{ metric.label }}</h2>
          <div class="stat-windows">
            <div v-for="w in windows" :key="w.key" class="stat-window">
              <div class="stat-window-label">{{ w.label }}</div>
              <div class="stat-value">
                {{ metric.hasUnique ? summary[metric.key][w.key].unique : summary[metric.key][w.key].total }}
              </div>
              <div v-if="metric.hasUnique" class="stat-subvalue">
                {{ summary[metric.key][w.key].total }} total visits
              </div>
              <div class="stat-platforms">
                <span v-for="(label, platform) in platformLabels" :key="platform">
                  {{ label }}: {{ metric.hasUnique
                    ? summary[metric.key][w.key].byPlatform[platform].unique
                    : summary[metric.key][w.key].byPlatform[platform].total }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <h2 class="daily-heading">Last 30 Days</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Visitors</th>
              <th>Logins</th>
              <th>Signups</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="day in dailyDescending" :key="day.date">
              <td>{{ formatDate(day.date) }}</td>
              <td>{{ day.uniqueVisitors }}</td>
              <td>{{ day.logins }}</td>
              <td>{{ day.signups }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.page-container {
  padding: 24px;
}

.status-msg {
  color: var(--color-text-muted);
  padding: 20px 0;
}

.status-msg.error {
  color: var(--color-error, #e53e3e);
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
  margin-top: 16px;
}

.stat-card {
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 16px;
}

.stat-card h2 {
  margin: 0 0 12px;
  font-size: 1.05rem;
}

.stat-windows {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.stat-window {
  border-top: 1px solid var(--color-border);
  padding-top: 10px;
}

.stat-window:first-child {
  border-top: none;
  padding-top: 0;
}

.stat-window-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
  margin-bottom: 2px;
}

.stat-value {
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--color-text);
}

.stat-subvalue {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.stat-platforms {
  display: flex;
  gap: 12px;
  font-size: 0.78rem;
  color: var(--color-text-muted);
  margin-top: 4px;
  flex-wrap: wrap;
}

.daily-heading {
  margin-top: 28px;
}

.table-wrap {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 10px;
}

th, td {
  text-align: left;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
}

th {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
}
</style>
