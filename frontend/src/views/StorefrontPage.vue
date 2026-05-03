<template>
  <main class="storefront-page page-container">

    <div class="page-header">
      <div class="header-left">
        <RouterLink to="/collections" class="back-link">← Collections</RouterLink>
        <h1>Storefront</h1>
        <p class="page-desc">
          This is your public-facing landing page. Visitors who arrive at your domain will see this page first.
        </p>
      </div>
      <div class="header-actions">
        <span v-if="savedAt" class="saved-indicator">Saved {{ savedAt }}</span>
        <button class="btn-primary" :disabled="saving" @click="save">
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="loading-state">Loading…</div>

    <template v-else>
      <div class="form-section">
        <div class="form-group">
          <label class="form-label" for="page-title">Page Title</label>
          <p class="form-hint">Shown in the browser tab and as the main heading on your public page.</p>
          <input
            id="page-title"
            v-model="pageTitle"
            type="text"
            class="form-input"
            placeholder="e.g. My Art Store"
            maxlength="255"
          />
        </div>

        <div class="form-group">
          <label class="form-label">Content</label>
          <p class="form-hint">Use the toolbar to add headings, lists, quotes, and more — no HTML required.</p>
          <StorefrontEditor v-model="content" />
        </div>
      </div>

      <div class="save-row">
        <span v-if="savedAt" class="saved-indicator">Saved {{ savedAt }}</span>
        <button class="btn-primary" :disabled="saving" @click="save">
          {{ saving ? 'Saving…' : 'Save Storefront' }}
        </button>
      </div>
    </template>

  </main>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { authFetch } from '@/utilities/authFetch'
import StorefrontEditor from '@/components/StorefrontEditor.vue'

const loading = ref(true)
const saving = ref(false)
const savedAt = ref(null)
const pageTitle = ref('')
const content = ref('')

async function fetchStorefront() {
  loading.value = true
  try {
    const res = await authFetch('/api/storefront')
    if (res.ok) {
      const data = await res.json()
      if (data) {
        pageTitle.value = data.page_title || ''
        content.value = data.content || ''
        savedAt.value = formatDate(data.updated_at)
      }
    }
  } catch (err) {
    console.error('Failed to fetch storefront:', err)
  } finally {
    loading.value = false
  }
}

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    const res = await authFetch('/api/storefront', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_title: pageTitle.value, content: content.value })
    })
    if (res.ok) {
      savedAt.value = formatDate(new Date().toISOString())
    }
  } catch (err) {
    console.error('Failed to save storefront:', err)
  } finally {
    saving.value = false
  }
}

function formatDate(isoString) {
  if (!isoString) return null
  const d = new Date(isoString)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

onMounted(fetchStorefront)
</script>

<style scoped>
.storefront-page {
  padding: 32px 20px;
  max-width: 860px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 36px;
  flex-wrap: wrap;
}

.back-link {
  display: inline-block;
  color: var(--color-link);
  text-decoration: none;
  font-size: 0.88rem;
  margin-bottom: 8px;
}

.back-link:hover {
  text-decoration: underline;
}

.header-left h1 {
  font-size: 1.8rem;
  color: var(--color-text);
  margin: 0 0 8px;
}

.page-desc {
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  margin: 0;
  max-width: 480px;
  line-height: 1.5;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  padding-top: 4px;
  flex-shrink: 0;
}

.loading-state {
  color: var(--color-text-secondary);
  padding: 60px 0;
  text-align: center;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--color-text);
}

.form-hint {
  font-size: 0.82rem;
  color: var(--color-text-secondary);
  margin: 0;
  line-height: 1.4;
}

.form-input {
  padding: 10px 13px;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  font-size: 1rem;
  color: var(--color-text);
  background: var(--color-background, #fff);
  transition: border-color 0.15s;
  max-width: 480px;
}

.form-input:focus {
  outline: none;
  border-color: var(--color-link);
}

.save-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid var(--color-border);
}

.saved-indicator {
  font-size: 0.82rem;
  color: var(--color-text-secondary);
}

.btn-primary {
  background: var(--color-link);
  color: #fff;
  border: none;
  padding: 10px 22px;
  border-radius: 7px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
  white-space: nowrap;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.87;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 600px) {
  .page-header {
    flex-direction: column;
  }

  .header-actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
