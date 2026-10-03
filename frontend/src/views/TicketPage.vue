<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { RouterLink, useRoute, useRouter, onBeforeRouteUpdate } from 'vue-router'
import { authFetch } from '../utilities/authFetch'
import StatusBadge from '../components/StatusBadge.vue'
import LoadingSpinner from '../components/LoadingSpinner.vue'
import RichTextEditor from '../components/RichTextEditor.vue'
import TicketAttachments from '../components/TicketAttachments.vue'
import SplitTicketDialog from '../components/SplitTicketDialog.vue'
import DependencyPicker from '../components/DependencyPicker.vue'
import { toRichHtml } from '../utilities/richText'
import { user } from '../stores/user'
import { ESTIMATE_UNITS, formatEstimate, formatEstimateShort } from '../utilities/ticketEstimates'
import { useTicketDetail, priorityColor, statusColor, statusLabels } from '../composables/useTicketDetail'

// Full-page ticket view (/projects/:id/ticket/:ticketId in the project
// workspace, /project/:id/ticket/:ticketId standalone), opened from the
// ticket popup. Same data and save model as the popup -- every change is
// staged in the draft until Save Changes -- but nothing hides behind an
// Edit button: click the title or description to edit it in place, and
// the properties are always-live controls.
const props = defineProps({
  embedded: { type: Boolean, default: false }
})

const route = useRoute()
const router = useRouter()

const project = ref(null)
const assignees = ref([])
const loading = ref(true)
const error = ref(null)

const ticketRoute = (ticketId) => (props.embedded
  ? { name: 'projectWorkspaceTicket', params: { id: route.params.id, ticketId } }
  : { name: 'projectTicket', params: { id: route.params.id, ticketId } })

const {
  tickets, dependencies, splitParents, canWork,
  selectedTicket, ticketComments, commentText, postingComment, editingCommentId, editCommentText,
  formatDate, getCreatorName, getAssigneeName, ticketsById, splitParentsById,
  subtasksOf, parentOf, ancestorsOf, liveStatus, canOpen,
  showSplitDialog, canSplit, openSplitDialog, onSplit,
  selectedDependsOn, selectedBlocking, dependencyCandidates,
  addDependency, dependencyCategoryIds, dependencyCategoryName, toggleDependency,
  draft, original, savingChanges, saveError, isDirty, saveChanges, discardChanges,
  ticketAttachments, canAttach, canRemoveAttachment,
  leavePrompt, leaveSaveBtn, confirmLeave, resolveLeave, allowedTransitions, openLinkedTicket,
  selectTicket, addComment, startEditComment, cancelEditComment, saveEditComment, deleteComment
} = useTicketDetail({
  reload: () => loadProject(),
  // Linked tickets open as their own page. openLinkedTicket has already
  // asked about unsaved changes; drop whatever was discarded so the route
  // guard below doesn't ask again.
  openTicket: (ticket) => {
    if (isDirty.value) discardChanges()
    router.push(ticketRoute(ticket.id))
  }
})

// Where Back goes: the page this was opened from (board, backlog, ...),
// captured once -- moving between linked tickets keeps this component, so
// later history entries are just other tickets.
const previousPath = router.options.history.state.back
const returnTo = typeof previousPath === 'string' && !previousPath.includes('/ticket/')
  ? previousPath
  : (props.embedded ? { name: 'projectKanban', params: { id: route.params.id } } : `/project/${route.params.id}`)

// Creators edit their own ticket's text and priority; anyone who can work
// the project edits everything (mirrors PUT /api/helpdesk/ticket)
const canEditText = computed(() => !!selectedTicket.value
  && (canWork.value || selectedTicket.value.creator_handle === user.username))

// Status choices: the saved status plus the moves allowed from it
const statusOptions = computed(() => {
  if (!selectedTicket.value || !original.value) return []
  return [original.value.status, ...allowedTransitions(selectedTicket.value)]
})

async function loadProject() {
  try {
    const res = await authFetch(`/api/projects/${route.params.id}`)
    if (!res.ok) {
      if (res.status === 404) throw new Error('Project not found')
      if (res.status === 403) throw new Error("You don't have access to this project")
      throw new Error('Failed to load the project')
    }
    const data = await res.json()
    project.value = data.project
    tickets.value = data.tickets
    dependencies.value = data.dependencies || []
    splitParents.value = data.split_parents || []
    canWork.value = !!data.can_work
    assignees.value = data.assignees || []
    error.value = null
  } catch (err) {
    error.value = err.message
  }
}

function showRouteTicket() {
  const id = Number(route.params.ticketId)
  const ticket = ticketsById.value.get(id) || splitParentsById.value.get(id)
  if (!ticket) {
    error.value = error.value || `Ticket #${route.params.ticketId} isn't in this project`
    return
  }
  stopEditing()
  selectTicket(ticket)
}

// Back/forward between tickets: ask about unsaved changes first
onBeforeRouteUpdate(async (to, from) => {
  if (to.params.ticketId === from.params.ticketId) return true
  const ok = await confirmLeave()
  if (ok && isDirty.value) discardChanges()
  return ok
})
watch(() => route.params.ticketId, (id) => {
  if (id && !loading.value) showRouteTicket()
})

// ---- Click-to-edit fields ----
// Title and description show as text until clicked; the edits still go to
// the draft. Clicking anywhere else (or Escape / Done) puts them back to
// text -- nothing is lost, the save bar keeps them until saved.
const editingField = ref(null) // 'title' | 'description' | null
const titleInput = ref(null)
const descriptionBox = ref(null)

function startEditing(field) {
  if (!canEditText.value) return
  editingField.value = field
  if (field === 'title') nextTick(() => titleInput.value?.focus())
}

// Links in the description still open; clicking anywhere else edits it
function onDescriptionClick(e) {
  if (!e.target.closest('a')) startEditing('description')
}

function stopEditing() {
  if (editingField.value === 'title' && draft.value && !draft.value.title.trim()) {
    // A ticket needs a title: an emptied one goes back to the saved title
    draft.value.title = original.value.title
  }
  editingField.value = null
}

function handleDocumentMousedown(e) {
  if (editingField.value === 'description' && descriptionBox.value && !descriptionBox.value.contains(e.target)) {
    stopEditing()
  }
}

function handleDocumentKeydown(e) {
  if (e.key !== 'Escape') return
  if (leavePrompt.value) resolveLeave('keep')
  else if (editingField.value) stopEditing()
}

onMounted(async () => {
  document.addEventListener('mousedown', handleDocumentMousedown)
  document.addEventListener('keydown', handleDocumentKeydown)
  await loadProject()
  loading.value = false
  if (!error.value) showRouteTicket()
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleDocumentMousedown)
  document.removeEventListener('keydown', handleDocumentKeydown)
})

async function save() {
  stopEditing()
  await saveChanges()
}

function discard() {
  stopEditing()
  discardChanges()
}
</script>

<template>
  <div class="ticket-page">
    <div class="ticket-nav">
      <RouterLink :to="returnTo" class="back-link">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6" /></svg>
        Back
      </RouterLink>
      <nav v-if="selectedTicket" class="breadcrumb" aria-label="Ticket path">
        <span v-if="project" class="crumb-project">{{ project.title }}</span>
        <template v-for="a in ancestorsOf(selectedTicket)" :key="a.id">
          <span class="crumb-sep" aria-hidden="true">›</span>
          <button class="crumb-link" @click="openLinkedTicket(a.id)">#{{ a.id }} {{ a.title }}</button>
        </template>
        <span class="crumb-sep" aria-hidden="true">›</span>
        <span class="crumb-current">#{{ selectedTicket.id }}</span>
      </nav>
    </div>

    <div v-if="loading" class="page-state"><LoadingSpinner size="small" /> Loading ticket...</div>
    <div v-else-if="error" class="page-state page-error">{{ error }}</div>

    <template v-else-if="selectedTicket && draft">
      <header class="ticket-head">
        <div class="title-wrap">
          <input
            v-if="editingField === 'title'"
            ref="titleInput"
            v-model="draft.title"
            class="title-input"
            aria-label="Title"
            maxlength="255"
            @blur="stopEditing"
            @keydown.enter.prevent="stopEditing"
          />
          <h1
            v-else
            class="ticket-title"
            :class="{ editable: canEditText }"
            :tabindex="canEditText ? 0 : undefined"
            :title="canEditText ? 'Click to edit the title' : undefined"
            @click="startEditing('title')"
            @keydown.enter.prevent="startEditing('title')"
          >{{ draft.title }}</h1>
        </div>
        <button v-if="canSplit" class="btn-outline" @click="openSplitDialog">
          {{ selectedTicket.split_mode ? 'Add subtasks' : 'Split into subtasks' }}
        </button>
      </header>

      <div class="ticket-layout">
        <main class="ticket-main">
          <section class="ticket-section">
            <h2>Description</h2>
            <div
              v-if="editingField === 'description'"
              ref="descriptionBox"
              class="description-editor"
            >
              <RichTextEditor v-model="draft.description" autofocus />
              <div class="editor-actions">
                <button type="button" class="btn-outline btn-sm" @click="stopEditing">Done</button>
              </div>
            </div>
            <div
              v-else
              class="description-view"
              :class="{ editable: canEditText }"
              :tabindex="canEditText ? 0 : undefined"
              :role="canEditText ? 'button' : undefined"
              :aria-label="canEditText ? 'Edit description' : undefined"
              @click="onDescriptionClick"
              @keydown.enter.prevent="startEditing('description')"
            >
              <div v-if="draft.description" class="rich-content" v-safe-html="toRichHtml(draft.description)"></div>
              <p v-else class="placeholder">{{ canEditText ? 'Click to add a description' : 'No description provided.' }}</p>
            </div>
          </section>

          <section v-if="selectedTicket.split_mode" class="ticket-section">
            <h2>Subtasks</h2>
            <p class="section-note">
              {{ selectedTicket.split_mode === 'category'
                ? 'Shown as a category on the GANTT and Burndown charts, off the Kanban board.'
                : 'Hidden from the boards and charts; its subtasks carry the work.' }}
            </p>
            <ul class="link-list">
              <li v-for="sub in subtasksOf(selectedTicket.id)" :key="sub.id" class="link-item">
                <button class="item-link" @click="openLinkedTicket(sub.id)">
                  <span class="item-id">#{{ sub.id }}</span> {{ sub.title }}
                </button>
                <span v-if="formatEstimateShort(sub)" class="estimate-chip">{{ formatEstimateShort(sub) }}</span>
                <span v-if="sub.split_mode" class="split-kind">Split</span>
                <StatusBadge :color="statusColor[liveStatus(sub.id, sub.status)]" soft size="xs">
                  {{ statusLabels[liveStatus(sub.id, sub.status)] || liveStatus(sub.id, sub.status) }}
                </StatusBadge>
              </li>
            </ul>
          </section>

          <section class="ticket-section">
            <TicketAttachments
              :attachments="ticketAttachments"
              :pending-files="draft.addFiles"
              :pending-removals="draft.removeAttachments"
              :can-attach="canAttach"
              :can-remove="canRemoveAttachment"
              :busy="savingChanges"
              @add="files => draft.addFiles.push(...files)"
              @remove="a => draft.removeAttachments.push(a.id)"
              @undo-remove="a => draft.removeAttachments = draft.removeAttachments.filter(id => id !== a.id)"
              @drop-pending="i => draft.addFiles.splice(i, 1)"
            />
          </section>

          <section class="ticket-section">
            <h2>Comments ({{ ticketComments.filter(c => !c.is_deleted).length }})</h2>
            <div v-if="ticketComments.length > 0" class="comments-list">
              <div v-for="comment in ticketComments" :key="comment.id" class="comment-item">
                <p v-if="comment.is_deleted" class="comment-deleted">Comment deleted.</p>
                <template v-else>
                  <div class="comment-header">
                    <span class="comment-author">{{ comment.handle }}</span>
                    <span class="comment-date">{{ formatDate(comment.created_at) }}</span>
                    <span v-if="comment.updated_at !== comment.created_at" class="comment-edited">(edited)</span>
                    <button
                      v-if="comment.handle === user.username && editingCommentId !== comment.id"
                      class="btn-link btn-danger comment-delete"
                      @click="deleteComment(comment.id)"
                    >Delete</button>
                  </div>
                  <div v-if="editingCommentId === comment.id" class="comment-edit-form">
                    <textarea v-model="editCommentText" rows="3" class="comment-input" aria-label="Edit comment"></textarea>
                    <div class="comment-edit-actions">
                      <button class="btn-primary btn-sm" :disabled="!editCommentText.trim()" @click="saveEditComment(comment.id)">Save</button>
                      <button class="btn-outline btn-sm" @click="cancelEditComment">Cancel</button>
                    </div>
                  </div>
                  <p
                    v-else-if="comment.handle === user.username"
                    class="comment-content editable"
                    tabindex="0"
                    title="Click to edit your comment"
                    @click="startEditComment(comment)"
                    @keydown.enter.prevent="startEditComment(comment)"
                  >{{ comment.content }}</p>
                  <p v-else class="comment-content">{{ comment.content }}</p>
                </template>
              </div>
            </div>
            <p v-else class="placeholder">No comments yet.</p>

            <div class="comment-compose">
              <textarea v-model="commentText" placeholder="Add a comment..." rows="3" class="comment-input" aria-label="New comment"></textarea>
              <button class="btn-primary btn-sm" :disabled="postingComment || !commentText.trim()" @click="addComment">
                {{ postingComment ? 'Posting...' : 'Add Comment' }}
              </button>
            </div>
          </section>
        </main>

        <aside class="ticket-side" aria-label="Ticket details">
          <dl class="props">
            <dt><label for="tp-status">Status</label></dt>
            <dd>
              <select v-if="statusOptions.length > 1" id="tp-status" v-model="draft.status" class="inline-select">
                <option v-for="s in statusOptions" :key="s" :value="s">{{ statusLabels[s] || s }}</option>
              </select>
              <StatusBadge v-else :color="statusColor[draft.status]">{{ statusLabels[draft.status] || draft.status }}</StatusBadge>
            </dd>

            <dt><label for="tp-priority">Priority</label></dt>
            <dd>
              <select v-if="canEditText" id="tp-priority" v-model="draft.priority" class="inline-select">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
              <StatusBadge v-else :color="priorityColor[draft.priority]">{{ draft.priority }}</StatusBadge>
            </dd>

            <dt><label for="tp-assignee">Assignee</label></dt>
            <dd>
              <select v-if="canWork" id="tp-assignee" v-model="draft.assigned_to" class="inline-select">
                <option :value="null">Unassigned</option>
                <option v-for="emp in assignees" :key="emp.user_id" :value="emp.user_id">
                  {{ emp.first_name }} {{ emp.last_name }} ({{ emp.handle }})
                </option>
              </select>
              <span v-else>{{ getAssigneeName(selectedTicket) }}</span>
            </dd>

            <dt><label for="tp-estimate">Estimate</label></dt>
            <dd>
              <span v-if="canWork" class="estimate-edit">
                <input
                  id="tp-estimate"
                  v-model="draft.estimate_amount"
                  type="number"
                  min="0.25"
                  max="9999"
                  step="0.25"
                  placeholder="None"
                  class="inline-input"
                />
                <select v-model="draft.estimate_unit" class="inline-select" aria-label="Estimate unit">
                  <option v-for="unit in ESTIMATE_UNITS" :key="unit" :value="unit">{{ unit }}</option>
                </select>
              </span>
              <span v-else>{{ formatEstimate(selectedTicket) || 'Not estimated' }}</span>
            </dd>

            <dt>Created by</dt>
            <dd>{{ getCreatorName(selectedTicket) }}</dd>
            <dt>Created</dt>
            <dd>{{ formatDate(selectedTicket.created_at) }}</dd>
            <template v-if="selectedTicket.resolved_at">
              <dt>Resolved</dt>
              <dd>{{ formatDate(selectedTicket.resolved_at) }}</dd>
            </template>
            <template v-if="parentOf(selectedTicket)">
              <dt>Subtask of</dt>
              <dd>
                <button class="item-link" @click="openLinkedTicket(selectedTicket.parent_ticket_id)">
                  <span class="item-id">#{{ selectedTicket.parent_ticket_id }}</span> {{ parentOf(selectedTicket).title }}
                </button>
              </dd>
            </template>
          </dl>

          <section class="side-section">
            <h2>Depends on</h2>
            <ul v-if="selectedDependsOn.length > 0" class="link-list">
              <li v-for="dep in selectedDependsOn" :key="dep.id" class="link-item" :class="dep.pending && `pending-${dep.pending}`">
                <button
                  class="item-link"
                  :disabled="!canOpen(dep.id)"
                  :title="canOpen(dep.id) ? 'Open ticket' : 'In another project'"
                  @click="openLinkedTicket(dep.id)"
                >
                  <span class="item-id">#{{ dep.id }}</span> {{ dep.title }}
                </button>
                <StatusBadge :color="statusColor[dep.status]" soft size="xs">{{ statusLabels[dep.status] || dep.status }}</StatusBadge>
                <span v-if="dep.pending === 'add'" class="pending-note">unsaved</span>
                <button
                  v-if="canWork && dep.pending === 'remove'"
                  class="item-undo"
                  :aria-label="`Keep dependency on #${dep.id}`"
                  @click="toggleDependency(dep)"
                >Undo</button>
                <button
                  v-else-if="canWork"
                  class="item-remove"
                  :aria-label="`Remove dependency on #${dep.id}`"
                  title="Remove dependency"
                  @click="toggleDependency(dep)"
                >&times;</button>
              </li>
            </ul>
            <p v-else class="placeholder">No dependencies.</p>
            <DependencyPicker
              v-if="canWork"
              :candidates="dependencyCandidates"
              :category-ids="dependencyCategoryIds"
              :category-name="dependencyCategoryName"
              :status-labels="statusLabels"
              @select="addDependency"
            />

            <template v-if="selectedBlocking.length > 0">
              <h2 class="blocking-heading">Blocking</h2>
              <ul class="link-list">
                <li v-for="dep in selectedBlocking" :key="dep.id" class="link-item">
                  <button
                    class="item-link"
                    :disabled="!canOpen(dep.id)"
                    :title="canOpen(dep.id) ? 'Open ticket' : 'In another project'"
                    @click="openLinkedTicket(dep.id)"
                  >
                    <span class="item-id">#{{ dep.id }}</span> {{ dep.title }}
                  </button>
                  <StatusBadge :color="statusColor[dep.status]" soft size="xs">{{ statusLabels[dep.status] || dep.status }}</StatusBadge>
                </li>
              </ul>
            </template>
          </section>
        </aside>
      </div>

      <!-- Appears once anything is changed; nothing is saved until clicked -->
      <div v-if="isDirty || saveError" class="save-bar" role="region" aria-label="Unsaved changes">
        <p v-if="saveError" class="save-error" role="alert">{{ saveError }}</p>
        <div class="save-bar-row">
          <span class="save-bar-note">{{ isDirty ? 'You have unsaved changes' : '' }}</span>
          <div class="save-bar-buttons">
            <button type="button" class="btn-outline" :disabled="savingChanges || !isDirty" @click="discard">Discard Changes</button>
            <button type="button" class="btn-primary" :disabled="savingChanges || !isDirty" @click="save">
              {{ savingChanges ? 'Saving...' : 'Save Changes' }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <SplitTicketDialog
      v-if="showSplitDialog && selectedTicket"
      :ticket="selectedTicket"
      @close="showSplitDialog = false"
      @split="onSplit"
    />

    <!-- Leaving the ticket with unsaved changes -->
    <div v-if="leavePrompt" class="modal-overlay" @click.self="resolveLeave('keep')">
      <div class="modal leave-dialog" role="alertdialog" aria-modal="true" aria-labelledby="tp-leave-title" aria-describedby="tp-leave-desc">
        <h2 id="tp-leave-title">Unsaved changes</h2>
        <p id="tp-leave-desc">You have unsaved changes to this ticket. Save them before leaving?</p>
        <div class="leave-actions">
          <button type="button" class="btn-outline" @click="resolveLeave('keep')">Keep Editing</button>
          <button type="button" class="btn-outline btn-discard" @click="resolveLeave('discard')">Discard Changes</button>
          <button ref="leaveSaveBtn" type="button" class="btn-primary" @click="resolveLeave('save')">Save Changes</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ticket-page {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: 16px 28px 0;
  box-sizing: border-box;
}

.ticket-nav {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-bottom: 16px;
  font-size: 0.875rem;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-text-secondary);
  text-decoration: none;
}

.back-link:hover {
  color: var(--color-accent);
}

.breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  color: var(--color-text-muted);
}

.crumb-link {
  padding: 0;
  border: none;
  background: none;
  color: var(--color-text-secondary);
  font-size: inherit;
  cursor: pointer;
}

.crumb-link:hover {
  color: var(--color-accent);
  text-decoration: underline;
}

.crumb-current {
  color: var(--color-text);
  font-weight: 600;
}

.page-state {
  padding: 40px 0;
  color: var(--color-text-muted);
}

.page-error {
  color: var(--color-error);
}

/* Title */
.ticket-head {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 20px;
}

.title-wrap {
  flex: 1;
  min-width: 0;
}

.ticket-title,
.title-input {
  margin: 0;
  padding: 4px 8px;
  margin-left: -8px;
  font-size: 1.6rem;
  font-weight: 700;
  line-height: 1.3;
  color: var(--color-heading, var(--color-text));
  border-radius: 6px;
  box-sizing: border-box;
}

.title-input {
  width: calc(100% + 8px);
  border: 1px solid var(--color-accent);
  background: var(--color-background-input);
  font-family: inherit;
  outline: none;
}

/* Click-to-edit: plain text that shows it's editable on hover/focus */
.editable {
  cursor: text;
  border-radius: 6px;
  transition: background-color 0.12s, box-shadow 0.12s;
}

.editable:hover {
  background: var(--color-background-hover, var(--color-background-soft));
}

.editable:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-accent);
}

/* Layout: content + properties sidebar */
.ticket-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 32px;
  flex: 1;
  padding-bottom: 32px;
}

.ticket-section {
  margin-bottom: 28px;
}

.ticket-section h2,
.side-section h2 {
  margin: 0 0 10px;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.section-note {
  margin: 0 0 10px;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.description-view {
  min-height: 60px;
  padding: 10px 12px;
  margin: 0 -12px;
}

.description-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.editor-actions {
  display: flex;
  justify-content: flex-end;
}

.rich-content {
  color: var(--color-text);
  line-height: 1.65;
}

.rich-content :deep(p) { margin: 0 0 0.75em; }
.rich-content :deep(p:last-child) { margin-bottom: 0; }
.rich-content :deep(ul),
.rich-content :deep(ol) { padding-left: 1.5em; margin: 0.5em 0; }
.rich-content :deep(h3) { font-size: 1.05rem; font-weight: 600; margin: 0.75em 0 0.4em; }
.rich-content :deep(strong) { font-weight: 700; }
.rich-content :deep(em) { font-style: italic; }

.placeholder {
  margin: 0;
  color: var(--color-text-light);
  font-style: italic;
  font-size: 0.9rem;
}

/* Properties */
.ticket-side {
  align-self: start;
  position: sticky;
  top: 16px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-card);
}

.props {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 10px 14px;
  margin: 0 0 20px;
  font-size: 0.9rem;
}

.props dt {
  color: var(--color-text-muted);
  font-size: 0.82rem;
}

.props dd {
  margin: 0;
  min-width: 0;
  color: var(--color-text);
}

/* Always-live controls that read as values until hovered/focused */
.inline-select,
.inline-input {
  max-width: 100%;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  font-size: 0.9rem;
  font-family: inherit;
  cursor: pointer;
}

.inline-select:hover,
.inline-input:hover {
  border-color: var(--color-border);
  background: var(--color-background-input);
}

.inline-select:focus,
.inline-input:focus {
  outline: none;
  border-color: var(--color-accent);
  background: var(--color-background-input);
}

.inline-input {
  width: 72px;
  cursor: text;
}

.estimate-edit {
  display: inline-flex;
  gap: 4px;
}

.side-section {
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
}

.blocking-heading {
  margin-top: 16px !important;
}

/* Linked ticket lists */
.link-list {
  list-style: none;
  margin: 0 0 10px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.link-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--color-background-soft);
}

.item-link {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: none;
  background: none;
  text-align: left;
  font-size: 0.875rem;
  color: var(--color-text);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.props .item-link {
  white-space: normal;
}

.item-link:hover:not(:disabled) {
  color: var(--color-accent);
  text-decoration: underline;
}

.item-link:disabled {
  cursor: default;
}

.item-id {
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.link-item.pending-remove .item-link {
  text-decoration: line-through;
  opacity: 0.6;
}

.pending-note {
  font-size: 0.75rem;
  font-style: italic;
  color: var(--color-text-muted);
}

.item-undo {
  padding: 0 4px;
  border: none;
  background: none;
  color: var(--color-accent);
  font-size: 0.8rem;
  cursor: pointer;
}

.item-remove {
  flex-shrink: 0;
  padding: 0 4px;
  border: none;
  background: none;
  font-size: 1.1rem;
  line-height: 1;
  color: var(--color-text-muted);
  cursor: pointer;
}

.item-remove:hover {
  color: var(--color-error);
}

.estimate-chip {
  padding: 1px 6px;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-background-card);
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-muted);
}

.split-kind {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--color-background-mute, var(--color-background-soft));
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

/* Comments */
.comments-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.comment-item {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--color-background-soft);
}

.comment-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 4px;
}

.comment-author {
  font-weight: 600;
  font-size: 0.85rem;
}

.comment-date {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
}

.comment-edited {
  font-size: 0.75rem;
  font-style: italic;
  color: var(--color-text-light);
}

.comment-delete {
  margin-left: auto;
}

.comment-content {
  margin: 0 -6px;
  padding: 2px 6px;
  font-size: 0.92rem;
  color: var(--color-text);
  white-space: pre-wrap;
}

.comment-deleted {
  margin: 0;
  font-size: 0.85rem;
  font-style: italic;
  color: var(--color-text-light);
}

.comment-edit-form,
.comment-compose {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.comment-edit-actions {
  display: flex;
  gap: 8px;
}

.comment-input {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-input);
  color: var(--color-text);
  font-size: 0.9rem;
  font-family: inherit;
  resize: vertical;
  box-sizing: border-box;
}

/* Buttons */
.btn-primary,
.btn-outline {
  padding: 9px 18px;
  border-radius: 6px;
  font-size: 0.95rem;
  cursor: pointer;
}

.btn-primary {
  border: none;
  background: var(--color-accent);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.btn-primary:disabled {
  background: var(--color-button-secondary);
  cursor: default;
}

.btn-outline {
  flex-shrink: 0;
  border: 1px solid var(--color-border);
  background: var(--color-background-card);
  color: var(--color-text);
}

.btn-outline:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.btn-outline:disabled {
  opacity: 0.6;
  cursor: default;
}

.btn-sm {
  padding: 6px 14px;
  font-size: 0.85rem;
}

.btn-link {
  padding: 0;
  border: none;
  background: none;
  font-size: 0.8rem;
  text-decoration: underline;
  cursor: pointer;
}

.btn-danger {
  color: var(--color-error);
}

/* Unsaved changes */
.save-bar {
  position: sticky;
  bottom: 0;
  z-index: 5;
  margin: 0 -28px;
  padding: 12px 28px;
  border-top: 1px solid var(--color-border);
  background: var(--color-background-card);
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.08);
}

.save-bar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}

.save-bar-note {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.save-bar-buttons {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.save-error {
  margin: 0 0 8px;
  font-size: 0.85rem;
  color: var(--color-error);
}

/* Leave prompt */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--color-overlay);
}

.leave-dialog {
  width: 420px;
  max-width: 100%;
  padding: 25px;
  border-radius: 12px;
  background: var(--color-background-card);
}

.leave-dialog h2 {
  margin: 0 0 10px;
}

.leave-dialog p {
  margin: 0 0 20px;
  color: var(--color-text-secondary);
}

.leave-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.btn-discard:hover:not(:disabled) {
  border-color: var(--color-error);
  color: var(--color-error);
}

@media (max-width: 900px) {
  .ticket-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }

  .ticket-side {
    position: static;
    order: -1;
    margin-bottom: 20px;
  }
}

@media (max-width: 600px) {
  .ticket-page {
    padding: 12px 16px 0;
  }

  .save-bar {
    margin: 0 -16px;
    padding: 12px 16px;
  }

  .ticket-head {
    flex-direction: column;
    gap: 10px;
  }

  .ticket-title,
  .title-input {
    font-size: 1.3rem;
  }
}
</style>
