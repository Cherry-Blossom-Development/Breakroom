import { reactive } from 'vue'

// Global online/offline status by user id, for any page/component to read
// via presence.isOnline(userId) -- friends list, chat rooms, the chat
// carousel, wherever a handle shows up. Seeded on login from a full snapshot
// (fetchOnline) and kept live via the 'presence_update' socket event (see
// App.vue). A user with no entry is treated as offline, which is correct
// for anyone who hasn't connected since the snapshot was fetched.
export const presence = reactive({
  online: {},

  isOnline(userId) {
    return !!this.online[userId]
  },

  // Full snapshot of everyone currently online, called once at login
  // (see App.vue's initLoggedInServices).
  async fetchOnline() {
    try {
      const res = await fetch('/api/user/online-ids', { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json()
      for (const id of data.onlineUserIds || []) {
        this.online[id] = true
      }
    } catch (err) {
      console.error('Failed to fetch online status:', err)
    }
  },

  // Seeds/refreshes state from a list of user-like objects carrying
  // is_online, e.g. the /api/friends response. Safe to call repeatedly --
  // later calls just overwrite with whatever's freshest.
  hydrate(users) {
    for (const u of users || []) {
      if (u && u.id != null && 'is_online' in u) {
        this.online[u.id] = !!u.is_online
      }
    }
  },

  // Socket event handler (called from App.vue)
  onPresenceUpdate({ userId, isOnline }) {
    this.online[userId] = isOnline
  },

  // Called on logout so a later login in the same tab doesn't start out
  // showing stale status from the previous session.
  reset() {
    this.online = {}
  }
})
