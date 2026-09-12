<script setup>
import { ref, onMounted } from 'vue'

const loading = ref(true)
const error = ref('')
const forbidden = ref(false)
const instances = ref([])

const expandedId = ref(null)
const rosters = ref({}) // instanceId -> roster array
const loadingRoster = ref(false)

const newUniverseName = ref('')
const newUniverseSectors = ref(1000)
const generating = ref(false)
const generateError = ref('')
const generateResult = ref('')

const endingId = ref(null)

const npcCounts = ref({}) // instanceId -> pending spawn count input
const spawningNpcsFor = ref(null)
const npcError = ref('')

// Placement fields, all keyed by instanceId. npcModes defaults to 'anywhere'
// whenever unset (see the select's first option + the `|| 'anywhere'` reads
// below) rather than needing to be pre-initialized for every instance.
const npcModes = ref({}) // instanceId -> 'anywhere' | 'near_user' | 'in_sector'
const npcTargetUser = ref({}) // instanceId -> selected non-NPC game_users.id (string, from the <select>)
const npcSectorsAway = ref({}) // instanceId -> 0-10
const npcSectorNumber = ref({}) // instanceId -> exact sector_number
const npcMagnet = ref({}) // instanceId -> bool -- only meaningful in 'near_user' mode; see backend/jobs/haulonautNpcScheduler.js
const npcSpawnResults = ref({}) // instanceId -> last spawn's [{ id, display_name, sector_number, magnet }], for "chosen sector" display

async function loadOverview() {
  loading.value = true
  error.value = ''
  forbidden.value = false
  try {
    const res = await fetch('/api/games/haulonaut/admin/overview', { credentials: 'include' })
    if (res.status === 403) { forbidden.value = true; return }
    if (!res.ok) throw new Error('Failed to load')
    const data = await res.json()
    instances.value = data.instances || []
  } catch (err) {
    error.value = 'Failed to load universe overview.'
    console.error(err)
  } finally {
    loading.value = false
  }
}

// Fetches and caches the roster for one instance. Shared by the roster
// table toggle and the "near a player" NPC-placement dropdown, which needs
// the same non-NPC pilot list but can be opened without ever expanding the
// roster table itself.
async function ensureRoster(instanceId) {
  if (rosters.value[instanceId]) return
  loadingRoster.value = true
  try {
    const res = await fetch(`/api/games/haulonaut/admin/instances/${instanceId}/roster`, { credentials: 'include' })
    const data = await res.json()
    rosters.value = { ...rosters.value, [instanceId]: data.roster || [] }
  } finally {
    loadingRoster.value = false
  }
}

async function refreshRoster(instanceId) {
  const res = await fetch(`/api/games/haulonaut/admin/instances/${instanceId}/roster`, { credentials: 'include' })
  const data = await res.json()
  rosters.value = { ...rosters.value, [instanceId]: data.roster || [] }
}

function toggleRoster(instanceId) {
  if (expandedId.value === instanceId) {
    expandedId.value = null
    return
  }
  expandedId.value = instanceId
  ensureRoster(instanceId)
}

// Non-NPC characters available as a "near this pilot" target -- pulled from
// the same roster the table shows, so it stays in sync without a separate
// endpoint.
function humanRoster(instanceId) {
  return (rosters.value[instanceId] || []).filter(c => !c.is_npc)
}

function onPlacementModeChange(inst) {
  if (npcModes.value[inst.id] === 'near_user') ensureRoster(inst.id)
}

async function spawnNpcs(inst) {
  npcError.value = ''
  const count = npcCounts.value[inst.id] || 1
  const mode = npcModes.value[inst.id] || 'anywhere'

  const body = { count, placement: mode }
  if (mode === 'near_user') {
    if (!npcTargetUser.value[inst.id]) {
      npcError.value = 'Choose a pilot to spawn near.'
      return
    }
    body.targetGameUserId = npcTargetUser.value[inst.id]
    // Whole number 0-10 -- clamp/round client-side too, not just server-side.
    body.sectorsAway = Math.min(10, Math.max(0, Math.round(Number(npcSectorsAway.value[inst.id]) || 0)))
    body.magnet = !!npcMagnet.value[inst.id]
  } else if (mode === 'in_sector') {
    const sectorNumber = Math.round(Number(npcSectorNumber.value[inst.id]))
    if (!Number.isInteger(sectorNumber) || sectorNumber < 1) {
      npcError.value = 'Enter the exact sector number to spawn in.'
      return
    }
    body.sectorNumber = sectorNumber
  }

  spawningNpcsFor.value = inst.id
  try {
    const res = await fetch(`/api/games/haulonaut/admin/instances/${inst.id}/npcs`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message || 'Failed to spawn NPCs')
    npcSpawnResults.value = { ...npcSpawnResults.value, [inst.id]: data.created || [] }
    if (expandedId.value === inst.id || rosters.value[inst.id]) {
      await refreshRoster(inst.id)
    }
    await loadOverview()
  } catch (err) {
    npcError.value = err.message
  } finally {
    spawningNpcsFor.value = null
  }
}

async function endUniverse(inst) {
  if (!confirm(`End "${inst.name}"? Its characters stay in history but won't be able to keep playing there.`)) return
  endingId.value = inst.id
  try {
    const res = await fetch(`/api/games/haulonaut/admin/instances/${inst.id}/end`, {
      method: 'POST',
      credentials: 'include'
    })
    if (res.ok) await loadOverview()
  } finally {
    endingId.value = null
  }
}

async function generateUniverse() {
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
        <h2>Universes</h2>
        <div v-if="instances.length === 0" class="empty-state">No universes yet.</div>
        <div v-else class="instance-list">
          <div v-for="inst in instances" :key="inst.id" class="instance-card">
            <div class="instance-header">
              <div class="instance-info">
                <span class="instance-name">{{ inst.name }}</span>
                <span class="instance-badge" :class="`badge-${inst.status}`">{{ inst.status }}</span>
              </div>
              <div class="instance-actions">
                <button class="link-btn" @click="toggleRoster(inst.id)">
                  {{ expandedId === inst.id ? 'Hide Roster' : 'View Roster' }} ({{ inst.player_count }}<span v-if="inst.npc_count"> + {{ inst.npc_count }} NPC</span>)
                </button>
                <button
                  v-if="inst.status === 'active'"
                  class="btn-danger"
                  :disabled="endingId === inst.id"
                  @click="endUniverse(inst)"
                >
                  {{ endingId === inst.id ? 'Ending...' : 'End Universe' }}
                </button>
                <router-link
                  class="btn-danger btn-delete"
                  :to="{ name: 'haulonautDeleteUniverse', params: { instanceId: inst.id } }"
                >
                  Delete Universe
                </router-link>
              </div>
            </div>
            <div class="instance-meta">
              {{ inst.sector_count }} sectors · started {{ formatDate(inst.started_at) }}
              <span v-if="inst.ended_at"> · ended {{ formatDate(inst.ended_at) }}</span>
            </div>

            <div v-if="expandedId === inst.id" class="roster-wrap">
              <div v-if="loadingRoster && !rosters[inst.id]" class="empty-state">Loading roster...</div>
              <table v-else-if="(rosters[inst.id] || []).length > 0" class="roster-table">
                <thead>
                  <tr>
                    <th>Character</th>
                    <th>Owner</th>
                    <th>Status</th>
                    <th>Last Played</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="c in rosters[inst.id]" :key="c.id">
                    <td>{{ c.display_name }} <span v-if="c.is_npc" class="npc-badge">NPC</span></td>
                    <td>{{ c.is_npc ? '(system)' : (c.owner_handle || '(guest)') }}</td>
                    <td class="status-cell" :class="`status-${c.status}`">{{ c.status }}</td>
                    <td>{{ formatDate(c.last_played_at) }}</td>
                  </tr>
                </tbody>
              </table>
              <div v-else class="empty-state">No characters yet.</div>
            </div>

            <div v-if="inst.status === 'active'" class="npc-spawn-block">
              <div class="npc-spawn-row">
                <label>
                  Spawn NPCs
                  <input v-model.number="npcCounts[inst.id]" type="number" min="1" max="50" placeholder="1" />
                </label>

                <label>
                  Where
                  <select v-model="npcModes[inst.id]" @change="onPlacementModeChange(inst)">
                    <option value="anywhere">Anywhere</option>
                    <option value="near_user">Near user</option>
                    <option value="in_sector">In sector</option>
                  </select>
                </label>

                <label v-if="(npcModes[inst.id] || 'anywhere') === 'near_user'">
                  Pilot
                  <select v-model="npcTargetUser[inst.id]">
                    <option value="" disabled>Select a pilot...</option>
                    <option v-if="loadingRoster && !rosters[inst.id]" value="" disabled>Loading...</option>
                    <option v-for="c in humanRoster(inst.id)" :key="c.id" :value="c.id">
                      {{ c.display_name }} ({{ c.owner_handle || 'guest' }})
                    </option>
                  </select>
                </label>

                <label v-if="(npcModes[inst.id] || 'anywhere') === 'near_user' && npcTargetUser[inst.id]">
                  Sectors away
                  <input v-model.number="npcSectorsAway[inst.id]" type="number" min="0" max="10" step="1" placeholder="0" />
                </label>

                <label v-if="npcModes[inst.id] === 'in_sector'">
                  Sector #
                  <input v-model.number="npcSectorNumber[inst.id]" type="number" min="1" :max="inst.sector_count" step="1" placeholder="e.g. 42" />
                </label>

                <button
                  class="link-btn"
                  :disabled="spawningNpcsFor === inst.id"
                  @click="spawnNpcs(inst)"
                >
                  {{ spawningNpcsFor === inst.id ? 'Spawning...' : 'Spawn' }}
                </button>
              </div>

              <label v-if="(npcModes[inst.id] || 'anywhere') === 'near_user' && npcTargetUser[inst.id]" class="npc-magnet-row">
                <input type="checkbox" v-model="npcMagnet[inst.id]" />
                Magnet &mdash; every few turns, pull this NPC back toward that pilot until it catches up
              </label>

              <p v-if="(npcSpawnResults[inst.id] || []).length > 0" class="npc-spawn-results">
                Spawned:
                <span v-for="(c, i) in npcSpawnResults[inst.id]" :key="c.id">
                  {{ c.display_name }} &rarr; Sector #{{ c.sector_number }}<span v-if="c.magnet"> [MAGNET]</span><span v-if="i < npcSpawnResults[inst.id].length - 1">, </span>
                </span>
              </p>
            </div>
          </div>
        </div>
        <p v-if="npcError" class="error">{{ npcError }}</p>
      </section>

      <section class="admin-section">
        <h2>Generate New Universe</h2>
        <p class="hint-text">Creates a new universe alongside any others currently running — nothing else is affected. End a universe explicitly from the list above if you want to retire it.</p>
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
  padding: 12px 0;
}

.admin-section {
  background: var(--color-background-card);
  border-radius: 8px;
  padding: 18px 20px;
  margin-bottom: 20px;
}

.instance-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.instance-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px 14px;
}

.instance-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.instance-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.instance-name {
  font-weight: 600;
  color: var(--color-text);
}

.instance-badge {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 10px;
  text-transform: uppercase;
}

.badge-active { background: #d4edda; color: #155724; }
.badge-ended { background: #e2e3e5; color: #383d41; }
.badge-setup { background: #fff3cd; color: #856404; }

.instance-actions {
  display: flex;
  gap: 8px;
}

.instance-meta {
  margin-top: 4px;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.roster-wrap {
  margin-top: 12px;
}

.link-btn {
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-background-soft);
  color: var(--color-text);
  cursor: pointer;
  font-size: 0.8rem;
}
.link-btn:hover { background: var(--color-background-hover); }

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

.npc-badge {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-text-muted);
  vertical-align: middle;
}

.npc-spawn-block {
  margin-top: 12px;
}

.npc-spawn-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.npc-spawn-row label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8rem;
  color: var(--color-text-light);
}

.npc-spawn-row input,
.npc-spawn-row select {
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-background-input);
  color: var(--color-text);
  font-size: 0.85rem;
}

.npc-spawn-row input[type="number"] {
  width: 70px;
}

.npc-spawn-row select {
  min-width: 110px;
}

.npc-magnet-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: 0.8rem;
  color: var(--color-text-light);
}

.npc-spawn-results {
  margin: 10px 0 0;
  font-size: 0.82rem;
  color: var(--color-text-muted);
}

.status-cell { text-transform: capitalize; font-weight: 600; }
.status-active { color: var(--color-success, #2e7d32); }
.status-dead { color: var(--color-error, #cc0000); }
.status-abandoned { color: var(--color-text-light); }

.hint-text {
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

.generate-form button,
.instance-actions button {
  padding: 9px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  background: var(--color-accent);
  color: white;
  font-size: 0.9rem;
}

.generate-form button:hover { background: var(--color-accent-hover); }
.generate-form button:disabled,
.instance-actions button:disabled { opacity: 0.5; cursor: not-allowed; }

.instance-actions .btn-danger { background: var(--color-error, #dc3545); padding: 6px 12px; font-size: 0.8rem; }
.instance-actions .btn-danger:hover:not(:disabled) { background: #c82333; }

.btn-delete {
  display: inline-block;
  border-radius: 4px;
  text-decoration: none;
  color: white;
}
.btn-delete:hover { background: #c82333; }

.error { color: var(--color-error); font-size: 0.85rem; margin-top: 10px; }
.success { color: var(--color-success, #2e7d32); font-size: 0.85rem; margin-top: 10px; }
</style>
