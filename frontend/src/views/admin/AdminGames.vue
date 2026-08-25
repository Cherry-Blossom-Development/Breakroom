<template>
  <section>
    <h1>Game Admins</h1>
    <p class="page-subtitle">
      Grant users operational control over one game (generating a new universe, viewing the player roster) without
      granting site-wide admin access.
    </p>

    <div class="games-layout">
      <!-- Left: game list -->
      <div class="game-list">
        <h2>Games</h2>
        <div v-if="loading" class="status-msg">Loading...</div>
        <div v-else-if="games.length === 0" class="status-msg">No games yet.</div>

        <div
          v-for="g in games"
          :key="g.id"
          class="game-card"
          :class="{ selected: selectedGame?.id === g.id }"
          @click="selectGame(g)"
        >
          <span class="game-name">{{ g.name }}</span>
          <span class="game-meta">{{ g.admin_count }} admin{{ g.admin_count == 1 ? '' : 's' }}</span>
        </div>
      </div>

      <!-- Right: admins for selected game -->
      <div class="game-detail" v-if="selectedGame">
        <h2>{{ selectedGame.name }} Admins</h2>

        <div class="add-user-row">
          <input
            v-model="handleInput"
            placeholder="Handle to add..."
            @keydown.enter="addAdmin"
          />
          <button @click="addAdmin" :disabled="!handleInput.trim()">Add Admin</button>
        </div>
        <p v-if="addError" class="error">{{ addError }}</p>

        <div v-if="loadingAdmins" class="status-msg">Loading...</div>
        <table v-else-if="admins.length > 0" class="admins-table">
          <thead>
            <tr>
              <th>Handle</th>
              <th>Name</th>
              <th>Added</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in admins" :key="a.id">
              <td>{{ a.handle }}</td>
              <td>{{ [a.first_name, a.last_name].filter(Boolean).join(' ') || '—' }}</td>
              <td>{{ formatDate(a.added_at) }}</td>
              <td><button class="btn-sm btn-danger" @click="removeAdmin(a.id)">Remove</button></td>
            </tr>
          </tbody>
        </table>
        <div v-else class="status-msg">No admins yet for this game.</div>
      </div>

      <div class="game-detail game-detail-empty" v-else>
        <p>Select a game to manage its admins.</p>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref } from 'vue'

const games = ref([])
const loading = ref(true)
const selectedGame = ref(null)
const admins = ref([])
const loadingAdmins = ref(false)

const handleInput = ref('')
const addError = ref('')

async function loadGames() {
  loading.value = true
  try {
    const res = await fetch('/api/admin/games', { credentials: 'include' })
    const data = await res.json()
    games.value = data.games || []
    if (selectedGame.value) {
      const updated = games.value.find(g => g.id === selectedGame.value.id)
      if (updated) selectedGame.value = updated
    }
  } finally {
    loading.value = false
  }
}

async function loadAdmins() {
  if (!selectedGame.value) return
  loadingAdmins.value = true
  try {
    const res = await fetch(`/api/admin/games/${selectedGame.value.id}/admins`, { credentials: 'include' })
    const data = await res.json()
    admins.value = data.admins || []
  } finally {
    loadingAdmins.value = false
  }
}

function selectGame(g) {
  selectedGame.value = g
  handleInput.value = ''
  addError.value = ''
  loadAdmins()
}

async function addAdmin() {
  const handle = handleInput.value.trim()
  if (!handle) return
  addError.value = ''
  const res = await fetch(`/api/admin/games/${selectedGame.value.id}/admins`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle })
  })
  const data = await res.json()
  if (res.ok) {
    handleInput.value = ''
    await Promise.all([loadAdmins(), loadGames()])
  } else {
    addError.value = data.message || 'Failed to add admin'
  }
}

async function removeAdmin(userId) {
  if (!confirm('Remove this game admin?')) return
  const res = await fetch(`/api/admin/games/${selectedGame.value.id}/admins/${userId}`, {
    method: 'DELETE',
    credentials: 'include'
  })
  if (res.ok) {
    await Promise.all([loadAdmins(), loadGames()])
  }
}

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString()
}

loadGames()
</script>

<style scoped>
h1 { color: var(--color-text); margin-bottom: 4px; }
.page-subtitle { color: var(--color-text-muted); margin: 0 0 20px; font-size: 0.9rem; }
h2 { color: var(--color-text); font-size: 1rem; margin: 0 0 12px; }

.games-layout {
  display: flex;
  gap: 24px;
  align-items: flex-start;
}

.game-list {
  width: 260px;
  flex-shrink: 0;
}

.game-card {
  background: var(--color-background-card);
  border: 2px solid transparent;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: border-color 0.15s, background 0.15s;
}

.game-card:hover { border-color: var(--color-accent); }
.game-card.selected { border-color: var(--color-accent); background: var(--color-background-soft); }

.game-name { font-weight: 600; color: var(--color-text); font-size: 0.95rem; }
.game-meta { font-size: 0.8rem; color: var(--color-text-light); }

.game-detail {
  flex: 1;
  background: var(--color-background-card);
  border-radius: 8px;
  padding: 20px;
  min-height: 200px;
}

.game-detail-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted, #888);
}

.add-user-row {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}

.add-user-row input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-background-input);
  color: var(--color-text);
  font-size: 0.9rem;
}

.admins-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
  margin-top: 12px;
}

.admins-table th, .admins-table td {
  border: 1px solid var(--color-border);
  padding: 8px 10px;
  text-align: left;
  color: var(--color-text);
}

.admins-table thead { background: var(--color-background-soft); }

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

.btn-danger { background: var(--color-error, #dc3545); }
.btn-danger:hover { background: #c82333; }
.btn-sm { padding: 4px 10px; font-size: 0.8rem; }
</style>
