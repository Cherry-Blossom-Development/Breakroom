<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { io } from 'socket.io-client'

const props = defineProps({
  roomId: {
    type: Number,
    required: true
  }
})

// Local state for this widget
const messages = ref([])
const newMessage = ref('')
const typingUsers = ref([])
const loading = ref(true)
const error = ref(null)
const messagesContainer = ref(null)
const imageInput = ref(null)
const uploadingImage = ref(false)
const videoInput = ref(null)
const uploadingVideo = ref(false)

// Socket reference
let socket = null
let typingTimeout = null

// Scroll to bottom of messages
const scrollToBottom = (immediate = false) => {
  const doScroll = () => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  }

  if (immediate) {
    doScroll()
  } else {
    // Use nextTick + small delay to ensure DOM is fully updated
    nextTick(() => {
      setTimeout(doScroll, 50)
    })
  }
}

// Fetch messages via REST
const fetchMessages = async () => {
  try {
    loading.value = true
    const res = await fetch(`/api/chat/rooms/${props.roomId}/messages?limit=50`, {
      credentials: 'include'
    })
    if (!res.ok) throw new Error('Failed to fetch messages')
    const data = await res.json()
    messages.value = data.messages
    scrollToBottom()
  } catch (err) {
    console.error('ChatWidget: Error fetching messages:', err)
    error.value = err.message
  } finally {
    loading.value = false
  }
}

// Send message
const sendMessage = async () => {
  if (!newMessage.value.trim()) return

  const messageText = newMessage.value.trim()
  newMessage.value = ''

  // Stop typing indicator
  if (socket && socket.connected) {
    socket.emit('typing_stop', props.roomId)
  }

  try {
    // Try socket first
    if (socket && socket.connected) {
      socket.emit('send_message', {
        roomId: props.roomId,
        message: messageText
      })
    } else {
      // Fallback to REST
      const res = await fetch(`/api/chat/rooms/${props.roomId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: messageText })
      })
      if (!res.ok) throw new Error('Failed to send message')
      const data = await res.json()
      // Add message locally since we won't get socket event
      const exists = messages.value.some(m => m.id === data.message.id)
      if (!exists) {
        messages.value.push(data.message)
        scrollToBottom()
      }
    }
  } catch (err) {
    console.error('ChatWidget: Error sending message:', err)
    error.value = err.message
  }
}

// Handle typing
const onInput = () => {
  if (socket && socket.connected) {
    socket.emit('typing_start', props.roomId)

    // Clear existing timeout
    if (typingTimeout) {
      clearTimeout(typingTimeout)
    }

    // Stop typing after 2 seconds of no input
    typingTimeout = setTimeout(() => {
      if (socket && socket.connected) {
        socket.emit('typing_stop', props.roomId)
      }
    }, 2000)
  }
}

// Format timestamp - show date if not today
const formatTime = (timestamp) => {
  const date = new Date(timestamp)
  const today = new Date()
  const isToday = date.getFullYear() === today.getFullYear() &&
                  date.getMonth() === today.getMonth() &&
                  date.getDate() === today.getDate()

  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  if (isToday) {
    return time
  }

  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const year = date.getFullYear()
  return `${month}/${day}/${year} - ${time}`
}

// Get image URL
const getImageUrl = (imagePath) => {
  if (!imagePath) return null
  return `/api/uploads/${imagePath}`
}

// Get video URL
const getVideoUrl = (videoPath) => {
  if (!videoPath) return null
  return `/api/uploads/${videoPath}`
}

// Trigger image file input
const triggerImageUpload = () => {
  imageInput.value?.click()
}

// Handle image selection and upload
const onImageSelected = async (event) => {
  const file = event.target.files[0]
  if (!file) return

  uploadingImage.value = true
  error.value = null

  const formData = new FormData()
  formData.append('image', file)

  try {
    const res = await fetch(`/api/chat/rooms/${props.roomId}/image`, {
      method: 'POST',
      credentials: 'include',
      body: formData
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.message || 'Failed to upload image')
    }

    const data = await res.json()
    // Add message locally if socket not connected
    if (!socket || !socket.connected) {
      const exists = messages.value.some(m => m.id === data.message.id)
      if (!exists) {
        messages.value.push(data.message)
        scrollToBottom()
      }
    }
  } catch (err) {
    console.error('ChatWidget: Error uploading image:', err)
    error.value = err.message
  } finally {
    uploadingImage.value = false
    event.target.value = ''
  }
}

// Trigger video file input
const triggerVideoUpload = () => {
  videoInput.value?.click()
}

// Handle video selection and upload
const onVideoSelected = async (event) => {
  const file = event.target.files[0]
  if (!file) return

  uploadingVideo.value = true
  error.value = null

  const formData = new FormData()
  formData.append('video', file)

  try {
    const res = await fetch(`/api/chat/rooms/${props.roomId}/video`, {
      method: 'POST',
      credentials: 'include',
      body: formData
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.message || 'Failed to upload video')
    }

    const data = await res.json()
    // Add message locally if socket not connected
    if (!socket || !socket.connected) {
      const exists = messages.value.some(m => m.id === data.message.id)
      if (!exists) {
        messages.value.push(data.message)
        scrollToBottom()
      }
    }
  } catch (err) {
    console.error('ChatWidget: Error uploading video:', err)
    error.value = err.message
  } finally {
    uploadingVideo.value = false
    event.target.value = ''
  }
}

// Setup socket connection
const setupSocket = () => {
  const baseUrl = import.meta.env.VITE_API_BASE_URL || ''
  socket = io(baseUrl, {
    withCredentials: true,
    autoConnect: true
  })

  socket.on('connect', () => {
    console.log(`ChatWidget[${props.roomId}]: Socket connected`)
    socket.emit('join_room', props.roomId)
  })

  socket.on('new_message', (data) => {
    if (data.roomId === props.roomId) {
      const exists = messages.value.some(m => m.id === data.message.id)
      if (!exists) {
        messages.value.push(data.message)
        scrollToBottom()
      }
    }
  })

  socket.on('user_typing', (data) => {
    if (!typingUsers.value.includes(data.user)) {
      typingUsers.value.push(data.user)
    }
  })

  socket.on('user_stopped_typing', (data) => {
    typingUsers.value = typingUsers.value.filter(u => u !== data.user)
  })

  socket.on('error', (data) => {
    console.error(`ChatWidget[${props.roomId}]: Socket error:`, data.message)
    error.value = data.message
  })
}

// Cleanup socket
const cleanupSocket = () => {
  if (typingTimeout) {
    clearTimeout(typingTimeout)
  }
  if (socket) {
    socket.emit('leave_room', props.roomId)
    socket.disconnect()
    socket = null
  }
}

onMounted(() => {
  fetchMessages()
  setupSocket()
})

onUnmounted(() => {
  cleanupSocket()
})

// If roomId changes, rejoin
watch(() => props.roomId, (newRoomId, oldRoomId) => {
  if (oldRoomId && socket && socket.connected) {
    socket.emit('leave_room', oldRoomId)
  }
  messages.value = []
  typingUsers.value = []
  fetchMessages()
  if (socket && socket.connected) {
    socket.emit('join_room', newRoomId)
  }
})
</script>

<template>
  <div class="chat-widget">
    <div v-if="loading" class="loading">
      Loading messages...
    </div>

    <div v-else-if="error" class="error">
      {{ error }}
    </div>

    <template v-else>
      <div ref="messagesContainer" class="messages">
        <div v-if="messages.length === 0" class="no-messages">
          No messages yet. Start the conversation!
        </div>

        <div
          v-for="msg in messages"
          :key="msg.id"
          class="message"
        >
          <div class="message-header">
            <span class="username">{{ msg.handle }}</span>
            <span class="time">{{ formatTime(msg.created_at) }}</span>
          </div>
          <div v-if="msg.image_path" class="message-image">
            <a :href="getImageUrl(msg.image_path)" target="_blank">
              <img :src="getImageUrl(msg.image_path)" alt="Shared image" />
            </a>
          </div>
          <div v-if="msg.video_path" class="message-video">
            <video controls :src="getVideoUrl(msg.video_path)">
              Your browser does not support video playback.
            </video>
          </div>
          <div v-if="msg.message" class="message-content">{{ msg.message }}</div>
        </div>
      </div>

      <div v-if="typingUsers.length > 0" class="typing-indicator">
        {{ typingUsers.join(', ') }} {{ typingUsers.length === 1 ? 'is' : 'are' }} typing...
      </div>

      <form class="input-area" @submit.prevent="sendMessage">
        <input
          ref="imageInput"
          type="file"
          accept="image/*"
          class="hidden-input"
          @change="onImageSelected"
        />
        <input
          ref="videoInput"
          type="file"
          accept="video/*"
          class="hidden-input"
          @change="onVideoSelected"
        />
        <button
          type="button"
          class="image-btn"
          @click="triggerImageUpload"
          :disabled="uploadingImage"
          title="Upload image"
        >
          {{ uploadingImage ? '...' : 'Img' }}
        </button>
        <button
          type="button"
          class="image-btn"
          @click="triggerVideoUpload"
          :disabled="uploadingVideo"
          title="Upload video"
        >
          {{ uploadingVideo ? '...' : 'Vid' }}
        </button>
        <input
          v-model="newMessage"
          type="text"
          placeholder="Type a message..."
          maxlength="2000"
          @input="onInput"
        />
        <button type="submit" :disabled="!newMessage.trim()">
          Send
        </button>
      </form>
    </template>
  </div>
</template>

<style scoped>
.chat-widget {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-background-soft);
}

.loading,
.error {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-light);
  font-size: 0.9rem;
  padding: 20px;
}

.error {
  color: var(--color-error);
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.no-messages {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-light);
  font-size: 0.85rem;
  text-align: center;
}

.message {
  background: var(--color-background-card);
  padding: 8px 10px;
  border-radius: 6px;
  box-shadow: var(--shadow-sm);
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.username {
  font-weight: 600;
  font-size: 0.8rem;
  color: var(--color-link);
}

.time {
  font-size: 0.7rem;
  color: var(--color-text-light);
}

.message-content {
  font-size: 0.85rem;
  color: var(--color-text);
  word-wrap: break-word;
}

.message-image {
  margin: 6px 0;
}

.message-image img {
  max-width: 100%;
  max-height: 300px;
  border-radius: 4px;
  cursor: pointer;
}

.message-image a {
  display: block;
}

.message-video {
  margin: 6px 0;
}

.message-video video {
  max-width: 100%;
  max-height: 200px;
  border-radius: 4px;
}

.hidden-input {
  display: none;
}

.typing-indicator {
  padding: 4px 10px;
  font-size: 0.75rem;
  color: var(--color-text-light);
  font-style: italic;
  background: var(--color-background-hover);
}

.input-area {
  display: flex;
  gap: 6px;
  padding: 8px;
  background: var(--color-background-card);
  border-top: 1px solid var(--color-border);
}

.input-area input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 0.85rem;
  background: var(--color-background-input);
  color: var(--color-text);
}

.input-area input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.input-area button {
  padding: 8px 14px;
  background: var(--color-accent);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
}

.input-area button:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.input-area button:disabled {
  background: var(--color-button-disabled);
  cursor: not-allowed;
}

.image-btn {
  padding: 8px 10px;
  background: var(--color-button-secondary);
  color: var(--color-text);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 500;
}

.image-btn:hover:not(:disabled) {
  background: var(--color-button-secondary-hover);
}

.image-btn:disabled {
  background: var(--color-button-disabled);
  cursor: not-allowed;
}
</style>
