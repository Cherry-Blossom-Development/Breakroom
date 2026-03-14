import { reactive } from 'vue'

export const notificationStore = reactive({
  // All active notifications for the user
  notifications: [],

  // Currently showing popup (one at a time)
  currentPopup: null,

  // Queue for popups waiting to be shown
  popupQueue: [],

  // Fetch user's notifications from the server
  async fetchNotifications() {
    try {
      const res = await fetch('/api/notification/my', {
        credentials: 'include'
      })
      if (res.ok) {
        const data = await res.json()
        this.notifications = data.notifications || []
        this.processNotifications()
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err)
    }
  },

  // Process notifications and queue popups
  processNotifications() {
    // Find unviewed popup notifications
    const popups = this.notifications.filter(
      n => n.display_type === 'popup' && n.status === 'unviewed'
    )

    // Add to queue if not already showing
    for (const popup of popups) {
      if (!this.popupQueue.find(p => p.id === popup.id) &&
          (!this.currentPopup || this.currentPopup.id !== popup.id)) {
        this.popupQueue.push(popup)
      }
    }

    // Show next popup if none currently showing
    if (!this.currentPopup && this.popupQueue.length > 0) {
      this.showNextPopup()
    }
  },

  // Show the next popup in the queue
  showNextPopup() {
    if (this.popupQueue.length > 0) {
      this.currentPopup = this.popupQueue.shift()
    }
  },

  // Add a new notification (from Socket.IO)
  addNotification(notification) {
    // Avoid duplicates
    if (!this.notifications.find(n => n.id === notification.id)) {
      this.notifications.push(notification)
      this.processNotifications()
    }
  },

  // Get header notifications (unviewed, header type)
  get headerNotifications() {
    return this.notifications.filter(
      n => n.display_type === 'header' && n.status !== 'dismissed'
    )
  },

  // Dismiss a notification
  async dismissNotification(id) {
    try {
      const res = await fetch(`/api/notification/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'dismissed' })
      })

      if (res.ok) {
        // Update local state
        const notification = this.notifications.find(n => n.id === id)
        if (notification) {
          notification.status = 'dismissed'
        }

        // If this was the current popup, show next
        if (this.currentPopup && this.currentPopup.id === id) {
          this.currentPopup = null
          this.showNextPopup()
        }
      }
    } catch (err) {
      console.error('Failed to dismiss notification:', err)
    }
  },

  // Mark notification as viewed
  async markViewed(id) {
    try {
      await fetch(`/api/notification/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'viewed' })
      })

      // Update local state
      const notification = this.notifications.find(n => n.id === id)
      if (notification) {
        notification.status = 'viewed'
      }

      // If this was the current popup, show next
      if (this.currentPopup && this.currentPopup.id === id) {
        this.currentPopup = null
        this.showNextPopup()
      }
    } catch (err) {
      console.error('Failed to mark notification as viewed:', err)
    }
  }
})
