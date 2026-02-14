<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import LoadingSpinner from './LoadingSpinner.vue'

const emit = defineEmits(['close', 'saved'])

// Expose window for template use
const origin = window.location.origin

const settings = ref(null)
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const success = ref('')

const form = ref({
  blog_url: '',
  blog_name: ''
})

const urlAvailable = ref(null)
const checkingUrl = ref(false)

const publicUrl = computed(() => {
  if (!form.value.blog_url) return ''
  return `${window.location.origin}/b/${form.value.blog_url}`
})

onMounted(() => {
  fetchSettings()
})

// Debounced URL availability check
let urlCheckTimeout = null
watch(() => form.value.blog_url, (newUrl) => {
  urlAvailable.value = null
  if (urlCheckTimeout) clearTimeout(urlCheckTimeout)
  if (newUrl && newUrl.trim().length > 0) {
    urlCheckTimeout = setTimeout(() => checkUrlAvailability(newUrl.trim()), 500)
  }
})

async function fetchSettings() {
  loading.value = true
  error.value = ''

  try {
    const res = await fetch('/api/blog/settings', { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      settings.value = data.settings
      if (data.settings) {
        form.value.blog_url = data.settings.blog_url
        form.value.blog_name = data.settings.blog_name
      }
    }
  } catch (err) {
    error.value = 'Failed to load settings'
  } finally {
    loading.value = false
  }
}

async function checkUrlAvailability(url) {
  if (!url) return
  checkingUrl.value = true

  try {
    const res = await fetch(`/api/blog/check-url/${encodeURIComponent(url)}`, {
      credentials: 'include'
    })
    if (res.ok) {
      const data = await res.json()
      urlAvailable.value = data.available
    }
  } catch (err) {
    console.error('Error checking URL:', err)
  } finally {
    checkingUrl.value = false
  }
}

async function saveSettings() {
  if (!form.value.blog_url || form.value.blog_url.trim().length === 0) {
    error.value = 'Blog URL is required'
    return
  }

  saving.value = true
  error.value = ''
  success.value = ''

  try {
    const method = settings.value ? 'PUT' : 'POST'
    const res = await fetch('/api/blog/settings', {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        blog_url: form.value.blog_url.trim(),
        blog_name: form.value.blog_name.trim() || `${form.value.blog_url}'s Blog`
      })
    })

    const data = await res.json()

    if (res.ok) {
      settings.value = data.settings
      success.value = 'Settings saved successfully!'
      emit('saved', data.settings)
    } else {
      error.value = data.message || 'Failed to save settings'
    }
  } catch (err) {
    error.value = 'Failed to save settings: ' + err.message
  } finally {
    saving.value = false
  }
}

function close() {
  emit('close')
}
</script>

<template>
  <div class="modal-overlay" @click.self="close">
    <div class="modal blog-settings-modal">
      <header class="modal-header">
        <h2>Blog Settings</h2>
        <button class="close-btn" @click="close">&times;</button>
      </header>

      <div v-if="loading" class="loading">
        <LoadingSpinner size="small" /> Loading settings...
      </div>

      <div v-else class="modal-body">
        <div class="form-group">
          <label>Blog Name</label>
          <input
            v-model="form.blog_name"
            type="text"
            placeholder="My Awesome Blog"
          />
        </div>

        <div class="form-group">
          <label>Blog URL</label>
          <div class="url-input-wrapper">
            <span class="url-prefix">{{ origin }}/b/</span>
            <input
              v-model="form.blog_url"
              type="text"
              placeholder="your-blog-url"
              class="url-input"
            />
          </div>
          <div v-if="checkingUrl" class="url-status checking">
            Checking availability...
          </div>
          <div v-else-if="urlAvailable === true" class="url-status available">
            URL is available
          </div>
          <div v-else-if="urlAvailable === false" class="url-status taken">
            URL is already taken
          </div>
        </div>

        <div v-if="publicUrl" class="public-url-preview">
          <label>Public Blog URL:</label>
          <a :href="publicUrl" target="_blank" class="public-url-link">{{ publicUrl }}</a>
        </div>

        <p v-if="error" class="error">{{ error }}</p>
        <p v-if="success" class="success">{{ success }}</p>

        <div class="modal-actions">
          <button @click="close" class="btn-secondary">Cancel</button>
          <button
            @click="saveSettings"
            :disabled="saving || urlAvailable === false"
            class="btn-primary"
          >
            {{ saving ? 'Saving...' : 'Save Settings' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: var(--color-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--color-background-card);
  border-radius: 10px;
  box-shadow: var(--shadow-lg);
  max-width: 500px;
  width: 95%;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 25px;
  border-bottom: 1px solid var(--color-border);
}

.modal-header h2 {
  margin: 0;
  font-size: 1.3rem;
  color: var(--color-text);
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.8rem;
  color: var(--color-text-light);
  cursor: pointer;
  line-height: 1;
  padding: 0;
}

.close-btn:hover {
  color: var(--color-text);
}

.modal-body {
  padding: 25px;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px;
  color: var(--color-text-light);
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: var(--color-text);
}

.form-group input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 1rem;
  box-sizing: border-box;
  background: var(--color-background-input);
  color: var(--color-text);
}

.form-group input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.url-input-wrapper {
  display: flex;
  align-items: center;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}

.url-prefix {
  background: var(--color-background-soft);
  padding: 10px 12px;
  color: var(--color-text-muted);
  font-size: 0.9rem;
  white-space: nowrap;
  border-right: 1px solid var(--color-border);
}

.url-input {
  border: none !important;
  border-radius: 0 !important;
  flex: 1;
}

.url-input:focus {
  border: none !important;
}

.url-status {
  margin-top: 6px;
  font-size: 0.85rem;
}

.url-status.checking {
  color: var(--color-text-light);
}

.url-status.available {
  color: var(--color-success);
}

.url-status.taken {
  color: var(--color-error);
}

.public-url-preview {
  background: var(--color-background-soft);
  padding: 15px;
  border-radius: 6px;
  margin-bottom: 20px;
}

.public-url-preview label {
  display: block;
  margin-bottom: 6px;
  font-size: 0.9rem;
  color: var(--color-text-muted);
}

.public-url-link {
  color: var(--color-accent);
  word-break: break-all;
}

.error {
  color: var(--color-error);
  margin: 15px 0;
}

.success {
  color: var(--color-success);
  margin: 15px 0;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--color-border);
}

.btn-primary,
.btn-secondary {
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 1rem;
  cursor: pointer;
  border: none;
}

.btn-primary {
  background: var(--color-accent);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--color-button-secondary);
  color: var(--color-text);
}

.btn-secondary:hover {
  background: var(--color-button-secondary-hover);
}

/* Mobile responsive styles */
@media (max-width: 768px) {
  .modal-body {
    padding: 15px;
  }

  .url-input-wrapper {
    flex-direction: column;
    align-items: stretch;
  }

  .url-prefix {
    border-right: none;
    border-bottom: 1px solid var(--color-border);
    font-size: 0.8rem;
    padding: 8px 12px;
  }

  .modal-actions {
    flex-direction: column;
  }

  .modal-actions .btn-primary,
  .modal-actions .btn-secondary {
    width: 100%;
  }
}
</style>
