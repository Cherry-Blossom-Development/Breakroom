import { reactive } from 'vue'

// Global online/offline status by user id, kept live via the 'friend_presence'
// socket event (see App.vue) so any page can show accurate status without
// re-fetching. Seeded from whatever endpoint first loads a user list that
// includes an is_online flag (see hydrate()).
export const presence = reactive({
  online: {},

  isOnline(userId) {
    return !!this.online[userId]
  },

  // Seeds initial state from a list of user-like objects carrying is_online,
  // e.g. the /api/friends response. Safe to call repeatedly from multiple
  // pages/stores -- later calls only add to what's already known.
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
  }
})
