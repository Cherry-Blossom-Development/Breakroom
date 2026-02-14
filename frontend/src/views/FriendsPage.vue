<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { friends } from '@/stores/friends.js'
import LoadingSpinner from '@/components/LoadingSpinner.vue'
import { user } from '@/stores/user.js'

const router = useRouter()

const activeTab = ref('friends')
const searchQuery = ref('')
const searchResults = ref([])
const searching = ref(false)
const searchError = ref(null)

const tabs = [
  { id: 'friends', label: 'Friends' },
  { id: 'requests', label: 'Requests' },
  { id: 'sent', label: 'Sent' },
  { id: 'search', label: 'Find Users' },
  { id: 'blocked', label: 'Blocked' }
]

const requestCount = computed(() => friends.requests.length)

onMounted(() => {
  friends.fetchAll()
})

async function searchUsers() {
  if (!searchQuery.value.trim()) {
    searchResults.value = []
    return
  }

  searching.value = true
  searchError.value = null

  try {
    const res = await fetch('/api/user/all', { credentials: 'include' })
    if (!res.ok) throw new Error('Failed to search users')
    const data = await res.json()
    const users = data.users || []

    // Filter by search query and exclude current friends/pending
    const friendIds = new Set(friends.friends.map(f => f.id))
    const sentIds = new Set(friends.sent.map(s => s.id))
    const requestIds = new Set(friends.requests.map(r => r.id))
    const blockedIds = new Set(friends.blocked.map(b => b.id))

    const query = searchQuery.value.toLowerCase()
    searchResults.value = users.filter(u => {
      // Exclude current user
      if (u.handle === user.username) return false

      const matchesQuery = u.handle.toLowerCase().includes(query) ||
        (u.first_name && u.first_name.toLowerCase().includes(query)) ||
        (u.last_name && u.last_name.toLowerCase().includes(query)) ||
        (u.email && u.email.toLowerCase().includes(query))
      const notConnected = !friendIds.has(u.id) && !sentIds.has(u.id) &&
        !requestIds.has(u.id) && !blockedIds.has(u.id)
      return matchesQuery && notConnected
    })
  } catch (err) {
    searchError.value = err.message
  } finally {
    searching.value = false
  }
}

async function sendRequest(user) {
  try {
    await friends.sendRequest(user.id)
    searchResults.value = searchResults.value.filter(u => u.id !== user.id)
  } catch (err) {
    alert(err.message)
  }
}

async function acceptRequest(user) {
  try {
    await friends.acceptRequest(user.id)
  } catch (err) {
    alert(err.message)
  }
}

async function declineRequest(user) {
  try {
    await friends.declineRequest(user.id)
  } catch (err) {
    alert(err.message)
  }
}

async function cancelSent(user) {
  try {
    await friends.cancelRequest(user.id)
  } catch (err) {
    alert(err.message)
  }
}

async function removeFriend(user) {
  if (!confirm(`Remove ${user.handle} from your friends?`)) return
  try {
    await friends.removeFriend(user.id)
  } catch (err) {
    alert(err.message)
  }
}

async function blockUser(user) {
  if (!confirm(`Block ${user.handle}? This will also remove them from your friends.`)) return
  try {
    await friends.blockUser(user.id)
  } catch (err) {
    alert(err.message)
  }
}

async function unblockUser(user) {
  try {
    await friends.unblockUser(user.id)
  } catch (err) {
    alert(err.message)
  }
}

function getPhotoUrl(user) {
  if (user.photo_path) {
    return `/api/uploads/${user.photo_path}`
  }
  return null
}

function getInitial(user) {
  return user.first_name?.charAt(0) || user.handle?.charAt(0) || '?'
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

function goToProfile(handle) {
  router.push({ name: 'publicProfile', params: { handle } })
}
</script>

<template>
  <div class="page-container friends-page">
    <h1>Friends</h1>

    <div class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        :class="['tab', { active: activeTab === tab.id }]"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
        <span v-if="tab.id === 'requests' && requestCount > 0" class="badge">
          {{ requestCount }}
        </span>
      </button>
    </div>

    <div v-if="friends.loading" class="loading"><LoadingSpinner size="small" /> Loading...</div>

    <div v-else class="tab-content">
      <!-- Friends List -->
      <div v-if="activeTab === 'friends'" class="user-list">
        <div v-if="friends.friends.length === 0" class="empty-state">
          No friends yet. Find users to connect with!
        </div>
        <div v-for="friend in friends.friends" :key="friend.id" class="user-card">
          <div class="user-avatar clickable" @click="goToProfile(friend.handle)">
            <img v-if="getPhotoUrl(friend)" :src="getPhotoUrl(friend)" alt="" />
            <span v-else class="avatar-placeholder">{{ getInitial(friend) }}</span>
          </div>
          <div class="user-info">
            <span class="user-handle clickable" @click="goToProfile(friend.handle)">{{ friend.handle }}</span>
            <span v-if="friend.first_name || friend.last_name" class="user-name">
              {{ friend.first_name }} {{ friend.last_name }}
            </span>
            <span class="user-meta">Friends since {{ formatDate(friend.friends_since) }}</span>
          </div>
          <div class="user-actions">
            <button @click="removeFriend(friend)" class="btn-secondary">Remove</button>
            <button @click="blockUser(friend)" class="btn-danger">Block</button>
          </div>
        </div>
      </div>

      <!-- Incoming Requests -->
      <div v-if="activeTab === 'requests'" class="user-list">
        <div v-if="friends.requests.length === 0" class="empty-state">
          No pending friend requests.
        </div>
        <div v-for="request in friends.requests" :key="request.id" class="user-card">
          <div class="user-avatar clickable" @click="goToProfile(request.handle)">
            <img v-if="getPhotoUrl(request)" :src="getPhotoUrl(request)" alt="" />
            <span v-else class="avatar-placeholder">{{ getInitial(request) }}</span>
          </div>
          <div class="user-info">
            <span class="user-handle clickable" @click="goToProfile(request.handle)">{{ request.handle }}</span>
            <span v-if="request.first_name || request.last_name" class="user-name">
              {{ request.first_name }} {{ request.last_name }}
            </span>
            <span class="user-meta">Requested {{ formatDate(request.requested_at) }}</span>
          </div>
          <div class="user-actions">
            <button @click="acceptRequest(request)" class="btn-primary">Accept</button>
            <button @click="declineRequest(request)" class="btn-secondary">Decline</button>
          </div>
        </div>
      </div>

      <!-- Sent Requests -->
      <div v-if="activeTab === 'sent'" class="user-list">
        <div v-if="friends.sent.length === 0" class="empty-state">
          No pending sent requests.
        </div>
        <div v-for="sent in friends.sent" :key="sent.id" class="user-card">
          <div class="user-avatar clickable" @click="goToProfile(sent.handle)">
            <img v-if="getPhotoUrl(sent)" :src="getPhotoUrl(sent)" alt="" />
            <span v-else class="avatar-placeholder">{{ getInitial(sent) }}</span>
          </div>
          <div class="user-info">
            <span class="user-handle clickable" @click="goToProfile(sent.handle)">{{ sent.handle }}</span>
            <span v-if="sent.first_name || sent.last_name" class="user-name">
              {{ sent.first_name }} {{ sent.last_name }}
            </span>
            <span class="user-meta">Sent {{ formatDate(sent.requested_at) }}</span>
          </div>
          <div class="user-actions">
            <button @click="cancelSent(sent)" class="btn-secondary">Cancel</button>
          </div>
        </div>
      </div>

      <!-- Search Users -->
      <div v-if="activeTab === 'search'" class="search-section">
        <div class="search-box">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search by username or name..."
            @input="searchUsers"
          />
        </div>

        <div v-if="searching" class="loading"><LoadingSpinner size="small" /> Searching...</div>
        <div v-else-if="searchError" class="error">{{ searchError }}</div>
        <div v-else-if="searchQuery && searchResults.length === 0" class="empty-state">
          No users found matching "{{ searchQuery }}"
        </div>
        <div v-else class="user-list">
          <div v-for="u in searchResults" :key="u.id" class="user-card">
            <div class="user-avatar clickable" @click="goToProfile(u.handle)">
              <img v-if="getPhotoUrl(u)" :src="getPhotoUrl(u)" alt="" />
              <span v-else class="avatar-placeholder">{{ getInitial(u) }}</span>
            </div>
            <div class="user-info">
              <span class="user-handle clickable" @click="goToProfile(u.handle)">{{ u.handle }}</span>
              <span v-if="u.first_name || u.last_name" class="user-name">
                {{ u.first_name }} {{ u.last_name }}
              </span>
            </div>
            <div class="user-actions">
              <button @click="sendRequest(u)" class="btn-primary">Add Friend</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Blocked Users -->
      <div v-if="activeTab === 'blocked'" class="user-list">
        <div v-if="friends.blocked.length === 0" class="empty-state">
          No blocked users.
        </div>
        <div v-for="blocked in friends.blocked" :key="blocked.id" class="user-card">
          <div class="user-avatar clickable" @click="goToProfile(blocked.handle)">
            <span class="avatar-placeholder">{{ getInitial(blocked) }}</span>
          </div>
          <div class="user-info">
            <span class="user-handle clickable" @click="goToProfile(blocked.handle)">{{ blocked.handle }}</span>
            <span v-if="blocked.first_name || blocked.last_name" class="user-name">
              {{ blocked.first_name }} {{ blocked.last_name }}
            </span>
            <span class="user-meta">Blocked {{ formatDate(blocked.blocked_at) }}</span>
          </div>
          <div class="user-actions">
            <button @click="unblockUser(blocked)" class="btn-secondary">Unblock</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.friends-page {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

h1 {
  margin: 0 0 20px 0;
  color: var(--color-text);
}

.tabs {
  display: flex;
  gap: 5px;
  border-bottom: 2px solid var(--color-border);
  margin-bottom: 20px;
}

.tab {
  background: none;
  border: none;
  padding: 10px 20px;
  font-size: 0.95rem;
  color: var(--color-text-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.tab:hover {
  color: var(--color-accent);
}

.tab.active {
  color: var(--color-accent);
  border-bottom-color: var(--color-accent);
}

.badge {
  background: var(--color-error);
  color: white;
  font-size: 0.75rem;
  padding: 2px 6px;
  border-radius: 10px;
  min-width: 18px;
  text-align: center;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px;
  color: var(--color-text-muted);
}

.error {
  text-align: center;
  padding: 20px;
  color: var(--color-error);
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: var(--color-text-light);
  font-style: italic;
}

.search-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.search-box input {
  width: 100%;
  padding: 12px 15px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 1rem;
  box-sizing: border-box;
  background: var(--color-background-input);
  color: var(--color-text);
}

.search-box input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.user-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.user-card {
  display: flex;
  align-items: center;
  gap: 15px;
  padding: var(--card-padding);
  background: var(--color-background-soft);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
}

.user-avatar {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
}

.user-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  background: var(--color-accent);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  font-weight: bold;
  text-transform: uppercase;
}

.user-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.user-handle {
  font-weight: 600;
  color: var(--color-text);
}

.clickable {
  cursor: pointer;
}

.user-handle.clickable:hover {
  color: var(--color-accent);
  text-decoration: underline;
}

.user-avatar.clickable:hover {
  opacity: 0.8;
}

.user-name {
  font-size: 0.9rem;
  color: var(--color-text-muted);
}

.user-meta {
  font-size: 0.8rem;
  color: var(--color-text-light);
}

.user-actions {
  display: flex;
  gap: 8px;
}

.btn-primary {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.9rem;
}

.btn-primary:hover {
  background: var(--color-accent-hover);
}

.btn-secondary {
  background: var(--color-button-secondary);
  color: var(--color-text);
  border: none;
  padding: 8px 16px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.9rem;
}

.btn-secondary:hover {
  background: var(--color-button-secondary-hover);
}

.btn-danger {
  background: var(--color-error);
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.9rem;
}

.btn-danger:hover {
  background: #c0392b;
}
</style>
