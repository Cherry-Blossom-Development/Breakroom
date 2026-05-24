<template>
  <section class="impersonate-page">
    <h1>Impersonate User</h1>
    <p class="page-desc">
      Log in as another user. All actions taken during the session will affect that user's real account.
      A banner will be shown throughout the session.
    </p>

    <input
      v-model="search"
      type="text"
      class="search-input"
      placeholder="Search by handle, name, or email…"
    />

    <div v-if="loading" class="state-msg">Loading users…</div>
    <div v-else-if="!filteredUsers.length" class="state-msg">No users match your search.</div>

    <table v-else class="users-table">
      <thead>
        <tr>
          <th>Handle</th>
          <th>Name</th>
          <th>Email</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="u in filteredUsers" :key="u.id">
          <td>{{ u.handle }}</td>
          <td>{{ [u.first_name, u.last_name].filter(Boolean).join(' ') || '—' }}</td>
          <td>{{ u.email }}</td>
          <td>
            <button
              class="btn-impersonate"
              :disabled="impersonating === u.id"
              @click="startImpersonation(u)"
            >
              {{ impersonating === u.id ? 'Starting…' : 'Impersonate' }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-if="error" class="error-msg">{{ error }}</p>
  </section>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { authFetch } from '@/utilities/authFetch'
import { user } from '@/stores/user.js'

const router = useRouter()

const allUsers = ref([])
const loading = ref(true)
const search = ref('')
const impersonating = ref(null)
const error = ref(null)

const filteredUsers = computed(() => {
  const q = search.value.toLowerCase().trim()
  const me = user.username
  return allUsers.value.filter(u => {
    if (u.handle === me) return false
    if (!q) return true
    return (
      u.handle?.toLowerCase().includes(q) ||
      u.first_name?.toLowerCase().includes(q) ||
      u.last_name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q)
    )
  })
})

function getCookie(name) {
  const value = `; ${document.cookie}`
  const parts = value.split(`; ${name}=`)
  if (parts.length === 2) return parts.pop().split(';').shift()
  return null
}

async function startImpersonation(target) {
  error.value = null
  impersonating.value = target.id

  const adminToken = getCookie('jwtToken')
  if (!adminToken) {
    error.value = 'Could not read session token.'
    impersonating.value = null
    return
  }

  try {
    const res = await authFetch(`/api/admin/impersonate/${target.id}`, { method: 'POST' })
    if (!res.ok) {
      const data = await res.json()
      error.value = data.message || 'Failed to start impersonation.'
      return
    }
    const data = await res.json()

    localStorage.setItem('adminToken', adminToken)
    localStorage.setItem('impersonatedUser', data.handle)

    await user.fetchUser()
    router.push('/breakroom')
  } catch (err) {
    error.value = 'Network error.'
  } finally {
    impersonating.value = null
  }
}

onMounted(async () => {
  try {
    const res = await authFetch('/api/user/all')
    if (res.ok) {
      const data = await res.json()
      allUsers.value = data.users || []
    }
  } catch {}
  finally { loading.value = false }
})
</script>

<style scoped>
.impersonate-page {
  padding: 32px 24px;
  max-width: 860px;
}

h1 {
  font-size: 1.8rem;
  margin: 0 0 8px;
  color: var(--color-text);
}

.page-desc {
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  margin: 0 0 24px;
  line-height: 1.5;
  max-width: 560px;
}

.search-input {
  width: 100%;
  max-width: 420px;
  padding: 9px 13px;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  font-size: 0.95rem;
  color: var(--color-text);
  background: var(--color-background, #fff);
  margin-bottom: 20px;
  box-sizing: border-box;
}
.search-input:focus { outline: none; border-color: var(--color-link); }

.state-msg {
  color: var(--color-text-secondary);
  padding: 20px 0;
  font-size: 0.95rem;
}

.users-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.users-table th {
  text-align: left;
  padding: 8px 12px;
  border-bottom: 2px solid var(--color-border);
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.users-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text);
}

.users-table tbody tr:hover {
  background: var(--color-background-soft, #f9f9f9);
}

.btn-impersonate {
  background: var(--color-link);
  color: #fff;
  border: none;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
  white-space: nowrap;
}
.btn-impersonate:hover:not(:disabled) { opacity: 0.85; }
.btn-impersonate:disabled { opacity: 0.5; cursor: not-allowed; }

.error-msg {
  color: var(--color-error, #e53e3e);
  margin-top: 16px;
  font-size: 0.9rem;
}
</style>
