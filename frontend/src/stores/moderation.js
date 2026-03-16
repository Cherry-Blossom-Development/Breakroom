import { reactive } from 'vue'

export const moderationStore = reactive({
  blockedUserIds: [],  // array of user IDs the current user has blocked
  loaded: false,

  async fetchBlockList() {
    try {
      const res = await fetch('/api/moderation/blocks', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        this.blockedUserIds = data.blockedUserIds || []
        this.loaded = true
      }
    } catch (err) {
      console.error('Failed to fetch block list:', err)
    }
  },

  isBlocked(userId) {
    return this.blockedUserIds.includes(userId)
  },

  addBlock(userId) {
    if (!this.blockedUserIds.includes(userId)) {
      this.blockedUserIds.push(userId)
    }
  },

  removeBlock(userId) {
    this.blockedUserIds = this.blockedUserIds.filter(id => id !== userId)
  }
})
