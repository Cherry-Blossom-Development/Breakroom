<template>
  <section class="settings-page">
    <h2>Settings</h2>

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
import { ref } from 'vue'
import { user } from '@/stores/user'

const confirmed = ref(false)
const submitting = ref(false)
const successMessage = ref('')
const errorMessage = ref('')

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
