<template>
  <section>
    <h1>Greywire Membership</h1>
    <p class="page-subtitle">
      Only Greywire members can use the community site. Members either claimed a registered pedal's serial or were
      granted access here by hand.
    </p>

    <!-- Register pedals -->
    <div class="panel">
      <h2>Register Pedals</h2>
      <div class="add-grid">
        <label>
          Model
          <input v-model="newModel" placeholder="Flashover" maxlength="50" />
        </label>
        <label>
          Build date
          <input v-model="newBuildDate" type="date" />
        </label>
        <label class="wide">
          Notes
          <input v-model="newNotes" placeholder="Batch 1" maxlength="255" />
        </label>
        <label class="wide">
          Serials (one per line, 16 hex digits)
          <textarea v-model="newSerials" rows="4" placeholder="E4629C1B23456789"></textarea>
        </label>
      </div>
      <button @click="addPedals" :disabled="adding || !newModel.trim() || !newSerials.trim()">Register</button>
      <p v-if="addError" class="error">{{ addError }}</p>
      <p v-if="addResult" class="status-msg">
        Added {{ addResult.added.length }}.
        <span v-if="addResult.skipped.length">
          Skipped: {{ addResult.skipped.map(s => `${s.serial} (${s.reason})`).join(', ') }}
        </span>
      </p>
    </div>

    <!-- Pedal registry -->
    <div class="panel">
      <h2>Pedals</h2>
      <input v-model="filter" class="filter" placeholder="Filter by serial, model or owner..." />
      <div v-if="loadingPedals" class="status-msg">Loading...</div>
      <div v-else-if="filteredPedals.length === 0" class="status-msg">No pedals registered.</div>
      <div v-else class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Serial</th>
              <th>Model</th>
              <th>Built</th>
              <th>Owner</th>
              <th>Claimed</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="p in filteredPedals" :key="p.id">
              <tr>
                <td class="mono">{{ p.serial }}</td>
                <td>{{ p.model }}<div v-if="p.notes" class="sub">{{ p.notes }}</div></td>
                <td>{{ formatDay(p.build_date) }}</td>
                <td>{{ p.owner_handle || '—' }}</td>
                <td>{{ formatDate(p.claimed_at) }}</td>
                <td class="actions">
                  <button class="btn-sm" @click="startMove(p)">{{ p.owner_handle ? 'Move' : 'Assign' }}</button>
                  <button v-if="p.owner_handle" class="btn-sm btn-secondary" @click="release(p)">Release</button>
                  <button v-else class="btn-sm btn-danger" @click="removePedal(p)">Delete</button>
                  <button class="btn-sm btn-secondary" @click="toggleHistory(p)">History</button>
                </td>
              </tr>
              <tr v-if="movingId === p.id">
                <td colspan="6">
                  <div class="add-user-row">
                    <input v-model="moveHandle" placeholder="New owner's handle..." @keydown.enter="confirmMove(p)" />
                    <button @click="confirmMove(p)" :disabled="!moveHandle.trim()">Save</button>
                    <button class="btn-secondary" @click="movingId = null">Cancel</button>
                  </div>
                  <p v-if="moveError" class="error">{{ moveError }}</p>
                </td>
              </tr>
              <tr v-if="historyId === p.id">
                <td colspan="6">
                  <ul class="history">
                    <li v-for="e in history" :key="e.id">
                      {{ formatDateTime(e.created_at) }}: {{ describeEvent(e) }}
                    </li>
                  </ul>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Hand grants -->
    <div class="panel">
      <h2>Granted by Hand</h2>
      <div class="add-user-row">
        <input v-model="grantHandle" placeholder="Handle to grant..." @keydown.enter="addGrant" />
        <button @click="addGrant" :disabled="!grantHandle.trim()">Grant</button>
      </div>
      <p v-if="grantError" class="error">{{ grantError }}</p>

      <div v-if="loadingGrants" class="status-msg">Loading...</div>
      <div v-else-if="grants.length === 0" class="status-msg">No hand grants.</div>
      <div v-else class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Handle</th>
              <th>Name</th>
              <th>Granted</th>
              <th>By</th>
              <th>Pedals</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in grants" :key="g.id">
              <td>{{ g.handle }}</td>
              <td>{{ [g.first_name, g.last_name].filter(Boolean).join(' ') || '—' }}</td>
              <td>{{ formatDate(g.granted_at) }}</td>
              <td>{{ g.granted_by_handle || '—' }}</td>
              <td>{{ g.pedal_count }}</td>
              <td><button class="btn-sm btn-danger" @click="removeGrant(g)">Remove</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- greywirestudio.com Your Opinion surveys -->
    <GreywireSurveyResults />
  </section>
</template>

<script setup>
import { ref, computed } from 'vue'
import GreywireSurveyResults from '@/components/GreywireSurveyResults.vue'

const pedals = ref([])
const loadingPedals = ref(true)
const filter = ref('')

const newModel = ref('Flashover')
const newBuildDate = ref('')
const newNotes = ref('')
const newSerials = ref('')
const adding = ref(false)
const addError = ref('')
const addResult = ref(null)

const movingId = ref(null)
const moveHandle = ref('')
const moveError = ref('')

const historyId = ref(null)
const history = ref([])

const grants = ref([])
const loadingGrants = ref(true)
const grantHandle = ref('')
const grantError = ref('')

const filteredPedals = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return pedals.value
  return pedals.value.filter(p =>
    [p.serial, p.model, p.owner_handle, p.notes].some(v => v && v.toLowerCase().includes(q))
  )
})

async function loadPedals() {
  loadingPedals.value = true
  try {
    const res = await fetch('/api/admin/greywire/pedals', { credentials: 'include' })
    const data = await res.json()
    pedals.value = data.pedals || []
  } finally {
    loadingPedals.value = false
  }
}

async function loadGrants() {
  loadingGrants.value = true
  try {
    const res = await fetch('/api/admin/greywire/grants', { credentials: 'include' })
    const data = await res.json()
    grants.value = data.grants || []
  } finally {
    loadingGrants.value = false
  }
}

async function addPedals() {
  adding.value = true
  addError.value = ''
  addResult.value = null
  try {
    const res = await fetch('/api/admin/greywire/pedals', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: newModel.value.trim(),
        buildDate: newBuildDate.value || null,
        notes: newNotes.value.trim(),
        serials: newSerials.value
      })
    })
    const data = await res.json()
    if (res.ok) {
      addResult.value = data
      newSerials.value = ''
      await loadPedals()
    } else {
      addError.value = data.message || 'Failed to register pedals'
    }
  } finally {
    adding.value = false
  }
}

function startMove(p) {
  movingId.value = p.id
  moveHandle.value = ''
  moveError.value = ''
}

async function updateOwner(p, handle) {
  const res = await fetch(`/api/admin/greywire/pedals/${p.id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle })
  })
  const data = await res.json()
  if (res.ok) {
    movingId.value = null
    if (historyId.value === p.id) historyId.value = null
    await Promise.all([loadPedals(), loadGrants()])
  }
  return res.ok ? '' : (data.message || 'Failed to update pedal')
}

async function confirmMove(p) {
  moveError.value = await updateOwner(p, moveHandle.value.trim())
}

async function release(p) {
  if (!confirm(`Release ${p.serial} from ${p.owner_handle}? They lose access unless they hold another pedal or a grant.`)) return
  const err = await updateOwner(p, '')
  if (err) alert(err)
}

async function removePedal(p) {
  if (!confirm(`Delete ${p.serial} from the registry?`)) return
  const res = await fetch(`/api/admin/greywire/pedals/${p.id}`, { method: 'DELETE', credentials: 'include' })
  if (res.ok) await loadPedals()
}

async function toggleHistory(p) {
  if (historyId.value === p.id) {
    historyId.value = null
    return
  }
  const res = await fetch(`/api/admin/greywire/pedals/${p.id}/events`, { credentials: 'include' })
  const data = await res.json()
  history.value = data.events || []
  historyId.value = p.id
}

function describeEvent(e) {
  const by = e.by_handle ? ` by ${e.by_handle}` : ''
  switch (e.event) {
    case 'added': return `registered${by}`
    case 'claimed': return `claimed for ${e.to_handle || 'a deleted user'}${by}`
    case 'transferred': return `moved from ${e.from_handle || 'a deleted user'} to ${e.to_handle || 'a deleted user'}${by}`
    case 'released': return `released from ${e.from_handle || 'a deleted user'}${by}`
    default: return e.event
  }
}

async function addGrant() {
  const handle = grantHandle.value.trim()
  if (!handle) return
  grantError.value = ''
  const res = await fetch('/api/admin/greywire/grants', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle })
  })
  const data = await res.json()
  if (res.ok) {
    grantHandle.value = ''
    await loadGrants()
  } else {
    grantError.value = data.message || 'Failed to grant membership'
  }
}

async function removeGrant(g) {
  if (!confirm(`Remove ${g.handle}'s grant? They keep access only if they hold a pedal.`)) return
  const res = await fetch(`/api/admin/greywire/grants/${g.id}`, { method: 'DELETE', credentials: 'include' })
  if (res.ok) await loadGrants()
}

function formatDate(str) {
  return str ? new Date(str).toLocaleDateString() : '—'
}

// build_date is a DATE column, sent as midnight UTC; show that calendar day
function formatDay(str) {
  return str ? new Date(str).toLocaleDateString(undefined, { timeZone: 'UTC' }) : '—'
}

function formatDateTime(str) {
  return str ? new Date(str).toLocaleString() : '—'
}

loadPedals()
loadGrants()
</script>

<style scoped>
h1 { color: var(--color-text); margin-bottom: 4px; }
.page-subtitle { color: var(--color-text-muted); margin: 0 0 20px; font-size: 0.9rem; }
h2 { color: var(--color-text); font-size: 1rem; margin: 0 0 12px; }

.panel {
  background: var(--color-background-card);
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
}

.add-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}
.add-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
.add-grid .wide { grid-column: 1 / -1; }

input, textarea {
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-background-input);
  color: var(--color-text);
  font-size: 0.9rem;
}
textarea { font-family: monospace; resize: vertical; }
.filter { width: 100%; margin-bottom: 8px; box-sizing: border-box; }

.add-user-row {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}
.add-user-row input { flex: 1; }

.table-wrap { overflow-x: auto; }
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
  margin-top: 12px;
}
.data-table th, .data-table td {
  border: 1px solid var(--color-border);
  padding: 8px 10px;
  text-align: left;
  color: var(--color-text);
}
.data-table thead { background: var(--color-background-soft); }
.mono { font-family: monospace; }
.sub { font-size: 0.8rem; color: var(--color-text-light); }
.actions { white-space: nowrap; }
.actions button + button { margin-left: 4px; }

.history { margin: 0; padding-left: 18px; font-size: 0.85rem; color: var(--color-text); }

.status-msg { color: var(--color-text-muted, #888); font-style: italic; padding: 12px 0; }
.error { color: var(--color-error); font-size: 0.85rem; margin: 6px 0 0; }

button {
  padding: 8px 14px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  background: var(--color-accent);
  color: white;
  font-size: 0.9rem;
}
button:hover { background: var(--color-accent-hover); }
button:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-secondary { background: var(--color-background-soft); color: var(--color-text); border: 1px solid var(--color-border); }
.btn-secondary:hover { background: var(--color-border); }
.btn-danger { background: var(--color-error, #dc3545); }
.btn-danger:hover { background: #c82333; }
.btn-sm { padding: 4px 10px; font-size: 0.8rem; }
</style>
