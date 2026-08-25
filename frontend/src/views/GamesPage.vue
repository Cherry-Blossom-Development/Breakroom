<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

const loading = ref(true)
const error = ref('')
const game = ref(null)
const instances = ref([])
const characters = ref([])
const isAdmin = ref(false)

const showCreateModal = ref(false)
const newCharacterName = ref('')
const selectedInstanceId = ref(null)
const creating = ref(false)
const createError = ref('')

const mostRecentCharacter = computed(() => characters.value[0] || null)

async function loadGame() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch('/api/games/haulonaut', { credentials: 'include' })
    if (!res.ok) throw new Error('Failed to load')
    const data = await res.json()
    game.value = data.game
    instances.value = data.instances || []
    characters.value = data.characters || []
    isAdmin.value = !!data.isAdmin
  } catch (err) {
    error.value = 'Failed to load Haulonaut.'
    console.error(err)
  } finally {
    loading.value = false
  }
}

function handlePlayNow() {
  if (mostRecentCharacter.value) {
    resumeCharacter(mostRecentCharacter.value)
  } else if (instances.value.length > 0) {
    openCreateModal()
  }
}

function openCreateModal(instanceId = null) {
  newCharacterName.value = ''
  createError.value = ''
  selectedInstanceId.value = instanceId || instances.value[0]?.id || null
  showCreateModal.value = true
}

function resumeCharacter(character) {
  router.push(`/games/haulonaut/play/${character.id}`)
}

async function createCharacter() {
  const displayName = newCharacterName.value.trim()
  if (!displayName || !selectedInstanceId.value) return
  creating.value = true
  createError.value = ''
  try {
    const res = await fetch('/api/games/haulonaut/characters', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: displayName, instance_id: selectedInstanceId.value })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message || 'Failed to launch')
    showCreateModal.value = false
    router.push(`/games/haulonaut/play/${data.character.id}`)
  } catch (err) {
    createError.value = err.message
  } finally {
    creating.value = false
  }
}

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString()
}

onMounted(loadGame)
</script>

<template>
  <div class="page-container games-page">
    <h1>Games</h1>

    <div v-if="loading" class="loading">Loading...</div>
    <div v-else-if="error" class="error-message">{{ error }}</div>

    <template v-else-if="game">
      <!-- Retro ad card -->
      <div class="haulonaut-ad">
        <div class="ad-scanlines" aria-hidden="true"></div>
        <p class="ad-eyebrow">&gt;&gt;&gt; INCOMING TRANSMISSION<span class="ad-cursor" aria-hidden="true">_</span></p>
        <h2 class="ad-title">{{ game.name.toUpperCase() }}</h2>
        <p class="ad-tagline">Haul cargo. Chart the void. Make your fortune — or lose everything.</p>
        <p class="ad-description">{{ game.description }}</p>
        <p class="ad-stat">1000-sector universes · text-based · permadeath</p>
        <button
          class="ad-play-btn"
          :disabled="!mostRecentCharacter && instances.length === 0"
          @click="handlePlayNow"
        >
          {{ mostRecentCharacter ? 'RESUME ▶' : (instances.length > 0 ? 'PLAY NOW ▶' : 'NO UNIVERSES ONLINE') }}
        </button>
        <button v-if="isAdmin" class="admin-link-btn" @click="router.push('/games/haulonaut/admin')">⚙ Manage Universe</button>
      </div>

      <!-- Active universes -->
      <section v-if="instances.length > 0" class="universes-section">
        <h2>Active Universes</h2>
        <div class="universe-list">
          <div v-for="inst in instances" :key="inst.id" class="universe-card">
            <div class="universe-info">
              <span class="universe-name">{{ inst.name }}</span>
              <span class="universe-meta">
                {{ inst.sector_count }} sectors · {{ inst.player_count }} player{{ inst.player_count == 1 ? '' : 's' }} · since {{ formatDate(inst.started_at) }}
              </span>
            </div>
            <button class="new-game-btn" @click="openCreateModal(inst.id)">+ New Character</button>
          </div>
        </div>
      </section>

      <!-- Your current games -->
      <section v-if="characters.length > 0" class="current-games-section">
        <h2>Your Current Games</h2>

        <div class="character-list">
          <div v-for="c in characters" :key="c.id" class="character-card">
            <div class="character-info">
              <span class="character-name">{{ c.display_name }}</span>
              <span class="character-meta">
                <span class="character-status" :class="`status-${c.status}`">{{ c.status }}</span>
                in {{ c.instance_name }}<span v-if="c.instance_status !== 'active'"> (ended)</span>
                · Started {{ formatDate(c.created_at) }} · Last played {{ formatDate(c.last_played_at) }}
              </span>
            </div>
            <button class="resume-btn" @click="resumeCharacter(c)">Resume</button>
          </div>
        </div>
      </section>
    </template>

    <!-- Launch character modal -->
    <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="launch-modal-title">
        <h2 id="launch-modal-title">Name Your Captain</h2>
        <form @submit.prevent="createCharacter">
          <label v-if="instances.length > 1" class="modal-label">
            Universe
            <select v-model="selectedInstanceId">
              <option v-for="inst in instances" :key="inst.id" :value="inst.id">{{ inst.name }}</option>
            </select>
          </label>
          <input
            v-model="newCharacterName"
            placeholder="e.g. Captain Vex"
            maxlength="64"
            autofocus
            aria-label="Captain name"
          />
          <p v-if="createError" class="error">{{ createError }}</p>
          <div class="modal-actions">
            <button type="submit" :disabled="!newCharacterName.trim() || !selectedInstanceId || creating">
              {{ creating ? 'Launching...' : 'Launch' }}
            </button>
            <button type="button" @click="showCreateModal = false">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.games-page {
  max-width: 800px;
}

.loading,
.error-message {
  color: var(--color-text-muted);
  padding: 40px 0;
  text-align: center;
}

/* ---- Retro terminal ad ---- */
.haulonaut-ad {
  position: relative;
  background: #05130a;
  color: #4dff88;
  border: 2px solid #1f8a4c;
  border-radius: 6px;
  padding: 28px 24px;
  margin-bottom: 32px;
  font-family: 'Courier New', Courier, monospace;
  overflow: hidden;
  box-shadow: 0 0 24px rgba(77, 255, 136, 0.15);
}

.ad-scanlines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0) 0px,
    rgba(0, 0, 0, 0) 2px,
    rgba(0, 0, 0, 0.15) 3px
  );
}

.ad-eyebrow {
  margin: 0 0 8px;
  font-size: 0.85rem;
  letter-spacing: 0.05em;
  color: #2fd66e;
}

.ad-cursor {
  animation: ad-blink 1s step-end infinite;
}

@media (prefers-reduced-motion: reduce) {
  .ad-cursor { animation: none; }
}

@keyframes ad-blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}

.ad-title {
  margin: 0 0 10px;
  font-size: 2.2rem;
  letter-spacing: 0.08em;
  text-shadow: 0 0 8px rgba(77, 255, 136, 0.6);
}

.ad-tagline {
  margin: 0 0 14px;
  font-size: 1rem;
  color: #baffcf;
}

.ad-description {
  margin: 0 0 14px;
  color: #8fe6ab;
  line-height: 1.6;
}

.ad-stat {
  margin: 0 0 20px;
  font-size: 0.8rem;
  color: #2fd66e;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.ad-play-btn {
  position: relative;
  background: #0d3a1e;
  color: #baffcf;
  border: 2px solid #4dff88;
  border-radius: 4px;
  padding: 12px 28px;
  font-family: inherit;
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  cursor: pointer;
}

.ad-play-btn:hover:not(:disabled) {
  background: #4dff88;
  color: #05130a;
}

.ad-play-btn:focus-visible {
  outline: 2px solid #baffcf;
  outline-offset: 3px;
}

.ad-play-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.admin-link-btn {
  display: block;
  margin-top: 14px;
  background: none;
  border: 1px solid #1f8a4c;
  color: #8fe6ab;
  border-radius: 4px;
  padding: 7px 14px;
  font-family: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}

.admin-link-btn:hover {
  background: #0d3a1e;
}

.admin-link-btn:focus-visible {
  outline: 2px solid #baffcf;
  outline-offset: 2px;
}

/* ---- Universes & current games ---- */
.universes-section,
.current-games-section {
  margin-bottom: 28px;
}

.universes-section h2,
.current-games-section h2 {
  color: var(--color-text);
  font-size: 1.1rem;
  margin: 0 0 12px;
}

.universe-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.universe-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px 16px;
}

.universe-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.universe-name {
  font-weight: 600;
  color: var(--color-text);
}

.universe-meta {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.new-game-btn {
  flex-shrink: 0;
  padding: 7px 12px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-background-soft);
  color: var(--color-text);
  cursor: pointer;
  font-size: 0.85rem;
}

.new-game-btn:hover {
  background: var(--color-background-hover);
}

.character-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.character-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px 16px;
}

.character-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.character-name {
  font-weight: 600;
  color: var(--color-text);
}

.character-meta {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.character-status {
  font-weight: 600;
  text-transform: capitalize;
}

.status-active { color: var(--color-success, #2e7d32); }
.status-dead { color: var(--color-error, #cc0000); }
.status-abandoned { color: var(--color-text-light); }

.resume-btn {
  flex-shrink: 0;
  padding: 7px 14px;
  border: none;
  border-radius: 4px;
  background: var(--color-accent);
  color: white;
  cursor: pointer;
  font-size: 0.9rem;
}

.resume-btn:hover {
  background: var(--color-accent-hover);
}

/* ---- Launch modal ---- */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.modal {
  background: var(--color-background-card);
  color: var(--color-text);
  padding: 24px;
  border-radius: 10px;
  width: 380px;
  max-width: 90%;
}

.modal h2 {
  margin: 0 0 16px;
}

.modal input,
.modal select {
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-background-input);
  color: var(--color-text);
  font-size: 0.95rem;
  box-sizing: border-box;
}

.modal-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.85rem;
  color: var(--color-text-light);
  margin-bottom: 12px;
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
}

.modal-actions button {
  padding: 8px 14px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  background: var(--color-accent);
  color: white;
  font-size: 0.9rem;
}

.modal-actions button:hover {
  background: var(--color-accent-hover);
}

.modal-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.modal-actions button[type="button"] {
  background: var(--color-button-secondary);
  color: var(--color-text);
}

.modal-actions button[type="button"]:hover {
  background: var(--color-button-secondary-hover);
}

.error {
  color: var(--color-error);
  font-size: 0.85rem;
  margin: 8px 0 0;
}
</style>
