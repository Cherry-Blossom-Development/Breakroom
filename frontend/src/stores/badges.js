import { reactive } from 'vue'

export const badges = reactive({
  // Per-room unread message counts: { [roomId]: number }
  chatUnread: {},

  // Unseen incoming friend requests
  friendRequestsUnread: 0,

  // Number of the author's posts that have new comments (distinct post count)
  blogCommentsUnread: 0,

  // Per-post unread comment counts: { [postId]: number }
  blogUnreadByPost: {},

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
      // chatUnread arrives as { "5": 3, "12": 1 } – normalise keys to numbers
      const incoming = data.chatUnread || {}
      this.chatUnread = Object.fromEntries(
        Object.entries(incoming).map(([k, v]) => [Number(k), Number(v)])
      )
      this.friendRequestsUnread = data.friendRequestsUnread || 0
      this.blogCommentsUnread = data.blogCommentsUnread || 0
      const incomingBlog = data.blogUnreadByPost || {}
      this.blogUnreadByPost = Object.fromEntries(
        Object.entries(incomingBlog).map(([k, v]) => [Number(k), Number(v)])
      )
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
    const id = Number(postId)
    // Optimistically clear this post from local state
    if (this.blogUnreadByPost[id]) {
      delete this.blogUnreadByPost[id]
      this.blogCommentsUnread = Object.keys(this.blogUnreadByPost).length
    }
    try {
      await fetch(`/api/comments/posts/${id}/mark-read`, {
        method: 'POST',
        credentials: 'include'
      })
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

  onBlogBadgeUpdate(postId) {
    const id = Number(postId)
    if (id) {
      const wasZero = !this.blogUnreadByPost[id]
      this.blogUnreadByPost[id] = (this.blogUnreadByPost[id] || 0) + 1
      // Only increment the distinct-post count if this post was previously clean
      if (wasZero) this.blogCommentsUnread++
    } else {
      this.blogCommentsUnread++
    }
    this.hasUnseenBadges = true
  },

  // Called when the sidebar/hamburger menu is opened
  onSidebarOpen() {
    this.hasUnseenBadges = false
  }
})
