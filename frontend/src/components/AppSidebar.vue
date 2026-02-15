<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { RouterLink, useRouter, useRoute } from 'vue-router'
import { user } from '@/stores/user.js'
import { chat } from '@/stores/chat.js'
import { friends } from '@/stores/friends.js'
import InviteModal from './InviteModal.vue'

const props = defineProps({
  isAdmin: Boolean,
  visible: Boolean
})

const emit = defineEmits(['close', 'logout'])

const router = useRouter()
const route = useRoute()

// Chat state
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

const isOnChatPage = computed(() => route.path === '/chat')

// Initialize chat when navigating to chat page
watch(isOnChatPage, async (onChat) => {
  if (onChat) {
    await initChat()
  }
})

onMounted(async () => {
  if (isOnChatPage.value) {
    await initChat()
  }
})

async function initChat() {
  chat.connect()
  await Promise.all([
    chat.fetchCurrentUser(),
    chat.checkCreatePermission(),
    chat.fetchRooms(),
    chat.fetchInvites()
  ])
  friends.fetchFriends()
  // Auto-join first room if none selected
  if (chat.rooms.length > 0 && !chat.currentRoom) {
    await chat.joinRoom(chat.rooms[0].id)
  }
}

// Room selection
async function selectRoom(room) {
  if (chat.currentRoom !== room.id) {
    chat.leaveRoom()
    await chat.joinRoom(room.id)
  }
  // Navigate to chat if not already there
  if (route.path !== '/chat') {
    router.push('/chat')
  }
  emit('close')
}

// Create room
async function openCreateModal() {
  newRoomName.value = ''
  newRoomDescription.value = ''
  formError.value = ''
  inviteSearch.value = ''
  usersToInvite.value = []
  showCreateModal.value = true

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

function addUserToInvite(userToAdd) {
  usersToInvite.value.push(userToAdd)
  inviteSearch.value = ''
}

function removeUserFromInvite(userId) {
  usersToInvite.value = usersToInvite.value.filter(u => u.id !== userId)
}

async function createRoom() {
  if (!newRoomName.value.trim()) {
    formError.value = 'Room name is required'
    return
  }
  try {
    const room = await chat.createRoom(newRoomName.value, newRoomDescription.value)
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

// Edit room
function openEditModal(room) {
  editingRoom.value = { ...room }
  formError.value = ''
  showEditModal.value = true
}

async function updateRoom() {
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
async function deleteRoom(room) {
  if (!confirm(`Are you sure you want to delete "${room.name}"?`)) return
  try {
    await chat.deleteRoom(room.id)
  } catch (err) {
    alert(err.message)
  }
}

// Invites
async function acceptInvite(invite) {
  try {
    const room = await chat.acceptInvite(invite.room_id)
    await chat.joinRoom(room.id)
    if (route.path !== '/chat') router.push('/chat')
  } catch (err) {
    alert(err.message)
  }
}

async function declineInvite(invite) {
  try {
    await chat.declineInvite(invite.room_id)
  } catch (err) {
    alert(err.message)
  }
}

function openInviteModal(room) {
  inviteRoomId.value = room.id
  showInviteModal.value = true
}

function handleLogout() {
  emit('logout')
  emit('close')
}

function handleNavClick() {
  emit('close')
}
</script>

<template>
  <!-- Overlay for tablet mode -->
  <div v-if="visible" class="sidebar-overlay" @click="$emit('close')"></div>

  <aside class="app-sidebar" :class="{ open: visible }">
    <div class="sidebar-header">
      <img src="/logo-192x192-no-text.png" alt="Prosaurus" class="sidebar-logo" />
    </div>

    <nav class="sidebar-nav">
      <!-- Primary -->
      <div class="nav-section">
        <RouterLink to="/breakroom" class="nav-item" @click="handleNavClick">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span>Home</span>
        </RouterLink>

        <!-- Chat with expandable rooms -->
        <RouterLink to="/chat" class="nav-item" @click="handleNavClick">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span>Chat</span>
          <span v-if="chat.invites.length > 0" class="invite-badge">{{ chat.invites.length }}</span>
        </RouterLink>

        <!-- Chat rooms sub-list (only when on chat page) -->
        <div v-if="isOnChatPage" class="chat-rooms-section">
          <!-- Pending invites -->
          <div v-if="chat.invites.length > 0" class="room-invites">
            <div
              v-for="invite in chat.invites"
              :key="invite.room_id"
              class="invite-item"
            >
              <span class="invite-room-name"># {{ invite.room_name }}</span>
              <div class="invite-btns">
                <button @click="acceptInvite(invite)" class="invite-accept" title="Accept">Y</button>
                <button @click="declineInvite(invite)" class="invite-decline" title="Decline">N</button>
              </div>
            </div>
          </div>

          <!-- Room list -->
          <div
            v-for="room in chat.rooms"
            :key="room.id"
            class="room-item"
            :class="{ active: chat.currentRoom === room.id }"
            @click="selectRoom(room)"
          >
            <span class="room-name"># {{ room.name }}</span>
            <div v-if="chat.isRoomOwner(room)" class="room-actions" @click.stop>
              <button @click="openInviteModal(room)" class="room-action-btn" title="Invite">Inv</button>
              <button @click="openEditModal(room)" class="room-action-btn" title="Edit">Ed</button>
              <button @click="deleteRoom(room)" class="room-action-btn delete" title="Delete">Del</button>
            </div>
          </div>

          <!-- Create room button -->
          <button
            v-if="chat.canCreateRoom"
            class="create-room-btn"
            @click="openCreateModal"
          >
            + Create Room
          </button>
        </div>

        <RouterLink to="/blog" class="nav-item" @click="handleNavClick">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          <span>Blog</span>
        </RouterLink>
        <RouterLink to="/friends" class="nav-item" @click="handleNavClick">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span>Friends</span>
        </RouterLink>
      </div>

      <!-- Company -->
      <div class="nav-section">
        <div class="nav-section-label">Company</div>
        <RouterLink to="/about-company" class="nav-item" @click="handleNavClick">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
          <span>About Company</span>
        </RouterLink>
        <RouterLink to="/employment" class="nav-item" @click="handleNavClick">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
          <span>Employment</span>
        </RouterLink>
        <RouterLink to="/help-desk" class="nav-item" @click="handleNavClick">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span>Help Desk</span>
        </RouterLink>
        <RouterLink to="/company-portal" class="nav-item" @click="handleNavClick">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          <span>Company Portal</span>
        </RouterLink>
      </div>

      <!-- Tools -->
      <div class="nav-section">
        <div class="nav-section-label">Tools</div>
        <RouterLink to="/tool-shed" class="nav-item" @click="handleNavClick">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
          <span>Tool Shed</span>
        </RouterLink>
      </div>
    </nav>

    <!-- Bottom section -->
    <div class="sidebar-bottom">
      <RouterLink to="/profile" class="nav-item" @click="handleNavClick">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <span>Profile</span>
      </RouterLink>
      <RouterLink v-if="isAdmin" to="/admin" class="nav-item" @click="handleNavClick">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        <span>Admin</span>
      </RouterLink>
      <a href="#" class="nav-item logout-item" @click.prevent="handleLogout">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        <span>Logout</span>
      </a>
    </div>
  </aside>

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
</template>

<style scoped>
.sidebar-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: var(--color-overlay);
  z-index: 999;
}

.app-sidebar {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: 220px;
  background: var(--color-header-bg);
  color: var(--color-header-text);
  display: flex;
  flex-direction: column;
  z-index: 1000;
  overflow-y: auto;
  transition: transform 0.3s ease;
}

.sidebar-header {
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  justify-content: center;
}

.sidebar-logo {
  width: 48px;
  height: 48px;
  border-radius: 50%;
}

.sidebar-nav {
  flex: 1;
  padding: 8px 0;
  overflow-y: auto;
}

.nav-section {
  padding: 4px 0;
}

.nav-section + .nav-section {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  margin-top: 4px;
  padding-top: 8px;
}

.nav-section-label {
  padding: 4px 16px 4px;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(255, 255, 255, 0.4);
  font-weight: 600;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  color: rgba(255, 255, 255, 0.8);
  text-decoration: none;
  font-size: 0.9rem;
  transition: background-color 0.15s, color 0.15s;
  border-radius: 0;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.nav-item.router-link-exact-active {
  background: rgba(255, 255, 255, 0.15);
  color: var(--color-accent);
  font-weight: 500;
}

/* Admin route - active on any /admin/* path */
.nav-item[href^="/admin"].router-link-active,
.nav-item.router-link-active[href^="/admin"] {
  background: rgba(255, 255, 255, 0.15);
  color: var(--color-accent);
  font-weight: 500;
}

.nav-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.invite-badge {
  margin-left: auto;
  background: var(--color-accent);
  color: white;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 10px;
  min-width: 18px;
  text-align: center;
}

/* ============================================
   CHAT ROOMS SUB-LIST
   ============================================ */

.chat-rooms-section {
  padding: 2px 0 4px;
  border-left: 2px solid rgba(255, 255, 255, 0.1);
  margin-left: 26px;
}

.room-invites {
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding-bottom: 4px;
  margin-bottom: 4px;
}

.invite-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  font-size: 0.8rem;
  background: rgba(66, 185, 131, 0.1);
}

.invite-room-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: rgba(255, 255, 255, 0.8);
}

.invite-btns {
  display: flex;
  gap: 3px;
  flex-shrink: 0;
}

.invite-accept,
.invite-decline {
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  cursor: pointer;
  padding: 2px 6px;
  font-size: 0.7rem;
  border-radius: 3px;
}

.invite-accept {
  background: var(--color-accent);
}

.invite-accept:hover {
  background: var(--color-accent-hover);
}

.invite-decline:hover {
  background: rgba(255, 255, 255, 0.2);
}

.room-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 7px 12px;
  cursor: pointer;
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.7);
  transition: background-color 0.15s;
}

.room-item:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.room-item.active {
  background: rgba(255, 255, 255, 0.12);
  color: var(--color-accent);
  font-weight: 500;
}

.room-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.room-actions {
  display: none;
  gap: 3px;
  flex-shrink: 0;
}

.room-item:hover .room-actions {
  display: flex;
}

.room-action-btn {
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  cursor: pointer;
  padding: 2px 6px;
  font-size: 0.65rem;
  border-radius: 3px;
}

.room-action-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.room-action-btn.delete:hover {
  background: var(--color-error);
}

.create-room-btn {
  display: block;
  width: 100%;
  padding: 7px 12px;
  background: none;
  border: none;
  color: var(--color-accent);
  cursor: pointer;
  font-size: 0.8rem;
  text-align: left;
  transition: background-color 0.15s;
}

.create-room-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

/* ============================================
   BOTTOM SECTION
   ============================================ */

.sidebar-bottom {
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding: 8px 0;
}

.logout-item {
  color: rgba(255, 255, 255, 0.6);
}

.logout-item:hover {
  color: var(--color-error, #ff6b6b);
  background: rgba(255, 100, 100, 0.1);
}

/* ============================================
   MODALS
   ============================================ */

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
  z-index: 2000;
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
  color: var(--color-text);
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

/* ============================================
   RESPONSIVE
   ============================================ */

/* Desktop: sidebar always visible */
@media (min-width: 769px) {
  .app-sidebar {
    transform: translateX(0);
  }
}

/* Tablet: sidebar hidden, slides in when open */
@media (max-width: 768px) {
  .app-sidebar {
    transform: translateX(-100%);
  }

  .app-sidebar.open {
    transform: translateX(0);
  }

  .sidebar-overlay {
    display: block;
  }
}

/* Mobile: sidebar completely hidden (bottom bar used instead) */
@media (max-width: 480px) {
  .app-sidebar {
    display: none !important;
  }

  .sidebar-overlay {
    display: none !important;
  }
}
</style>
