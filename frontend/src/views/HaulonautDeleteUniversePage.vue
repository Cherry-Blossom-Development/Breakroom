<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const notFound = ref(false)
const forbidden = ref(false)
const error = ref('')
const instance = ref(null)

const confirmText = ref('')
const deleting = ref(false)
const deleteError = ref('')

const confirmMatches = computed(() => instance.value && confirmText.value === instance.value.name)

async function loadInstance() {
  loading.value = true
  error.value = ''
  forbidden.value = false
  notFound.value = false
  try {
    const res = await fetch('/api/games/haulonaut/admin/overview', { credentials: 'include' })
    if (res.status === 403) { forbidden.value = true; return }
    if (!res.ok) throw new Error('Failed to load')
    const data = await res.json()
    const found = (data.instances || []).find(i => String(i.id) === String(route.params.instanceId))
    if (!found) { notFound.value = true; return }
    instance.value = found
  } catch (err) {
    error.value = 'Failed to load universe details.'
    console.error(err)
  } finally {
    loading.value = false
  }
}

async function confirmDelete() {
  if (!confirmMatches.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    const res = await fetch(`/api/games/haulonaut/admin/instances/${instance.value.id}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmName: confirmText.value })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message || 'Failed to delete universe')
    router.push({ name: 'haulonautAdmin' })
  } catch (err) {
    deleteError.value = err.message
  } finally {
    deleting.value = false
  }
}

function cancel() {
  router.push({ name: 'haulonautAdmin' })
}

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleString()
}

onMounted(loadInstance)
</script>

<template>
  <div class="page-container haulonaut-delete-page">
    <h1>Delete Universe</h1>

    <div v-if="loading" class="loading">Loading...</div>
    <div v-else-if="forbidden" class="error-message">You aren't an admin for this game.</div>
    <div v-else-if="notFound" class="error-message">
      That universe couldn't be found.
      <router-link :to="{ name: 'haulonautAdmin' }">Back to Universe Admin</router-link>
    </div>
    <div v-else-if="error" class="error-message">{{ error }}</div>

    <template v-else>
      <section class="danger-zone">
        <h2>⚠ This cannot be undone</h2>
        <p class="warning-text">
          You are about to permanently delete the universe <strong>"{{ instance.name }}"</strong>.
          This will immediately and irreversibly delete:
        </p>
        <ul class="consequence-list">
          <li>The entire sector map — <strong>{{ instance.sector_count }}</strong> sectors and every connection between them</li>
          <li>Every planet, trading outpost, and other feature placed in those sectors</li>
          <li><strong>{{ instance.player_count }}</strong> player character{{ instance.player_count === 1 ? '' : 's' }} created in this universe, along with their current location, visited-sector history, and settings</li>
        </ul>
        <p class="warning-text">
          Players with characters here will lose them entirely — there is no way to recover a deleted universe or
          the characters in it. If you only want to retire this universe while keeping its history, go back and use
          <strong>End Universe</strong> instead.
        </p>

        <div class="instance-summary">
          <div><span class="summary-label">Status</span> {{ instance.status }}</div>
          <div><span class="summary-label">Started</span> {{ formatDate(instance.started_at) }}</div>
          <div v-if="instance.ended_at"><span class="summary-label">Ended</span> {{ formatDate(instance.ended_at) }}</div>
        </div>

        <div class="confirm-form">
          <label>
            Type the universe name <strong>{{ instance.name }}</strong> to confirm
            <input v-model="confirmText" :placeholder="instance.name" autocomplete="off" />
          </label>

          <div class="confirm-actions">
            <button class="btn-secondary" :disabled="deleting" @click="cancel">Cancel</button>
            <button class="btn-danger" :disabled="!confirmMatches || deleting" @click="confirmDelete">
              {{ deleting ? 'Deleting...' : 'Permanently Delete Universe' }}
            </button>
          </div>

          <p v-if="deleteError" class="error">{{ deleteError }}</p>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.haulonaut-delete-page {
  max-width: 700px;
}

h1 { color: var(--color-text); margin-bottom: 20px; }

.loading, .error-message {
  color: var(--color-text-muted);
  padding: 12px 0;
}

.danger-zone {
  background: var(--color-background-card);
  border: 1px solid var(--color-error, #dc3545);
  border-radius: 8px;
  padding: 20px 22px;
}

.danger-zone h2 {
  color: var(--color-error, #dc3545);
  font-size: 1.1rem;
  margin: 0 0 12px;
}

.warning-text {
  color: var(--color-text);
  line-height: 1.5;
  margin: 0 0 12px;
}

.consequence-list {
  color: var(--color-text);
  line-height: 1.6;
  margin: 0 0 12px;
  padding-left: 22px;
}

.instance-summary {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  border-top: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
  padding: 10px 0;
  margin: 16px 0;
}

.summary-label {
  font-weight: 600;
  color: var(--color-text-light);
  margin-right: 4px;
  text-transform: capitalize;
}

.confirm-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.9rem;
  color: var(--color-text);
  margin-bottom: 16px;
}

.confirm-form input {
  padding: 9px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-background-input);
  color: var(--color-text);
  font-size: 0.9rem;
}

.confirm-actions {
  display: flex;
  gap: 10px;
}

.btn-secondary,
.btn-danger {
  padding: 9px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
}

.btn-secondary {
  background: var(--color-background-soft);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}
.btn-secondary:hover:not(:disabled) { background: var(--color-background-hover); }

.btn-danger {
  background: var(--color-error, #dc3545);
  color: white;
}
.btn-danger:hover:not(:disabled) { background: #c82333; }

.btn-secondary:disabled,
.btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }

.error { color: var(--color-error); font-size: 0.85rem; margin-top: 10px; }
</style>
