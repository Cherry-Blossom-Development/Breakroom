import { reactive, ref } from 'vue'
import { io } from 'socket.io-client'
import { authFetch } from '../utilities/authFetch'

const state = reactive({
  socket: null,
  connected: false,
  currentRoom: null,
  rooms: [],
  messages: [],
  typingUsers: [],
  error: null,
  canCreateRoom: false,
  currentUserId: null,
  invites: [],
  members: [],
  isLoadingOlderMessages: false,
  hasOlderMessages: false,
  oldestMessageDate: null
})

// Get the socket instance, creating if needed
function getSocket() {
  if (!state.socket) {
    const baseUrl = import.meta.env.VITE_API_BASE_URL || ''
    state.socket = io(baseUrl, {
      withCredentials: true,
      autoConnect: false
    })

    // Connection events
    state.socket.on('connect', () => {
      console.log('Socket connected')
      state.connected = true
      state.error = null

      // Auto-join current room if one is set
      if (state.currentRoom) {
        console.log('Auto-joining room:', state.currentRoom)
        state.socket.emit('join_room', state.currentRoom)
      }
    })

    state.socket.on('disconnect', () => {
      console.log('Socket disconnected')
      state.connected = false
    })

    state.socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message)
      state.error = err.message
      state.connected = false
    })

    // Chat events
    state.socket.on('new_message', (data) => {
      if (data.roomId === state.currentRoom) {
        // Prevent duplicates by checking if message ID already exists
        const exists = state.messages.some(m => m.id === data.message.id)
        if (!exists) {
          state.messages.push(data.message)
        }
      }
    })

    state.socket.on('user_joined', (data) => {
      console.log(`${data.user} joined the room`)
    })

    state.socket.on('user_left', (data) => {
      console.log(`${data.user} left the room`)
    })

    state.socket.on('user_typing', (data) => {
      if (!state.typingUsers.includes(data.user)) {
        state.typingUsers.push(data.user)
      }
    })

    state.socket.on('user_stopped_typing', (data) => {
      state.typingUsers = state.typingUsers.filter(u => u !== data.user)
    })

    state.socket.on('error', (data) => {
      console.error('Socket error:', data.message)
      state.error = data.message
    })
  }
  return state.socket
}

export const chat = reactive({
  get connected() {
    return state.connected
  },
  get currentRoom() {
    return state.currentRoom
  },
  get rooms() {
    return state.rooms
  },
  get messages() {
    return state.messages
  },
  get typingUsers() {
    return state.typingUsers
  },
  get error() {
    return state.error
  },
  get canCreateRoom() {
    return state.canCreateRoom
  },
  get currentUserId() {
    return state.currentUserId
  },
  get invites() {
    return state.invites
  },
  get members() {
    return state.members
  },
  get isLoadingOlderMessages() {
    return state.isLoadingOlderMessages
  },
  get hasOlderMessages() {
    return state.hasOlderMessages
  },

  // Connect to the socket server
  connect() {
    const socket = getSocket()
    if (!socket.connected) {
      socket.connect()
    }
  },

  // Disconnect from the socket server
  disconnect() {
    if (state.socket) {
      state.socket.disconnect()
    }
  },

  // Fetch available rooms via REST API
  async fetchRooms() {
    try {
      const res = await authFetch('/api/chat/rooms')
      if (!res.ok) throw new Error('Failed to fetch rooms')
      const data = await res.json()
      state.rooms = data.rooms
    } catch (err) {
      console.error('Error fetching rooms:', err)
      state.error = err.message
    }
  },

  // Fetch messages for a room via REST API (last 7 days by default)
  async fetchMessages(roomId) {
    try {
      const since = new Date()
      since.setDate(since.getDate() - 7)
      const url = `/api/chat/rooms/${roomId}/messages?since=${since.toISOString()}`
      const res = await authFetch(url)
      if (!res.ok) throw new Error('Failed to fetch messages')
      const data = await res.json()
      state.hasOlderMessages = data.hasMore
      state.oldestMessageDate = data.messages.length > 0 ? data.messages[0].created_at : null
      return data.messages
    } catch (err) {
      console.error('Error fetching messages:', err)
      state.error = err.message
      return []
    }
  },

  // Fetch the previous week of messages and prepend them
  async fetchOlderMessages() {
    if (state.isLoadingOlderMessages || !state.hasOlderMessages || !state.currentRoom) return null
    state.isLoadingOlderMessages = true
    try {
      const until = state.oldestMessageDate
      const since = new Date(until)
      since.setDate(since.getDate() - 7)
      const url = `/api/chat/rooms/${state.currentRoom}/messages?since=${since.toISOString()}&until=${encodeURIComponent(until)}`
      const res = await authFetch(url)
      if (!res.ok) throw new Error('Failed to fetch older messages')
      const data = await res.json()
      state.hasOlderMessages = data.hasMore
      if (data.messages.length > 0) {
        state.oldestMessageDate = data.messages[0].created_at
        state.messages = [...data.messages, ...state.messages]
      }
      return data.messages
    } catch (err) {
      console.error('Error fetching older messages:', err)
      state.error = err.message
      return null
    } finally {
      state.isLoadingOlderMessages = false
    }
  },

  // Join a chat room
  async joinRoom(roomId) {
    // Reset older-message state for fresh room join
    state.hasOlderMessages = false
    state.isLoadingOlderMessages = false
    state.oldestMessageDate = null
    // Fetch initial messages via REST
    const messages = await this.fetchMessages(roomId)
    state.messages = messages
    state.currentRoom = roomId
    state.typingUsers = []

    // Join via socket for real-time updates
    const socket = getSocket()
    if (socket.connected) {
      socket.emit('join_room', roomId)
    }
  },

  // Leave current room
  leaveRoom() {
    if (state.currentRoom) {
      const socket = getSocket()
      if (socket.connected) {
        socket.emit('leave_room', state.currentRoom)
      }
      state.currentRoom = null
      state.messages = []
      state.typingUsers = []
    }
  },

  // Send a message
  sendMessage(message) {
    if (!state.currentRoom || !message.trim()) return

    const socket = getSocket()
    console.log('sendMessage - socket.connected:', socket.connected, 'currentRoom:', state.currentRoom)
    if (socket.connected) {
      console.log('Sending via socket')
      socket.emit('send_message', {
        roomId: state.currentRoom,
        message: message.trim()
      })
    } else {
      // Fallback to REST API
      console.log('Sending via REST (socket not connected)')
      this.sendMessageREST(message)
    }
  },

  // Send message via REST API (fallback)
  async sendMessageREST(message) {
    if (!state.currentRoom) return

    try {
      const res = await authFetch(`/api/chat/rooms/${state.currentRoom}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: message.trim() })
      })
      if (!res.ok) throw new Error('Failed to send message')
      const data = await res.json()
      // Add message to local state since we won't get socket event
      state.messages.push(data.message)
    } catch (err) {
      console.error('Error sending message:', err)
      state.error = err.message
    }
  },

  // Typing indicators
  startTyping() {
    if (state.currentRoom) {
      const socket = getSocket()
      if (socket.connected) {
        socket.emit('typing_start', state.currentRoom)
      }
    }
  },

  stopTyping() {
    if (state.currentRoom) {
      const socket = getSocket()
      if (socket.connected) {
        socket.emit('typing_stop', state.currentRoom)
      }
    }
  },

  // Check if user can create rooms
  async checkCreatePermission() {
    console.log('Checking create permission...')
    try {
      const res = await fetch('/api/auth/can/create_room', {
        credentials: 'include'
      })
      const data = await res.json()
      console.log('Create permission response:', data)
      state.canCreateRoom = data.has_permission
    } catch (err) {
      console.error('Create permission error:', err)
      state.canCreateRoom = false
    }
  },

  // Fetch current user ID for ownership checks
  async fetchCurrentUser() {
    try {
      const res = await fetch('/api/auth/me', {
        credentials: 'include'
      })
      if (res.ok) {
        const data = await res.json()
        state.currentUserId = data.userId
      }
    } catch (err) {
      state.currentUserId = null
    }
  },

  // Create a new room
  async createRoom(name, description) {
    try {
      const res = await authFetch('/api/chat/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description })
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || 'Failed to create room')
      }

      const data = await res.json()
      state.rooms.push(data.room)
      return data.room
    } catch (err) {
      state.error = err.message
      throw err
    }
  },

  // Update a room
  async updateRoom(roomId, name, description) {
    try {
      const res = await authFetch(`/api/chat/rooms/${roomId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description })
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || 'Failed to update room')
      }

      const data = await res.json()
      const index = state.rooms.findIndex(r => r.id === roomId)
      if (index !== -1) {
        state.rooms[index] = data.room
      }
      return data.room
    } catch (err) {
      state.error = err.message
      throw err
    }
  },

  // Delete a room
  async deleteRoom(roomId) {
    try {
      const res = await authFetch(`/api/chat/rooms/${roomId}`, {
        method: 'DELETE'
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || 'Failed to delete room')
      }

      state.rooms = state.rooms.filter(r => r.id !== roomId)

      // If we deleted the current room, switch to General
      if (state.currentRoom === roomId) {
        const generalRoom = state.rooms.find(r => r.owner_id === null)
        if (generalRoom) {
          await this.joinRoom(generalRoom.id)
        }
      }
    } catch (err) {
      state.error = err.message
      throw err
    }
  },

  // Check if current user owns a room
  isRoomOwner(room) {
    return room && room.owner_id === state.currentUserId
  },

  // Clear error
  clearError() {
    state.error = null
  },

  // Fetch pending invites
  async fetchInvites() {
    try {
      const res = await authFetch('/api/chat/invites')
      if (!res.ok) throw new Error('Failed to fetch invites')
      const data = await res.json()
      state.invites = data.invites
    } catch (err) {
      console.error('Error fetching invites:', err)
      state.error = err.message
    }
  },

  // Accept an invite
  async acceptInvite(roomId) {
    try {
      const res = await authFetch(`/api/chat/invites/${roomId}/accept`, {
        method: 'POST'
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || 'Failed to accept invite')
      }
      const data = await res.json()
      // Remove from invites and add to rooms
      state.invites = state.invites.filter(i => i.room_id !== roomId)
      state.rooms.push(data.room)
      return data.room
    } catch (err) {
      state.error = err.message
      throw err
    }
  },

  // Decline an invite
  async declineInvite(roomId) {
    try {
      const res = await authFetch(`/api/chat/invites/${roomId}/decline`, {
        method: 'POST'
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || 'Failed to decline invite')
      }
      state.invites = state.invites.filter(i => i.room_id !== roomId)
    } catch (err) {
      state.error = err.message
      throw err
    }
  },

  // Invite a user to a room
  async inviteUser(roomId, userId) {
    try {
      const res = await authFetch(`/api/chat/rooms/${roomId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || 'Failed to invite user')
      }
      const data = await res.json()
      return data
    } catch (err) {
      state.error = err.message
      throw err
    }
  },

  // Fetch members of a room
  async fetchMembers(roomId) {
    try {
      const res = await authFetch(`/api/chat/rooms/${roomId}/members`)
      if (!res.ok) throw new Error('Failed to fetch members')
      const data = await res.json()
      state.members = data.members
      return data.members
    } catch (err) {
      console.error('Error fetching members:', err)
      state.error = err.message
      return []
    }
  }
})
