<template>
  <section>
    <h1>Manage Users</h1>

    <!-- Add User Form -->
    <form @submit.prevent="createUser" class="add-user-form">
      <input v-model="newUser.handle" placeholder="Handle" required />
      <input v-model="newUser.email" placeholder="Email" required />
      <button type="submit">Add User</button>
      <p v-if="formError" class="form-error">{{ formError }}</p>
    </form>

    <!-- User table -->
    <DataFetcher :key="fetchKey" endpoint="/api/user/all" v-slot="{ data }">
      <template v-if="data && data.users">
        <div v-show="false">{{ updateUsers(data.users) }}</div>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Handle</th>
              <th>First Name</th>
              <th>Last Name</th>
              <th>Email</th>
              <th>Plan</th>
              <th>Options</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in data.users" :key="user.id">
              <td>{{ user.id }}</td>
              <td>{{ user.handle }}</td>
              <td>{{ user.first_name }}</td>
              <td>{{ user.last_name }}</td>
              <td>{{ user.email }}</td>
              <td>
                <span class="plan-badge" :class="isPaid(user) ? 'plan-paid' : 'plan-free'">
                  {{ planLabel(user) }}
                </span>
              </td>
              <td>
                <button class="btn-edit" @click="openEdit(user)">Edit</button>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </DataFetcher>

    <!-- Invite Modal -->
    <div v-if="showInviteModal" class="modal-overlay">
      <div class="modal">
        <h2>Invite New User</h2>
        <form @submit.prevent="sendInvite">
          <input v-model="inviteUserForm.handle" placeholder="Handle" disabled />
          <input v-model="inviteUserForm.email" placeholder="Email" disabled />
          <input v-model="inviteUserForm.first_name" placeholder="First Name" required />
          <input v-model="inviteUserForm.last_name" placeholder="Last Name" required />
          <div class="modal-actions">
            <button type="submit">Send Invite</button>
            <button type="button" @click="showInviteModal = false">Cancel</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Unified Edit Dialog -->
    <div v-if="editingUser" class="modal-overlay" @click.self="cancelEdit">
      <div class="modal modal-wide">
        <div class="modal-header">
          <h2>Edit User — @{{ editingUser.handle }}</h2>
          <button type="button" class="btn-close" @click="cancelEdit">✕</button>
        </div>

        <!-- Basic Info -->
        <section class="dialog-section">
          <h3>Basic Info</h3>
          <div class="field-grid">
            <div class="field">
              <label>Handle</label>
              <input v-model="editingUser.handle" placeholder="Handle" />
            </div>
            <div class="field">
              <label>Email</label>
              <input v-model="editingUser.email" placeholder="Email" />
            </div>
            <div class="field">
              <label>First Name</label>
              <input v-model="editingUser.first_name" placeholder="First Name" />
            </div>
            <div class="field">
              <label>Last Name</label>
              <input v-model="editingUser.last_name" placeholder="Last Name" />
            </div>
          </div>
        </section>

        <!-- Payment Plan -->
        <section class="dialog-section">
          <h3>Payment Plan</h3>
          <div class="plan-row">
            <div class="plan-info">
              <span class="plan-badge" :class="isPaid(editingUser) ? 'plan-paid' : 'plan-free'">
                {{ planLabel(editingUser) }}
              </span>
              <span v-if="editingUser.sub_platform" class="plan-detail">
                via {{ editingUser.sub_platform }}
                <template v-if="editingUser.sub_expires_at">
                  · expires {{ formatDate(editingUser.sub_expires_at) }}
                </template>
                <template v-else-if="isPaid(editingUser)">
                  · no expiry
                </template>
              </span>
            </div>
            <div class="plan-actions">
              <button v-if="!isPaid(editingUser)" type="button" class="btn-grant"
                      :disabled="planSaving" @click="grantPlan">
                {{ planSaving ? 'Saving…' : 'Grant Paid Plan' }}
              </button>
              <button v-else type="button" class="btn-revoke"
                      :disabled="planSaving" @click="revokePlan">
                {{ planSaving ? 'Saving…' : 'Revoke Plan' }}
              </button>
            </div>
          </div>
          <p v-if="planMsg" class="plan-msg" :class="planMsgType">{{ planMsg }}</p>
        </section>

        <!-- Groups & Permissions -->
        <section v-if="matrix" class="dialog-section">
          <div class="groups-perms-grid">
            <div>
              <h3>Groups</h3>
              <ul class="check-list">
                <li v-for="group in matrix.groups" :key="group.id">
                  <label>
                    <input type="checkbox" v-model="group.has_group" />
                    {{ group.name }}
                  </label>
                </li>
              </ul>
            </div>
            <div>
              <h3>Permissions</h3>
              <ul class="check-list">
                <li v-for="perm in matrix.permissions" :key="perm.id">
                  <label>
                    <input type="checkbox" v-model="perm.has_permission" />
                    {{ perm.name }}
                  </label>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <!-- Save Info -->
        <div class="dialog-action-row">
          <button type="button" class="btn-primary" :disabled="infoSaving" @click="updateUser">
            {{ infoSaving ? 'Saving…' : 'Save Info' }}
          </button>
          <p v-if="infoMsg" class="inline-msg success">{{ infoMsg }}</p>
          <p v-if="infoError" class="inline-msg error">{{ infoError }}</p>
        </div>

        <!-- Password -->
        <section class="dialog-section">
          <h3>Set Password</h3>
          <div class="password-row">
            <input v-model="newPassword" type="password" placeholder="New password (min 8 characters)"
                   minlength="8" autocomplete="new-password" class="pw-input" />
            <button type="button" :disabled="passwordSubmitting" @click="submitPasswordReset">
              {{ passwordSubmitting ? 'Saving…' : 'Set Password' }}
            </button>
          </div>
          <p v-if="passwordError" class="inline-msg error">{{ passwordError }}</p>
          <p v-if="passwordSuccess" class="inline-msg success">{{ passwordSuccess }}</p>
        </section>

        <!-- Danger Zone -->
        <section class="dialog-section danger-zone">
          <h3>Danger Zone</h3>
          <button type="button" class="btn-danger" @click="deleteUser(editingUser.id)">
            Delete User
          </button>
        </section>

      </div>
    </div>

  </section>
</template>

<script setup>
import { ref, watchEffect } from 'vue'
import DataFetcher from '@/components/DataFetcher.vue'

const newUser = ref({ handle: '', email: '' })
const inviteUserForm = ref({ handle: '', email: '', first_name: '', last_name: '' })
const showInviteModal = ref(false)
const formError = ref('')
const existingUsers = ref([])
const fetchKey = ref(0)
const matrix = ref(null)
const editingUser = ref(null)

// Info save state
const infoSaving = ref(false)
const infoMsg = ref('')
const infoError = ref('')

// Password state
const newPassword = ref('')
const passwordError = ref('')
const passwordSuccess = ref('')
const passwordSubmitting = ref(false)

// Plan state
const planSaving = ref(false)
const planMsg = ref('')
const planMsgType = ref('success')

function updateUsers(users) {
  existingUsers.value = users
  return ''
}

function isPaid(user) {
  return user.sub_status === 'active' &&
    (!user.sub_expires_at || new Date(user.sub_expires_at) > new Date())
}

function planLabel(user) {
  if (isPaid(user)) return 'Paid'
  if (user.sub_status && user.sub_status !== 'active') return `Expired (${user.sub_status})`
  return 'Free'
}

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString()
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function createUser() {
  const { handle, email } = newUser.value
  if (!handle || !email) { formError.value = 'Handle and Email are required.'; return }
  const duplicate = existingUsers.value.find(u => u.handle === handle || u.email === email)
  if (duplicate) { formError.value = `Handle "${duplicate.handle}" or email "${duplicate.email}" already exists.`; return }
  if (!isValidEmail(email)) { formError.value = 'Please enter a valid email address.'; return }
  formError.value = ''
  inviteUserForm.value = { handle, email, first_name: '', last_name: '' }
  showInviteModal.value = true
}

async function sendInvite() {
  await fetch('/api/user/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(inviteUserForm.value)
  })
  newUser.value = { handle: '', email: '' }
  inviteUserForm.value = { handle: '', email: '', first_name: '', last_name: '' }
  showInviteModal.value = false
  fetchKey.value++
}

async function openEdit(user) {
  editingUser.value = { ...user }
  matrix.value = null
  newPassword.value = ''
  passwordError.value = ''
  passwordSuccess.value = ''
  infoMsg.value = ''
  infoError.value = ''
  planMsg.value = ''

  try {
    const res = await fetch(`/api/user/permissionMatrix/${user.id}`)
    if (!res.ok) throw new Error('Failed to fetch permission matrix')
    const data = await res.json()
    matrix.value = data

    watchEffect(() => {
      if (!matrix.value) return
      const checked = new Set()
      matrix.value.permissions.forEach(p => p.has_permission = false)
      matrix.value.groups.forEach(g => {
        if (g.has_group) g.group_permissions.forEach(id => checked.add(id))
      })
      matrix.value.permissions.forEach(p => { if (checked.has(p.id)) p.has_permission = true })
    })
  } catch (err) {
    console.error(err)
  }
}

async function updateUser() {
  infoSaving.value = true
  infoMsg.value = ''
  infoError.value = ''
  const user = editingUser.value
  const payload = {
    user,
    permissions: matrix.value?.permissions.map(p => ({ permission_id: p.id, has_permission: p.has_permission })) ?? [],
    groups: matrix.value?.groups.map(g => ({ group_id: g.id, has_group: g.has_group })) ?? []
  }
  try {
    const res = await fetch(`/api/user/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    if (!res.ok) { infoError.value = 'Failed to update user.'; return }
    infoMsg.value = 'Saved.'
    fetchKey.value++
    setTimeout(() => { infoMsg.value = '' }, 2500)
  } catch { infoError.value = 'Network error.' }
  finally { infoSaving.value = false }
}

async function deleteUser(userId) {
  if (!confirm('Are you sure you want to delete this user? This cannot be undone.')) return
  try {
    const res = await fetch(`/api/user/${userId}`, { method: 'DELETE' })
    if (!res.ok) { alert('Failed to delete user.'); return }
    editingUser.value = null
    fetchKey.value++
  } catch { alert('Network error.') }
}

function cancelEdit() {
  editingUser.value = null
}

async function submitPasswordReset() {
  passwordError.value = ''
  passwordSuccess.value = ''
  passwordSubmitting.value = true
  try {
    const res = await fetch(`/api/user/${editingUser.value.id}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword.value }),
      credentials: 'include'
    })
    const data = await res.json()
    if (!res.ok) { passwordError.value = data.message || 'Failed to update password.' }
    else { passwordSuccess.value = data.message; newPassword.value = '' }
  } catch { passwordError.value = 'Network error — please try again.' }
  finally { passwordSubmitting.value = false }
}

async function grantPlan() {
  planSaving.value = true
  planMsg.value = ''
  try {
    const res = await fetch('/api/subscriptions/admin/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ handle: editingUser.value.handle, action: 'grant' })
    })
    const data = await res.json()
    if (!res.ok) { planMsg.value = data.message || 'Failed.'; planMsgType.value = 'error'; return }
    planMsg.value = data.message
    planMsgType.value = 'success'
    editingUser.value.sub_status = 'active'
    editingUser.value.sub_platform = 'promo'
    editingUser.value.sub_expires_at = null
    fetchKey.value++
  } catch { planMsg.value = 'Network error.'; planMsgType.value = 'error' }
  finally { planSaving.value = false }
}

async function revokePlan() {
  if (!confirm(`Revoke the paid plan for @${editingUser.value.handle}?`)) return
  planSaving.value = true
  planMsg.value = ''
  try {
    const res = await fetch('/api/subscriptions/admin/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ handle: editingUser.value.handle, action: 'revoke' })
    })
    const data = await res.json()
    if (!res.ok) { planMsg.value = data.message || 'Failed.'; planMsgType.value = 'error'; return }
    planMsg.value = data.message
    planMsgType.value = 'success'
    editingUser.value.sub_status = 'cancelled'
    fetchKey.value++
  } catch { planMsg.value = 'Network error.'; planMsgType.value = 'error' }
  finally { planSaving.value = false }
}
</script>

<style scoped>
h1 { color: var(--color-text); margin-bottom: 16px; }

.add-user-form { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
.add-user-form input { padding: 8px 12px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-background-input); color: var(--color-text); }
.form-error { color: var(--color-error, #dc3545); font-size: 0.85rem; width: 100%; margin: 0; }

table { width: 100%; border-collapse: collapse; margin-top: 8px; background: var(--color-background-card); }
th, td { border: 1px solid var(--color-border); padding: 10px; text-align: left; color: var(--color-text); }
thead { background-color: var(--color-background-soft); }

.plan-badge { font-size: 0.75rem; font-weight: 700; padding: 2px 8px; border-radius: 10px; white-space: nowrap; }
.plan-paid { background: #d4edda; color: #155724; }
.plan-free { background: var(--color-background-soft); color: var(--color-text-muted); }

.btn-edit { padding: 5px 14px; border: none; border-radius: 4px; cursor: pointer; background: var(--color-accent); color: white; font-size: 0.85rem; }
.btn-edit:hover { background: var(--color-accent-hover); }

/* Modal */
.modal-overlay { position: fixed; inset: 0; background: var(--color-overlay); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px; }
.modal { background: var(--color-background-card); padding: 24px; border-radius: 10px; width: 500px; max-width: 95vw; max-height: 90vh; overflow-y: auto; }
.modal-wide { width: 680px; }

.modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.modal-header h2 { color: var(--color-text); margin: 0; font-size: 1.1rem; }
.btn-close { background: none; border: none; font-size: 1.1rem; color: var(--color-text-muted); cursor: pointer; padding: 2px 6px; }
.btn-close:hover { color: var(--color-text); }

.dialog-section { border-top: 1px solid var(--color-border); padding-top: 16px; margin-bottom: 16px; }
.dialog-section h3 { color: var(--color-text); margin: 0 0 12px; font-size: 0.95rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-muted); }

.field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.field label { display: block; font-size: 0.8rem; color: var(--color-text-muted); margin-bottom: 4px; }
.field input { width: 100%; padding: 8px 10px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-background-input); color: var(--color-text); font-size: 0.9rem; box-sizing: border-box; }
.field input:focus { outline: none; border-color: var(--color-accent); }

.plan-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.plan-info { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.plan-detail { font-size: 0.82rem; color: var(--color-text-muted); }
.plan-actions { display: flex; gap: 8px; }
.plan-msg { font-size: 0.85rem; margin: 8px 0 0; }

.btn-grant { padding: 7px 16px; border: none; border-radius: 4px; cursor: pointer; background: #28a745; color: white; font-size: 0.85rem; font-weight: 600; }
.btn-grant:hover:not(:disabled) { background: #218838; }
.btn-grant:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-revoke { padding: 7px 16px; border: none; border-radius: 4px; cursor: pointer; background: var(--color-button-secondary); color: var(--color-text); font-size: 0.85rem; border: 1px solid var(--color-border); }
.btn-revoke:hover:not(:disabled) { background: var(--color-button-secondary-hover); }
.btn-revoke:disabled { opacity: 0.5; cursor: not-allowed; }

.groups-perms-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.check-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.check-list label { display: flex; align-items: center; gap: 8px; color: var(--color-text); font-size: 0.9rem; cursor: pointer; }
.check-list input[type="checkbox"] { width: 15px; height: 15px; cursor: pointer; accent-color: var(--color-accent); }

.dialog-action-row { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
.btn-primary { padding: 8px 20px; border: none; border-radius: 4px; cursor: pointer; background: var(--color-accent); color: white; font-size: 0.9rem; font-weight: 600; }
.btn-primary:hover:not(:disabled) { background: var(--color-accent-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.inline-msg { font-size: 0.85rem; margin: 0; }
.inline-msg.success { color: #28a745; }
.inline-msg.error { color: var(--color-error, #dc3545); }

.password-row { display: flex; gap: 10px; align-items: center; }
.pw-input { flex: 1; padding: 8px 10px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-background-input); color: var(--color-text); font-size: 0.9rem; }
.pw-input:focus { outline: none; border-color: var(--color-accent); }
.password-row button { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; background: var(--color-accent); color: white; font-size: 0.9rem; white-space: nowrap; }
.password-row button:disabled { opacity: 0.5; cursor: not-allowed; }

.danger-zone { border-color: rgba(220, 53, 69, 0.3); }
.danger-zone h3 { color: var(--color-error, #dc3545); }
.btn-danger { padding: 8px 18px; border: none; border-radius: 4px; cursor: pointer; background: var(--color-error, #dc3545); color: white; font-size: 0.9rem; font-weight: 600; }
.btn-danger:hover { background: #c82333; }

.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.modal input { width: 100%; padding: 10px; margin-bottom: 12px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-background-input); color: var(--color-text); box-sizing: border-box; }
</style>
