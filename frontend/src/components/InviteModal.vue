<script setup>
import { ref, onMounted, computed } from 'vue'
import { chat } from '@/stores/chat.js'
import LoadingSpinner from './LoadingSpinner.vue'

const props = defineProps({
  roomId: {
    type: Number,
    required: true
  }
})

const emit = defineEmits(['close'])

const users = ref([])
const members = ref([])
const searchQuery = ref('')
const loading = ref(true)
const inviting = ref(false)
const error = ref('')
const successMessage = ref('')

// Filter users that are not already members
const availableUsers = computed(() => {
  const memberIds = new Set(members.value.map(m => m.id))
  return users.value.filter(u => !memberIds.has(u.id))
})

// Filter by search query
const filteredUsers = computed(() => {
  if (!searchQuery.value.trim()) {
    return availableUsers.value
  }
  const query = searchQuery.value.toLowerCase()
  return availableUsers.value.filter(u =>
    u.handle.toLowerCase().includes(query) ||
    (u.first_name && u.first_name.toLowerCase().includes(query)) ||
    (u.last_name && u.last_name.toLowerCase().includes(query))
  )
})

onMounted(async () => {
  try {
    // Fetch all users
    const usersRes = await fetch('/api/user/all', { credentials: 'include' })
    if (usersRes.ok) {
      const data = await usersRes.json()
      users.value = data.users || []
    }

    // Fetch current room members
    members.value = await chat.fetchMembers(props.roomId)
  } catch (err) {
    error.value = 'Failed to load users'
  } finally {
    loading.value = false
  }
})

const inviteUser = async (user) => {
  inviting.value = true
  error.value = ''
  successMessage.value = ''

  try {
    await chat.inviteUser(props.roomId, user.id)
    successMessage.value = `Invited ${user.handle}`
    // Add to members list to remove from available users
    members.value.push({ id: user.id, handle: user.handle })
  } catch (err) {
    error.value = err.message
  } finally {
    inviting.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal">
      <h2>Invite Users</h2>

      <input
        v-model="searchQuery"
        type="text"
        placeholder="Search users..."
        class="search-input"
      />

      <div v-if="loading" class="loading"><LoadingSpinner size="small" /> Loading users...</div>

      <div v-else-if="filteredUsers.length === 0" class="no-users">
        No users available to invite
      </div>

      <ul v-else class="user-list">
        <li v-for="user in filteredUsers" :key="user.id" class="user-item">
          <div class="user-info">
            <span class="user-handle">{{ user.handle }}</span>
            <span v-if="user.first_name || user.last_name" class="user-name">
              {{ user.first_name }} {{ user.last_name }}
            </span>
          </div>
          <button
            @click="inviteUser(user)"
            :disabled="inviting"
            class="invite-btn"
          >
            Invite
          </button>
        </li>
      </ul>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="successMessage" class="success">{{ successMessage }}</p>

      <div class="modal-actions">
        <button type="button" class="btn-secondary" @click="emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: white;
  color: #333;
  padding: 25px;
  border-radius: 10px;
  width: 400px;
  max-width: 90%;
  max-height: 80vh;
  overflow-y: auto;
}

.modal h2 {
  margin-top: 0;
  margin-bottom: 20px;
}

.search-input {
  width: 100%;
  padding: 10px;
  margin-bottom: 15px;
  border: 1px solid #ddd;
  border-radius: 5px;
  font-size: 1em;
  box-sizing: border-box;
}

.loading, .no-users {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #666;
  padding: 20px;
}

.user-list {
  list-style: none;
  padding: 0;
  margin: 0 0 15px 0;
  max-height: 300px;
  overflow-y: auto;
}

.user-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px;
  border-bottom: 1px solid #eee;
}

.user-item:last-child {
  border-bottom: none;
}

.user-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.user-handle {
  font-weight: bold;
}

.user-name {
  font-size: 0.85em;
  color: #666;
}

.invite-btn {
  background: #42b983;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9em;
}

.invite-btn:hover:not(:disabled) {
  background: #3aa876;
}

.invite-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error {
  color: #c0392b;
  font-size: 0.9em;
  margin: 10px 0;
}

.success {
  color: #42b983;
  font-size: 0.9em;
  margin: 10px 0;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 15px;
}

.btn-secondary {
  background: #ddd;
  color: #333;
  border: none;
  padding: 10px 20px;
  border-radius: 5px;
  cursor: pointer;
}

.btn-secondary:hover {
  background: #ccc;
}
</style>
