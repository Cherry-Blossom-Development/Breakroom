<template>
  <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <h2>Report Content</h2>
      <p class="modal-desc">
        This content will be immediately hidden and reviewed by our moderation team.
        <span v-if="contentType === 'other'"> Please describe what you are reporting below.</span>
      </p>

      <label>Reason <span v-if="contentType === 'other'" class="required">*</span> <span v-else class="optional">(optional)</span></label>
      <textarea
        v-model="reason"
        rows="3"
        placeholder="Describe the issue..."
        :required="contentType === 'other'"
      ></textarea>

      <p v-if="error" class="error">{{ error }}</p>

      <div class="modal-actions">
        <button type="button" @click="submit" :disabled="submitting || (contentType === 'other' && !reason.trim())">
          {{ submitting ? 'Reporting…' : 'Submit Report' }}
        </button>
        <button type="button" class="btn-secondary" @click="$emit('close')">Cancel</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  visible: Boolean,
  contentType: { type: String, required: true },
  contentId: { type: Number, default: null }
})

const emit = defineEmits(['close', 'flagged'])

const reason = ref('')
const submitting = ref(false)
const error = ref('')

watch(() => props.visible, (val) => {
  if (val) {
    reason.value = ''
    error.value = ''
    submitting.value = false
  }
})

async function submit() {
  if (props.contentType === 'other' && !reason.value.trim()) return
  submitting.value = true
  error.value = ''
  try {
    const body = { content_type: props.contentType }
    if (props.contentId != null) body.content_id = props.contentId
    if (reason.value.trim()) body.reason = reason.value.trim()

    const res = await fetch('/api/moderation/flag', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (res.ok) {
      emit('flagged')
      emit('close')
    } else {
      const data = await res.json()
      error.value = data.message || 'Failed to submit report.'
    }
  } catch {
    error.value = 'Network error. Please try again.'
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.modal {
  background: var(--color-background-card);
  color: var(--color-text);
  padding: 24px;
  border-radius: 10px;
  width: 420px;
  max-width: 90%;
}

.modal h2 { margin: 0 0 8px; font-size: 1.1rem; }
.modal-desc { font-size: 0.9rem; color: var(--color-text-muted, #888); margin-bottom: 16px; }

label { display: block; font-size: 0.85rem; color: var(--color-text-light); margin-bottom: 4px; }
.required { color: var(--color-error); }
.optional { font-size: 0.75rem; color: var(--color-text-muted, #888); }

textarea {
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-background-input);
  color: var(--color-text);
  font-size: 0.9rem;
  box-sizing: border-box;
  resize: vertical;
}

.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }

button {
  padding: 8px 14px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  background: var(--color-error, #dc3545);
  color: white;
  font-size: 0.9rem;
}
button:hover { opacity: 0.9; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary { background: var(--color-button-secondary); color: var(--color-text); }
.btn-secondary:hover { background: var(--color-button-secondary-hover); }

.error { color: var(--color-error); font-size: 0.85rem; margin: 6px 0 0; }
</style>
