<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { chat } from '@/stores/chat.js'
import { user } from '@/stores/user.js'
import ChatSidebar from '@/components/ChatSidebar.vue'

const messageInput = ref('')
const messagesContainer = ref(null)
const typingTimeout = ref(null)
const imageInput = ref(null)
const uploadingImage = ref(false)
const videoInput = ref(null)
const uploadingVideo = ref(false)
const showAttachMenu = ref(false)

const toggleAttachMenu = () => {
  showAttachMenu.value = !showAttachMenu.value
}

const closeAttachMenu = () => {
  showAttachMenu.value = false
}

// Mobile view state
const isMobile = ref(false)
const showMobileChat = ref(false)

const checkMobile = () => {
  isMobile.value = window.innerWidth <= 768
}

const openMobileChat = () => {
  showMobileChat.value = true
}

const closeMobileChat = () => {
  showMobileChat.value = false
}

// Get current room info
const currentRoom = computed(() => {
  return chat.rooms.find(r => r.id === chat.currentRoom)
})

const currentRoomName = computed(() => {
  return currentRoom.value ? currentRoom.value.name : 'Chat'
})

const currentRoomDescription = computed(() => {
  return currentRoom.value ? currentRoom.value.description : null
})

// Auto-scroll to bottom when new messages arrive
const scrollToBottom = () => {
  const doScroll = () => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  }

  // Use nextTick + delay to ensure DOM is fully updated
  nextTick(() => {
    setTimeout(doScroll, 100)
  })
}

// Watch for new messages (length change = new message added)
watch(() => chat.messages.length, () => {
  scrollToBottom()
}, { flush: 'post' })

// Watch for messages array replacement (happens when joining/switching rooms)
watch(() => chat.messages, () => {
  scrollToBottom()
}, { flush: 'post' })

// Watch for mobile chat becoming visible - need to scroll after it's shown
watch(showMobileChat, (isVisible) => {
  if (isVisible) {
    scrollToBottom()
  }
})

// Handle sending a message
const sendMessage = () => {
  if (messageInput.value.trim()) {
    chat.sendMessage(messageInput.value)
    messageInput.value = ''
    chat.stopTyping()
  }
}

// Handle typing indicator
const handleTyping = () => {
  chat.startTyping()

  // Clear existing timeout
  if (typingTimeout.value) {
    clearTimeout(typingTimeout.value)
  }

  // Stop typing after 2 seconds of no input
  typingTimeout.value = setTimeout(() => {
    chat.stopTyping()
  }, 2000)
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

// Check if message is from current user
const isOwnMessage = (handle) => {
  return handle === user.username
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

  if (!chat.currentRoom) {
    chat.error = 'Please join a room first'
    return
  }

  uploadingImage.value = true

  const formData = new FormData()
  formData.append('image', file)

  try {
    const res = await fetch(`/api/chat/rooms/${chat.currentRoom}/image`, {
      method: 'POST',
      credentials: 'include',
      body: formData
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.message || 'Failed to upload image')
    }

    // Message will be received via socket
  } catch (err) {
    console.error('Error uploading image:', err)
    chat.error = err.message
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

  if (!chat.currentRoom) {
    chat.error = 'Please join a room first'
    return
  }

  uploadingVideo.value = true

  const formData = new FormData()
  formData.append('video', file)

  try {
    const res = await fetch(`/api/chat/rooms/${chat.currentRoom}/video`, {
      method: 'POST',
      credentials: 'include',
      body: formData
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.message || 'Failed to upload video')
    }

    // Message will be received via socket
  } catch (err) {
    console.error('Error uploading video:', err)
    chat.error = err.message
  } finally {
    uploadingVideo.value = false
    event.target.value = ''
  }
}

onMounted(async () => {
  // Check mobile on mount and listen for resize
  checkMobile()
  window.addEventListener('resize', checkMobile)

  // Connect to socket
  chat.connect()

  // Fetch user info and permissions
  await Promise.all([
    chat.fetchCurrentUser(),
    chat.checkCreatePermission()
  ])

  // Fetch rooms and join the General room (id=1)
  await chat.fetchRooms()
  if (chat.rooms.length > 0) {
    await chat.joinRoom(chat.rooms[0].id)
    scrollToBottom()
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
  chat.leaveRoom()
  chat.disconnect()
})
</script>

<template>
  <main class="chat-page page-container" :class="{ 'mobile-view': isMobile }">
    <div class="chat-layout">
      <ChatSidebar
        :class="{ 'mobile-hidden': isMobile && showMobileChat }"
        @room-selected="openMobileChat"
      />
      <div class="chat-container" :class="{ 'mobile-hidden': isMobile && !showMobileChat }">
        <div class="chat-header">
          <button
            v-if="isMobile"
            class="back-btn"
            @click="closeMobileChat"
          >
            &larr; Rooms
          </button>
          <div class="room-info">
            <h2># {{ currentRoomName }}</h2>
            <p v-if="currentRoomDescription" class="room-description">{{ currentRoomDescription }}</p>
          </div>
          <span class="connection-status" :class="{ connected: chat.connected }">
            {{ chat.connected ? 'Connected' : 'Disconnected' }}
          </span>
        </div>

      <div class="messages-container" ref="messagesContainer">
        <div v-if="chat.messages.length === 0" class="no-messages">
          No messages yet. Start the conversation!
        </div>

        <div
          v-for="msg in chat.messages"
          :key="msg.id"
          class="message"
          :class="{ own: isOwnMessage(msg.handle) }"
        >
          <div class="message-header">
            <span class="message-author">{{ msg.handle }}</span>
            <span class="message-time">{{ formatTime(msg.created_at) }}</span>
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

      <div v-if="chat.typingUsers.length > 0" class="typing-indicator">
        {{ chat.typingUsers.join(', ') }} {{ chat.typingUsers.length === 1 ? 'is' : 'are' }} typing...
      </div>

      <div class="message-input-wrapper">
        <!-- Attachment menu popup -->
        <div v-if="showAttachMenu" class="attach-menu">
          <button
            type="button"
            class="attach-option"
            @click="triggerImageUpload(); closeAttachMenu()"
            :disabled="!chat.connected || uploadingImage"
          >
            <span class="attach-icon">🖼️</span>
            <span>Image</span>
          </button>
          <button
            type="button"
            class="attach-option"
            @click="triggerVideoUpload(); closeAttachMenu()"
            :disabled="!chat.connected || uploadingVideo"
          >
            <span class="attach-icon">🎬</span>
            <span>Video</span>
          </button>
        </div>

        <div class="message-input-container">
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
            class="attach-btn"
            @click="toggleAttachMenu"
            :disabled="!chat.connected"
            :class="{ active: showAttachMenu }"
            title="Add attachment"
          >
            <span v-if="uploadingImage || uploadingVideo" class="uploading">...</span>
            <span v-else class="plus-icon">+</span>
          </button>
          <input
            v-model="messageInput"
            @keyup.enter="sendMessage"
            @input="handleTyping"
            @focus="closeAttachMenu"
            type="text"
            placeholder="Type a message..."
            maxlength="1000"
            :disabled="!chat.connected"
          />
          <button class="send-btn" @click="sendMessage" :disabled="!chat.connected || !messageInput.trim()">
            Send
          </button>
        </div>
      </div>

      <div v-if="chat.error" class="error-message">
        {{ chat.error }}
        <button @click="chat.clearError" class="dismiss-btn">Dismiss</button>
      </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.chat-page {
  max-width: 1200px;
  margin: 20px auto;
  padding: 0 20px;
}

.chat-layout {
  display: flex;
  height: calc(100vh - 120px);
  min-height: 500px;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: var(--shadow-md);
}

.chat-container {
  flex: 1;
  background: var(--color-background-card);
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 20px;
  border-bottom: 1px solid var(--color-border);
}

.chat-header h2 {
  margin: 0;
  color: var(--color-text);
}

.room-description {
  margin: 4px 0 0 0;
  font-size: 0.85em;
  color: var(--color-text-muted);
}

.connection-status {
  font-size: 0.8em;
  padding: 4px 10px;
  border-radius: 12px;
  background: var(--color-error);
  color: white;
}

.connection-status.connected {
  background: var(--color-success);
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.no-messages {
  text-align: center;
  color: var(--color-text-light);
  margin-top: 40px;
}

.message {
  max-width: 70%;
  padding: 10px 15px;
  border-radius: 15px;
  background: var(--color-background-soft);
  align-self: flex-start;
  color: var(--color-text);
}

.message.own {
  background: var(--color-accent);
  color: white;
  align-self: flex-end;
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
  font-size: 0.75em;
  opacity: 0.8;
}

.message-author {
  font-weight: bold;
}

.message-time {
  margin-left: 10px;
}

.message-content {
  word-wrap: break-word;
  line-height: 1.4;
}

.message-image {
  margin: 6px 0;
}

.message-image img {
  max-width: 100%;
  max-height: 300px;
  border-radius: 8px;
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
  max-height: 300px;
  border-radius: 8px;
}

.typing-indicator {
  padding: 5px 20px;
  font-size: 0.85em;
  color: var(--color-text-light);
  font-style: italic;
}

.message-input-wrapper {
  position: relative;
  border-top: 1px solid var(--color-border);
}

.message-input-container {
  display: flex;
  padding: 12px;
  gap: 8px;
  align-items: center;
}

.message-input-container input[type="text"] {
  flex: 1;
  min-width: 0;
  padding: 10px 15px;
  border: 1px solid var(--color-border);
  border-radius: 25px;
  font-size: 1em;
  outline: none;
  background: var(--color-background-input);
  color: var(--color-text);
}

.message-input-container input[type="text"]:focus {
  border-color: var(--color-accent);
}

.message-input-container input[type="text"]:disabled {
  background: var(--color-background-soft);
}

.hidden-input {
  display: none;
}

.attach-btn {
  width: 42px;
  height: 42px;
  padding: 0;
  background: var(--color-button-secondary);
  color: var(--color-text);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  font-size: 1.5em;
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
  font-size: 0.8em;
}

.send-btn {
  padding: 10px 20px;
  background: var(--color-accent);
  color: white;
  border: none;
  border-radius: 25px;
  cursor: pointer;
  font-size: 0.95em;
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
  position: absolute;
  bottom: 100%;
  left: 12px;
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  padding: 8px;
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
  z-index: 10;
}

.attach-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 20px;
  background: var(--color-background-soft);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  color: var(--color-text);
  font-size: 0.85em;
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
  font-size: 1.5em;
}

.error-message {
  padding: 10px 20px;
  background: var(--color-error-bg);
  color: var(--color-error);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.9em;
}

.dismiss-btn {
  background: none;
  border: none;
  color: var(--color-error);
  cursor: pointer;
  text-decoration: underline;
}

/* Mobile styles */
.back-btn {
  background: var(--color-button-secondary);
  color: var(--color-text);
  border: none;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9em;
  margin-right: 10px;
  flex-shrink: 0;
}

.back-btn:hover {
  background: var(--color-button-secondary-hover);
}

@media (max-width: 768px) {
  .chat-page {
    padding: 0 10px;
    margin: 10px auto;
  }

  .chat-layout {
    height: calc(100vh - 80px);
  }

  .mobile-hidden {
    display: none !important;
  }

  .chat-page.mobile-view .chat-sidebar {
    width: 100%;
  }

  .chat-page.mobile-view .chat-container {
    width: 100%;
  }

  .chat-header {
    padding: 10px 15px;
  }

  .chat-header h2 {
    font-size: 1.1rem;
  }

  .message-input-container {
    padding: 8px;
    gap: 6px;
  }

  .message-input-container input[type="text"] {
    padding: 8px 12px;
    font-size: 0.95em;
  }

  .attach-btn {
    width: 38px;
    height: 38px;
    font-size: 1.3em;
  }

  .send-btn {
    padding: 8px 14px;
    font-size: 0.9em;
  }

  .attach-menu {
    left: 8px;
  }

  .attach-option {
    padding: 10px 16px;
  }

  .message {
    max-width: 85%;
  }
}
</style>
