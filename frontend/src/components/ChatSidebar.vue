<script setup>
import { ref, onMounted, computed } from 'vue'
import { chat } from '@/stores/chat.js'
import { friends } from '@/stores/friends.js'
import { user } from '@/stores/user.js'
import InviteModal from './InviteModal.vue'

const emit = defineEmits(['room-selected'])

const showCreateModal = ref(false)
const showEditModal = ref(false)
const showInviteModal = ref(false)
const inviteRoomId = ref(null)
const newRoomName = ref('')
const newRoomDescription = ref('')
const editingRoom = ref(null)
const formError = ref('')

// Invite on create state
const inviteSearch = ref('')
const usersToInvite = ref([])
const allUsers = ref([])
const loadingUsers = ref(false)

// Filter users for invite search
const filteredInviteUsers = computed(() => {
  if (!inviteSearch.value.trim()) return []
  const query = inviteSearch.value.toLowerCase()
  const inviteIds = new Set(usersToInvite.value.map(u => u.id))
  return allUsers.value.filter(u => {
    if (u.handle === user.username) return false
    if (inviteIds.has(u.id)) return false
    return u.handle.toLowerCase().includes(query) ||
      (u.first_name && u.first_name.toLowerCase().includes(query)) ||
      (u.last_name && u.last_name.toLowerCase().includes(query))
  })
})

onMounted(() => {
  chat.fetchInvites()
  friends.fetchFriends()
})

// Switch to a room
const selectRoom = async (room) => {
  if (chat.currentRoom !== room.id) {
    chat.leaveRoom()
    await chat.joinRoom(room.id)
  }
  emit('room-selected', room)
}

// Create room modal handlers
const openCreateModal = async () => {
  newRoomName.value = ''
  newRoomDescription.value = ''
  formError.value = ''
  inviteSearch.value = ''
  usersToInvite.value = []
  showCreateModal.value = true

  // Load all users for invite search
  loadingUsers.value = true
  try {
    const res = await fetch('/api/user/all', { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      allUsers.value = data.users || []
    }
  } catch (err) {
    console.error('Failed to load users:', err)
  } finally {
    loadingUsers.value = false
  }
}

const addUserToInvite = (userToAdd) => {
  usersToInvite.value.push(userToAdd)
  inviteSearch.value = ''
}

const removeUserFromInvite = (userId) => {
  usersToInvite.value = usersToInvite.value.filter(u => u.id !== userId)
}

const createRoom = async () => {
  if (!newRoomName.value.trim()) {
    formError.value = 'Room name is required'
    return
  }

  try {
    const room = await chat.createRoom(newRoomName.value, newRoomDescription.value)

    // Send invites to selected users
    for (const invitee of usersToInvite.value) {
      try {
        await chat.inviteUser(room.id, invitee.id)
      } catch (err) {
        console.error(`Failed to invite ${invitee.handle}:`, err)
      }
    }

    showCreateModal.value = false
    await chat.joinRoom(room.id)
  } catch (err) {
    formError.value = err.message
  }
}

// Edit room modal handlers
const openEditModal = (room) => {
  editingRoom.value = { ...room }
  formError.value = ''
  showEditModal.value = true
}

const updateRoom = async () => {
  if (!editingRoom.value.name.trim()) {
    formError.value = 'Room name is required'
    return
  }

  try {
    await chat.updateRoom(editingRoom.value.id, editingRoom.value.name, editingRoom.value.description)
    showEditModal.value = false
  } catch (err) {
    formError.value = err.message
  }
}

// Delete room
const deleteRoom = async (room) => {
  if (!confirm(`Are you sure you want to delete "${room.name}"?`)) {
    return
  }

  try {
    await chat.deleteRoom(room.id)
  } catch (err) {
    alert(err.message)
  }
}

// Accept invite
const acceptInvite = async (invite) => {
  try {
    const room = await chat.acceptInvite(invite.room_id)
    await chat.joinRoom(room.id)
    emit('room-selected', room)
  } catch (err) {
    alert(err.message)
  }
}

// Decline invite
const declineInvite = async (invite) => {
  try {
    await chat.declineInvite(invite.room_id)
  } catch (err) {
    alert(err.message)
  }
}

// Open invite modal
const openInviteModal = (room) => {
  inviteRoomId.value = room.id
  showInviteModal.value = true
}
</script>

<template>
  <div class="chat-sidebar">
    <div class="sidebar-header">
      <h3>Rooms</h3>
      <button
        v-if="chat.canCreateRoom"
        @click="openCreateModal"
        class="create-btn"
      >
        + Create
      </button>
    </div>

    <!-- Pending Invites -->
    <div v-if="chat.invites.length > 0" class="invites-section">
      <div class="section-header">Pending Invites</div>
      <ul class="invite-list">
        <li v-for="invite in chat.invites" :key="invite.room_id" class="invite-item">
          <div class="invite-info">
            <span class="room-name"># {{ invite.room_name }}</span>
            <span class="invited-by">from {{ invite.invited_by_handle }}</span>
          </div>
          <div class="invite-actions">
            <button @click="acceptInvite(invite)" class="icon-btn accept" title="Accept">Yes</button>
            <button @click="declineInvite(invite)" class="icon-btn decline" title="Decline">No</button>
          </div>
        </li>
      </ul>
    </div>

    <ul class="room-list">
      <li v-if="chat.rooms.length === 0" class="empty-rooms">
        No rooms yet. Create one to get started!
      </li>
      <li
        v-for="room in chat.rooms"
        :key="room.id"
        :class="{ active: chat.currentRoom === room.id }"
        @click="selectRoom(room)"
      >
        <span class="room-name"># {{ room.name }}</span>
        <div v-if="chat.isRoomOwner(room)" class="room-actions" @click.stop>
          <button @click="openInviteModal(room)" class="icon-btn" title="Invite">
            <span>Inv</span>
          </button>
          <button @click="openEditModal(room)" class="icon-btn" title="Edit">
            <span>Edit</span>
          </button>
          <button @click="deleteRoom(room)" class="icon-btn delete" title="Delete">
            <span>Del</span>
          </button>
        </div>
      </li>
    </ul>

    <!-- Create Room Modal -->
    <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
      <div class="modal">
        <h2>Create New Room</h2>
        <form @submit.prevent="createRoom">
          <input
            v-model="newRoomName"
            placeholder="Room name"
            maxlength="64"
            required
          />
          <textarea
            v-model="newRoomDescription"
            placeholder="Description (optional)"
          ></textarea>

          <!-- Invite users section -->
          <div class="invite-section">
            <label>Invite Users (optional)</label>
            <div class="invite-search-container">
              <input
                v-model="inviteSearch"
                type="text"
                placeholder="Search users to invite..."
                class="invite-search"
              />
              <ul v-if="filteredInviteUsers.length > 0" class="invite-dropdown">
                <li
                  v-for="u in filteredInviteUsers"
                  :key="u.id"
                  @click="addUserToInvite(u)"
                >
                  <span class="dropdown-handle">{{ u.handle }}</span>
                  <span v-if="u.first_name || u.last_name" class="dropdown-name">
                    {{ u.first_name }} {{ u.last_name }}
                  </span>
                </li>
              </ul>
            </div>
            <div v-if="usersToInvite.length > 0" class="selected-users">
              <span
                v-for="u in usersToInvite"
                :key="u.id"
                class="selected-user-tag"
              >
                {{ u.handle }}
                <button type="button" @click="removeUserFromInvite(u.id)">&times;</button>
              </span>
            </div>
          </div>

          <p v-if="formError" class="error">{{ formError }}</p>
          <div class="modal-actions">
            <button type="submit" class="btn-primary">Create</button>
            <button type="button" class="btn-secondary" @click="showCreateModal = false">Cancel</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Edit Room Modal -->
    <div v-if="showEditModal" class="modal-overlay" @click.self="showEditModal = false">
      <div class="modal">
        <h2>Edit Room</h2>
        <form @submit.prevent="updateRoom">
          <input
            v-model="editingRoom.name"
            placeholder="Room name"
            maxlength="64"
            required
          />
          <textarea
            v-model="editingRoom.description"
            placeholder="Description (optional)"
          ></textarea>
          <p v-if="formError" class="error">{{ formError }}</p>
          <div class="modal-actions">
            <button type="submit" class="btn-primary">Save</button>
            <button type="button" class="btn-secondary" @click="showEditModal = false">Cancel</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Invite Modal -->
    <InviteModal
      v-if="showInviteModal"
      :room-id="inviteRoomId"
      @close="showInviteModal = false"
    />
  </div>
</template>

<style scoped>
.chat-sidebar {
  width: 220px;
  background: var(--color-header-bg);
  color: var(--color-header-text);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.sidebar-header h3 {
  margin: 0;
  font-size: 1.1em;
}

.create-btn {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85em;
}

.create-btn:hover {
  background: var(--color-accent-hover);
}

.room-list {
  list-style: none;
  padding: 0;
  margin: 0;
  flex: 1;
  overflow-y: auto;
}

.room-list .empty-rooms {
  padding: 20px 15px;
  color: rgba(255, 255, 255, 0.5);
  font-style: italic;
  font-size: 0.9em;
  text-align: center;
  cursor: default;
}

.room-list li {
  padding: 12px 15px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-left: 3px solid transparent;
}

.room-list li:hover {
  background: rgba(255, 255, 255, 0.1);
}

.room-list li.active {
  background: rgba(255, 255, 255, 0.1);
  border-left-color: var(--color-accent);
}

.room-name {
  font-size: 0.95em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.room-actions {
  display: none;
  gap: 4px;
}

.room-list li:hover .room-actions {
  display: flex;
}

.icon-btn {
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  cursor: pointer;
  padding: 3px 8px;
  font-size: 0.75em;
  border-radius: 3px;
}

.icon-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.icon-btn.delete:hover {
  background: var(--color-error);
}

/* Modal styles */
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
  z-index: 1000;
}

.modal {
  background: var(--color-background-card);
  color: var(--color-text);
  padding: 25px;
  border-radius: 10px;
  width: 400px;
  max-width: 90%;
}

.modal h2 {
  margin-top: 0;
  margin-bottom: 20px;
}

.modal input,
.modal textarea {
  width: 100%;
  padding: 10px;
  margin-bottom: 10px;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  font-size: 1em;
  box-sizing: border-box;
  background: var(--color-background-input);
  color: var(--color-text);
}

.modal textarea {
  height: 80px;
  resize: vertical;
}

.error {
  color: var(--color-error);
  font-size: 0.9em;
  margin: 0 0 10px;
}

.modal-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 15px;
}

.btn-primary {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 5px;
  cursor: pointer;
}

.btn-primary:hover {
  background: var(--color-accent-hover);
}

.btn-secondary {
  background: var(--color-button-secondary);
  color: var(--color-text);
  border: none;
  padding: 10px 20px;
  border-radius: 5px;
  cursor: pointer;
}

.btn-secondary:hover {
  background: var(--color-button-secondary-hover);
}

/* Invites section */
.invites-section {
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 10px;
}

.section-header {
  padding: 10px 15px 5px;
  font-size: 0.85em;
  color: rgba(255, 255, 255, 0.6);
  text-transform: uppercase;
}

.invite-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.invite-item {
  padding: 8px 15px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(66, 185, 131, 0.1);
  border-left: 3px solid var(--color-accent);
}

.invite-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.invited-by {
  font-size: 0.75em;
  color: rgba(255, 255, 255, 0.6);
}

.invite-actions {
  display: flex;
  gap: 4px;
}

.icon-btn.accept {
  background: var(--color-accent);
}

.icon-btn.accept:hover {
  background: var(--color-accent-hover);
}

.icon-btn.decline {
  background: rgba(255, 255, 255, 0.3);
}

.icon-btn.decline:hover {
  background: rgba(255, 255, 255, 0.4);
}

/* Invite section in Create Room modal */
.invite-section {
  margin-bottom: 10px;
}

.invite-section label {
  display: block;
  font-size: 0.9em;
  color: var(--color-text-muted);
  margin-bottom: 5px;
}

.invite-search-container {
  position: relative;
}

.invite-search {
  width: 100%;
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  font-size: 1em;
  box-sizing: border-box;
}

.invite-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-top: none;
  border-radius: 0 0 5px 5px;
  max-height: 150px;
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: 0;
  z-index: 10;
  box-shadow: var(--shadow-md);
}

.invite-dropdown li {
  padding: 8px 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.invite-dropdown li:hover {
  background: var(--color-background-hover);
}

.dropdown-handle {
  font-weight: bold;
  font-size: 0.9em;
}

.dropdown-name {
  font-size: 0.8em;
  color: var(--color-text-muted);
}

.selected-users {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}

.selected-user-tag {
  background: var(--color-accent);
  color: white;
  padding: 4px 8px;
  border-radius: 15px;
  font-size: 0.85em;
  display: flex;
  align-items: center;
  gap: 5px;
}

.selected-user-tag button {
  background: none;
  border: none;
  color: white;
  cursor: pointer;
  font-size: 1.1em;
  line-height: 1;
  padding: 0;
  opacity: 0.8;
}

.selected-user-tag button:hover {
  opacity: 1;
}

/* Mobile styles */
@media (max-width: 768px) {
  .chat-sidebar {
    width: 100%;
  }

  .sidebar-header {
    padding: 12px 15px;
  }

  .room-list li {
    padding: 15px;
  }

  .room-actions {
    display: flex;
  }
}
</style>
