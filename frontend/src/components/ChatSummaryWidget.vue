<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { io } from 'socket.io-client'
import { user } from '@/stores/user.js'

const emit = defineEmits(['new-message'])

// ── State ────────────────────────────────────────────────────────────────────

const queue        = ref([])   // [{ id, name, last_read_at, unread_count }]
const queueIndex   = ref(0)
const messages     = ref([])
const newMessage   = ref('')
const loading      = ref(true)
const loadingMsgs  = ref(false)
const sending      = ref(false)
const error        = ref(null)
const messagesEl   = ref(null)
const inputEl      = ref(null)
let socket = null

// ── Derived ──────────────────────────────────────────────────────────────────

const currentRoom = computed(() => queue.value[queueIndex.value] ?? null)
const allDone     = computed(() => !loading.value && queue.value.length === 0)
const posLabel    = computed(() =>
  queue.value.length > 0 ? `${queueIndex.value + 1} of ${queue.value.length}` : ''
)

// Index of the first message that arrived after last_read_at (where the divider goes)
const firstUnreadIdx = computed(() => {
  const room = currentRoom.value
  if (!room) return -1
  if (!room.last_read_at) return 0
  const cutoff = new Date(room.last_read_at)
  return messages.value.findIndex(m => new Date(m.created_at) > cutoff)
})

// ── Data loading ─────────────────────────────────────────────────────────────

async function fetchQueue() {
  loading.value = true
  error.value = null
  try {
    const res = await fetch('/api/chat/rooms/unread-summary', { credentials: 'include' })
    if (!res.ok) throw new Error('Failed to load')
    const data = await res.json()
    queue.value = data
    queueIndex.value = 0
    if (data.length > 0) await loadMessages(data[0])
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function loadMessages(room) {
  loadingMsgs.value = true
  messages.value = []
  try {
    const res = await fetch(`/api/chat/rooms/${room.id}/messages?limit=20`, { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      messages.value = data.messages ?? []
      await nextTick()
      scrollToUnread()
    }
  } finally {
    loadingMsgs.value = false
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function markRead() {
  if (!currentRoom.value) return
  await fetch(`/api/chat/rooms/${currentRoom.value.id}/mark-read`, {
    method: 'POST', credentials: 'include'
  }).catch(() => {})
}

async function goNext() {
  await markRead()
  leaveRoom(currentRoom.value?.id)

  if (queueIndex.value < queue.value.length - 1) {
    queueIndex.value++
    const next = queue.value[queueIndex.value]
    joinRoom(next.id)
    await loadMessages(next)
  } else {
    // Exhausted the queue — show "no new messages"
    queue.value = []
    messages.value = []
  }
}

async function sendMessage() {
  const text = newMessage.value.trim()
  if (!text || !currentRoom.value || sending.value) return
  sending.value = true
  newMessage.value = ''
  try {
    const res = await fetch(`/api/chat/rooms/${currentRoom.value.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ message: text })
    })
    if (res.ok) {
      const data = await res.json()
      messages.value.push(data.message)
      await markRead()
      await nextTick()
      scrollToBottom()
    } else {
      newMessage.value = text   // restore on failure
    }
  } catch {
    newMessage.value = text
  } finally {
    sending.value = false
    inputEl.value?.focus()
  }
}

function handleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

// ── Scroll helpers ───────────────────────────────────────────────────────────

function scrollToUnread() {
  if (!messagesEl.value) return
  const divider = messagesEl.value.querySelector('.unread-divider')
  if (divider) {
    divider.scrollIntoView({ block: 'nearest' })
    messagesEl.value.scrollTop = Math.max(0, messagesEl.value.scrollTop - 12)
  } else {
    scrollToBottom()
  }
}

function scrollToBottom() {
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}

// ── Socket ───────────────────────────────────────────────────────────────────

function joinRoom(roomId) {
  if (socket?.connected) socket.emit('join_room', roomId)
}

function leaveRoom(roomId) {
  if (roomId && socket?.connected) socket.emit('leave_room', roomId)
}

function setupSocket() {
  const baseUrl = import.meta.env.VITE_API_BASE_URL || ''
  socket = io(baseUrl, { withCredentials: true, autoConnect: true })

  socket.on('connect', () => {
    if (currentRoom.value) socket.emit('join_room', currentRoom.value.id)
  })

  socket.on('new_message', async (data) => {
    if (!currentRoom.value || data.roomId !== currentRoom.value.id) return
    if (messages.value.some(m => m.id === data.message.id)) return
    messages.value.push(data.message)
    // If the message is from someone else, notify parent to flash header
    if (data.message.handle !== user.username) {
      emit('new-message', { roomId: data.roomId })
    }
    await nextTick()
    scrollToBottom()
  })

  socket.on('message_edited', (data) => {
    if (!currentRoom.value || data.roomId !== currentRoom.value.id) return
    const idx = messages.value.findIndex(m => m.id === data.message.id)
    if (idx !== -1) messages.value[idx] = data.message
  })

  socket.on('message_deleted', (data) => {
    if (!currentRoom.value || data.roomId !== currentRoom.value.id) return
    messages.value = messages.value.filter(m => m.id !== data.messageId)
  })
}

function cleanupSocket() {
  leaveRoom(currentRoom.value?.id)
  socket?.disconnect()
  socket = null
}

// ── Formatting ───────────────────────────────────────────────────────────────

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(async () => {
  await fetchQueue()
  setupSocket()
})

onUnmounted(() => {
  cleanupSocket()
})
</script>

<template>
  <div class="csw">

    <!-- Loading -->
    <div v-if="loading" class="csw-center">
      <span class="csw-spinner"></span>
      Loading…
    </div>

    <!-- Error -->
    <div v-else-if="error" class="csw-center csw-error">
      {{ error }}
      <button class="csw-refresh-btn" @click="fetchQueue">Retry</button>
    </div>

    <!-- No new messages -->
    <div v-else-if="allDone" class="csw-center csw-done">
      <svg class="csw-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      <span>No New Messages</span>
      <button class="csw-refresh-btn" @click="fetchQueue">Refresh</button>
    </div>

    <!-- Active chat view -->
    <template v-else-if="currentRoom">

      <!-- Room sub-header -->
      <div class="csw-subheader">
        <span class="csw-room-name"># {{ currentRoom.name }}</span>
        <span class="csw-position">{{ posLabel }}</span>
      </div>

      <!-- Messages -->
      <div ref="messagesEl" class="csw-messages">
        <div v-if="loadingMsgs" class="csw-center">
          <span class="csw-spinner"></span>
        </div>
        <template v-else>
          <div v-if="messages.length === 0" class="csw-no-msgs">No messages yet.</div>
          <template v-for="(msg, idx) in messages" :key="msg.id">
            <!-- Unread divider -->
            <div v-if="idx === firstUnreadIdx" class="unread-divider">
              <span>New Messages</span>
            </div>
            <div class="csw-msg" :class="{ 'csw-msg--new': idx >= firstUnreadIdx && firstUnreadIdx !== -1 }">
              <span class="csw-msg-handle">{{ msg.handle }}</span>
              <span class="csw-msg-time">{{ formatTime(msg.created_at) }}</span>
              <p class="csw-msg-text">{{ msg.message }}</p>
            </div>
          </template>
        </template>
      </div>

      <!-- Input footer -->
      <div class="csw-footer">
        <input
          ref="inputEl"
          v-model="newMessage"
          class="csw-input"
          type="text"
          placeholder="Reply…"
          maxlength="4000"
          :disabled="sending"
          @keydown="handleKeydown"
        />
        <button
          class="csw-btn csw-btn--send"
          :disabled="!newMessage.trim() || sending"
          @click="sendMessage"
        >Send</button>
        <button
          class="csw-btn csw-btn--next"
          @click="goNext"
        >Next →</button>
      </div>
    </template>

  </div>
</template>

<style scoped>
.csw {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-size: 0.88rem;
}

/* ── Centred states ── */
.csw-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--color-text-muted, var(--color-text-light));
  padding: 20px;
  text-align: center;
}

.csw-error { color: var(--color-error); }

.csw-check {
  width: 36px;
  height: 36px;
  color: var(--color-accent);
  stroke: var(--color-accent);
}

.csw-done {
  color: var(--color-text-secondary);
}

.csw-spinner {
  display: inline-block;
  width: 18px;
  height: 18px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: csw-spin 0.7s linear infinite;
}

@keyframes csw-spin { to { transform: rotate(360deg); } }

.csw-refresh-btn {
  margin-top: 4px;
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text-secondary);
  padding: 5px 14px;
  font-size: 0.82rem;
  cursor: pointer;
}
.csw-refresh-btn:hover { background: var(--color-background-hover); }

/* ── Sub-header ── */
.csw-subheader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--color-background-soft);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.csw-room-name {
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.csw-position {
  font-size: 0.78rem;
  color: var(--color-text-muted, var(--color-text-light));
  white-space: nowrap;
  margin-left: 8px;
}

/* ── Messages ── */
.csw-messages {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.csw-no-msgs {
  color: var(--color-text-muted, var(--color-text-light));
  text-align: center;
  padding: 20px 0;
}

/* Unread divider */
.unread-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0 4px;
  flex-shrink: 0;
}
.unread-divider::before,
.unread-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--color-accent);
  opacity: 0.5;
}
.unread-divider span {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-accent);
  white-space: nowrap;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* Individual message */
.csw-msg {
  padding: 5px 8px;
  border-radius: 6px;
  background: var(--color-background-soft);
  line-height: 1.4;
}
.csw-msg--new {
  background: var(--color-accent-light, rgba(var(--color-accent-rgb, 66,153,225), 0.08));
}

.csw-msg-handle {
  font-weight: 600;
  color: var(--color-text);
  margin-right: 6px;
}
.csw-msg-time {
  font-size: 0.75rem;
  color: var(--color-text-muted, var(--color-text-light));
}
.csw-msg-text {
  margin: 2px 0 0;
  color: var(--color-text);
  word-break: break-word;
}

/* ── Footer ── */
.csw-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-top: 1px solid var(--color-border);
  background: var(--color-background-card);
  flex-shrink: 0;
}

.csw-input {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 0.88rem;
  background: var(--color-background-input, var(--color-background));
  color: var(--color-text);
  outline: none;
}
.csw-input:focus { border-color: var(--color-accent); }

.csw-btn {
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.csw-btn--send {
  background: var(--color-accent);
  color: #fff;
}
.csw-btn--send:hover:not(:disabled) { opacity: 0.88; }
.csw-btn--send:disabled { opacity: 0.45; cursor: not-allowed; }

.csw-btn--next {
  background: var(--color-button-secondary, var(--color-background-soft));
  color: var(--color-text);
  border: 1px solid var(--color-border);
}
.csw-btn--next:hover { background: var(--color-background-hover); }
</style>
