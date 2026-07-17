<template>
  <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="pro-badge">Pro</div>
      <h2>Upgrade to Prosaurus Pro</h2>
      <p class="modal-desc">{{ message || "You've reached the free-tier limit for this session type." }}</p>

      <ul class="feature-list">
        <li><span class="check">✓</span> Unlimited band &amp; individual sessions</li>
        <li><span class="check">✓</span> Extra storage on Sessions</li>
        <li><span class="check">✓</span> No Prosaurus platform fee on art sales</li>
      </ul>

      <p v-if="error" class="error">{{ error }}</p>

      <div class="modal-actions">
        <button type="button" class="btn-pro" :disabled="subscribing" @click="subscribe">
          {{ subscribing ? 'Redirecting…' : 'Upgrade to Pro — $3.99/mo' }}
        </button>
        <button type="button" class="btn-secondary" @click="$emit('close')">Not now</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { authFetch } from '@/utilities/authFetch'

const props = defineProps({
  visible: Boolean,
  message: { type: String, default: '' }
})
const emit = defineEmits(['close'])

const subscribing = ref(false)
const error = ref('')

watch(() => props.visible, (val) => {
  if (val) {
    error.value = ''
    subscribing.value = false
  }
})

async function subscribe() {
  if (subscribing.value) return
  subscribing.value = true
  error.value = ''
  try {
    const res = await authFetch('/api/billing/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnTo: '/sessions' })
    })
    if (res.ok) {
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
        return
      }
      // Already subscribed (e.g. re-opened after subscribing elsewhere) — just close.
      emit('close')
    } else {
      error.value = 'Something went wrong. Please try again.'
    }
  } catch {
    error.value = 'Network error. Please try again.'
  } finally {
    subscribing.value = false
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

.pro-badge {
  display: inline-block;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 3px 10px;
  border-radius: 20px;
  background: rgba(107, 70, 193, 0.12);
  color: #6b46c1;
  margin-bottom: 10px;
}

.modal h2 { margin: 0 0 8px; font-size: 1.15rem; }
.modal-desc { font-size: 0.9rem; color: var(--color-text-muted, #888); margin-bottom: 16px; line-height: 1.5; }

.feature-list {
  list-style: none;
  margin: 0 0 16px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 0.88rem;
  color: var(--color-text-secondary);
}

.feature-list li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.check {
  color: #4caf50;
  flex-shrink: 0;
}

.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }

button {
  padding: 9px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.88rem;
  font-weight: 600;
}

.btn-pro {
  background: #6b46c1;
  color: #fff;
}
.btn-pro:hover:not(:disabled) { opacity: 0.88; }
.btn-pro:disabled { opacity: 0.55; cursor: not-allowed; }

.btn-secondary {
  background: var(--color-button-secondary);
  color: var(--color-text);
  font-weight: 500;
}
.btn-secondary:hover { background: var(--color-button-secondary-hover); }

.error { color: var(--color-error); font-size: 0.85rem; margin: 6px 0 0; }
</style>
