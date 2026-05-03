<template>
  <main class="storefront-page page-container">

    <div class="page-header">
      <div class="header-left">
        <RouterLink to="/collections" class="back-link">← Collections</RouterLink>
        <h1>Storefront</h1>
        <p class="page-desc">
          Your public-facing landing page. Visitors who arrive at your domain will see this page first.
        </p>
      </div>
      <div class="header-actions">
        <a
          v-if="storeUrl && urlAvailable !== false"
          :href="`/store/${storeUrl}`"
          target="_blank"
          rel="noopener"
          class="btn-secondary"
        >View Store ↗</a>
        <span v-if="savedAt" class="saved-indicator">Saved {{ savedAt }}</span>
        <button class="btn-primary" :disabled="saving || !canSave" @click="save">
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="loading-state">Loading…</div>

    <template v-else>
      <div class="form-section">

        <!-- Store URL -->
        <div class="form-group">
          <label class="form-label" for="store-url">Store URL</label>
          <p class="form-hint">
            Your store will be publicly accessible at this address. Use lowercase letters, numbers, and hyphens only.
            Point your own domain here to make it look fully independent.
          </p>
          <div class="url-field">
            <span class="url-prefix">{{ origin }}/store/</span>
            <input
              id="store-url"
              v-model="storeUrl"
              type="text"
              class="url-input"
              placeholder="my-store"
              maxlength="60"
              spellcheck="false"
              @input="onUrlInput"
            />
          </div>
          <div class="url-status" :class="urlStatusClass">
            <template v-if="urlChecking">Checking…</template>
            <template v-else-if="storeUrl && urlAvailable === true">Available</template>
            <template v-else-if="storeUrl && urlAvailable === false">
              {{ urlReason || 'Not available' }}
            </template>
          </div>
        </div>

        <!-- Page title -->
        <div class="form-group">
          <label class="form-label" for="page-title">Page Title</label>
          <p class="form-hint">Shown as the main heading and in the browser tab.</p>
          <input
            id="page-title"
            v-model="pageTitle"
            type="text"
            class="form-input"
            placeholder="e.g. My Art Store"
            maxlength="255"
          />
        </div>

        <!-- Section builder -->
        <div class="form-group">
          <label class="form-label">Page Sections</label>
          <p class="form-hint">Drag to reorder. Toggle the eye to show or hide a section on your public store.</p>

          <draggable
            v-model="sections"
            item-key="id"
            handle=".drag-handle"
            class="sections-list"
            :animation="150"
          >
            <template #item="{ element: section }">
              <div class="section-card" :class="{ 'section-hidden': !section.visible }">
                <div class="section-card-header">
                  <span class="drag-handle" title="Drag to reorder">⠿</span>
                  <span class="section-type-label">{{ section.type === 'content' ? 'Content' : 'Collections' }}</span>
                  <button
                    class="visibility-btn"
                    :title="section.visible ? 'Hide section' : 'Show section'"
                    @click="section.visible = !section.visible"
                  >
                    <svg v-if="section.visible" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                    <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  </button>
                </div>

                <div v-if="section.visible" class="section-card-body">
                  <!-- Content section -->
                  <template v-if="section.type === 'content'">
                    <StorefrontEditor v-model="contentBody" />
                  </template>

                  <!-- Collections section -->
                  <template v-else-if="section.type === 'collections'">
                    <div class="form-group" style="gap:4px">
                      <label class="form-label" style="font-size:0.82rem">Section heading</label>
                      <input
                        v-model="section.title"
                        type="text"
                        class="form-input"
                        placeholder="e.g. My Collections"
                        maxlength="120"
                        style="max-width:360px"
                      />
                    </div>
                    <p class="form-hint" style="margin-top:8px">
                      All your collections will appear here automatically. Manage them on the
                      <RouterLink to="/collections">Collections</RouterLink> page.
                    </p>
                  </template>
                </div>

                <div v-else class="section-hidden-label">Hidden from public store</div>
              </div>
            </template>
          </draggable>
        </div>

      </div>

      <div class="save-row">
        <span v-if="savedAt" class="saved-indicator">Saved {{ savedAt }}</span>
        <button class="btn-primary" :disabled="saving || !canSave" @click="save">
          {{ saving ? 'Saving…' : 'Save Storefront' }}
        </button>
      </div>
    </template>

  </main>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { RouterLink } from 'vue-router'
import { authFetch } from '@/utilities/authFetch'
import StorefrontEditor from '@/components/StorefrontEditor.vue'
import draggable from 'vuedraggable'

const DEFAULT_SECTIONS = [
  { id: 'content', type: 'content', visible: true },
  { id: 'collections', type: 'collections', visible: true, title: 'My Collections' }
]

const loading = ref(true)
const saving = ref(false)
const savedAt = ref(null)
const storeUrl = ref('')
const pageTitle = ref('')
const contentBody = ref('')
const sections = ref(DEFAULT_SECTIONS.map(s => ({ ...s })))

const urlChecking = ref(false)
const urlAvailable = ref(null)
const urlReason = ref('')

const origin = window.location.origin

const urlStatusClass = computed(() => {
  if (urlChecking.value) return 'checking'
  if (!storeUrl.value) return ''
  return urlAvailable.value ? 'available' : 'taken'
})

const canSave = computed(() => {
  if (!storeUrl.value) return false
  if (urlChecking.value) return false
  if (urlAvailable.value === false) return false
  return true
})

let urlCheckTimer = null

function onUrlInput() {
  storeUrl.value = storeUrl.value.toLowerCase().replace(/[^a-z0-9-]/g, '')
  urlAvailable.value = null
  urlReason.value = ''
  clearTimeout(urlCheckTimer)
  if (storeUrl.value.length >= 3) {
    urlCheckTimer = setTimeout(checkUrl, 500)
  }
}

async function checkUrl() {
  if (!storeUrl.value) return
  urlChecking.value = true
  try {
    const res = await authFetch(`/api/storefront/check-url/${storeUrl.value}`)
    if (res.ok) {
      const data = await res.json()
      urlAvailable.value = data.available
      urlReason.value = data.reason || ''
    }
  } catch (err) {
    console.error('URL check failed:', err)
  } finally {
    urlChecking.value = false
  }
}

async function fetchStorefront() {
  loading.value = true
  try {
    const res = await authFetch('/api/storefront')
    if (res.ok) {
      const data = await res.json()
      if (data) {
        storeUrl.value = data.store_url || ''
        pageTitle.value = data.page_title || ''
        contentBody.value = data.content || ''
        savedAt.value = formatDate(data.updated_at)
        if (storeUrl.value) urlAvailable.value = true
        if (data.settings && data.settings.sections) {
          sections.value = data.settings.sections
        }
      }
    }
  } catch (err) {
    console.error('Failed to fetch storefront:', err)
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!canSave.value || saving.value) return
  saving.value = true
  try {
    const res = await authFetch('/api/storefront', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store_url: storeUrl.value,
        page_title: pageTitle.value,
        content: contentBody.value,
        settings: { sections: sections.value }
      })
    })
    if (res.ok) {
      savedAt.value = formatDate(new Date().toISOString())
    } else if (res.status === 409) {
      urlAvailable.value = false
      urlReason.value = 'That store URL is already taken.'
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
onBeforeUnmount(() => clearTimeout(urlCheckTimer))
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

.back-link:hover { text-decoration: underline; }

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
  gap: 12px;
  padding-top: 4px;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.loading-state {
  color: var(--color-text-secondary);
  padding: 60px 0;
  text-align: center;
}

/* ---- URL field ---- */
.url-field {
  display: flex;
  align-items: center;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  overflow: hidden;
  max-width: 560px;
  background: var(--color-background, #fff);
  transition: border-color 0.15s;
}

.url-field:focus-within {
  border-color: var(--color-link);
}

.url-prefix {
  padding: 10px 10px 10px 13px;
  background: var(--color-background-soft, #f5f5f5);
  border-right: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  white-space: nowrap;
  flex-shrink: 0;
}

.url-input {
  flex: 1;
  border: none;
  outline: none;
  padding: 10px 13px;
  font-size: 0.95rem;
  color: var(--color-text);
  background: transparent;
  min-width: 0;
  font-family: monospace;
}

.url-status {
  font-size: 0.8rem;
  margin-top: 5px;
  min-height: 1.1em;
  color: var(--color-text-secondary);
}

.url-status.available { color: #2f855a; }
.url-status.taken { color: #c53030; }
.url-status.checking { color: var(--color-text-secondary); }

/* ---- Form ---- */
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

/* ---- Section Builder ---- */
.sections-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
}

.section-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--color-background, #fff);
  transition: opacity 0.15s;
}

.section-card.section-hidden {
  opacity: 0.6;
}

.section-card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--color-background-soft, #f5f5f5);
  border-bottom: 1px solid var(--color-border);
  user-select: none;
}

.drag-handle {
  cursor: grab;
  font-size: 1.2rem;
  color: var(--color-text-secondary);
  line-height: 1;
  flex-shrink: 0;
}

.drag-handle:active {
  cursor: grabbing;
}

.section-type-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text);
  flex: 1;
}

.visibility-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-secondary);
  padding: 2px;
  display: flex;
  align-items: center;
  border-radius: 4px;
  transition: color 0.15s;
}

.visibility-btn:hover {
  color: var(--color-text);
}

.section-card-body {
  padding: 16px 14px;
}

.section-hidden-label {
  padding: 10px 14px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  font-style: italic;
}

/* ---- Buttons ---- */
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

.btn-primary:hover:not(:disabled) { opacity: 0.87; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-secondary {
  background: transparent;
  color: var(--color-link);
  border: 1px solid var(--color-link);
  padding: 9px 16px;
  border-radius: 7px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
  white-space: nowrap;
  transition: background 0.15s;
}

.btn-secondary:hover {
  background: rgba(0,0,0,0.04);
}

/* ---- Save row ---- */
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

@media (max-width: 600px) {
  .page-header { flex-direction: column; }
  .header-actions { width: 100%; }
  .url-prefix { font-size: 0.8rem; padding: 10px 8px; }
}
</style>
