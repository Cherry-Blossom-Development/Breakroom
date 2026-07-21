<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { io } from 'socket.io-client'
import LoadingSpinner from './LoadingSpinner.vue'
import FlagDialog from './FlagDialog.vue'
import ImageLightbox from './ImageLightbox.vue'
import { user } from '@/stores/user.js'
import { moderationStore } from '@/stores/moderation.js'
import { chat } from '@/stores/chat.js'
import { renderMessage } from '@/utilities/linkify.js'

const emit = defineEmits(['new-message'])

// ── State ────────────────────────────────────────────────────────────────────

// rooms sorted oldest-last-message → newest-last-message (left = old, right = new)
const rooms          = ref([])
const currentRoomId  = ref(null)
const messages       = ref([])
const newMessage     = ref('')
const typingUsers    = ref([])
const loading        = ref(true)
const loadingMsgs    = ref(false)
const error          = ref(null)
const messagesEl     = ref(null)
const imageInput     = ref(null)
const videoInput     = ref(null)
const attachBtnRef   = ref(null)
const messageInputEl = ref(null)
const uploadingImage = ref(false)
const uploadingVideo = ref(false)
const showAttachMenu = ref(false)
const attachMenuStyle = ref({})
const hasOlderMessages = ref(false)
const isLoadingOlderMessages = ref(false)
const oldestMessageDate = ref(null)
const isPrepending   = ref(false)
const isMuted        = ref(false)
const flashingMessageIds = ref(new Set())
const rightGlowing   = ref(false)

const flaggingMessageId  = ref(null)
const editingMessageId   = ref(null)
const editText           = ref('')
const editInputEl        = ref(null)
const deletingMessageId  = ref(null)
const openMenuId         = ref(null)

// @mention state
const mentionQuery   = ref('')
const mentionResults = ref([])
const mentionActive  = ref(false)
const mentionIndex   = ref(0)
let mentionDebounce = null

let socket = null
let typingTimeout = null
let glowTimer = null
let muteTimeout = null

// ── Derived ──────────────────────────────────────────────────────────────────

const currentRoom = computed(() =>
  rooms.value.find(r => r.room_id === currentRoomId.value) ?? null
)
const currentIdx = computed(() =>
  rooms.value.findIndex(r => r.room_id === currentRoomId.value)
)
const canLeft  = computed(() => currentIdx.value > 0)
const canRight = computed(() => currentIdx.value < rooms.value.length - 1)
const posLabel = computed(() =>
  rooms.value.length > 0 ? `${currentIdx.value + 1} / ${rooms.value.length}` : ''
)

// ── Data loading ─────────────────────────────────────────────────────────────

async function fetchRooms() {
  loading.value = true
  error.value = null
  try {
    const res = await fetch('/api/chat/rooms/recent', { credentials: 'include' })
    if (!res.ok) throw new Error('Failed to load rooms')
    const data = await res.json()  // ASC by last-message time — left=oldest, right=newest
    rooms.value = data
    if (data.length > 0) {
      // Default to the most-recently-active room (rightmost)
      currentRoomId.value = data[data.length - 1].room_id
      await loadMessages(currentRoomId.value)
    }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function loadMessages(roomId) {
  loadingMsgs.value = true
  messages.value = []
  typingUsers.value = []
  hasOlderMessages.value = false
  isLoadingOlderMessages.value = false
  oldestMessageDate.value = null
  try {
    const res = await fetch(`/api/chat/rooms/${roomId}/messages?limit=50`, { credentials: 'include' })
    if (!res.ok) throw new Error('Failed to load messages')
    const data = await res.json()
    messages.value = data.messages ?? []
    hasOlderMessages.value = data.hasMore ?? false
    oldestMessageDate.value = messages.value.length > 0 ? messages.value[0].created_at : null
    scrollToBottom()
  } catch (e) {
    error.value = e.message
  } finally {
    loadingMsgs.value = false
  }
}

async function fetchOlderMessages() {
  if (isLoadingOlderMessages.value || !hasOlderMessages.value || !oldestMessageDate.value) return
  const roomId = currentRoomId.value
  isLoadingOlderMessages.value = true
  try {
    const res = await fetch(
      `/api/chat/rooms/${roomId}/messages?limit=50&before=${encodeURIComponent(oldestMessageDate.value)}`,
      { credentials: 'include' }
    )
    if (!res.ok) throw new Error('Failed to load older messages')
    const data = await res.json()
    hasOlderMessages.value = data.hasMore ?? false
    if (data.messages?.length > 0) {
      oldestMessageDate.value = data.messages[0].created_at
      messages.value = [...data.messages, ...messages.value]
    }
  } finally {
    isLoadingOlderMessages.value = false
  }
}

async function fetchMuteState(roomId) {
  try {
    const res = await fetch(`/api/chat/rooms/${roomId}/mute`, { credentials: 'include' })
    if (res.ok) isMuted.value = (await res.json()).muted
  } catch {}
}

// ── Carousel navigation ───────────────────────────────────────────────────────

async function goLeft() {
  if (!canLeft.value) return
  const room = rooms.value[currentIdx.value - 1]
  currentRoomId.value = room.room_id
  await loadMessages(room.room_id)
  await fetchMuteState(room.room_id)
}

async function goRight() {
  if (!canRight.value) return
  const room = rooms.value[currentIdx.value + 1]
  currentRoomId.value = room.room_id
  await loadMessages(room.room_id)
  await fetchMuteState(room.room_id)
}

// ── Actions ───────────────────────────────────────────────────────────────────

const isOwnMessage = (handle) => handle === user.username

const startEdit = (msg) => {
  editingMessageId.value = msg.id
  editText.value = msg.message
  deletingMessageId.value = null
  nextTick(() => {
    const el = editInputEl.value
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 200) + 'px'; el.focus() }
  })
}
const cancelEdit = () => { editingMessageId.value = null; editText.value = '' }

const handleEditInput = () => {
  const el = editInputEl.value
  if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 200) + 'px' }
}

async function saveEdit(messageId) {
  const text = editText.value.trim()
  if (!text) return
  try {
    const res = await fetch(`/api/chat/rooms/${currentRoomId.value}/messages/${messageId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ message: text })
    })
    if (!res.ok) throw new Error('Failed to edit message')
    cancelEdit()
  } catch (err) { error.value = err.message }
}

async function confirmDelete(messageId) {
  deletingMessageId.value = null
  try {
    const res = await fetch(`/api/chat/rooms/${currentRoomId.value}/messages/${messageId}`, {
      method: 'DELETE', credentials: 'include'
    })
    if (!res.ok) throw new Error('Failed to delete message')
  } catch (err) { error.value = err.message }
}

async function blockUser(msg) {
  if (!msg.user_id) return
  if (moderationStore.isBlocked(msg.user_id)) {
    const res = await fetch(`/api/moderation/block/${msg.user_id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) moderationStore.removeBlock(msg.user_id)
  } else {
    const res = await fetch(`/api/moderation/block/${msg.user_id}`, { method: 'POST', credentials: 'include' })
    if (res.ok) moderationStore.addBlock(msg.user_id)
  }
}

async function toggleMute() {
  const newMuted = !isMuted.value
  try {
    const res = await fetch(`/api/chat/rooms/${currentRoomId.value}/mute`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ muted: newMuted })
    })
    if (res.ok) isMuted.value = newMuted
  } catch {}
}

async function sendMessage() {
  if (mentionActive.value) return
  const text = newMessage.value.trim()
  if (!text || !currentRoomId.value) return
  newMessage.value = ''
  if (socket?.connected) {
    socket.emit('typing_stop', currentRoomId.value)
    socket.emit('send_message', { roomId: currentRoomId.value, message: text })
  } else {
    try {
      const res = await fetch(`/api/chat/rooms/${currentRoomId.value}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: text })
      })
      if (res.ok) {
        const data = await res.json()
        if (!messages.value.some(m => m.id === data.message.id)) {
          messages.value.push(data.message)
          scrollToBottom()
        }
      }
    } catch {}
  }
}

const toggleMsgMenu = (id) => { openMenuId.value = openMenuId.value === id ? null : id }
const closeMsgMenu  = (e) => { if (!e.target.closest('.msg-menu-wrapper')) openMenuId.value = null }

// ── Attachments ───────────────────────────────────────────────────────────────

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

async function onImageSelected(event) {
  const file = event.target.files[0]
  if (!file) return
  uploadingImage.value = true
  liveAnnouncement.value = 'Uploading image'
  const formData = new FormData()
  formData.append('image', file)
  try {
    const res = await fetch(`/api/chat/rooms/${currentRoomId.value}/image`, {
      method: 'POST', credentials: 'include', body: formData
    })
    if (!res.ok) throw new Error('Upload failed')
    liveAnnouncement.value = 'Image sent'
    if (!socket?.connected) {
      const data = await res.json()
      if (!messages.value.some(m => m.id === data.message.id)) {
        messages.value.push(data.message)
        scrollToBottom()
      }
    }
  } catch {
    liveAnnouncement.value = 'Upload failed'
  } finally { uploadingImage.value = false; event.target.value = '' }
}

async function onVideoSelected(event) {
  const file = event.target.files[0]
  if (!file) return
  uploadingVideo.value = true
  liveAnnouncement.value = 'Uploading video'
  const formData = new FormData()
  formData.append('video', file)
  try {
    const res = await fetch(`/api/chat/rooms/${currentRoomId.value}/video`, {
      method: 'POST', credentials: 'include', body: formData
    })
    if (!res.ok) throw new Error('Upload failed')
    liveAnnouncement.value = 'Video sent'
    if (!socket?.connected) {
      const data = await res.json()
      if (!messages.value.some(m => m.id === data.message.id)) {
        messages.value.push(data.message)
        scrollToBottom()
      }
    }
  } catch {
    liveAnnouncement.value = 'Upload failed'
  } finally { uploadingVideo.value = false; event.target.value = '' }
}

// ── @mention ──────────────────────────────────────────────────────────────────

const closeMention = () => {
  mentionActive.value = false; mentionResults.value = []; mentionQuery.value = ''; mentionIndex.value = 0
}
const selectMention = (u) => {
  if (!u) return
  const atPos = newMessage.value.lastIndexOf('@')
  newMessage.value = newMessage.value.substring(0, atPos) + '@' + u.handle + ' '
  closeMention()
  nextTick(() => messageInputEl.value?.focus())
}
const handleMentionKeydown = (e) => {
  if (!mentionActive.value) return
  if (e.key === 'ArrowDown') { e.preventDefault(); mentionIndex.value = (mentionIndex.value + 1) % mentionResults.value.length }
  else if (e.key === 'ArrowUp') { e.preventDefault(); mentionIndex.value = (mentionIndex.value - 1 + mentionResults.value.length) % mentionResults.value.length }
  else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectMention(mentionResults.value[mentionIndex.value]) }
  else if (e.key === 'Escape') closeMention()
}
const onInput = () => {
  if (socket?.connected) {
    socket.emit('typing_start', currentRoomId.value)
    if (typingTimeout) clearTimeout(typingTimeout)
    typingTimeout = setTimeout(() => socket?.connected && socket.emit('typing_stop', currentRoomId.value), 2000)
  }
  const val = newMessage.value
  const atPos = val.lastIndexOf('@')
  if (atPos !== -1) {
    const after = val.substring(atPos + 1)
    if (/^\w{0,30}$/.test(after)) {
      mentionQuery.value = after; mentionIndex.value = 0
      clearTimeout(mentionDebounce)
      mentionDebounce = setTimeout(async () => {
        mentionResults.value = await chat.searchMentions(after)
        mentionActive.value = mentionResults.value.length > 0
      }, after.length === 0 ? 0 : 150)
      return
    }
  }
  closeMention()
}

// ── Scroll ────────────────────────────────────────────────────────────────────

const scrollToBottom = () => {
  nextTick(() => setTimeout(() => {
    if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
  }, 50))
}

const handleScroll = async () => {
  if (!messagesEl.value || !hasOlderMessages.value || isLoadingOlderMessages.value) return
  if (messagesEl.value.scrollTop > 100) return
  const prevScrollHeight = messagesEl.value.scrollHeight
  isPrepending.value = true
  await fetchOlderMessages()
  await nextTick()
  messagesEl.value.scrollTop = messagesEl.value.scrollHeight - prevScrollHeight
  isPrepending.value = false
}

// ── Glow ──────────────────────────────────────────────────────────────────────

function triggerRightGlow() {
  if (glowTimer) clearTimeout(glowTimer)
  rightGlowing.value = true
  glowTimer = setTimeout(() => { rightGlowing.value = false; glowTimer = null }, 2000)
}

// ── Socket ────────────────────────────────────────────────────────────────────

function setupSocket() {
  const baseUrl = import.meta.env.VITE_API_BASE_URL || ''
  socket = io(baseUrl, { withCredentials: true, autoConnect: true })

  socket.on('connect', () => {
    rooms.value.forEach(r => socket.emit('join_room', r.room_id))
  })

  socket.on('new_message', (data) => {
    const roomIdx = rooms.value.findIndex(r => r.room_id === data.roomId)
    if (roomIdx === -1) return

    const wasAtEnd = roomIdx === rooms.value.length - 1
    const isCurrent = data.roomId === currentRoomId.value

    // Re-sort: move this room to the rightmost position
    const updatedRoom = { ...rooms.value[roomIdx], created_at: data.message.created_at }
    const newRooms = rooms.value.filter((_, i) => i !== roomIdx)
    newRooms.push(updatedRoom)
    rooms.value = newRooms

    // Glow the right arrow if a different room moved up in the order
    if (!isCurrent && !wasAtEnd) {
      triggerRightGlow()
    }

    if (isCurrent) {
      if (!messages.value.some(m => m.id === data.message.id)) {
        messages.value.push(data.message)
        scrollToBottom()
        if (data.message.handle !== user.username) {
          flashingMessageIds.value = new Set([...flashingMessageIds.value, data.message.id])
          setTimeout(() => {
            flashingMessageIds.value = new Set([...flashingMessageIds.value].filter(id => id !== data.message.id))
          }, 2000)
          liveAnnouncement.value = `New message from ${data.message.handle}: ${describeMessage(data.message)}`
        }
      }
    }

    if (data.message.handle !== user.username) emit('new-message')
  })

  socket.on('message_edited', (data) => {
    if (data.roomId !== currentRoomId.value) return
    const idx = messages.value.findIndex(m => m.id === data.message.id)
    if (idx !== -1) messages.value[idx] = data.message
  })

  socket.on('message_deleted', (data) => {
    if (data.roomId !== currentRoomId.value) return
    messages.value = messages.value.filter(m => m.id !== data.messageId)
  })

  socket.on('user_typing', (data) => {
    if (data.roomId !== currentRoomId.value) return
    if (data.user !== user.username && !typingUsers.value.includes(data.user)) typingUsers.value.push(data.user)
  })

  socket.on('user_stopped_typing', (data) => {
    if (data.roomId !== currentRoomId.value) return
    typingUsers.value = typingUsers.value.filter(u => u !== data.user)
  })
}

function cleanupSocket() {
  if (typingTimeout) clearTimeout(typingTimeout)
  if (socket) {
    rooms.value.forEach(r => socket.emit('leave_room', r.room_id))
    socket.disconnect()
    socket = null
  }
}

// ── Formatting ────────────────────────────────────────────────────────────────

const formatTime = (ts) => {
  const d = new Date(ts), now = new Date()
  const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return isToday ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}
const getImageUrl = (p) => p ? `/api/uploads/${p}` : null
const getVideoUrl = (p) => p ? `/api/uploads/${p}` : null

// Lightbox for viewing shared images full-size, in place
const lightboxSrc = ref(null)
const openLightbox = (src) => {
  lightboxSrc.value = src
}

// Screen-reader-only live region text
const liveAnnouncement = ref('')

function describeMessage(msg) {
  if (msg.message) {
    return msg.message.length > 50 ? msg.message.slice(0, 50) + '…' : msg.message
  }
  if (msg.image_path) return 'sent an image'
  if (msg.video_path) return 'sent a video'
  return 'sent a message'
}
// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(async () => {
  await fetchRooms()
  if (currentRoomId.value) await fetchMuteState(currentRoomId.value)
  setupSocket()
  await nextTick()
  messagesEl.value?.addEventListener('scroll', handleScroll)
  document.addEventListener('click', closeMsgMenu)
})

onUnmounted(() => {
  document.removeEventListener('click', closeMsgMenu)
  messagesEl.value?.removeEventListener('scroll', handleScroll)
  if (glowTimer) clearTimeout(glowTimer)
  cleanupSocket()
})
</script>

<template>
  <div class="chat-widget">

    <div v-if="loading" class="loading">
      <LoadingSpinner size="small" /> Loading rooms…
    </div>

    <div v-else-if="error" class="error">{{ error }}</div>

    <template v-else-if="rooms.length === 0">
      <div class="loading">No chat rooms available.</div>
    </template>

    <template v-else>

      <!-- Carousel sub-header -->
      <div class="ccw-nav">
        <button
          class="ccw-arrow"
          :disabled="!canLeft"
          @click="goLeft"
          aria-label="Previous room (older)"
        ><span aria-hidden="true">‹</span></button>
        <span class="ccw-room-name"># {{ currentRoom?.room_name ?? '…' }}</span>
        <span class="ccw-pos">{{ posLabel }}</span>
        <button
          class="ccw-arrow"
          :class="{ 'ccw-arrow--glow': rightGlowing }"
          :disabled="!canRight"
          @click="goRight"
          aria-label="Next room (newer)"
        ><span aria-hidden="true">›</span></button>
      </div>

      <!-- Messages -->
      <div v-if="loadingMsgs" class="loading">
        <LoadingSpinner size="small" /> Loading…
      </div>

      <template v-else>
        <div ref="messagesEl" class="messages">
          <div v-if="isLoadingOlderMessages" class="loading-older">
            <span class="loading-spinner"></span> Loading older messages…
          </div>
          <div v-else-if="hasOlderMessages" class="load-more-btn-wrapper">
            <button class="load-more-btn" @click="handleScroll">↑ Load older messages</button>
          </div>

          <div v-if="messages.length === 0" class="no-messages">
            No messages yet. Start the conversation!
          </div>

          <div
            v-for="msg in messages"
            :key="msg.id"
            class="message"
            :class="{ 'message-flash': flashingMessageIds.has(msg.id) }"
          >
            <div class="message-header">
              <RouterLink :to="`/user/${msg.handle}`" class="username">{{ msg.handle }}</RouterLink>
              <div class="msg-header-right">
                <span class="time">{{ formatTime(msg.created_at) }}</span>
                <div class="msg-menu-wrapper" @click.stop>
                  <button
                    class="msg-menu-btn"
                    @click="toggleMsgMenu(msg.id)"
                    aria-label="Message options"
                    aria-haspopup="true"
                    :aria-expanded="openMenuId === msg.id"
                  >
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
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
              <img
                :src="getImageUrl(msg.image_path)"
                :alt="isOwnMessage(msg.handle) ? 'Image you sent, tap to view full size' : `Image from ${msg.handle}, tap to view full size`"
                @click="openLightbox(getImageUrl(msg.image_path))"
              />
            </div>
            <div v-if="msg.video_path" class="message-video">
              <video controls :src="getVideoUrl(msg.video_path)">Your browser does not support video.</video>
            </div>
            <div v-if="msg.message" class="message-content">
              <template v-if="editingMessageId === msg.id">
                <textarea :ref="el => editInputEl = el" v-model="editText" @input="handleEditInput" @keydown.enter.exact.prevent="saveEdit(msg.id)" @keydown.escape="cancelEdit" class="edit-input" maxlength="1000" rows="1" />
                <div class="edit-actions">
                  <button @click="saveEdit(msg.id)" class="edit-save-btn">Save</button>
                  <button @click="cancelEdit" class="edit-cancel-btn">Cancel</button>
                </div>
              </template>
              <template v-else><span v-html="renderMessage(msg.message)"></span></template>
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
          {{ typingUsers.join(', ') }} {{ typingUsers.length === 1 ? 'is' : 'are' }} typing…
        </div>

        <div class="input-wrapper">
          <div v-if="showAttachMenu" class="attach-menu" :style="attachMenuStyle">
            <button type="button" class="attach-option" @click="imageInput.click(); showAttachMenu = false" :disabled="uploadingImage">
              <span class="attach-icon" aria-hidden="true">🖼️</span><span>Image</span>
            </button>
            <button type="button" class="attach-option" @click="videoInput.click(); showAttachMenu = false" :disabled="uploadingVideo">
              <span class="attach-icon" aria-hidden="true">🎬</span><span>Video</span>
            </button>
          </div>
          <form class="input-area" @submit.prevent="sendMessage">
            <input ref="imageInput" type="file" accept="image/*" class="hidden-input" @change="onImageSelected" />
            <input ref="videoInput" type="file" accept="video/*" class="hidden-input" @change="onVideoSelected" />
            <button
              ref="attachBtnRef"
              type="button"
              class="attach-btn"
              @click="toggleAttachMenu"
              :class="{ active: showAttachMenu }"
              :aria-label="uploadingImage || uploadingVideo ? 'Uploading attachment' : 'Add attachment'"
              aria-haspopup="true"
              :aria-expanded="showAttachMenu"
            >
              <span v-if="uploadingImage || uploadingVideo" class="uploading" aria-hidden="true">…</span>
              <span v-else class="plus-icon" aria-hidden="true">+</span>
            </button>
            <div class="mention-dropdown" v-if="mentionActive && mentionResults.length > 0">
              <div
                v-for="(u, i) in mentionResults" :key="u.id"
                class="mention-option" :class="{ active: i === mentionIndex }"
                @mousedown.prevent="selectMention(u)"
              >
                <span class="mention-option-handle">@{{ u.handle }}</span>
                <span v-if="u.first_name || u.last_name" class="mention-option-name">{{ u.first_name }} {{ u.last_name }}</span>
              </div>
            </div>
            <input
              ref="messageInputEl"
              v-model="newMessage"
              type="text"
              placeholder="Type a message…"
              maxlength="2000"
              @keydown="handleMentionKeydown"
              @input="onInput"
              @focus="showAttachMenu = false"
              @blur="closeMention"
            />
            <button type="submit" class="send-btn" :disabled="!newMessage.trim()">Send</button>
            <button
              type="button"
              class="mute-btn"
              :class="{ muted: isMuted }"
              @click="toggleMute"
              :aria-label="isMuted ? 'Unmute this room' : 'Mute this room'"
              :aria-pressed="isMuted"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <template v-if="isMuted">
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                  <path d="M18.63 13A17.9 17.9 0 0 1 18 8"/>
                  <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/>
                  <path d="M18 8a6 6 0 0 0-9.33-5"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </template>
                <template v-else>
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </template>
              </svg>
            </button>
          </form>
        </div>
      </template>
    </template>

    <ImageLightbox :visible="!!lightboxSrc" :src="lightboxSrc" alt="Shared image" @close="lightboxSrc = null" />

    <div class="sr-only" aria-live="polite" role="status">{{ liveAnnouncement }}</div>
  </div>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* ── Base (same as ChatWidget) ── */
.chat-widget {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-background-soft);
}

.loading, .error {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--color-text-light);
  font-size: 0.9rem;
  padding: 20px;
}
.error { color: var(--color-error); }

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
.username:hover { text-decoration: underline; }

.time {
  font-size: 0.7rem;
  color: var(--color-text-light);
  white-space: nowrap;
}

.msg-menu-wrapper { position: relative; }
.msg-menu-btn {
  background: none; border: none; padding: 1px 2px; cursor: pointer;
  color: var(--color-text-muted); opacity: 0; line-height: 1;
  display: inline-flex; align-items: center; border-radius: 3px; transition: opacity 0.15s;
}
.message:hover .msg-menu-btn { opacity: 0.45; }
.msg-menu-btn:hover { opacity: 1 !important; background: var(--color-background-hover); }

.msg-dropdown {
  position: absolute; right: 0; top: calc(100% + 2px);
  background: var(--color-background-card); border: 1px solid var(--color-border);
  border-radius: 8px; box-shadow: var(--shadow-lg); min-width: 110px; z-index: 100; overflow: hidden;
}
.msg-dropdown-item {
  display: block; width: 100%; padding: 7px 12px; background: none; border: none;
  text-align: left; font-size: 0.82em; color: var(--color-text); cursor: pointer; white-space: nowrap;
}
.msg-dropdown-item:hover { background: var(--color-background-hover); }
.msg-dropdown-item.danger { color: var(--color-error, #ff3b30); }
.msg-dropdown-item.danger:hover { background: var(--color-error-bg, rgba(255,59,48,0.08)); }

.delete-confirm-bar {
  display: flex; align-items: center; gap: 6px; font-size: 0.75em;
  color: var(--color-error, #ff3b30); margin-bottom: 4px; flex-wrap: wrap;
}
.delete-confirm-yes {
  padding: 1px 8px; background: var(--color-error, #ff3b30); color: white;
  border: none; border-radius: 4px; cursor: pointer; font-size: 0.9em;
}
.delete-confirm-yes:hover { opacity: 0.85; }
.delete-confirm-no {
  padding: 1px 8px; background: none; border: 1px solid var(--color-border);
  border-radius: 4px; cursor: pointer; font-size: 0.9em; color: var(--color-text);
}
.delete-confirm-no:hover { background: var(--color-background-hover); }

.edit-input {
  width: 100%; padding: 4px 8px; border: 1px solid var(--color-accent);
  border-radius: 6px; font-size: inherit; font-family: inherit; line-height: 1.4;
  background: var(--color-background-input);
  color: var(--color-text); outline: none; box-sizing: border-box;
  resize: none; overflow-y: auto; max-height: 200px;
  white-space: pre-wrap; word-wrap: break-word;
}
.edit-actions { display: flex; gap: 6px; margin-top: 4px; }
.edit-save-btn {
  padding: 2px 10px; background: var(--color-accent); color: white;
  border: none; border-radius: 4px; cursor: pointer; font-size: 0.85em;
}
.edit-save-btn:hover { background: var(--color-accent-hover); }
.edit-cancel-btn {
  padding: 2px 10px; background: none; border: 1px solid var(--color-border);
  border-radius: 4px; cursor: pointer; font-size: 0.85em; color: var(--color-text);
}
.edit-cancel-btn:hover { background: var(--color-background-hover); }

.message-content { font-size: 0.85rem; color: var(--color-text); word-wrap: break-word; white-space: pre-wrap; }

.message-image { margin: 6px 0; }
.message-image img { max-width: 100%; max-height: 300px; border-radius: 4px; cursor: pointer; }

.message-video { margin: 6px 0; }
.message-video video { max-width: 100%; max-height: 200px; border-radius: 4px; }

.hidden-input { display: none; }

.typing-indicator {
  padding: 4px 10px; font-size: 0.75rem; color: var(--color-text-light);
  font-style: italic; background: var(--color-background-hover);
}

.input-wrapper {
  position: relative; background: var(--color-background-card); border-top: 1px solid var(--color-border);
}
.input-area {
  display: flex; gap: 6px; padding: 8px; align-items: center; position: relative;
}
.input-area input[type="text"] {
  flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid var(--color-border);
  border-radius: 4px; font-size: 0.85rem; background: var(--color-background-input); color: var(--color-text);
}
.input-area input[type="text"]:focus { outline: none; border-color: var(--color-accent); }

.attach-btn {
  width: 32px; height: 32px; padding: 0; background: var(--color-button-secondary);
  color: var(--color-text); border: none; border-radius: 50%; cursor: pointer;
  font-size: 1.2em; font-weight: 300; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; transition: transform 0.2s ease, background-color 0.2s ease;
}
.attach-btn:hover:not(:disabled) { background: var(--color-button-secondary-hover); }
.attach-btn.active { background: var(--color-accent); color: white; transform: rotate(45deg); }
.attach-btn:disabled { background: var(--color-button-disabled); cursor: not-allowed; }

.send-btn {
  padding: 8px 12px; background: var(--color-accent); color: white; border: none;
  border-radius: 4px; cursor: pointer; font-size: 0.85rem; font-weight: 500; flex-shrink: 0;
}
.send-btn:hover:not(:disabled) { background: var(--color-accent-hover); }
.send-btn:disabled { background: var(--color-button-disabled); cursor: not-allowed; }

.mute-btn {
  background: none; border: none; cursor: pointer; padding: 4px 6px;
  color: var(--color-text-muted); border-radius: 4px; display: flex; align-items: center;
  flex-shrink: 0; transition: color 0.15s;
}
.mute-btn:hover { color: var(--color-text-secondary); }
.mute-btn.muted { color: #e53e3e; }

.attach-menu {
  background: var(--color-background-card); border: 1px solid var(--color-border);
  border-radius: 8px; box-shadow: var(--shadow-lg); padding: 6px; display: flex; gap: 6px; margin-bottom: 6px;
}
.attach-option {
  display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 14px;
  background: var(--color-background-soft); border: none; border-radius: 6px; cursor: pointer;
  color: var(--color-text); font-size: 0.75rem; transition: background-color 0.15s ease;
}
.attach-option:hover:not(:disabled) { background: var(--color-background-hover); }
.attach-option:disabled { opacity: 0.5; cursor: not-allowed; }
.attach-icon { font-size: 1.2em; }

.loading-older {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px; font-size: 0.75rem; color: var(--color-text-muted);
}
.loading-spinner {
  display: inline-block; width: 12px; height: 12px; border: 2px solid var(--color-border);
  border-top-color: var(--color-accent); border-radius: 50%; animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.load-more-btn-wrapper { display: flex; justify-content: center; padding: 6px 0; }
.load-more-btn {
  background: none; border: 1px solid var(--color-border); border-radius: 12px;
  padding: 3px 12px; font-size: 0.75em; color: var(--color-text-muted); cursor: pointer;
}
.load-more-btn:hover { background: var(--color-background-mute); color: var(--color-text); }

.mention-dropdown {
  position: absolute; bottom: 100%; left: 0; right: 0;
  background: var(--color-background-card); border: 1px solid var(--color-border);
  border-radius: 8px; box-shadow: var(--shadow-lg); overflow: hidden; z-index: 20; margin-bottom: 4px;
}
.mention-option {
  display: flex; align-items: center; gap: 8px; padding: 7px 12px; cursor: pointer; font-size: 0.82rem;
}
.mention-option:hover, .mention-option.active { background: var(--color-background-hover); }
.mention-option-handle { font-weight: 600; color: var(--color-accent); }
.mention-option-name { color: var(--color-text-muted); font-size: 0.78rem; }

@keyframes msg-flash {
  0%   { background-color: rgba(236, 201, 75, 0.35); }
  100% { background-color: transparent; }
}
.message-flash { animation: msg-flash 2s ease-out forwards; border-radius: 4px; }

:deep(.mention-highlight) {
  background: rgba(99, 91, 255, 0.12); color: #6355e8;
  border-radius: 3px; padding: 1px 4px; font-weight: 600;
}

:deep(.chat-link) {
  display: inline-flex; align-items: center; gap: 4px; max-width: 100%;
  padding: 2px 9px; background: var(--color-accent); color: white;
  border-radius: 12px; font-size: 0.9em; font-weight: 600; text-decoration: none;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: middle;
}
:deep(.chat-link:hover) { opacity: 0.85; }
:deep(.chat-link-icon) { flex-shrink: 0; }

/* ── Carousel nav ── */
.ccw-nav {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  background: var(--color-background-soft);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.ccw-arrow {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
  color: var(--color-text);
  flex-shrink: 0;
  transition: background-color 0.15s;
}
.ccw-arrow:hover:not(:disabled) { background: var(--color-background-hover); }
.ccw-arrow:disabled { opacity: 0.3; cursor: default; }

@keyframes arrow-glow {
  0%   { background-color: rgba(236, 201, 75, 0.7); border-color: rgba(236, 201, 75, 0.9); }
  100% { background-color: transparent; border-color: var(--color-border); }
}
.ccw-arrow--glow {
  animation: arrow-glow 2s ease-out forwards;
}

.ccw-room-name {
  flex: 1;
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ccw-pos {
  font-size: 0.75rem;
  color: var(--color-text-light);
  white-space: nowrap;
  flex-shrink: 0;
}
</style>
