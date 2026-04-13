import { reactive, computed } from 'vue'

export const badges = reactive({
  // Per-room unread message counts: { [roomId]: number }
  chatUnread: {},

  // Unseen incoming friend requests
  friendRequestsUnread: 0,

  // Author's posts with new comments not yet visited
  blogCommentsUnread: 0,

  // True when a new badge has arrived since the sidebar was last opened.
  // Drives the hamburger red-ring indicator on mobile.
  hasUnseenBadges: false,

  // Total of all non-chat badges (for summary use)
  get totalNonChat() {
    return this.friendRequestsUnread + this.blogCommentsUnread
  },

  // Sum of all chat room unread counts
  get totalChatUnread() {
    return Object.values(this.chatUnread).reduce((a, b) => a + b, 0)
  },

  // Any unread content at all
  get hasAny() {
    return this.totalChatUnread > 0 || this.totalNonChat > 0
  },

  // ── Initialisation ────────────────────────────────────────────────────────

  async fetchAll() {
    try {
      const res = await fetch('/api/user/badge-counts', { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json()
      // chatUnread arrives as { "5": 3, "12": 1 } – keep as-is but ensure number values
      const incoming = data.chatUnread || {}
      this.chatUnread = Object.fromEntries(
        Object.entries(incoming).map(([k, v]) => [Number(k), Number(v)])
      )
      this.friendRequestsUnread = data.friendRequestsUnread || 0
      this.blogCommentsUnread = data.blogCommentsUnread || 0
    } catch (err) {
      console.error('Failed to fetch badge counts:', err)
    }
  },

  // ── Mark-read actions (also call server) ─────────────────────────────────

  async markRoomRead(roomId) {
    const id = Number(roomId)
    if (!this.chatUnread[id]) return          // nothing to clear
    delete this.chatUnread[id]
    try {
      await fetch(`/api/chat/rooms/${id}/mark-read`, {
        method: 'POST',
        credentials: 'include'
      })
    } catch (err) {
      console.error('Failed to mark room read:', err)
    }
  },

  async markAllRoomsRead() {
    this.chatUnread = {}
    try {
      await fetch('/api/chat/rooms/mark-all-read', {
        method: 'POST',
        credentials: 'include'
      })
    } catch (err) {
      console.error('Failed to mark all rooms read:', err)
    }
  },

  async markFriendsRead() {
    if (this.friendRequestsUnread === 0) return
    this.friendRequestsUnread = 0
    try {
      await fetch('/api/friends/mark-seen', {
        method: 'POST',
        credentials: 'include'
      })
    } catch (err) {
      console.error('Failed to mark friend requests seen:', err)
    }
  },

  async markBlogPostRead(postId) {
    // Re-fetch the blog count from server after marking, since multiple posts
    // may be outstanding and we only know the one post just visited.
    try {
      await fetch(`/api/comments/posts/${postId}/mark-read`, {
        method: 'POST',
        credentials: 'include'
      })
      // Refresh blog count
      const res = await fetch('/api/user/badge-counts', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        this.blogCommentsUnread = data.blogCommentsUnread || 0
      }
    } catch (err) {
      console.error('Failed to mark blog post read:', err)
    }
  },

  // ── Socket event handlers (called from App.vue) ───────────────────────────

  onChatBadgeUpdate(roomId) {
    const id = Number(roomId)
    this.chatUnread[id] = (this.chatUnread[id] || 0) + 1
    this.hasUnseenBadges = true
  },

  onFriendBadgeUpdate() {
    this.friendRequestsUnread++
    this.hasUnseenBadges = true
  },

  onBlogBadgeUpdate() {
    this.blogCommentsUnread++
    this.hasUnseenBadges = true
  },

  // Called when the sidebar/hamburger menu is opened
  onSidebarOpen() {
    this.hasUnseenBadges = false
  }
})
