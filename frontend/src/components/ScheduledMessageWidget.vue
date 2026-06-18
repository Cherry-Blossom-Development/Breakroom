<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { chat } from '@/stores/chat.js'

const rooms = computed(() => chat.rooms)
const scheduled = ref([])
const loading = ref(true)
const error = ref('')

const DEFAULT_INDICATOR = '- sent via scheduled message'

const editingId = ref(null)
const form = reactive({
  messageText: '',
  roomId: null,
  scheduledAt: '',
  warningMinutes: 10,
  indicatorText: DEFAULT_INDICATOR
})
const saving = ref(false)
const formError = ref('')

function toLocalISOString(date) {
  const d = new Date(date)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function getDefaultScheduledAt() {
  const d = new Date()
  d.setHours(d.getHours() + 1)
  d.setSeconds(0, 0)
  return toLocalISOString(d)
}

const minScheduledAt = computed(() => {
  const d = new Date()
  d.setMinutes(d.getMinutes() + 2)
  return toLocalISOString(d)
})

function resetForm() {
  editingId.value = null
  form.messageText = ''
  form.roomId = rooms.value[0]?.id || null
  form.scheduledAt = getDefaultScheduledAt()
  form.warningMinutes = 10
  form.indicatorText = DEFAULT_INDICATOR
  formError.value = ''
}

async function fetchScheduled() {
  try {
    const res = await fetch('/api/scheduled-messages', { credentials: 'include' })
    if (!res.ok) throw new Error('Failed to load')
    const data = await res.json()
    scheduled.value = data.scheduled_messages
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

async function handleSubmit() {
  formError.value = ''
  if (!form.messageText.trim()) { formError.value = 'Message is required'; return }
  if (!form.roomId) { formError.value = 'Please select a room'; return }
  if (!form.scheduledAt) { formError.value = 'Please set a send time'; return }

  const scheduledAt = new Date(form.scheduledAt).toISOString()
  if (new Date(scheduledAt) <= new Date()) {
    formError.value = 'Send time must be in the future'
    return
  }

  saving.value = true
  try {
    const url = editingId.value
      ? `/api/scheduled-messages/${editingId.value}`
      : '/api/scheduled-messages'
    const method = editingId.value ? 'PUT' : 'POST'

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        room_id: form.roomId,
        message_text: form.messageText,
        scheduled_at: scheduledAt,
        warning_minutes: form.warningMinutes,
        indicator_text: form.indicatorText
      })
    })
    if (!res.ok) {
      const d = await res.json()
      throw new Error(d.message || 'Failed to save')
    }
    resetForm()
    await fetchScheduled()
  } catch (err) {
    formError.value = err.message
  } finally {
    saving.value = false
  }
}

function startEdit(msg) {
  editingId.value = msg.id
  form.messageText = msg.message_text
  form.roomId = msg.room_id
  form.scheduledAt = toLocalISOString(new Date(msg.scheduled_at))
  form.warningMinutes = msg.warning_minutes
  form.indicatorText = msg.indicator_text ?? DEFAULT_INDICATOR
  formError.value = ''
}

async function cancelMessage(id) {
  try {
    await fetch(`/api/scheduled-messages/${id}`, { method: 'DELETE', credentials: 'include' })
    if (editingId.value === id) resetForm()
    await fetchScheduled()
  } catch (err) {
    error.value = err.message
  }
}

function formatSendTime(utcStr) {
  const d = new Date(utcStr)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  const isTomorrow = d.toDateString() === tomorrow.toDateString()

  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (isToday) return `Today at ${time}`
  if (isTomorrow) return `Tomorrow at ${time}`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ` at ${time}`
}

function statusLabel(msg) {
  if (msg.is_editing) return 'Editing paused'
  switch (msg.status) {
    case 'warning_sent': return 'Sending soon'
    case 'confirmed': return 'Confirmed'
    default: return 'Scheduled'
  }
}

onMounted(async () => {
  if (rooms.value.length === 0) await chat.fetchRooms()
  if (rooms.value.length > 0 && !form.roomId) form.roomId = rooms.value[0].id
  form.scheduledAt = getDefaultScheduledAt()
  await fetchScheduled()
})
</script>

<template>
  <div class="scheduled-widget">
    <!-- Create / Edit form -->
    <div class="form-section">
      <h4 class="section-heading">{{ editingId ? 'Edit Scheduled Message' : 'Schedule a Message' }}</h4>

      <form @submit.prevent="handleSubmit">
        <textarea
          v-model="form.messageText"
          placeholder="Type your message..."
          maxlength="1000"
          rows="3"
          class="msg-input"
          :class="{ 'edit-mode': editingId }"
        />
        <div class="char-count">{{ form.messageText.length }}/1000</div>

        <div class="field-row">
          <div class="field">
            <label>Room</label>
            <select v-model="form.roomId">
              <option v-for="r in rooms" :key="r.id" :value="r.id"># {{ r.name }}</option>
            </select>
          </div>
          <div class="field">
            <label>Warn me</label>
            <div class="warn-row">
              <input
                type="number"
                v-model.number="form.warningMinutes"
                min="0"
                max="60"
                class="warn-input"
              />
              <span class="warn-label">min before</span>
            </div>
          </div>
        </div>

        <div class="field">
          <label>Send at</label>
          <input
            type="datetime-local"
            v-model="form.scheduledAt"
            :min="minScheduledAt"
            class="datetime-input"
          />
        </div>

        <div class="field">
          <label>
            Indicator text
            <span class="label-hint">(appended to message — leave empty for none)</span>
          </label>
          <div class="indicator-row">
            <input
              type="text"
              v-model="form.indicatorText"
              placeholder="e.g. - sent via scheduled message"
              maxlength="255"
              class="indicator-input"
            />
            <button type="button" class="btn-tiny" @click="form.indicatorText = DEFAULT_INDICATOR" title="Reset to default">Default</button>
            <button type="button" class="btn-tiny" @click="form.indicatorText = ''" title="No indicator">None</button>
          </div>
        </div>

        <p v-if="formError" class="form-error">{{ formError }}</p>

        <div class="form-actions">
          <button type="submit" class="btn-primary" :disabled="saving">
            {{ saving ? 'Saving...' : editingId ? 'Update Message' : 'Schedule Message' }}
          </button>
          <button v-if="editingId" type="button" class="btn-secondary" @click="resetForm">
            Cancel Edit
          </button>
        </div>
      </form>
    </div>

    <!-- Pending list -->
    <div class="list-section">
      <h4 class="section-heading">Upcoming</h4>

      <div v-if="loading" class="empty-state">Loading...</div>
      <div v-else-if="error" class="empty-state error-text">{{ error }}</div>
      <div v-else-if="scheduled.length === 0" class="empty-state">No scheduled messages.</div>

      <div v-else class="scheduled-list">
        <div
          v-for="msg in scheduled"
          :key="msg.id"
          class="scheduled-item"
          :class="{ 'is-editing': msg.is_editing, 'is-warning': msg.status === 'warning_sent' }"
        >
          <div class="item-meta">
            <span class="item-room">#{{ msg.room_name }}</span>
            <span class="item-status" :class="msg.status">{{ statusLabel(msg) }}</span>
          </div>
          <div class="item-time">{{ formatSendTime(msg.scheduled_at) }}</div>
          <div class="item-preview">{{ msg.message_text }}</div>
          <div class="item-actions">
            <button
              class="btn-tiny"
              @click="startEdit(msg)"
              :disabled="msg.status === 'warning_sent' && !msg.is_editing"
            >
              Edit
            </button>
            <button class="btn-tiny danger" @click="cancelMessage(msg.id)">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scheduled-widget {
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0;
  font-size: 0.85rem;
}

.form-section,
.list-section {
  padding: 10px 12px;
}

.form-section {
  border-bottom: 1px solid var(--color-border);
}

.section-heading {
  margin: 0 0 8px;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.msg-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-input);
  color: var(--color-text);
  font-size: 0.85rem;
  resize: vertical;
  font-family: inherit;
}

.msg-input.edit-mode {
  border-color: var(--color-accent);
}

.msg-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.char-count {
  text-align: right;
  font-size: 0.72rem;
  color: var(--color-text-muted);
  margin: 2px 0 6px;
}

.field-row {
  display: flex;
  gap: 8px;
}

.field-row .field {
  flex: 1;
  min-width: 0;
}

.field {
  margin-bottom: 8px;
}

.field label {
  display: block;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  margin-bottom: 3px;
  font-weight: 500;
}

.label-hint {
  font-weight: 400;
  color: var(--color-text-muted);
}

.field select,
.field input[type="text"],
.field input[type="number"],
.datetime-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-input);
  color: var(--color-text);
  font-size: 0.82rem;
}

.field select:focus,
.field input:focus,
.datetime-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.warn-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.warn-input {
  width: 52px !important;
  text-align: center;
}

.warn-label {
  font-size: 0.78rem;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.indicator-row {
  display: flex;
  gap: 4px;
  align-items: center;
}

.indicator-input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-input);
  color: var(--color-text);
  font-size: 0.82rem;
}

.indicator-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.form-error {
  color: var(--color-error);
  font-size: 0.8rem;
  margin: 4px 0;
}

.form-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.btn-primary {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: 7px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 500;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.btn-primary:disabled {
  background: var(--color-button-disabled);
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--color-button-secondary);
  color: var(--color-text);
  border: none;
  padding: 7px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.82rem;
}

.btn-secondary:hover {
  background: var(--color-button-secondary-hover);
}

.btn-tiny {
  background: var(--color-background-hover);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.75rem;
  white-space: nowrap;
}

.btn-tiny:hover:not(:disabled) {
  background: var(--color-button-secondary-hover);
}

.btn-tiny:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-tiny.danger {
  color: var(--color-error);
}

.btn-tiny.danger:hover {
  background: var(--color-error-bg, rgba(255, 59, 48, 0.1));
}

.empty-state {
  color: var(--color-text-muted);
  font-size: 0.82rem;
  text-align: center;
  padding: 12px 0;
}

.error-text {
  color: var(--color-error);
}

.scheduled-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.scheduled-item {
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 8px 10px;
}

.scheduled-item.is-warning {
  border-color: rgba(237, 137, 54, 0.5);
  background: rgba(237, 137, 54, 0.07);
}

.scheduled-item.is-editing {
  border-color: var(--color-accent);
  background: rgba(var(--color-accent-rgb, 90, 103, 216), 0.06);
}

.item-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2px;
}

.item-room {
  font-weight: 600;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
}

.item-status {
  font-size: 0.72rem;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--color-background-soft);
  color: var(--color-text-muted);
}

.item-status.warning_sent {
  background: rgba(237, 137, 54, 0.2);
  color: rgb(180, 90, 10);
}

.item-status.confirmed {
  background: rgba(72, 187, 120, 0.2);
  color: rgb(39, 120, 71);
}

.item-time {
  font-size: 0.78rem;
  color: var(--color-text-muted);
  margin-bottom: 4px;
}

.item-preview {
  font-size: 0.82rem;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 6px;
}

.item-actions {
  display: flex;
  gap: 4px;
}
</style>
