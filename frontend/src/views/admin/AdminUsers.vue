<template>
  <section>
    <h1>Manage Users</h1>

    <!-- Add User Form -->
    <form @submit.prevent="createUser">
      <input v-model="newUser.handle" placeholder="Handle" required />
      <input v-model="newUser.email" placeholder="Email" required />
      <button type="submit">Add User</button>
      <p v-if="formError" style="color: red;">{{ formError }}</p>
    </form>


    <!-- DataFetcher renders the user table -->
    <DataFetcher :key="fetchKey" endpoint="/api/user/all" v-slot="{ data: data }">
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
              <th>Actions</th>
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
                <button @click="editUser(user)">Edit</button>
                <button @click="deleteUser(user.id)">Delete</button>
                <button @click="openPasswordDialog(user)">Password</button>
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
          <button type="submit">Send Invite</button>
          <button @click="showInviteModal = false" type="button">Cancel</button>
        </form>
      </div>
    </div>

    <!-- Edit User Modal -->
    <div v-if="editingUser" class="modal-overlay">
      <div class="modal">
        <h2>Edit User</h2>
        <form @submit.prevent="updateUser">
          <input v-model="editingUser.handle" placeholder="Handle" required />
          <input v-model="editingUser.first_name" placeholder="First Name" required />
          <input v-model="editingUser.last_name" placeholder="Last Name" required />
          <input v-model="editingUser.email" placeholder="Email" required />
          <div v-if="matrix">
            <h3>Groups</h3>
            <ul>
              <li v-for="group in matrix.groups" :key="group.id">
                <label>
                  <input type="checkbox" v-model="group.has_group"/>
                  {{ group.name }}
                </label>
              </li>
            </ul>
            <h3>Permissions</h3>
            <ul>
              <li v-for="perm in matrix.permissions" :key="perm.id">
                <label>
                  <input type="checkbox" v-model="perm.has_permission"/>
                  {{ perm.name }}
                </label>
              </li>
            </ul>
          </div>
          <button type="submit">Save</button>
          <button type="button" @click="cancelEdit">Cancel</button>
        </form>
      </div>
    </div>

    <!-- Password Reset Modal -->
    <div v-if="passwordDialogUser" class="modal-overlay">
      <div class="modal">
        <h2>Set Password — {{ passwordDialogUser.handle }}</h2>
        <form @submit.prevent="submitPasswordReset">
          <input
            v-model="newPassword"
            type="password"
            placeholder="New password (min 8 characters)"
            required
            minlength="8"
            autocomplete="new-password"
          />
          <p v-if="passwordError" style="color: red; margin-bottom: 12px;">{{ passwordError }}</p>
          <p v-if="passwordSuccess" style="color: green; margin-bottom: 12px;">{{ passwordSuccess }}</p>
          <button type="submit" :disabled="passwordSubmitting">
            {{ passwordSubmitting ? 'Saving…' : 'Set Password' }}
          </button>
          <button type="button" @click="closePasswordDialog">Cancel</button>
        </form>
      </div>
    </div>

  </section>
</template>

<script setup>
import { ref } from 'vue'
import DataFetcher from '@/components/DataFetcher.vue'
import { watchEffect } from 'vue'

const newUser = ref({ handle: '', email: '' })
const inviteUserForm = ref({ handle: '', email: '', first_name: '', last_name: '' })
const showInviteModal = ref(false)
const formError = ref('')

const existingUsers = ref([])
const matrix = ref(null)

const fetchKey = ref(0)

function updateUsers(users) {
  existingUsers.value = users
  return '' // Just returns something harmless for the DOM
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

const editingUser = ref(null)

function createUser() {
  const { handle, email } = newUser.value

  if (!handle || !email) {
    formError.value = 'Handle and Email are required.'
    return
  }

  const duplicate = existingUsers.value.find(
    user => user.handle === handle || user.email === email
  )

  if (duplicate) {
    formError.value = `Login handle "${duplicate.handle}" or email address "${duplicate.email}" already exist.  Please use unique values`
    return
  }

  if (!isValidEmail(email)) {
    formError.value = 'Please enter a valid email address.'
    return
  }

  formError.value = ''
  inviteUserForm.value = {
    handle,
    email,
    first_name: '',
    last_name: ''
  }
  showInviteModal.value = true
}

async function sendInvite() {
  const payload = inviteUserForm.value

  await fetch('/api/user/invite', { 
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload) }
  )

  console.log('Sending invite with payload:', payload)

  // Reset forms and close modal
  newUser.value = { handle: '', email: '' }
  inviteUserForm.value = { handle: '', email: '', first_name: '', last_name: '' }
  showInviteModal.value = false
  fetchKey.value++  // trigger user list refresh
}

async function editUser(user) {
  editingUser.value = { ...user }  // Copy user object

  try {
    const res = await fetch(`/api/user/permissionMatrix/${user.id}`)
    if (!res.ok) {
      throw new Error('Failed to fetch permission matrix')
    }
    const data = await res.json()
    matrix.value = data

    // Auto-sync group selection with permission checkboxes
    watchEffect(() => {
      if (!matrix.value) return

      // Clear all permissions first
      const manuallyChecked = new Set()
      matrix.value.permissions.forEach(p => p.has_permission = false)

      // Loop through all groups and enable permissions from checked groups
      matrix.value.groups.forEach(group => {
        if (group.has_group) {
          group.group_permissions.forEach(permId => {
            manuallyChecked.add(permId)
          })
        }
      })

      matrix.value.permissions.forEach(p => {
        if (manuallyChecked.has(p.id)) {
          p.has_permission = true
        }
      })
    })

    console.log('Loaded all permissions:', data)
  } catch (err) {
    console.error(err)
    matrix.value = null
  }
}

async function updateUser() {
  const user = editingUser.value

  // Build the payload to include user and permissions
  const payload = {
    user,
    permissions: matrix.value.permissions.map(perm => ({
      permission_id: perm.id,
      has_permission: perm.has_permission
    })),
    groups: matrix.value.groups.map(group => ({
      group_id: group.id,
      has_group: group.has_group
    }))
  }

  const response = await fetch(`/api/user/${user.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    console.error('Failed to update user')
    return
  }

  // Refresh users list
  const updated = await response.json()
  const index = existingUsers.value.findIndex(u => u.id === updated.id)
  if (index !== -1) {
    existingUsers.value[index] = updated
  }

  editingUser.value = null
}


async function deleteUser(userId) {
  if (!confirm('Are you sure you want to delete this user?')) {
    return;
  }

  try {
    const res = await fetch(`/api/user/${userId}`, {
      method: 'DELETE'
    });

    if (!res.ok) {
      console.error('Failed to delete user');
      return;
    }

    fetchKey.value++  // trigger user list refresh
  } catch (err) {
    console.error('Error deleting user:', err);
  }
}


function cancelEdit() {
  editingUser.value = null
}

const passwordDialogUser = ref(null)
const newPassword = ref('')
const passwordError = ref('')
const passwordSuccess = ref('')
const passwordSubmitting = ref(false)

function openPasswordDialog(user) {
  passwordDialogUser.value = user
  newPassword.value = ''
  passwordError.value = ''
  passwordSuccess.value = ''
}

function closePasswordDialog() {
  passwordDialogUser.value = null
}

async function submitPasswordReset() {
  passwordError.value = ''
  passwordSuccess.value = ''
  passwordSubmitting.value = true

  try {
    const res = await fetch(`/api/user/${passwordDialogUser.value.id}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword.value }),
      credentials: 'include'
    })

    const data = await res.json()
    if (!res.ok) {
      passwordError.value = data.message || 'Failed to update password.'
    } else {
      passwordSuccess.value = data.message
      newPassword.value = ''
    }
  } catch {
    passwordError.value = 'Network error — please try again.'
  } finally {
    passwordSubmitting.value = false
  }
}
</script>

<style>
h1 {
  color: var(--color-text);
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 20px;
  background: var(--color-background-card);
}

th, td {
  border: 1px solid var(--color-border);
  padding: 10px;
  text-align: left;
  color: var(--color-text);
}

thead {
  background-color: var(--color-background-soft);
}

form {
  margin-bottom: 20px;
}

form input {
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  margin-right: 8px;
  background: var(--color-background-input);
  color: var(--color-text);
}

button {
  margin-right: 5px;
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  background: var(--color-accent);
  color: white;
}

button:hover {
  background: var(--color-accent-hover);
}

button[type="button"] {
  background: var(--color-button-secondary);
  color: var(--color-text);
}

button[type="button"]:hover {
  background: var(--color-button-secondary-hover);
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: var(--color-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal {
  background: var(--color-background-card);
  padding: 20px;
  border-radius: 8px;
  width: 400px;
  max-width: 90%;
}

.modal h2, .modal h3 {
  color: var(--color-text);
  margin-bottom: 12px;
}

.modal input {
  width: 100%;
  padding: 10px;
  margin-bottom: 12px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-background-input);
  color: var(--color-text);
  box-sizing: border-box;
}

.modal ul {
  list-style: none;
  padding: 0;
  margin: 0 0 12px;
}

.modal li {
  margin: 6px 0;
}

.modal label {
  color: var(--color-text);
  cursor: pointer;
}

.modal input[type="checkbox"] {
  width: auto;
  margin-right: 8px;
  margin-bottom: 0;
}
</style>

