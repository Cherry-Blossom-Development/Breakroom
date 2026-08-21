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

    <!-- ── Alternate Email ── -->
    <div class="settings-section">
      <h3>Alternate Email</h3>
      <p class="section-hint">Add a second address so account notices can also reach you there.</p>

      <div v-if="altEmailLoading" class="settings-loading">Loading...</div>

      <div v-else>
        <div v-if="altEmailEditing" class="form-group">
          <label>Alternate email address</label>
          <input type="email" v-model="altEmailInput" placeholder="you@example.com" class="alt-email-input" />
          <div class="alt-email-actions">
            <button class="btn-primary" :disabled="altEmailSaving || !altEmailInput.trim()" @click="saveAltEmail">
              {{ altEmailSaving ? 'Sending…' : 'Send Verification Email' }}
            </button>
            <button v-if="altEmail.alternate_email" class="btn-secondary" @click="cancelEditAltEmail">Cancel</button>
          </div>
        </div>

        <div v-else-if="!altEmail.alternate_email_verified" class="alt-email-status">
          <p>Pending confirmation: <strong>{{ altEmail.alternate_email }}</strong></p>
          <p class="section-hint">Check that inbox for a confirmation link.</p>
          <div class="alt-email-actions">
            <button class="btn-secondary" :disabled="altEmailResending" @click="resendAltEmailVerification">
              {{ altEmailResending ? 'Sending…' : 'Resend Email' }}
            </button>
            <button class="btn-secondary" @click="startEditAltEmail">Change</button>
            <button class="btn-secondary" @click="removeAltEmail">Remove</button>
          </div>
        </div>

        <div v-else class="alt-email-status">
          <p>Confirmed: <strong>{{ altEmail.alternate_email }}</strong></p>
          <label class="toggle-row">
            <span class="toggle-label">Also send notices to this address</span>
            <input type="checkbox" v-model="altEmail.send_notices_to_alternate_email" @change="toggleAltEmailNotify" />
            <span class="toggle-track" :class="{ on: altEmail.send_notices_to_alternate_email }"></span>
          </label>
          <div class="alt-email-actions">
            <button class="btn-secondary" @click="startEditAltEmail">Change</button>
            <button class="btn-secondary" @click="removeAltEmail">Remove</button>
          </div>
        </div>

        <p v-if="altEmailMessage" class="alt-email-message">{{ altEmailMessage }}</p>
        <p v-if="altEmailError" class="settings-error">{{ altEmailError }}</p>
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

// ── Alternate email ──────────────────────────────────────────────────────────
const altEmailLoading = ref(true)
const altEmail = ref({ alternate_email: null, alternate_email_verified: false, send_notices_to_alternate_email: false })
const altEmailEditing = ref(false)
const altEmailInput = ref('')
const altEmailSaving = ref(false)
const altEmailResending = ref(false)
const altEmailMessage = ref('')
const altEmailError = ref('')

onMounted(loadAltEmail)

async function loadAltEmail() {
  altEmailLoading.value = true
  try {
    const res = await fetch('/api/user/alternate-email', { credentials: 'include' })
    if (res.ok) {
      altEmail.value = await res.json()
      altEmailEditing.value = !altEmail.value.alternate_email
    }
  } catch (err) {
    console.error('Failed to load alternate email:', err)
  } finally {
    altEmailLoading.value = false
  }
}

function startEditAltEmail() {
  altEmailInput.value = altEmail.value.alternate_email || ''
  altEmailEditing.value = true
  altEmailMessage.value = ''
  altEmailError.value = ''
}

function cancelEditAltEmail() {
  altEmailEditing.value = false
  altEmailError.value = ''
}

async function saveAltEmail() {
  if (!altEmailInput.value.trim() || altEmailSaving.value) return
  altEmailSaving.value = true
  altEmailError.value = ''
  altEmailMessage.value = ''
  try {
    const res = await fetch('/api/user/alternate-email', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ alternate_email: altEmailInput.value.trim() })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      altEmailError.value = data.message || 'Failed to set alternate email.'
      return
    }
    altEmailMessage.value = data.message
    await loadAltEmail()
  } catch (err) {
    altEmailError.value = 'Failed to set alternate email.'
  } finally {
    altEmailSaving.value = false
  }
}

async function resendAltEmailVerification() {
  altEmailResending.value = true
  altEmailError.value = ''
  altEmailMessage.value = ''
  try {
    const res = await fetch('/api/user/alternate-email/resend', { method: 'POST', credentials: 'include' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      altEmailError.value = data.message || 'Failed to resend verification email.'
      return
    }
    altEmailMessage.value = data.message
  } catch (err) {
    altEmailError.value = 'Failed to resend verification email.'
  } finally {
    altEmailResending.value = false
  }
}

async function removeAltEmail() {
  altEmailError.value = ''
  altEmailMessage.value = ''
  try {
    const res = await fetch('/api/user/alternate-email', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ alternate_email: '' })
    })
    if (!res.ok) {
      altEmailError.value = 'Failed to remove alternate email.'
      return
    }
    await loadAltEmail()
  } catch (err) {
    altEmailError.value = 'Failed to remove alternate email.'
  }
}

async function toggleAltEmailNotify(e) {
  const enabled = e.target.checked
  altEmailError.value = ''
  try {
    const res = await fetch('/api/user/alternate-email/notify', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ enabled })
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      altEmailError.value = data.message || 'Failed to save setting.'
      altEmail.value.send_notices_to_alternate_email = !enabled
    }
  } catch (err) {
    altEmailError.value = 'Failed to save setting.'
    altEmail.value.send_notices_to_alternate_email = !enabled
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
  border: 1px solid var(--color-border-medium);
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
  color: var(--color-text-light);
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
  color: var(--color-text-secondary);
}

.master-toggle .toggle-label {
  font-weight: 600;
  color: var(--color-text);
}

.toggle-track {
  width: 36px;
  height: 20px;
  background: var(--color-border-medium);
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
  background: var(--color-background-card);
  border-radius: 50%;
  transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}

.toggle-track.on {
  background: var(--color-success);
}

.toggle-track.on::after {
  transform: translateX(16px);
}

.sub-options {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding-left: 1rem;
  border-left: 2px solid var(--color-border-medium);
  margin-left: 0.25rem;
  transition: opacity 0.2s;
}

.sub-options.disabled {
  opacity: 0.4;
  pointer-events: none;
}

.settings-error {
  color: var(--color-error);
  font-size: 0.85rem;
  margin: 0.5rem 0 0;
}

/* ── Alternate email ── */
.section-hint {
  color: var(--color-text-light);
  font-size: 0.85rem;
  margin: 0 0 1rem;
}

.alt-email-input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--color-border-medium);
  border-radius: 4px;
  font-size: 0.9rem;
  box-sizing: border-box;
  margin-top: 0.25rem;
}

.alt-email-status p {
  margin: 0 0 0.5rem;
  font-size: 0.9rem;
  color: var(--color-text);
}

.alt-email-status .toggle-row {
  margin: 0.5rem 0;
}

.alt-email-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.alt-email-message {
  color: var(--color-success);
  font-size: 0.85rem;
  margin: 0.5rem 0 0;
}

.btn-primary {
  padding: 0.5rem 1.25rem;
  background: var(--color-accent);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.9rem;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary:not(:disabled):hover {
  background: var(--color-accent-hover);
}

.btn-secondary {
  padding: 0.5rem 1.25rem;
  background: var(--color-background-hover);
  color: var(--color-text-secondary);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.9rem;
}

.btn-secondary:hover {
  background: var(--color-border-medium);
}

.danger-zone {
  border: 1px solid var(--color-error);
  border-radius: 6px;
  padding: 1.5rem;
  margin-top: 1.5rem;
}

.danger-zone h3 {
  color: var(--color-error);
  margin-top: 0;
}

.warning-text {
  color: var(--color-text-light);
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
  border: 1px solid var(--color-border-medium);
  border-radius: 4px;
  background: var(--color-background-soft);
  color: var(--color-text-light);
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
  background: var(--color-error);
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
  background: var(--color-error);
  opacity: 0.85;
}

.alert {
  padding: 0.75rem 1rem;
  border-radius: 4px;
  font-size: 0.9rem;
}

.alert-success {
  background: var(--color-success-bg);
  border: 1px solid var(--color-success);
  color: var(--color-success);
}

.alert-error {
  background: var(--color-error-bg);
  border: 1px solid var(--color-error);
  color: var(--color-error);
}
</style>
