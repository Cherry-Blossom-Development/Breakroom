<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authFetch } from '../utilities/authFetch'
import StatusBadge from '../components/StatusBadge.vue'
import LoadingSpinner from '../components/LoadingSpinner.vue'
import InviteAutocomplete from '../components/InviteAutocomplete.vue'

// Project settings (migration 082): sprint duration and project members.
// Roles and what they allow are enforced by the backend
// (backend/utilities/projectAccess.js); this page only hides controls the
// current user can't use.
const route = useRoute()
const router = useRouter()
const projectId = route.params.id

const loading = ref(true)
const error = ref(null)

const canManage = ref(false)
const canManageOwners = ref(false)
const currentUserId = ref(null)
const roles = ref([])
const members = ref([])

const ROLE_LABELS = { owner: 'Owner', manager: 'Manager', member: 'Member', viewer: 'Viewer' }
const ROLE_HINTS = {
  owner: 'Manages settings and members, including owners',
  manager: 'Manages settings and members',
  member: 'Works on tickets',
  viewer: 'Read-only',
}

// ---- Sprint duration ----
const sprintDurations = ref([])
const savedSprintDays = ref(null)
const sprintDays = ref(null)
const savingSettings = ref(false)
const settingsMessage = ref('')
const settingsError = ref('')

const weeksLabel = (days) => `${days / 7} week${days === 7 ? '' : 's'}`

async function fetchSettings() {
  try {
    const res = await authFetch(`/api/projects/${projectId}/settings`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.message || 'Failed to load settings')
    savedSprintDays.value = data.settings.sprint_duration_days
    sprintDays.value = data.settings.sprint_duration_days
    sprintDurations.value = data.sprint_durations
    members.value = data.members
    roles.value = data.roles
    currentUserId.value = data.current_user_id
    canManage.value = data.can_manage
    canManageOwners.value = data.can_manage_owners
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

async function saveSettings() {
  savingSettings.value = true
  settingsMessage.value = ''
  settingsError.value = ''
  try {
    const res = await authFetch(`/api/projects/${projectId}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sprint_duration_days: sprintDays.value }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message || 'Failed to save settings')
    savedSprintDays.value = data.settings.sprint_duration_days
    settingsMessage.value = 'Saved'
  } catch (err) {
    settingsError.value = err.message
  } finally {
    savingSettings.value = false
  }
}

// ---- Members ----
const memberError = ref('')
const busyMember = ref(null)

// Roles the current user may hand out
const assignableRoles = computed(() =>
  roles.value.filter(r => r !== 'owner' || canManageOwners.value)
)

function displayName(m) {
  return [m.first_name, m.last_name].filter(Boolean).join(' ') || `@${m.handle}`
}

function canEditMember(m) {
  return canManage.value && (canManageOwners.value || m.role !== 'owner')
}

function canRemoveMember(m) {
  return m.user_id === currentUserId.value || canEditMember(m)
}

function removeLabel(m) {
  if (m.status === 'invited') return 'Cancel invite'
  return m.user_id === currentUserId.value ? 'Leave' : 'Remove'
}

async function changeRole(m, select) {
  const role = select.value
  if (role === m.role) return
  busyMember.value = m.user_id
  memberError.value = ''
  try {
    const res = await authFetch(`/api/projects/${projectId}/members/${m.user_id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message || 'Failed to change role')
    members.value = data.members
    // Changing your own role can change what you may do here
    if (m.user_id === currentUserId.value) await fetchSettings()
  } catch (err) {
    memberError.value = err.message
    select.value = m.role // put the select back on the saved role
  } finally {
    busyMember.value = null
  }
}

async function removeMember(m) {
  const isSelf = m.user_id === currentUserId.value
  const prompt = m.status === 'invited'
    ? `Cancel the invite for ${displayName(m)}?`
    : isSelf ? 'Leave this project?' : `Remove ${displayName(m)} from this project?`
  if (!confirm(prompt)) return

  busyMember.value = m.user_id
  memberError.value = ''
  try {
    const res = await authFetch(`/api/projects/${projectId}/members/${m.user_id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message || 'Failed to remove member')
    if (isSelf && m.status === 'active') {
      // You may no longer have access to this project
      router.push('/projects')
      return
    }
    members.value = data.members
  } catch (err) {
    memberError.value = err.message
  } finally {
    busyMember.value = null
  }
}

// ---- Invite ----
const inviteIdentifier = ref('')
const inviteRole = ref('member')
const inviting = ref(false)
const inviteMessage = ref('')
const inviteError = ref('')

async function sendInvite() {
  if (!inviteIdentifier.value.trim()) return
  inviting.value = true
  inviteMessage.value = ''
  inviteError.value = ''
  try {
    const res = await authFetch(`/api/projects/${projectId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: inviteIdentifier.value, role: inviteRole.value }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message || 'Failed to send invite')
    members.value = data.members
    inviteMessage.value = data.message
    inviteIdentifier.value = ''
    inviteRole.value = 'member'
  } catch (err) {
    inviteError.value = err.message
  } finally {
    inviting.value = false
  }
}

onMounted(fetchSettings)
</script>

<template>
  <div class="page-container settings-page">
    <h2 class="settings-title">Project Settings</h2>

    <div v-if="loading" class="loading"><LoadingSpinner size="small" /> Loading settings...</div>

    <div v-else-if="error" class="error-box">{{ error }}</div>

    <template v-else>
      <section class="section-card">
        <h3>Sprints</h3>
        <form class="sprint-form" @submit.prevent="saveSettings">
          <label for="sprint-duration">Sprint duration</label>
          <div class="sprint-controls">
            <select
              id="sprint-duration"
              v-model.number="sprintDays"
              :disabled="!canManage || savingSettings"
              @change="settingsMessage = ''"
            >
              <option v-for="days in sprintDurations" :key="days" :value="days">{{ weeksLabel(days) }}</option>
            </select>
            <button
              v-if="canManage"
              type="submit"
              class="btn-primary"
              :disabled="savingSettings || sprintDays === savedSprintDays"
            >
              {{ savingSettings ? 'Saving...' : 'Save' }}
            </button>
            <span v-if="settingsMessage" class="form-success" role="status">{{ settingsMessage }}</span>
          </div>
          <p v-if="settingsError" class="form-error">{{ settingsError }}</p>
          <p v-if="!canManage" class="hint">Only project owners and managers can change settings.</p>
        </form>
      </section>

      <section class="section-card">
        <h3>Members</h3>
        <p class="hint">
          Company employees can always open this project. Membership gives people outside
          the company access and decides who manages the project.
        </p>

        <p v-if="memberError" class="form-error">{{ memberError }}</p>

        <div v-if="members.length === 0" class="empty-state">No members yet.</div>

        <ul v-else class="member-list">
          <li v-for="m in members" :key="m.user_id" class="member-row" :class="{ invited: m.status === 'invited' }">
            <div class="member-info">
              <span class="member-name">
                {{ displayName(m) }}
                <span v-if="m.user_id === currentUserId" class="you">(you)</span>
              </span>
              <span class="member-handle">@{{ m.handle }}</span>
              <div class="member-badges">
                <StatusBadge v-if="m.status === 'invited'" color="orange" soft size="xs">Invite pending</StatusBadge>
                <StatusBadge v-if="m.is_employee" color="purple" soft size="xs">Employee</StatusBadge>
              </div>
            </div>

            <div class="member-controls">
              <select
                v-if="canEditMember(m)"
                :value="m.role"
                :disabled="busyMember === m.user_id"
                :aria-label="`Role for ${displayName(m)}`"
                :title="ROLE_HINTS[m.role]"
                @change="changeRole(m, $event.target)"
              >
                <option v-for="r in assignableRoles" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
                <option v-if="!assignableRoles.includes(m.role)" :value="m.role">{{ ROLE_LABELS[m.role] }}</option>
              </select>
              <span v-else class="member-role" :title="ROLE_HINTS[m.role]">{{ ROLE_LABELS[m.role] }}</span>

              <button
                v-if="canRemoveMember(m)"
                class="btn-small btn-remove"
                :disabled="busyMember === m.user_id"
                @click="removeMember(m)"
              >
                {{ removeLabel(m) }}
              </button>
            </div>
          </li>
        </ul>

        <form v-if="canManage" class="invite-form" @submit.prevent="sendInvite">
          <h4>Invite someone</h4>
          <div class="invite-controls">
            <InviteAutocomplete v-model="inviteIdentifier" :project-id="projectId" :disabled="inviting" />
            <select v-model="inviteRole" aria-label="Role" :disabled="inviting">
              <option v-for="r in assignableRoles" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
            </select>
            <button type="submit" class="btn-primary" :disabled="inviting || !inviteIdentifier.trim()">
              {{ inviting ? 'Sending...' : 'Send Invite' }}
            </button>
          </div>
          <p class="hint">{{ ROLE_LABELS[inviteRole] }}: {{ ROLE_HINTS[inviteRole] }}. They'll get an email and can accept from their Projects page.</p>
          <p v-if="inviteMessage" class="form-success" role="status">{{ inviteMessage }}</p>
          <p v-if="inviteError" class="form-error">{{ inviteError }}</p>
        </form>
      </section>
    </template>
  </div>
</template>

<style scoped>
.settings-title {
  margin: 0 0 20px;
  color: var(--color-text);
}

.loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-muted);
}

.error-box {
  padding: 16px;
  border-radius: var(--card-radius-sm);
  background: var(--color-error-bg);
  color: var(--color-error);
}

.section-card {
  max-width: 760px;
  margin-bottom: 20px;
  padding: 24px;
  background: var(--color-background-card);
  border-radius: var(--card-radius);
  box-shadow: var(--shadow-sm);
}

.section-card h3 {
  margin: 0 0 16px;
  padding-bottom: 10px;
  border-bottom: 2px solid var(--color-accent);
  color: var(--color-text);
  font-size: 1.1rem;
}

.sprint-form label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
  color: var(--color-text);
}

.sprint-controls,
.invite-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

select,
input[type="text"] {
  padding: 8px 10px;
  font-size: 0.9rem;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-background-card);
  color: var(--color-text);
}

.btn-primary {
  padding: 8px 16px;
  font-size: 0.9rem;
  border: 1px solid var(--color-accent);
  border-radius: 4px;
  background: var(--color-accent);
  color: #fff;
  cursor: pointer;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
  border-color: var(--color-accent-hover);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn-small {
  padding: 6px 12px;
  font-size: 0.85rem;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-background-card);
  color: var(--color-text);
  cursor: pointer;
}

.btn-small:hover:not(:disabled) {
  background: var(--color-background-soft);
}

.btn-remove:hover:not(:disabled) {
  border-color: var(--color-error);
  color: var(--color-error);
}

.hint {
  margin: 8px 0 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

.section-card > .hint {
  margin: 0 0 16px;
}

.form-success {
  margin: 8px 0 0;
  font-size: 0.85rem;
  color: var(--color-success, #2e7d32);
}

.sprint-controls .form-success {
  margin: 0;
}

.form-error {
  margin: 8px 0 0;
  font-size: 0.85rem;
  color: var(--color-error);
}

.empty-state {
  padding: 20px;
  text-align: center;
  color: var(--color-text-light);
}

.member-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--card-radius-sm);
}

.member-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 16px;
}

.member-row + .member-row {
  border-top: 1px solid var(--color-border);
}

.member-row.invited .member-name {
  color: var(--color-text-muted);
}

.member-info {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
  min-width: 0;
}

.member-name {
  font-weight: 500;
  color: var(--color-text);
}

.you {
  font-weight: 400;
  color: var(--color-text-muted);
}

.member-handle {
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

.member-badges {
  display: flex;
  gap: 6px;
}

.member-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.member-role {
  font-size: 0.9rem;
  color: var(--color-text-secondary);
}

.invite-form {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
}

.invite-form h4 {
  margin: 0 0 10px;
  color: var(--color-text);
}
</style>
