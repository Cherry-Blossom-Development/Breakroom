<template>
  <section class="settings-page">
    <h2>Settings</h2>

    <!-- ── Notification Settings ── -->
    <div class="settings-section">
      <h3>Notifications</h3>

      <div v-if="settingsLoading" class="settings-loading">Loading...</div>

      <div v-else class="notification-settings">
        <label class="toggle-row master-toggle">
          <span class="toggle-label">Allow notifications</span>
          <input type="checkbox" v-model="settings.notifications_enabled" @change="saveSettings" />
          <span class="toggle-track" :class="{ on: settings.notifications_enabled }"></span>
        </label>

        <div class="sub-options" :class="{ disabled: !settings.notifications_enabled }">
          <label class="toggle-row">
            <span class="toggle-label">New messages in chat</span>
            <input type="checkbox" v-model="settings.notify_chat_messages" :disabled="!settings.notifications_enabled" @change="saveSettings" />
            <span class="toggle-track" :class="{ on: settings.notify_chat_messages && settings.notifications_enabled }"></span>
          </label>

          <label class="toggle-row">
            <span class="toggle-label">Friend requests</span>
            <input type="checkbox" v-model="settings.notify_friend_requests" :disabled="!settings.notifications_enabled" @change="saveSettings" />
            <span class="toggle-track" :class="{ on: settings.notify_friend_requests && settings.notifications_enabled }"></span>
          </label>

          <label class="toggle-row">
            <span class="toggle-label">Comments on your content</span>
            <input type="checkbox" v-model="settings.notify_blog_comments" :disabled="!settings.notifications_enabled" @change="saveSettings" />
            <span class="toggle-track" :class="{ on: settings.notify_blog_comments && settings.notifications_enabled }"></span>
          </label>
        </div>

        <p v-if="settingsSaveError" class="settings-error">{{ settingsSaveError }}</p>
      </div>
    </div>

    <div class="danger-zone">
      <h3>Account Deletion</h3>
      <p class="warning-text">
        Requesting deletion will permanently remove your account and all associated data.
        This action cannot be undone. An administrator will process your request.
      </p>

      <div v-if="successMessage" class="alert alert-success">
        {{ successMessage }}
      </div>

      <form v-else @submit.prevent="submitDeletionRequest" class="deletion-form">
        <div class="form-group">
          <label>Account</label>
          <input type="text" :value="user.username" readonly class="input-readonly" />
        </div>

        <div class="form-group checkbox-group">
          <label>
            <input type="checkbox" v-model="confirmed" />
            I understand this will permanently delete my account and all associated data
          </label>
        </div>

        <div v-if="errorMessage" class="alert alert-error">
          {{ errorMessage }}
        </div>

        <button
          type="submit"
          class="btn-danger"
          :disabled="!confirmed || submitting"
        >
          {{ submitting ? 'Submitting...' : 'Request Account Deletion' }}
        </button>
      </form>
    </div>
  </section>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { user } from '@/stores/user'

const confirmed = ref(false)
const submitting = ref(false)
const successMessage = ref('')
const errorMessage = ref('')

// ── Notification settings ────────────────────────────────────────────────────
const settingsLoading = ref(true)
const settingsSaveError = ref('')
const settings = ref({
  notifications_enabled: true,
  notify_chat_messages: true,
  notify_friend_requests: true,
  notify_blog_comments: true
})

onMounted(async () => {
  try {
    const res = await fetch('/api/user/notification-settings', { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      settings.value = data
    }
  } catch (err) {
    console.error('Failed to load notification settings:', err)
  } finally {
    settingsLoading.value = false
  }
})

async function saveSettings() {
  settingsSaveError.value = ''
  try {
    const res = await fetch('/api/user/notification-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(settings.value)
    })
    if (!res.ok) {
      settingsSaveError.value = 'Failed to save settings.'
    }
  } catch (err) {
    settingsSaveError.value = 'Failed to save settings.'
  }
}

async function submitDeletionRequest() {
  if (!confirmed.value || submitting.value) return

  submitting.value = true
  errorMessage.value = ''

  try {
    const res = await fetch('/api/profile/deletion-request', {
      method: 'POST',
      credentials: 'include'
    })

    if (res.status === 409) {
      errorMessage.value = 'You already have a pending deletion request.'
      return
    }

    if (!res.ok) {
      errorMessage.value = 'Failed to submit deletion request. Please try again.'
      return
    }

    successMessage.value = 'Your deletion request has been submitted. An administrator will process it shortly.'
  } catch (err) {
    errorMessage.value = 'Failed to submit deletion request. Please try again.'
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.settings-page {
  max-width: 600px;
  margin: 0 auto;
  padding: 1.5rem;
}

/* ── Notification settings ── */
.settings-section {
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 6px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
}

.settings-section h3 {
  margin-top: 0;
  margin-bottom: 1rem;
  font-size: 1rem;
  font-weight: 600;
}

.settings-loading {
  color: #718096;
  font-size: 0.9rem;
}

.notification-settings {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.4rem 0;
  cursor: pointer;
  user-select: none;
}

.toggle-row input[type="checkbox"] {
  display: none;
}

.toggle-label {
  font-size: 0.9rem;
  color: #4a5568;
}

.master-toggle .toggle-label {
  font-weight: 600;
  color: #2d3748;
}

.toggle-track {
  width: 36px;
  height: 20px;
  background: #cbd5e0;
  border-radius: 10px;
  position: relative;
  flex-shrink: 0;
  transition: background 0.2s;
}

.toggle-track::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  background: white;
  border-radius: 50%;
  transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}

.toggle-track.on {
  background: #48bb78;
}

.toggle-track.on::after {
  transform: translateX(16px);
}

.sub-options {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding-left: 1rem;
  border-left: 2px solid #e2e8f0;
  margin-left: 0.25rem;
  transition: opacity 0.2s;
}

.sub-options.disabled {
  opacity: 0.4;
  pointer-events: none;
}

.settings-error {
  color: #e53e3e;
  font-size: 0.85rem;
  margin: 0.5rem 0 0;
}

.danger-zone {
  border: 1px solid #e53e3e;
  border-radius: 6px;
  padding: 1.5rem;
  margin-top: 1.5rem;
}

.danger-zone h3 {
  color: #e53e3e;
  margin-top: 0;
}

.warning-text {
  color: #718096;
  margin-bottom: 1.25rem;
}

.deletion-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.form-group label {
  font-size: 0.875rem;
  font-weight: 600;
}

.input-readonly {
  padding: 0.5rem;
  border: 1px solid #cbd5e0;
  border-radius: 4px;
  background: #f7fafc;
  color: #718096;
}

.checkbox-group {
  flex-direction: row;
  align-items: flex-start;
}

.checkbox-group label {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-weight: normal;
  cursor: pointer;
}

.checkbox-group input[type="checkbox"] {
  margin-top: 2px;
  flex-shrink: 0;
}

.btn-danger {
  padding: 0.5rem 1.25rem;
  background: #e53e3e;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 600;
  align-self: flex-start;
}

.btn-danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-danger:not(:disabled):hover {
  background: #c53030;
}

.alert {
  padding: 0.75rem 1rem;
  border-radius: 4px;
  font-size: 0.9rem;
}

.alert-success {
  background: #f0fff4;
  border: 1px solid #9ae6b4;
  color: #276749;
}

.alert-error {
  background: #fff5f5;
  border: 1px solid #feb2b2;
  color: #c53030;
}
</style>
