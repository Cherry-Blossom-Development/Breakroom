<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { io } from 'socket.io-client'
import LoadingSpinner from './LoadingSpinner.vue'
import FlagDialog from './FlagDialog.vue'
import { user } from '@/stores/user.js'
import { moderationStore } from '@/stores/moderation.js'

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
const showAttachMenu = ref(false)
const hasOlderMessages = ref(false)
const isLoadingOlderMessages = ref(false)
const oldestMessageDate = ref(null)
const isPrepending = ref(false)

const flaggingMessageId = ref(null)
const editingMessageId = ref(null)
const editText = ref('')
const deletingMessageId = ref(null)
const openMenuId = ref(null)

const toggleMsgMenu = (id) => {
  openMenuId.value = openMenuId.value === id ? null : id
}

const handleMsgMenuOutsideClick = (e) => {
  if (!e.target.closest('.msg-menu-wrapper')) {
    openMenuId.value = null
  }
}

const isOwnMessage = (handle) => handle === user.username

const startEdit = (msg) => {
  editingMessageId.value = msg.id
  editText.value = msg.message
  deletingMessageId.value = null
}

const cancelEdit = () => {
  editingMessageId.value = null
  editText.value = ''
}

const saveEdit = async (messageId) => {
  const text = editText.value.trim()
  if (!text) return
  try {
    const res = await fetch(`/api/chat/rooms/${props.roomId}/messages/${messageId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ message: text })
    })
    if (!res.ok) throw new Error('Failed to edit message')
    cancelEdit()
  } catch (err) {
    error.value = err.message
  }
}

const confirmDelete = async (messageId) => {
  deletingMessageId.value = null
  try {
    const res = await fetch(`/api/chat/rooms/${props.roomId}/messages/${messageId}`, {
      method: 'DELETE',
      credentials: 'include'
    })
    if (!res.ok) throw new Error('Failed to delete message')
  } catch (err) {
    error.value = err.message
  }
}

const blockUser = async (msg) => {
  if (!msg.user_id) return
  if (moderationStore.isBlocked(msg.user_id)) {
    const res = await fetch(`/api/moderation/block/${msg.user_id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) moderationStore.removeBlock(msg.user_id)
  } else {
    const res = await fetch(`/api/moderation/block/${msg.user_id}`, { method: 'POST', credentials: 'include' })
    if (res.ok) moderationStore.addBlock(msg.user_id)
  }
}

const attachBtnRef = ref(null)
const attachMenuStyle = ref({})

const toggleAttachMenu = () => {
  if (!showAttachMenu.value && attachBtnRef.value) {
    const rect = attachBtnRef.value.getBoundingClientRect()
    attachMenuStyle.value = {
      position: 'fixed',
      bottom: `${window.innerHeight - rect.top + 4}px`,
      left: `${rect.left}px`,
      zIndex: '9999'
    }
  }
  showAttachMenu.value = !showAttachMenu.value
}

const closeAttachMenu = () => {
  showAttachMenu.value = false
}

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

// Fetch messages via REST (most recent 50)
const fetchMessages = async () => {
  try {
    loading.value = true
    hasOlderMessages.value = false
    oldestMessageDate.value = null
    const res = await fetch(`/api/chat/rooms/${props.roomId}/messages?limit=50`, {
      credentials: 'include'
    })
    if (!res.ok) throw new Error('Failed to fetch messages')
    const data = await res.json()
    messages.value = data.messages
    hasOlderMessages.value = data.hasMore
    oldestMessageDate.value = data.messages.length > 0 ? data.messages[0].created_at : null
    scrollToBottom()
  } catch (err) {
    console.error('ChatWidget: Error fetching messages:', err)
    error.value = err.message
  } finally {
    loading.value = false
  }
}

// Fetch the previous batch of messages (50 older than current oldest)
const fetchOlderMessages = async () => {
  if (isLoadingOlderMessages.value || !hasOlderMessages.value || !oldestMessageDate.value) return
  isLoadingOlderMessages.value = true
  try {
    const res = await fetch(
      `/api/chat/rooms/${props.roomId}/messages?limit=50&before=${encodeURIComponent(oldestMessageDate.value)}`,
      { credentials: 'include' }
    )
    if (!res.ok) throw new Error('Failed to fetch older messages')
    const data = await res.json()
    hasOlderMessages.value = data.hasMore
    if (data.messages.length > 0) {
      oldestMessageDate.value = data.messages[0].created_at
      messages.value = [...data.messages, ...messages.value]
    }
    return data.messages
  } catch (err) {
    console.error('ChatWidget: Error fetching older messages:', err)
    error.value = err.message
  } finally {
    isLoadingOlderMessages.value = false
  }
}

const loadOlderMessages = async () => {
  if (!messagesContainer.value || !hasOlderMessages.value || isLoadingOlderMessages.value) return

  const container = messagesContainer.value
  const prevScrollHeight = container.scrollHeight

  isPrepending.value = true
  await fetchOlderMessages()
  await nextTick()

  container.scrollTop = container.scrollHeight - prevScrollHeight
  isPrepending.value = false
}

// Load older messages when user scrolls near the top
const handleScroll = async () => {
  if (!messagesContainer.value || !hasOlderMessages.value || isLoadingOlderMessages.value) return
  if (messagesContainer.value.scrollTop > 100) return
  loadOlderMessages()
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

  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  if (isToday) {
    return time
  }

  const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return `${dateStr}, ${time}`
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

  socket.on('message_edited', (data) => {
    if (data.roomId === props.roomId) {
      const idx = messages.value.findIndex(m => m.id === data.message.id)
      if (idx !== -1) messages.value[idx] = data.message
    }
  })

  socket.on('message_deleted', (data) => {
    if (data.roomId === props.roomId) {
      messages.value = messages.value.filter(m => m.id !== data.messageId)
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

onMounted(async () => {
  await fetchMessages()
  setupSocket()
  await nextTick()
  messagesContainer.value?.addEventListener('scroll', handleScroll)
  document.addEventListener('click', handleMsgMenuOutsideClick)
})

onUnmounted(() => {
  document.removeEventListener('click', handleMsgMenuOutsideClick)
  messagesContainer.value?.removeEventListener('scroll', handleScroll)
  cleanupSocket()
})

// If roomId changes, rejoin
watch(() => props.roomId, (newRoomId, oldRoomId) => {
  if (oldRoomId && socket && socket.connected) {
    socket.emit('leave_room', oldRoomId)
  }
  messages.value = []
  typingUsers.value = []
  hasOlderMessages.value = false
  isLoadingOlderMessages.value = false
  oldestMessageDate.value = null
  fetchMessages()
  if (socket && socket.connected) {
    socket.emit('join_room', newRoomId)
  }
})
</script>

<template>
  <div class="chat-widget">
    <div v-if="loading" class="loading">
      <LoadingSpinner size="small" /> Loading messages...
    </div>

    <div v-else-if="error" class="error">
      {{ error }}
    </div>

    <template v-else>
      <div ref="messagesContainer" class="messages">
        <div v-if="isLoadingOlderMessages" class="loading-older">
          <span class="loading-spinner"></span>
          Loading older messages...
        </div>

        <div v-else-if="hasOlderMessages" class="load-more-btn-wrapper">
          <button class="load-more-btn" @click="loadOlderMessages">
            ↑ Load older messages
          </button>
        </div>

        <div v-if="messages.length === 0" class="no-messages">
          No messages yet. Start the conversation!
        </div>

        <div
          v-for="msg in messages"
          :key="msg.id"
          class="message"
        >
          <div class="message-header">
            <RouterLink :to="`/user/${msg.handle}`" class="username">{{ msg.handle }}</RouterLink>
            <div class="msg-header-right">
              <span class="time">{{ formatTime(msg.created_at) }}</span>
              <div class="msg-menu-wrapper" @click.stop>
                <button class="msg-menu-btn" @click="toggleMsgMenu(msg.id)" title="Message options">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
                </button>
                <div v-if="openMenuId === msg.id" class="msg-dropdown">
                  <template v-if="isOwnMessage(msg.handle)">
                    <button v-if="msg.message" class="msg-dropdown-item" @click="startEdit(msg); openMenuId = null">Edit</button>
                    <button class="msg-dropdown-item danger" @click="deletingMessageId = msg.id; openMenuId = null">Delete</button>
                  </template>
                  <template v-else>
                    <button class="msg-dropdown-item danger" @click="flaggingMessageId = msg.id; openMenuId = null">Report</button>
                    <button class="msg-dropdown-item danger" @click="blockUser(msg); openMenuId = null">{{ moderationStore.isBlocked(msg.user_id) ? 'Unblock User' : 'Block User' }}</button>
                  </template>
                </div>
              </div>
            </div>
          </div>
          <div v-if="deletingMessageId === msg.id" class="delete-confirm-bar">
            Delete this message?
            <button @click="confirmDelete(msg.id)" class="delete-confirm-yes">Yes, delete</button>
            <button @click="deletingMessageId = null" class="delete-confirm-no">Cancel</button>
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
          <div v-if="msg.message" class="message-content">
            <template v-if="editingMessageId === msg.id">
              <input
                v-model="editText"
                @keyup.enter="saveEdit(msg.id)"
                @keyup.escape="cancelEdit"
                class="edit-input"
                maxlength="1000"
                autofocus
              />
              <div class="edit-actions">
                <button @click="saveEdit(msg.id)" class="edit-save-btn">Save</button>
                <button @click="cancelEdit" class="edit-cancel-btn">Cancel</button>
              </div>
            </template>
            <template v-else>{{ msg.message }}</template>
          </div>
          <FlagDialog
            :visible="flaggingMessageId === msg.id"
            content-type="chat_message"
            :content-id="msg.id"
            @close="flaggingMessageId = null"
            @flagged="flaggingMessageId = null"
          />
        </div>
      </div>

      <div v-if="typingUsers.length > 0" class="typing-indicator">
        {{ typingUsers.join(', ') }} {{ typingUsers.length === 1 ? 'is' : 'are' }} typing...
      </div>

      <div class="input-wrapper">
        <!-- Attachment menu popup -->
        <div v-if="showAttachMenu" class="attach-menu" :style="attachMenuStyle">
          <button
            type="button"
            class="attach-option"
            @click="triggerImageUpload(); closeAttachMenu()"
            :disabled="uploadingImage"
          >
            <span class="attach-icon">🖼️</span>
            <span>Image</span>
          </button>
          <button
            type="button"
            class="attach-option"
            @click="triggerVideoUpload(); closeAttachMenu()"
            :disabled="uploadingVideo"
          >
            <span class="attach-icon">🎬</span>
            <span>Video</span>
          </button>
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
            ref="attachBtnRef"
            type="button"
            class="attach-btn"
            @click="toggleAttachMenu"
            :class="{ active: showAttachMenu }"
            title="Add attachment"
          >
            <span v-if="uploadingImage || uploadingVideo" class="uploading">...</span>
            <span v-else class="plus-icon">+</span>
          </button>
          <input
            v-model="newMessage"
            type="text"
            placeholder="Type a message..."
            maxlength="2000"
            @input="onInput"
            @focus="closeAttachMenu"
          />
          <button type="submit" class="send-btn" :disabled="!newMessage.trim()">
            Send
          </button>
        </form>
      </div>
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
  gap: 10px;
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
  padding: var(--card-padding-compact);
  border-radius: var(--card-radius-sm);
  box-shadow: var(--shadow-sm);
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.msg-header-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.username {
  font-weight: 600;
  font-size: 0.8rem;
  color: var(--color-link);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-decoration: none;
}

.username:hover {
  text-decoration: underline;
}

.time {
  font-size: 0.7rem;
  color: var(--color-text-light);
  white-space: nowrap;
}

.msg-menu-wrapper {
  position: relative;
}

.msg-menu-btn {
  background: none;
  border: none;
  padding: 1px 2px;
  cursor: pointer;
  color: var(--color-text-muted);
  opacity: 0;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  border-radius: 3px;
  transition: opacity 0.15s;
}

.message:hover .msg-menu-btn {
  opacity: 0.45;
}

.msg-menu-btn:hover {
  opacity: 1 !important;
  background: var(--color-background-hover);
}

.msg-dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 2px);
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  min-width: 110px;
  z-index: 100;
  overflow: hidden;
}

.msg-dropdown-item {
  display: block;
  width: 100%;
  padding: 7px 12px;
  background: none;
  border: none;
  text-align: left;
  font-size: 0.82em;
  color: var(--color-text);
  cursor: pointer;
  white-space: nowrap;
}

.msg-dropdown-item:hover {
  background: var(--color-background-hover);
}

.msg-dropdown-item.danger {
  color: var(--color-error, #ff3b30);
}

.msg-dropdown-item.danger:hover {
  background: var(--color-error-bg, rgba(255, 59, 48, 0.08));
}

.delete-confirm-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75em;
  color: var(--color-error, #ff3b30);
  margin-bottom: 4px;
  flex-wrap: wrap;
}

.delete-confirm-yes {
  padding: 1px 8px;
  background: var(--color-error, #ff3b30);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9em;
}

.delete-confirm-yes:hover {
  opacity: 0.85;
}

.delete-confirm-no {
  padding: 1px 8px;
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9em;
  color: var(--color-text);
}

.delete-confirm-no:hover {
  background: var(--color-background-hover);
}

.edit-input {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--color-accent);
  border-radius: 6px;
  font-size: inherit;
  background: var(--color-background-input);
  color: var(--color-text);
  outline: none;
  box-sizing: border-box;
}

.edit-actions {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.edit-save-btn {
  padding: 2px 10px;
  background: var(--color-accent);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85em;
}

.edit-save-btn:hover {
  background: var(--color-accent-hover);
}

.edit-cancel-btn {
  padding: 2px 10px;
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85em;
  color: var(--color-text);
}

.edit-cancel-btn:hover {
  background: var(--color-background-hover);
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

.input-wrapper {
  position: relative;
  background: var(--color-background-card);
  border-top: 1px solid var(--color-border);
}

.input-area {
  display: flex;
  gap: 6px;
  padding: 8px;
  align-items: center;
}

.input-area input[type="text"] {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 0.85rem;
  background: var(--color-background-input);
  color: var(--color-text);
}

.input-area input[type="text"]:focus {
  outline: none;
  border-color: var(--color-accent);
}

.attach-btn {
  width: 32px;
  height: 32px;
  padding: 0;
  background: var(--color-button-secondary);
  color: var(--color-text);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  font-size: 1.2em;
  font-weight: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: transform 0.2s ease, background-color 0.2s ease;
}

.attach-btn:hover:not(:disabled) {
  background: var(--color-button-secondary-hover);
}

.attach-btn.active {
  background: var(--color-accent);
  color: white;
  transform: rotate(45deg);
}

.attach-btn:disabled {
  background: var(--color-button-disabled);
  cursor: not-allowed;
}

.attach-btn .plus-icon {
  line-height: 1;
}

.attach-btn .uploading {
  font-size: 0.7em;
}

.send-btn {
  padding: 8px 12px;
  background: var(--color-accent);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  flex-shrink: 0;
}

.send-btn:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.send-btn:disabled {
  background: var(--color-button-disabled);
  cursor: not-allowed;
}

.attach-menu {
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  padding: 6px;
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}

.attach-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 14px;
  background: var(--color-background-soft);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  color: var(--color-text);
  font-size: 0.75rem;
  transition: background-color 0.15s ease;
}

.attach-option:hover:not(:disabled) {
  background: var(--color-background-hover);
}

.attach-option:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.attach-icon {
  font-size: 1.2em;
}

.loading-older {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.loading-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.load-more-btn-wrapper {
  display: flex;
  justify-content: center;
  padding: 6px 0;
}

.load-more-btn {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 3px 12px;
  font-size: 0.75em;
  color: var(--color-text-muted);
  cursor: pointer;
}

.load-more-btn:hover {
  background: var(--color-background-mute);
  color: var(--color-text);
}
</style>
