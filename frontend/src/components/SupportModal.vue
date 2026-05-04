<template>
  <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal" role="dialog" aria-label="Contact Support">

      <div class="modal-header">
        <h2 class="modal-title">Contact Support</h2>
        <button class="close-btn" @click="$emit('close')" aria-label="Close">✕</button>
      </div>

      <template v-if="submitted">
        <div class="success-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40" class="success-icon">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="9 12 11 14 15 10"/>
          </svg>
          <p class="success-title">Message sent!</p>
          <p class="success-desc">We'll get back to you as soon as possible.</p>
          <button class="btn-primary" @click="$emit('close')">Close</button>
        </div>
      </template>

      <template v-else>
        <div class="form-group">
          <label class="form-label">Name</label>
          <input v-model="form.name" type="text" class="form-input" placeholder="Your name" maxlength="120" />
        </div>

        <div class="form-group">
          <label class="form-label">Email</label>
          <input v-model="form.email" type="email" class="form-input" placeholder="your@email.com" maxlength="255" />
        </div>

        <div class="form-group">
          <label class="form-label">Subject</label>
          <input v-model="form.subject" type="text" class="form-input" placeholder="What do you need help with?" maxlength="255" />
        </div>

        <div class="form-group">
          <label class="form-label">Message</label>
          <textarea v-model="form.message" class="form-textarea" placeholder="Describe your issue or question…" rows="5" />
        </div>

        <p v-if="error" class="error-msg">{{ error }}</p>

        <div class="modal-actions">
          <button class="btn-secondary" @click="$emit('close')">Cancel</button>
          <button class="btn-primary" :disabled="submitting" @click="submit">
            {{ submitting ? 'Sending…' : 'Send Message' }}
          </button>
        </div>
      </template>

    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { user } from '@/stores/user.js'

const props = defineProps({ visible: Boolean })
defineEmits(['close'])

const form = ref({ name: '', email: '', subject: '', message: '' })
const submitting = ref(false)
const submitted = ref(false)
const error = ref('')

// Pre-fill name with handle when modal opens for logged-in users
watch(() => props.visible, (val) => {
  if (val) {
    submitted.value = false
    error.value = ''
    if (user.username && !form.value.name) {
      form.value.name = user.username
    }
  }
})

async function submit() {
  error.value = ''
  if (!form.value.name.trim()) { error.value = 'Name is required.'; return }
  if (!form.value.email.trim()) { error.value = 'Email is required.'; return }
  if (!form.value.subject.trim()) { error.value = 'Subject is required.'; return }
  if (!form.value.message.trim()) { error.value = 'Message is required.'; return }

  submitting.value = true
  try {
    const res = await fetch('/api/support', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.value.name.trim(),
        email: form.value.email.trim(),
        subject: form.value.subject.trim(),
        message: form.value.message.trim()
      })
    })
    if (res.ok) {
      submitted.value = true
      form.value = { name: '', email: '', subject: '', message: '' }
    } else {
      const data = await res.json()
      error.value = data.message || 'Something went wrong. Please try again.'
    }
  } catch (err) {
    error.value = 'Could not send message. Please try again.'
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 20px;
}

.modal {
  background: var(--color-background, #fff);
  border-radius: 12px;
  padding: 28px 32px;
  width: 100%;
  max-width: 460px;
  box-shadow: 0 16px 48px rgba(0,0,0,0.2);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.modal-title {
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--color-text);
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1rem;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 4px;
  line-height: 1;
}

.close-btn:hover { color: var(--color-text); }

.form-group { margin-bottom: 16px; }

.form-label {
  display: block;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 5px;
}

.form-input,
.form-textarea {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 0.95rem;
  color: var(--color-text);
  background: var(--color-background, #fff);
  box-sizing: border-box;
  font-family: inherit;
  transition: border-color 0.15s;
}

.form-input:focus,
.form-textarea:focus {
  outline: none;
  border-color: var(--color-link);
}

.form-textarea { resize: vertical; }

.error-msg {
  font-size: 0.85rem;
  color: #e53e3e;
  margin: 0 0 12px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}

.btn-primary {
  background: var(--color-link);
  color: #fff;
  border: none;
  padding: 9px 20px;
  border-radius: 7px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-primary:hover:not(:disabled) { opacity: 0.87; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-secondary {
  background: transparent;
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 9px 20px;
  border-radius: 7px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}

.btn-secondary:hover { border-color: var(--color-text-secondary); }

/* Success state */
.success-state {
  text-align: center;
  padding: 16px 0 8px;
}

.success-icon {
  color: #2f855a;
  margin: 0 auto 12px;
}

.success-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-text);
  margin: 0 0 8px;
}

.success-desc {
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  margin: 0 0 20px;
}
</style>
