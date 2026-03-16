<template>
  <div class="admin-moderation">
    <h1>Content Moderation</h1>

    <!-- Top-level tabs -->
    <div class="tabs">
      <button
        v-for="tab in mainTabs"
        :key="tab.key"
        :class="['tab-btn', { active: activeTab === tab.key }]"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- ============================= -->
    <!-- Flagged Content Tab           -->
    <!-- ============================= -->
    <div v-if="activeTab === 'flags'" class="tab-content">
      <div class="sub-tabs">
        <button
          :class="['sub-tab-btn', { active: flagsSubTab === 'pending' }]"
          @click="flagsSubTab = 'pending'; loadFlags()"
        >
          Pending
        </button>
        <button
          :class="['sub-tab-btn', { active: flagsSubTab === 'resolved' }]"
          @click="flagsSubTab = 'resolved'; loadFlags()"
        >
          Resolved
        </button>
      </div>

      <div v-if="flagsLoading" class="loading">Loading...</div>
      <div v-else-if="flags.length === 0" class="empty-message">No items to display.</div>
      <div v-else class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Content Snippet</th>
              <th>Author</th>
              <th>Flagged By</th>
              <th>Reason</th>
              <th>Date</th>
              <th>Age</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="flag in flags" :key="flag.id">
              <td><span class="content-type-badge">{{ flag.content_type }}</span></td>
              <td class="snippet-cell">{{ flag.snippet || '—' }}</td>
              <td>{{ flag.author_handle || '—' }}</td>
              <td>{{ flag.flagger_handle || '—' }}</td>
              <td class="reason-cell">{{ flag.reason || '—' }}</td>
              <td>{{ formatDate(flag.created_at) }}</td>
              <td :class="['age-cell', { 'age-warning': isOldPending(flag) }]">
                <span v-if="isOldPending(flag)">⚠️ </span>{{ formatAge(flag.created_at) }}
              </td>
              <td class="actions-cell">
                <template v-if="flag.status === 'pending'">
                  <button class="btn btn-danger btn-sm" @click="approveFlag(flag.id)">
                    Approve Removal
                  </button>
                  <button class="btn btn-secondary btn-sm" @click="restoreFlag(flag.id)">
                    Restore Content
                  </button>
                  <button
                    v-if="flag.content_author_id && !flag.author_restricted"
                    class="btn btn-warning btn-sm"
                    @click="ejectUser(flag.content_author_id, flag)"
                  >
                    Eject User
                  </button>
                </template>
                <template v-else>
                  <span class="status-badge" :class="'status-' + flag.status">{{ flag.status }}</span>
                  <span v-if="flag.reviewer_handle" class="reviewer-info">by {{ flag.reviewer_handle }}</span>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ============================= -->
    <!-- Keyword Filter Tab            -->
    <!-- ============================= -->
    <div v-if="activeTab === 'keywords'" class="tab-content">
      <div class="add-keyword-form">
        <h2>Add Keyword</h2>
        <div class="form-row">
          <input
            v-model="newKeyword"
            class="text-input"
            type="text"
            placeholder="Enter keyword to filter..."
            @keyup.enter="addKeyword"
          />
          <button class="btn btn-primary" @click="addKeyword" :disabled="keywordsLoading">
            Add
          </button>
        </div>
        <p v-if="keywordError" class="error-message">{{ keywordError }}</p>
      </div>

      <div v-if="keywordsLoading" class="loading">Loading...</div>
      <div v-else-if="keywords.length === 0" class="empty-message">No keywords configured.</div>
      <div v-else class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Keyword</th>
              <th>Status</th>
              <th>Added</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="kw in keywords" :key="kw.id">
              <td>{{ kw.keyword }}</td>
              <td>
                <span :class="['status-badge', kw.is_active ? 'status-active' : 'status-inactive']">
                  {{ kw.is_active ? 'Active' : 'Inactive' }}
                </span>
              </td>
              <td>{{ formatDate(kw.created_at) }}</td>
              <td>
                <button class="btn btn-danger btn-sm" @click="deleteKeyword(kw.id)">
                  Delete
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ============================= -->
    <!-- Frequent Flaggers Tab         -->
    <!-- ============================= -->
    <div v-if="activeTab === 'flaggers'" class="tab-content">
      <div v-if="flaggersLoading" class="loading">Loading...</div>
      <div v-else-if="flaggers.length === 0" class="empty-message">No flaggers found.</div>
      <div v-else class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Handle</th>
              <th>Flag Count</th>
              <th>Flag Banned</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="flagger in flaggers" :key="flagger.id">
              <td>{{ flagger.handle }}</td>
              <td>{{ flagger.flag_count }}</td>
              <td>
                <span :class="['status-badge', flagger.is_flag_banned ? 'status-banned' : 'status-active']">
                  {{ flagger.is_flag_banned ? 'Banned' : 'Active' }}
                </span>
              </td>
              <td>
                <button
                  :class="['btn', 'btn-sm', flagger.is_flag_banned ? 'btn-secondary' : 'btn-warning']"
                  @click="toggleFlagBan(flagger)"
                >
                  {{ flagger.is_flag_banned ? 'Enable Flagging' : 'Disable Flagging' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'

// =====================================
// State
// =====================================

const mainTabs = [
  { key: 'flags', label: 'Flagged Content' },
  { key: 'keywords', label: 'Keyword Filter' },
  { key: 'flaggers', label: 'Frequent Flaggers' }
]

const activeTab = ref('flags')
const flagsSubTab = ref('pending')

// Flags
const flags = ref([])
const flagsLoading = ref(false)

// Keywords
const keywords = ref([])
const keywordsLoading = ref(false)
const newKeyword = ref('')
const keywordError = ref('')

// Flaggers
const flaggers = ref([])
const flaggersLoading = ref(false)

// =====================================
// Watch tab changes
// =====================================

watch(activeTab, (tab) => {
  if (tab === 'flags') loadFlags()
  else if (tab === 'keywords') loadKeywords()
  else if (tab === 'flaggers') loadFlaggers()
})

// =====================================
// Flags
// =====================================

async function loadFlags() {
  flagsLoading.value = true
  try {
    const statusParam = flagsSubTab.value === 'resolved' ? 'resolved' : 'pending'
    const res = await fetch(`/api/moderation/flags?status=${statusParam}`, { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      // Augment flags with restriction check
      const rawFlags = data.flags || []
      for (const flag of rawFlags) {
        flag.author_restricted = false
        if (flag.content_author_id) {
          // Check done client-side via flaggers or just mark false; restriction check is UI hint only
        }
      }
      flags.value = rawFlags
    }
  } catch (err) {
    console.error('Failed to load flags:', err)
  } finally {
    flagsLoading.value = false
  }
}

async function approveFlag(flagId) {
  try {
    const res = await fetch(`/api/moderation/flags/${flagId}/approve`, {
      method: 'PUT',
      credentials: 'include'
    })
    if (res.ok) {
      await loadFlags()
    }
  } catch (err) {
    console.error('Failed to approve flag:', err)
  }
}

async function restoreFlag(flagId) {
  try {
    const res = await fetch(`/api/moderation/flags/${flagId}/restore`, {
      method: 'PUT',
      credentials: 'include'
    })
    if (res.ok) {
      await loadFlags()
    }
  } catch (err) {
    console.error('Failed to restore flag:', err)
  }
}

async function ejectUser(userId, flag) {
  if (!confirm('Eject user and hide all their content?')) return
  try {
    const res = await fetch(`/api/moderation/eject/${userId}`, {
      method: 'POST',
      credentials: 'include'
    })
    if (res.ok) {
      flag.author_restricted = true
      await loadFlags()
    }
  } catch (err) {
    console.error('Failed to eject user:', err)
  }
}

// =====================================
// Keywords
// =====================================

async function loadKeywords() {
  keywordsLoading.value = true
  keywordError.value = ''
  try {
    const res = await fetch('/api/moderation/keywords', { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      keywords.value = data.keywords || []
    }
  } catch (err) {
    console.error('Failed to load keywords:', err)
  } finally {
    keywordsLoading.value = false
  }
}

async function addKeyword() {
  const kw = newKeyword.value.trim()
  if (!kw) {
    keywordError.value = 'Please enter a keyword.'
    return
  }
  keywordError.value = ''
  try {
    const res = await fetch('/api/moderation/keywords', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: kw })
    })
    if (res.ok) {
      newKeyword.value = ''
      await loadKeywords()
    } else {
      const data = await res.json()
      keywordError.value = data.message || 'Failed to add keyword.'
    }
  } catch (err) {
    keywordError.value = 'Failed to add keyword.'
    console.error('Failed to add keyword:', err)
  }
}

async function deleteKeyword(keywordId) {
  try {
    const res = await fetch(`/api/moderation/keywords/${keywordId}`, {
      method: 'DELETE',
      credentials: 'include'
    })
    if (res.ok) {
      await loadKeywords()
    }
  } catch (err) {
    console.error('Failed to delete keyword:', err)
  }
}

// =====================================
// Flaggers
// =====================================

async function loadFlaggers() {
  flaggersLoading.value = true
  try {
    const res = await fetch('/api/moderation/flaggers', { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      flaggers.value = data.flaggers || []
    }
  } catch (err) {
    console.error('Failed to load flaggers:', err)
  } finally {
    flaggersLoading.value = false
  }
}

async function toggleFlagBan(flagger) {
  try {
    const res = await fetch(`/api/moderation/users/${flagger.id}/flag-ban`, {
      method: 'PUT',
      credentials: 'include'
    })
    if (res.ok) {
      const data = await res.json()
      flagger.is_flag_banned = data.is_flag_banned
    }
  } catch (err) {
    console.error('Failed to toggle flag ban:', err)
  }
}

// =====================================
// Formatting helpers
// =====================================

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleString()
}

function formatAge(str) {
  if (!str) return '—'
  const diffMs = Date.now() - new Date(str).getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 60) return `${diffMins}m`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays} days`
}

function isOldPending(flag) {
  if (flag.status !== 'pending') return false
  const diffMs = Date.now() - new Date(flag.created_at).getTime()
  const diffHours = diffMs / 3600000
  return diffHours > 20
}

// =====================================
// Init
// =====================================

onMounted(() => {
  loadFlags()
})
</script>

<style scoped>
.admin-moderation {
  padding: 24px;
  color: var(--color-text);
}

h1 {
  font-size: 1.6rem;
  font-weight: 600;
  margin-bottom: 24px;
  color: var(--color-text);
}

h2 {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--color-text);
}

/* ======================== */
/* Tabs                     */
/* ======================== */

.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 2px solid var(--color-border);
  margin-bottom: 24px;
}

.tab-btn {
  padding: 10px 20px;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--color-text);
  font-size: 0.95rem;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: color 0.15s, border-color 0.15s;
}

.tab-btn:hover {
  color: var(--color-accent);
}

.tab-btn.active {
  color: var(--color-accent);
  border-bottom-color: var(--color-accent);
  font-weight: 600;
}

.sub-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
}

.sub-tab-btn {
  padding: 6px 16px;
  border: 1px solid var(--color-border);
  background: var(--color-background-card);
  cursor: pointer;
  color: var(--color-text);
  font-size: 0.875rem;
  border-radius: 4px;
  transition: background 0.15s, color 0.15s;
}

.sub-tab-btn:hover {
  background: var(--color-border);
}

.sub-tab-btn.active {
  background: var(--color-accent);
  color: #fff;
  border-color: var(--color-accent);
}

/* ======================== */
/* Tab content              */
/* ======================== */

.tab-content {
  min-height: 200px;
}

/* ======================== */
/* Loading / empty states   */
/* ======================== */

.loading {
  padding: 24px;
  text-align: center;
  color: var(--color-text);
  opacity: 0.6;
}

.empty-message {
  padding: 32px;
  text-align: center;
  color: var(--color-text);
  opacity: 0.5;
  font-style: italic;
}

/* ======================== */
/* Table                    */
/* ======================== */

.table-wrapper {
  overflow-x: auto;
  border-radius: 8px;
  border: 1px solid var(--color-border);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.data-table th {
  background: var(--color-background-card);
  color: var(--color-text);
  padding: 10px 12px;
  text-align: left;
  font-weight: 600;
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
}

.data-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}

.data-table tr:last-child td {
  border-bottom: none;
}

.data-table tr:hover td {
  background: var(--color-background-card);
}

.snippet-cell {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reason-cell {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions-cell {
  white-space: nowrap;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}

/* ======================== */
/* Age warning              */
/* ======================== */

.age-cell.age-warning {
  color: var(--color-error);
  font-weight: 600;
}

/* ======================== */
/* Badges                   */
/* ======================== */

.content-type-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.75rem;
  background: var(--color-border);
  color: var(--color-text);
}

.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.75rem;
  font-weight: 600;
}

.status-pending {
  background: #f3c84a22;
  color: #c9a227;
}

.status-approved {
  background: #e74c3c22;
  color: var(--color-error, #e74c3c);
}

.status-restored {
  background: #2ecc7122;
  color: #27ae60;
}

.status-active {
  background: #2ecc7122;
  color: #27ae60;
}

.status-inactive {
  background: var(--color-border);
  color: var(--color-text);
  opacity: 0.7;
}

.status-banned {
  background: #e74c3c22;
  color: var(--color-error, #e74c3c);
}

.reviewer-info {
  font-size: 0.75rem;
  opacity: 0.6;
  margin-left: 4px;
}

/* ======================== */
/* Buttons                  */
/* ======================== */

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: opacity 0.15s;
}

.btn:hover {
  opacity: 0.85;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-sm {
  padding: 4px 10px;
  font-size: 0.8rem;
}

.btn-primary {
  background: var(--color-accent);
  color: #fff;
}

.btn-danger {
  background: var(--color-error, #e74c3c);
  color: #fff;
}

.btn-secondary {
  background: var(--color-border);
  color: var(--color-text);
}

.btn-warning {
  background: #e67e22;
  color: #fff;
}

/* ======================== */
/* Add keyword form         */
/* ======================== */

.add-keyword-form {
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 20px;
}

.form-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.text-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-background-card);
  color: var(--color-text);
  font-size: 0.9rem;
  max-width: 400px;
}

.text-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.error-message {
  margin-top: 8px;
  color: var(--color-error);
  font-size: 0.875rem;
}
</style>
