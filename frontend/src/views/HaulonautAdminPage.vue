<script setup>
import { ref, onMounted } from 'vue'

const loading = ref(true)
const error = ref('')
const forbidden = ref(false)
const instance = ref(null)
const roster = ref([])

const newUniverseName = ref('')
const newUniverseSectors = ref(1000)
const generating = ref(false)
const generateError = ref('')
const generateResult = ref('')

async function loadOverview() {
  loading.value = true
  error.value = ''
  forbidden.value = false
  try {
    const res = await fetch('/api/games/haulonaut/admin/overview', { credentials: 'include' })
    if (res.status === 403) { forbidden.value = true; return }
    if (!res.ok) throw new Error('Failed to load')
    const data = await res.json()
    instance.value = data.instance
    roster.value = data.roster || []
  } catch (err) {
    error.value = 'Failed to load universe overview.'
    console.error(err)
  } finally {
    loading.value = false
  }
}

async function generateUniverse() {
  const label = instance.value
    ? `This will end "${instance.value.name}" and generate a brand new universe. All players will need to start a new character. Continue?`
    : 'Generate a new universe?'
  if (!confirm(label)) return

  generating.value = true
  generateError.value = ''
  generateResult.value = ''
  try {
    const res = await fetch('/api/games/haulonaut/admin/universe', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newUniverseName.value.trim() || undefined,
        sectors: newUniverseSectors.value
      })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message || 'Failed to generate universe')
    generateResult.value = `Universe "${data.instance.name}" created: ${data.sectorCount} sectors, ${data.linkCount} links (degree avg ${data.degreeStats.avg.toFixed(2)}).`
    newUniverseName.value = ''
    await loadOverview()
  } catch (err) {
    generateError.value = err.message
  } finally {
    generating.value = false
  }
}

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleString()
}

onMounted(loadOverview)
</script>

<template>
  <div class="page-container haulonaut-admin-page">
    <h1>Haulonaut — Universe Admin</h1>

    <div v-if="loading" class="loading">Loading...</div>
    <div v-else-if="forbidden" class="error-message">You aren't an admin for this game.</div>
    <div v-else-if="error" class="error-message">{{ error }}</div>

    <template v-else>
      <section class="admin-section">
        <h2>Current Universe</h2>
        <div v-if="instance" class="instance-card">
          <div class="instance-row"><span class="label">Name</span><span>{{ instance.name }}</span></div>
          <div class="instance-row"><span class="label">Sectors</span><span>{{ instance.sector_count }}</span></div>
          <div class="instance-row"><span class="label">Started</span><span>{{ formatDate(instance.started_at) }}</span></div>
        </div>
        <div v-else class="empty-state">No active universe.</div>
      </section>

      <section class="admin-section">
        <h2>Player Roster ({{ roster.length }})</h2>
        <table v-if="roster.length > 0" class="roster-table">
          <thead>
            <tr>
              <th>Character</th>
              <th>Owner</th>
              <th>Status</th>
              <th>Last Played</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in roster" :key="c.id">
              <td>{{ c.display_name }}</td>
              <td>{{ c.owner_handle || '(guest)' }}</td>
              <td class="status-cell" :class="`status-${c.status}`">{{ c.status }}</td>
              <td>{{ formatDate(c.last_played_at) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty-state">No characters yet.</div>
      </section>

      <section class="admin-section">
        <h2>Generate New Universe</h2>
        <p class="warning-text">This ends the current universe and starts a fresh one. Existing characters stay in the old (ended) universe's history but can't keep playing in it.</p>
        <div class="generate-form">
          <label>
            Name
            <input v-model="newUniverseName" placeholder="e.g. Haulonaut Season 2" maxlength="128" />
          </label>
          <label>
            Sectors
            <input v-model.number="newUniverseSectors" type="number" min="10" max="5000" />
          </label>
          <button @click="generateUniverse" :disabled="generating">
            {{ generating ? 'Generating...' : 'Generate New Universe' }}
          </button>
        </div>
        <p v-if="generateError" class="error">{{ generateError }}</p>
        <p v-if="generateResult" class="success">{{ generateResult }}</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.haulonaut-admin-page {
  max-width: 800px;
}

h1 { color: var(--color-text); margin-bottom: 20px; }
h2 { color: var(--color-text); font-size: 1.1rem; margin: 0 0 12px; }

.loading, .error-message, .empty-state {
  color: var(--color-text-muted);
  padding: 20px 0;
}

.admin-section {
  background: var(--color-background-card);
  border-radius: 8px;
  padding: 18px 20px;
  margin-bottom: 20px;
}

.instance-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.instance-row {
  display: flex;
  gap: 10px;
  font-size: 0.9rem;
  color: var(--color-text);
}

.instance-row .label {
  width: 90px;
  flex-shrink: 0;
  color: var(--color-text-muted);
}

.roster-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.roster-table th, .roster-table td {
  border: 1px solid var(--color-border);
  padding: 8px 10px;
  text-align: left;
  color: var(--color-text);
}

.roster-table thead { background: var(--color-background-soft); }

.status-cell { text-transform: capitalize; font-weight: 600; }
.status-active { color: var(--color-success, #2e7d32); }
.status-dead { color: var(--color-error, #cc0000); }
.status-abandoned { color: var(--color-text-light); }

.warning-text {
  color: var(--color-text-muted);
  font-size: 0.85rem;
  margin: 0 0 14px;
}

.generate-form {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  flex-wrap: wrap;
}

.generate-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.85rem;
  color: var(--color-text-light);
}

.generate-form input {
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-background-input);
  color: var(--color-text);
  font-size: 0.9rem;
}

.generate-form input[type="number"] {
  width: 100px;
}

.generate-form button {
  padding: 9px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  background: var(--color-accent);
  color: white;
  font-size: 0.9rem;
}

.generate-form button:hover { background: var(--color-accent-hover); }
.generate-form button:disabled { opacity: 0.5; cursor: not-allowed; }

.error { color: var(--color-error); font-size: 0.85rem; margin-top: 10px; }
.success { color: var(--color-success, #2e7d32); font-size: 0.85rem; margin-top: 10px; }
</style>
