import { reactive } from 'vue'
import { authFetch } from '../utilities/authFetch'
import { presence } from './presence.js'

const state = reactive({
  friends: [],
  requests: [],
  sent: [],
  blocked: [],
  loading: false,
  error: null
})

export const friends = reactive({
  get friends() {
    return state.friends
  },
  get requests() {
    return state.requests
  },
  get sent() {
    return state.sent
  },
  get blocked() {
    return state.blocked
  },
  get loading() {
    return state.loading
  },
  get error() {
    return state.error
  },

  // Fetch friends list
  async fetchFriends() {
    try {
      const res = await authFetch('/api/friends')
      if (!res.ok) throw new Error('Failed to fetch friends')
      const data = await res.json()
      state.friends = data.friends
      presence.hydrate(data.friends)
    } catch (err) {
      console.error('Error fetching friends:', err)
      state.error = err.message
    }
  },

  // Fetch incoming friend requests
  async fetchRequests() {
    try {
      const res = await authFetch('/api/friends/requests')
      if (!res.ok) throw new Error('Failed to fetch requests')
      const data = await res.json()
      state.requests = data.requests
    } catch (err) {
      console.error('Error fetching requests:', err)
      state.error = err.message
    }
  },

  // Fetch sent friend requests
  async fetchSent() {
    try {
      const res = await authFetch('/api/friends/sent')
      if (!res.ok) throw new Error('Failed to fetch sent requests')
      const data = await res.json()
      state.sent = data.sent
    } catch (err) {
      console.error('Error fetching sent requests:', err)
      state.error = err.message
    }
  },

  // Fetch blocked users
  async fetchBlocked() {
    try {
      const res = await authFetch('/api/friends/blocked')
      if (!res.ok) throw new Error('Failed to fetch blocked users')
      const data = await res.json()
      state.blocked = data.blocked
    } catch (err) {
      console.error('Error fetching blocked users:', err)
      state.error = err.message
    }
  },

  // Fetch all data
  async fetchAll() {
    state.loading = true
    state.error = null
    await Promise.all([
      this.fetchFriends(),
      this.fetchRequests(),
      this.fetchSent(),
      this.fetchBlocked()
    ])
    state.loading = false
  },

  // Send friend request
  async sendRequest(userId) {
    try {
      const res = await authFetch(`/api/friends/request/${userId}`, {
        method: 'POST'
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.message || 'Failed to send request')
      }
      const data = await res.json()
      // Add to sent list
      state.sent.push({
        id: userId,
        handle: data.user.handle,
        requested_at: new Date().toISOString()
      })
      return data
    } catch (err) {
      state.error = err.message
      throw err
    }
  },

  // Accept friend request
  async acceptRequest(userId) {
    try {
      const res = await authFetch(`/api/friends/accept/${userId}`, {
        method: 'POST'
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.message || 'Failed to accept request')
      }
      // Move from requests to friends
      const request = state.requests.find(r => r.id === userId)
      if (request) {
        state.requests = state.requests.filter(r => r.id !== userId)
        state.friends.push({
          ...request,
          friends_since: new Date().toISOString()
        })
      }
    } catch (err) {
      state.error = err.message
      throw err
    }
  },

  // Decline friend request
  async declineRequest(userId) {
    try {
      const res = await authFetch(`/api/friends/decline/${userId}`, {
        method: 'POST'
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.message || 'Failed to decline request')
      }
      state.requests = state.requests.filter(r => r.id !== userId)
    } catch (err) {
      state.error = err.message
      throw err
    }
  },

  // Cancel sent request
  async cancelRequest(userId) {
    try {
      const res = await authFetch(`/api/friends/request/${userId}`, {
        method: 'DELETE'
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.message || 'Failed to cancel request')
      }
      state.sent = state.sent.filter(s => s.id !== userId)
    } catch (err) {
      state.error = err.message
      throw err
    }
  },

  // Remove friend
  async removeFriend(userId) {
    try {
      const res = await authFetch(`/api/friends/${userId}`, {
        method: 'DELETE'
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.message || 'Failed to remove friend')
      }
      state.friends = state.friends.filter(f => f.id !== userId)
    } catch (err) {
      state.error = err.message
      throw err
    }
  },

  // Block user
  async blockUser(userId) {
    try {
      const res = await authFetch(`/api/friends/block/${userId}`, {
        method: 'POST'
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.message || 'Failed to block user')
      }
      // Remove from friends/requests/sent if present
      const user = state.friends.find(f => f.id === userId) ||
                   state.requests.find(r => r.id === userId) ||
                   state.sent.find(s => s.id === userId)
      state.friends = state.friends.filter(f => f.id !== userId)
      state.requests = state.requests.filter(r => r.id !== userId)
      state.sent = state.sent.filter(s => s.id !== userId)
      if (user) {
        state.blocked.push({
          id: userId,
          handle: user.handle,
          first_name: user.first_name,
          last_name: user.last_name,
          blocked_at: new Date().toISOString()
        })
      }
    } catch (err) {
      state.error = err.message
      throw err
    }
  },

  // Unblock user
  async unblockUser(userId) {
    try {
      const res = await authFetch(`/api/friends/block/${userId}`, {
        method: 'DELETE'
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.message || 'Failed to unblock user')
      }
      state.blocked = state.blocked.filter(b => b.id !== userId)
    } catch (err) {
      state.error = err.message
      throw err
    }
  },

  clearError() {
    state.error = null
  }
})
