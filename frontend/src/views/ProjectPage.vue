<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { RouterLink, useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { authFetch } from '../utilities/authFetch'
import draggable from 'vuedraggable'
import StatusBadge from '../components/StatusBadge.vue'
import LoadingSpinner from '../components/LoadingSpinner.vue'
import RichTextEditor from '../components/RichTextEditor.vue'
import TicketAttachments from '../components/TicketAttachments.vue'
import SplitTicketDialog from '../components/SplitTicketDialog.vue'
import { user } from '../stores/user'
import { ESTIMATE_UNITS, hasEstimate, formatEstimate, formatEstimateShort } from '../utilities/ticketEstimates'

// embedded: rendered as the Kanban tab inside ProjectWorkspacePage, which
// already shows the project title and its own Back button.
// view: 'board' (the lanes) or 'backlog' (the backlog as a list). The
// backlog has no lane -- it outgrew one -- so the board links to the list,
// which is this same page so tickets open in the same panel.
const props = defineProps({
  embedded: { type: Boolean, default: false },
  view: { type: String, default: 'board' }
})

const route = useRoute()
const router = useRouter()

const project = ref(null)
const tickets = ref([])
// Who tickets can be assigned to: employees + working project members
const assignees = ref([])
const loading = ref(true)
const error = ref(null)

// New ticket form
const showNewTicketForm = ref(false)
const newTicket = ref({
  title: '',
  description: '',
  priority: 'medium',
  estimate_amount: '',
  estimate_unit: 'hours',
  files: []
})
const createError = ref('')
const submitting = ref(false)

// Selected ticket for detail view
const selectedTicket = ref(null)
const ticketCloseBtn = ref(null)

// Comments state
const ticketComments = ref([])
const commentText = ref('')
const postingComment = ref(false)
const editingCommentId = ref(null)
const editCommentText = ref('')

// Edit mode: shows the title/description/priority form (ticket creator
// only). Its changes are staged in `draft` like every other change.
const editingTicket = ref(false)

const priorityColor = {
  low: 'gray',
  medium: 'blue',
  high: 'orange',
  urgent: 'red'
}

const statusColor = {
  backlog: 'gray',
  'on-deck': 'teal',
  in_progress: 'yellow',
  resolved: 'green',
  closed: 'gray'
}

// Hex colors needed for kanban column borders and transition buttons
const statusHex = {
  backlog: 'var(--badge-gray)',
  'on-deck': 'var(--badge-teal)',
  in_progress: 'var(--badge-yellow)',
  resolved: 'var(--badge-green)',
  closed: 'var(--badge-gray)'
}

const statusLabels = {
  backlog: 'Backlog',
  'on-deck': 'On Deck',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed'
}

// Backlog and Closed tickets get no lane -- they're counted in links above
// the board that open the backlog list (this page, view 'backlog') and
// ProjectClosedTicketsPage.
const kanbanStatuses = ['on-deck', 'in_progress', 'resolved']

const closedCount = computed(() => tickets.value.filter(t => t.status === 'closed').length)

// Backlog, including Help Desk tickets still in the legacy 'open' status
// (the API already orders tickets by priority, then newest first)
const isBacklog = (t) => t.status === 'backlog' || t.status === 'open'
const backlogTickets = computed(() => tickets.value.filter(isBacklog))
const backlogLink = computed(() => ({
  name: props.embedded ? 'projectWorkspaceBacklog' : 'projectBacklog',
  params: { id: route.params.id }
}))
const boardLink = computed(() => (props.embedded
  ? { name: 'projectKanban', params: { id: route.params.id } }
  : `/project/${route.params.id}`))

// Backlog list rows. Subtasks are grouped under their split parent
// (migration 086) -- the parent is otherwise off the board -- as a header
// row followed by its backlog subtasks, indented. A group sits where its
// first subtask would (the API orders by priority, then newest), and a
// parent appears only while some of its subtasks are in the backlog.
// Search (#id or title words): a parent match shows its whole group; a
// subtask match shows that subtask under its parent.
const backlogSearch = ref('')
const collapsedGroups = ref(new Set())

function toggleGroup(parentId) {
  const next = new Set(collapsedGroups.value)
  if (next.has(parentId)) next.delete(parentId)
  else next.add(parentId)
  collapsedGroups.value = next
}

const backlogRows = computed(() => {
  const q = backlogSearch.value.trim().toLowerCase().replace(/^#/, '')
  const matches = (t) => String(t.id) === q || t.title.toLowerCase().includes(q)

  // Ordered entries: standalone tickets and groups (by first subtask)
  const entries = []
  const groups = new Map()
  for (const ticket of backlogTickets.value) {
    const parent = parentOf(ticket)
    if (!parent) {
      entries.push({ ticket })
      continue
    }
    if (!groups.has(parent.id)) {
      const group = { parent, children: [] }
      groups.set(parent.id, group)
      entries.push(group)
    }
    groups.get(parent.id).children.push(ticket)
  }

  const rows = []
  for (const entry of entries) {
    if (!entry.parent) {
      if (!q || matches(entry.ticket)) rows.push({ kind: 'ticket', key: `t${entry.ticket.id}`, ticket: entry.ticket })
      continue
    }
    const { parent, children } = entry
    const shown = !q || matches(parent) ? children : children.filter(matches)
    if (!shown.length) continue
    const all = subtasksOf(parent.id)
    // Searching always shows the matches, even in a collapsed group
    const collapsed = !q && collapsedGroups.value.has(parent.id)
    rows.push({
      kind: 'parent',
      key: `p${parent.id}`,
      ticket: parent,
      collapsed,
      backlogCount: children.length,
      subtaskCount: all.length,
      doneCount: all.filter(t => isDone(t.status)).length
    })
    if (!collapsed) {
      shown.forEach((ticket, i) => rows.push({
        kind: 'ticket',
        key: `t${ticket.id}`,
        ticket,
        child: true,
        lastChild: i === shown.length - 1
      }))
    }
  }
  return rows
})

// Workspace board links to the workspace's closed list; the standalone
// /project/:id board links to the standalone one.
const closedTicketsLink = computed(() => ({
  name: props.embedded ? 'projectWorkspaceClosed' : 'projectClosedTickets',
  params: { id: route.params.id }
}))

// Group tickets by status for Kanban columns
const ticketsByStatus = computed(() => {
  const grouped = {}
  kanbanStatuses.forEach(status => {
    grouped[status] = tickets.value.filter(t => t.status === status)
  })
  return grouped
})

const formatDate = (dateStr) => {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  })
}

const getCreatorName = (ticket) => {
  if (ticket.creator_first_name || ticket.creator_last_name) {
    return `${ticket.creator_first_name || ''} ${ticket.creator_last_name || ''}`.trim()
  }
  return ticket.creator_handle
}

const getAssigneeName = (ticket) => {
  if (ticket.assignee_first_name || ticket.assignee_last_name) {
    return `${ticket.assignee_first_name || ''} ${ticket.assignee_last_name || ''}`.trim()
  }
  return ticket.assignee_handle || 'Unassigned'
}

async function fetchProject() {
  loading.value = true
  error.value = null

  try {
    const res = await authFetch(`/api/projects/${route.params.id}`)
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error('Project not found')
      }
      throw new Error('Failed to fetch project')
    }
    const data = await res.json()
    project.value = data.project
    tickets.value = data.tickets
    dependencies.value = data.dependencies || []
    splitParents.value = data.split_parents || []
    // Full edit rights: company employees and working project members
    canWork.value = !!data.can_work
    assignees.value = data.assignees || []
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

// ---- Ticket dependencies (migration 079) ----
// Edges touching this project's tickets: { ticket_id, depends_on_ticket_id,
// ticket_title/status, depends_on_title/status }. Either end may be in
// another project of the same company.
const dependencies = ref([])
const canWork = ref(false)
const newDependencyId = ref('')

// Prefer the board's live status (it changes on drag/transition) over the
// status captured in the edge when the board loaded.
const ticketsById = computed(() => new Map(tickets.value.map(t => [t.id, t])))

// ---- Subtasks (migration 086) ----
// Split tickets are off the board (the API returns them separately) but
// open from their subtasks' "Subtask of" link.
const splitParents = ref([])
const splitParentsById = computed(() => new Map(splitParents.value.map(t => [t.id, t])))
const subtasksOf = (id) => tickets.value.filter(t => t.parent_ticket_id === id)
const parentOf = (ticket) => (ticket?.parent_ticket_id ? splitParentsById.value.get(ticket.parent_ticket_id) : null)

const showSplitDialog = ref(false)
// Split: subtasks can't be split further, and finished work isn't split
const canSplit = computed(() => {
  const t = selectedTicket.value
  return !!t && canWork.value && !t.parent_ticket_id && !isDone(t.status)
})

async function openSplitDialog() {
  // Settle unsaved edits first so the split works from the saved ticket
  if (isDirty.value) {
    if (!(await confirmLeave())) return
    if (isDirty.value) discardChanges()
  }
  showSplitDialog.value = true
}

async function onSplit() {
  showSplitDialog.value = false
  const parentId = selectedTicket.value.id
  await fetchProject()
  // The parent is off the board now; reopen it to show its subtasks
  const parent = splitParentsById.value.get(parentId)
  if (parent) selectTicket(parent)
}
function liveStatus(id, fallback) {
  const ticket = ticketsById.value.get(id)
  if (ticket) return ticket.status
  // A split ticket's own status goes stale -- its subtasks carry the work --
  // so anything depending on it follows them: done once they all are
  if (splitParentsById.value.has(id)) {
    const subs = subtasksOf(id)
    if (subs.length) {
      if (subs.every(t => isDone(t.status))) return 'resolved'
      return subs.some(t => t.status !== 'backlog' && t.status !== 'open') ? 'in_progress' : 'backlog'
    }
  }
  return fallback
}

// Tickets the panel can open: the board's, plus split parents
const canOpen = (id) => ticketsById.value.has(id) || splitParentsById.value.has(id)

const isDone = (status) => status === 'resolved' || status === 'closed'

// ticket id -> ids of its unfinished dependencies (for the card's Blocked chip)
const openBlockersByTicket = computed(() => {
  const map = {}
  for (const d of dependencies.value) {
    if (isDone(liveStatus(d.depends_on_ticket_id, d.depends_on_status))) continue
    ;(map[d.ticket_id] ||= []).push(d.depends_on_ticket_id)
  }
  return map
})

// Saved dependencies plus the draft's pending ones. pending: 'remove' (still
// listed, struck through, until saved) or 'add' (not saved yet).
const selectedDependsOn = computed(() => {
  if (!selectedTicket.value) return []
  const removing = new Set(draft.value?.removeDeps || [])
  const saved = dependencies.value
    .filter(d => d.ticket_id === selectedTicket.value.id)
    .map(d => ({
      id: d.depends_on_ticket_id,
      title: d.depends_on_title,
      status: liveStatus(d.depends_on_ticket_id, d.depends_on_status),
      pending: removing.has(d.depends_on_ticket_id) ? 'remove' : null
    }))
  const adding = (draft.value?.addDeps || [])
    .map(id => ticketsById.value.get(id))
    .filter(Boolean)
    .map(t => ({ id: t.id, title: t.title, status: t.status, pending: 'add' }))
  return [...saved, ...adding]
})

const selectedBlocking = computed(() => {
  if (!selectedTicket.value) return []
  return dependencies.value
    .filter(d => d.depends_on_ticket_id === selectedTicket.value.id)
    .map(d => ({ id: d.ticket_id, title: d.ticket_title, status: liveStatus(d.ticket_id, d.ticket_status) }))
})

// Tickets on this board the selected ticket could depend on: not itself,
// not already a dependency, and not anything that (as far as this board
// knows) already depends on it -- that would be a loop. The server
// re-checks loops across the whole company.
const dependencyCandidates = computed(() => {
  const sel = selectedTicket.value
  if (!sel) return []
  const dependents = new Set([sel.id])
  let grew = true
  while (grew) {
    grew = false
    for (const d of dependencies.value) {
      if (dependents.has(d.depends_on_ticket_id) && !dependents.has(d.ticket_id)) {
        dependents.add(d.ticket_id)
        grew = true
      }
    }
  }
  const already = new Set(selectedDependsOn.value.map(d => d.id))
  return tickets.value
    .filter(t => !dependents.has(t.id) && !already.has(t.id))
    .sort((a, b) => a.id - b.id)
})

// Swap in the server's fresh edge set for one ticket
function replaceTicketEdges(ticketId, edges) {
  dependencies.value = [
    ...dependencies.value.filter(d => d.ticket_id !== ticketId && d.depends_on_ticket_id !== ticketId),
    ...edges
  ]
}

// Dependency edits are staged in the draft until Save Changes. Picking a
// ticket in the dropdown stages it immediately -- there's no separate Add
// step to forget.
function addDependency() {
  const id = parseInt(newDependencyId.value)
  if (!draft.value || !id) return
  if (draft.value.removeDeps.includes(id)) {
    draft.value.removeDeps = draft.value.removeDeps.filter(x => x !== id)
  } else if (!draft.value.addDeps.includes(id)) {
    draft.value.addDeps.push(id)
  }
  newDependencyId.value = ''
}

// x on a saved dependency marks it for removal; on a pending one, drops it;
// on one already marked for removal, undoes that
function toggleDependency(dep) {
  const d = draft.value
  if (dep.pending === 'add') d.addDeps = d.addDeps.filter(x => x !== dep.id)
  else if (dep.pending === 'remove') d.removeDeps = d.removeDeps.filter(x => x !== dep.id)
  else d.removeDeps.push(dep.id)
}

// ---- Unsaved ticket changes ----
// The detail panel stages every change -- title/description/priority,
// status, assignee, estimate (amount + unit, migration 083) and
// dependencies -- in `draft`. Nothing reaches the backend until Save
// Changes, which sends one ticket update plus one call per dependency
// change. Leaving with unsaved changes asks first.
const draft = ref(null)
const original = ref(null) // draft of the saved ticket, for dirty checks
const savingChanges = ref(false)
const saveError = ref('')

const TICKET_FIELDS = ['title', 'description', 'priority', 'status', 'assigned_to']

function draftFrom(ticket) {
  return {
    title: ticket.title,
    description: ticket.description || '',
    priority: ticket.priority,
    status: ticket.status,
    assigned_to: ticket.assigned_to ?? null,
    estimate_amount: hasEstimate(ticket) ? Number(ticket.estimate_amount) : '',
    estimate_unit: hasEstimate(ticket) ? ticket.estimate_unit : 'hours',
    addDeps: [],
    removeDeps: [],
    addFiles: [], // File objects to upload (migration 085)
    removeAttachments: [] // saved attachment ids to delete
  }
}

function resetDraft(ticket) {
  draft.value = draftFrom(ticket)
  original.value = draftFrom(ticket)
  saveError.value = ''
}

// '' when not estimated (the unit alone doesn't count as a change)
function estimateKey(d) {
  return d.estimate_amount === '' || d.estimate_amount === null ? '' : `${Number(d.estimate_amount)} ${d.estimate_unit}`
}

// Changed ticket fields, as a PUT /api/helpdesk/ticket body
function changedTicketFields() {
  const d = draft.value
  const o = original.value
  const body = {}
  for (const key of TICKET_FIELDS) {
    if (d[key] !== o[key]) body[key] = key === 'title' ? d.title.trim() : d[key]
  }
  if (estimateKey(d) !== estimateKey(o)) {
    body.estimate_amount = d.estimate_amount === '' ? null : d.estimate_amount
    body.estimate_unit = d.estimate_unit
  }
  return body
}

// A comment being written, or an edit to one, that hasn't been posted
const commentEditChanged = computed(() => {
  if (editingCommentId.value === null) return false
  const comment = ticketComments.value.find(c => c.id === editingCommentId.value)
  return !!comment && editCommentText.value.trim() !== comment.content.trim()
})
const hasUnpostedComment = computed(() => !!commentText.value.trim() || commentEditChanged.value)

// Every change made in the panel must land here, or the save bar won't
// appear and the leave prompt won't warn about it
const isDirty = computed(() => {
  if (!draft.value || !original.value) return false
  return Object.keys(changedTicketFields()).length > 0
    || draft.value.addDeps.length > 0
    || draft.value.removeDeps.length > 0
    || draft.value.addFiles.length > 0
    || draft.value.removeAttachments.length > 0
    || hasUnpostedComment.value
})

// Merge a saved ticket (PUT response) into the panel and the board
function applyTicketUpdate(saved) {
  selectedTicket.value = { ...selectedTicket.value, ...saved }
  const boardTicket = ticketsById.value.get(saved.id) || splitParentsById.value.get(saved.id)
  if (boardTicket) Object.assign(boardTicket, saved)
}

// Returns true when everything saved. On failure the unsaved part stays in
// the draft and the error shows in the save bar.
async function saveChanges() {
  if (!isDirty.value) return true
  if (savingChanges.value) return false
  const ticketId = selectedTicket.value.id
  savingChanges.value = true
  saveError.value = ''
  try {
    const body = changedTicketFields()
    if ('title' in body && !body.title) throw new Error('Title is required')
    if (Object.keys(body).length > 0) {
      const res = await authFetch(`/api/helpdesk/ticket/${ticketId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Failed to save changes')
      applyTicketUpdate(data.ticket)
      // Fields are saved; keep any pending dependency/attachment changes
      const { addDeps, removeDeps, addFiles, removeAttachments } = draft.value
      resetDraft(selectedTicket.value)
      Object.assign(draft.value, { addDeps, removeDeps, addFiles, removeAttachments })
    }

    for (const id of [...draft.value.removeDeps]) {
      const res = await authFetch(`/api/helpdesk/ticket/${ticketId}/dependencies/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || `Failed to remove dependency on #${id}`)
      replaceTicketEdges(ticketId, data.dependencies)
      draft.value.removeDeps = draft.value.removeDeps.filter(x => x !== id)
    }
    for (const id of [...draft.value.addDeps]) {
      const res = await authFetch(`/api/helpdesk/ticket/${ticketId}/dependencies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depends_on_ticket_id: id })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || `Failed to add dependency on #${id}`)
      replaceTicketEdges(ticketId, data.dependencies)
      draft.value.addDeps = draft.value.addDeps.filter(x => x !== id)
    }

    for (const id of [...draft.value.removeAttachments]) {
      const res = await authFetch(`/api/helpdesk/attachment/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Failed to remove attachment')
      ticketAttachments.value = data.attachments
      draft.value.removeAttachments = draft.value.removeAttachments.filter(x => x !== id)
    }
    if (draft.value.addFiles.length > 0) {
      ticketAttachments.value = await uploadAttachments(ticketId, draft.value.addFiles)
      draft.value.addFiles = []
    }

    // The comment helpers clear their text only on success
    if (commentEditChanged.value) {
      await saveEditComment(editingCommentId.value)
      if (commentEditChanged.value) throw new Error('Failed to save your comment edit')
    }
    if (commentText.value.trim()) {
      await addComment()
      if (commentText.value.trim()) throw new Error('Failed to post your comment')
    }

    editingTicket.value = false
    return true
  } catch (err) {
    saveError.value = err.message
    return false
  } finally {
    savingChanges.value = false
  }
}

// ---- Attachments (migration 085) ----
// Picked files and removals are staged in the draft like every other edit.
const ticketAttachments = ref([])

async function fetchAttachments(ticketId) {
  try {
    const res = await authFetch(`/api/helpdesk/ticket/${ticketId}/attachments`)
    if (res.ok) ticketAttachments.value = (await res.json()).attachments
  } catch (err) {
    console.error('Error fetching attachments:', err)
  }
}

// Uploads files in one request; returns the ticket's full attachment list
async function uploadAttachments(ticketId, files) {
  const form = new FormData()
  for (const file of files) form.append('files', file)
  const res = await authFetch(`/api/helpdesk/ticket/${ticketId}/attachments`, { method: 'POST', body: form })
  const data = await res.json()
  if (!res.ok) throw new Error(data.message || 'Failed to upload attachments')
  return data.attachments
}

// Creator or anyone who can work the ticket may attach; the uploader or
// anyone who can work it may remove (mirrors routes/helpdesk.js)
const canAttach = computed(() => !!selectedTicket.value
  && (canWork.value || selectedTicket.value.creator_handle === user.username))
const canRemoveAttachment = (a) => canWork.value || a.uploader_handle === user.username

function discardChanges() {
  resetDraft(selectedTicket.value)
  editingTicket.value = false
  newDependencyId.value = ''
  commentText.value = ''
  cancelEditComment()
}

// Status buttons pick the draft's status; picking the chosen one again
// puts back the saved status
function chooseStatus(status) {
  draft.value.status = draft.value.status === status ? original.value.status : status
}

// ---- Leave-with-unsaved-changes prompt ----
// confirmLeave() resolves true when it's fine to leave: nothing unsaved, or
// the user saved (successfully) or discarded. False: keep editing.
const leavePrompt = ref(null) // { resolve }
const leaveSaveBtn = ref(null)

function confirmLeave() {
  if (!isDirty.value) return Promise.resolve(true)
  return new Promise(resolve => {
    leavePrompt.value = { resolve }
    nextTick(() => leaveSaveBtn.value?.focus())
  })
}

async function resolveLeave(choice) {
  const { resolve } = leavePrompt.value
  leavePrompt.value = null
  if (choice === 'save') resolve(await saveChanges())
  else resolve(choice === 'discard')
}

async function requestClose() {
  if (await confirmLeave()) closeDetail()
}

// Leaving the route closes the panel too: the board and the backlog list
// are this same component, so Vue reuses it between them and an open (or
// just-discarded) panel would otherwise follow you to the other view.
onBeforeRouteLeave(async () => {
  const ok = await confirmLeave()
  if (ok) closeDetail()
  return ok
})

// Closing or reloading the browser tab: only the browser's own prompt is
// possible there
function handleBeforeUnload(e) {
  if (!isDirty.value) return
  e.preventDefault()
  e.returnValue = ''
}
window.addEventListener('beforeunload', handleBeforeUnload)

// Status changes: employees (and working project members) can make any
// move; anyone else who created
// the ticket may only resolve or close it (mirrors PUT /api/helpdesk/ticket).
function allowedTransitions(ticket) {
  const transitions = getAvailableTransitions(ticket.status)
  if (canWork.value) return transitions
  if (ticket.creator_handle === user.username) return transitions.filter(s => s === 'resolved' || s === 'closed')
  return []
}

// Jump to a linked ticket if it's on this board (it may be in another project)
// Jumps to a ticket on this board, or to a split parent (off the board)
async function openLinkedTicket(id) {
  const ticket = ticketsById.value.get(id) || splitParentsById.value.get(id)
  if (ticket && await confirmLeave()) selectTicket(ticket)
}

async function createTicket() {
  if (!newTicket.value.title.trim()) {
    return
  }

  createError.value = ''
  const files = newTicket.value.files
  if (files.length > 10) {
    createError.value = 'Attach at most 10 files at a time'
    return
  }
  const tooBig = files.filter(f => f.size > 25 * 1024 * 1024)
  if (tooBig.length) {
    createError.value = `${tooBig.map(f => f.name).join(', ')} ${tooBig.length === 1 ? 'is' : 'are'} over 25 MB`
    return
  }

  submitting.value = true

  try {
    const res = await authFetch(`/api/projects/${route.params.id}/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newTicket.value.title,
        description: newTicket.value.description,
        priority: newTicket.value.priority,
        ...(canWork.value && newTicket.value.estimate_amount !== ''
          ? { estimate_amount: newTicket.value.estimate_amount, estimate_unit: newTicket.value.estimate_unit }
          : {})
      })
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.message || 'Failed to create ticket')
    }

    // The ticket exists now; attach any picked files to it
    let uploadError = ''
    if (files.length > 0) {
      try {
        await uploadAttachments(data.ticket.id, files)
      } catch (err) {
        uploadError = err.message
      }
    }

    // Reset form and refresh project data
    newTicket.value = { title: '', description: '', priority: 'medium', estimate_amount: '', estimate_unit: 'hours', files: [] }
    showNewTicketForm.value = false
    await fetchProject()

    // Upload failed: open the new ticket with the files still pending so
    // Save Changes can retry
    if (uploadError) {
      const created = ticketsById.value.get(data.ticket.id)
      if (created) {
        selectTicket(created)
        draft.value.addFiles = files
        saveError.value = `The ticket was created, but its attachments didn't upload: ${uploadError}`
      }
    }
  } catch (err) {
    createError.value = err.message
  } finally {
    submitting.value = false
  }
}

// Handle drag change - update ticket status when dropped in new column
async function onDragChange(event, toStatus) {
  // Only handle when an item is added to this column
  if (!event.added) return

  const ticket = event.added.element
  if (!ticket || ticket.status === toStatus) return

  const oldStatus = ticket.status
  ticket.status = toStatus  // Update local state

  try {
    const res = await authFetch(`/api/helpdesk/ticket/${ticket.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: toStatus })
    })

    if (!res.ok) {
      ticket.status = oldStatus  // Rollback on failure
      await fetchProject()  // Re-fetch to restore correct state
    }
  } catch (err) {
    ticket.status = oldStatus  // Rollback on failure
    await fetchProject()
    console.error('Error updating ticket status:', err)
  }
}

function selectTicket(ticket) {
  selectedTicket.value = { ...ticket }
  editingTicket.value = false
  newDependencyId.value = ''
  resetDraft(ticket)
  ticketAttachments.value = []
  fetchComments(ticket.id)
  fetchAttachments(ticket.id)
}

function closeDetail() {
  selectedTicket.value = null
  draft.value = null
  original.value = null
  saveError.value = ''
  newDependencyId.value = ''
  editingTicket.value = false
  ticketComments.value = []
  ticketAttachments.value = []
  commentText.value = ''
  editingCommentId.value = null
  editCommentText.value = ''
}

function handleTicketDetailKeydown(e) {
  if (e.key !== 'Escape') return
  if (leavePrompt.value) resolveLeave('keep')
  else requestClose()
}

watch(selectedTicket, (isOpen) => {
  if (isOpen) {
    document.addEventListener('keydown', handleTicketDetailKeydown)
    nextTick(() => ticketCloseBtn.value?.focus())
  } else {
    document.removeEventListener('keydown', handleTicketDetailKeydown)
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleTicketDetailKeydown)
  window.removeEventListener('beforeunload', handleBeforeUnload)
})

async function fetchComments(ticketId) {
  try {
    const res = await authFetch(`/api/helpdesk/ticket/${ticketId}/comments`)
    if (res.ok) {
      const data = await res.json()
      ticketComments.value = data.comments
    }
  } catch (err) {
    console.error('Error fetching comments:', err)
  }
}

async function addComment() {
  if (!commentText.value.trim() || !selectedTicket.value) return
  postingComment.value = true
  try {
    const res = await authFetch(`/api/helpdesk/ticket/${selectedTicket.value.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: commentText.value.trim() })
    })
    if (res.ok) {
      const data = await res.json()
      ticketComments.value.push(data.comment)
      commentText.value = ''
    }
  } catch (err) {
    console.error('Error adding comment:', err)
  } finally {
    postingComment.value = false
  }
}

function startEditComment(comment) {
  editingCommentId.value = comment.id
  editCommentText.value = comment.content
}

function cancelEditComment() {
  editingCommentId.value = null
  editCommentText.value = ''
}

async function saveEditComment(commentId) {
  if (!editCommentText.value.trim()) return
  try {
    const res = await authFetch(`/api/helpdesk/comment/${commentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editCommentText.value.trim() })
    })
    if (res.ok) {
      const data = await res.json()
      const idx = ticketComments.value.findIndex(c => c.id === commentId)
      if (idx !== -1) ticketComments.value[idx] = data.comment
      cancelEditComment()
    }
  } catch (err) {
    console.error('Error updating comment:', err)
  }
}

async function deleteComment(commentId) {
  try {
    const res = await authFetch(`/api/helpdesk/comment/${commentId}`, { method: 'DELETE' })
    if (res.ok) {
      const idx = ticketComments.value.findIndex(c => c.id === commentId)
      if (idx !== -1) ticketComments.value[idx] = { ...ticketComments.value[idx], is_deleted: 1 }
    }
  } catch (err) {
    console.error('Error deleting comment:', err)
  }
}

function goBack() {
  if (project.value?.company_id) {
    router.push(`/company/${project.value.company_id}`)
  } else {
    router.push('/company-portal')
  }
}

// Status transitions for detail modal
function getAvailableTransitions(currentStatus) {
  const transitions = {
    backlog: ['on-deck', 'in_progress'],
    // Help Desk tickets start 'open'; on a board they're backlog
    open: ['on-deck', 'in_progress'],
    'on-deck': ['backlog', 'in_progress'],
    in_progress: ['on-deck', 'resolved'],
    resolved: ['in_progress', 'closed'],
    closed: ['resolved']
  }
  return transitions[currentStatus] || []
}

// Watch for route changes (if navigating between projects)
watch(() => route.params.id, () => {
  if (route.params.id) {
    fetchProject()
  }
})

onMounted(async () => {
  await fetchProject()
})
</script>

<template>
  <div class="page-container project-page">
    <header class="project-header" :class="{ embedded: props.embedded }">
      <div v-if="!props.embedded">
        <h1>{{ project?.title || 'Loading...' }}</h1>
        <p v-if="project" class="company-name">{{ project.company_name }}</p>
      </div>
      <div class="header-actions">
        <button v-if="canWork || project?.is_public || project?.is_default" class="new-ticket-btn" @click="showNewTicketForm = true" :disabled="loading || error">
          + New Ticket
        </button>
        <button v-if="!props.embedded" @click="goBack" class="btn-secondary">Back</button>
      </div>
    </header>

    <!-- New Ticket Modal -->
    <div v-if="showNewTicketForm" class="modal-overlay" @click.self="showNewTicketForm = false">
      <div class="modal">
        <h2>Create New Ticket</h2>
        <form @submit.prevent="createTicket">
          <div class="form-group">
            <label for="title">Title</label>
            <input
              id="title"
              v-model="newTicket.title"
              type="text"
              placeholder="Brief description of the issue"
              required
            />
          </div>

          <div class="form-group">
            <label for="description">Description</label>
            <textarea
              id="description"
              v-model="newTicket.description"
              rows="5"
              placeholder="Provide details about the issue..."
            ></textarea>
          </div>

          <div class="form-group">
            <label for="priority">Priority</label>
            <select id="priority" v-model="newTicket.priority">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>

          <div v-if="canWork" class="form-group">
            <label for="estimate">Estimate</label>
            <div class="estimate-fields">
              <input
                id="estimate"
                v-model="newTicket.estimate_amount"
                type="number"
                min="0.25"
                max="9999"
                step="0.25"
                placeholder="e.g. 4"
              />
              <select v-model="newTicket.estimate_unit" aria-label="Estimate unit">
                <option v-for="unit in ESTIMATE_UNITS" :key="unit" :value="unit">{{ unit }}</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label for="new-ticket-files">Attachments</label>
            <input
              id="new-ticket-files"
              type="file"
              multiple
              @change="e => newTicket.files = [...e.target.files]"
            />
            <p class="form-hint">Images, spreadsheets, documents — up to 25 MB each, 10 files.</p>
          </div>

          <p v-if="createError" class="dependency-error" role="alert">{{ createError }}</p>

          <div class="modal-actions">
            <button type="submit" class="btn-primary" :disabled="submitting">
              {{ submitting ? 'Creating...' : 'Create Ticket' }}
            </button>
            <button type="button" class="btn-secondary" @click="showNewTicketForm = false">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Ticket Detail Modal -->
    <div v-if="selectedTicket && draft" class="modal-overlay" @click.self="requestClose">
      <div class="modal ticket-detail" role="dialog" aria-modal="true" aria-labelledby="ticket-detail-title">
        <div class="detail-header">
          <h2 v-if="!editingTicket" id="ticket-detail-title">{{ draft.title }}</h2>
          <h2 v-else id="ticket-detail-title">Edit Ticket</h2>
          <div class="header-buttons">
            <button v-if="!editingTicket && canSplit" class="btn-edit" @click="openSplitDialog">
              {{ selectedTicket.split_mode ? 'Add subtasks' : 'Split into subtasks' }}
            </button>
            <button v-if="!editingTicket && selectedTicket.creator_handle === user.username" class="btn-edit" @click="editingTicket = true">Edit</button>
            <button ref="ticketCloseBtn" class="close-btn" @click="requestClose" aria-label="Close">&times;</button>
          </div>
        </div>

        <!-- View Mode -->
        <template v-if="!editingTicket">
          <div class="detail-meta">
            <StatusBadge :color="statusColor[draft.status]">
              {{ statusLabels[draft.status] || draft.status }}
            </StatusBadge>
            <StatusBadge :color="priorityColor[draft.priority]">
              {{ draft.priority }}
            </StatusBadge>
          </div>

          <p v-if="parentOf(selectedTicket)" class="subtask-of">
            Subtask of
            <button class="dependency-link" @click="openLinkedTicket(selectedTicket.parent_ticket_id)">
              <span class="dependency-id">#{{ selectedTicket.parent_ticket_id }}</span> {{ parentOf(selectedTicket).title }}
            </button>
          </p>

          <div v-if="selectedTicket.split_mode" class="split-summary">
            <p class="split-note">
              Split into subtasks ·
              {{ selectedTicket.split_mode === 'category'
                ? 'shown as a category on the GANTT and Burndown charts, off the Kanban board'
                : 'hidden from the boards and charts' }}
            </p>
            <ul class="dependency-list">
              <li v-for="sub in subtasksOf(selectedTicket.id)" :key="sub.id" class="dependency-item">
                <button class="dependency-link" @click="openLinkedTicket(sub.id)">
                  <span class="dependency-id">#{{ sub.id }}</span> {{ sub.title }}
                </button>
                <span v-if="formatEstimateShort(sub)" class="ticket-estimate">{{ formatEstimateShort(sub) }}</span>
                <StatusBadge :color="statusColor[sub.status]" soft size="xs">{{ statusLabels[sub.status] || sub.status }}</StatusBadge>
              </li>
            </ul>
          </div>

          <div class="detail-info">
            <p><strong>Created by:</strong> {{ getCreatorName(selectedTicket) }}</p>
            <p><strong>Created:</strong> {{ formatDate(selectedTicket.created_at) }}</p>
            <p v-if="selectedTicket.resolved_at"><strong>Resolved:</strong> {{ formatDate(selectedTicket.resolved_at) }}</p>
            <p><strong>Assigned to:</strong> {{ getAssigneeName(selectedTicket) }}</p>
            <p v-if="!canWork"><strong>Estimate:</strong> {{ formatEstimate(selectedTicket) || 'Not estimated' }}</p>
          </div>

          <div v-if="canWork" class="detail-estimate">
            <label for="estimate-input"><strong>Estimate:</strong></label>
            <input
              id="estimate-input"
              v-model="draft.estimate_amount"
              type="number"
              min="0.25"
              max="9999"
              step="0.25"
              placeholder="Not estimated"
            />
            <select v-model="draft.estimate_unit" aria-label="Estimate unit">
              <option v-for="unit in ESTIMATE_UNITS" :key="unit" :value="unit">{{ unit }}</option>
            </select>
          </div>

          <div v-if="canWork" class="detail-assign">
            <label for="assign-select"><strong>Assign to:</strong></label>
            <select id="assign-select" v-model="draft.assigned_to">
              <option :value="null">Unassigned</option>
              <option v-for="emp in assignees" :key="emp.user_id" :value="emp.user_id">
                {{ emp.first_name }} {{ emp.last_name }} ({{ emp.handle }})
              </option>
            </select>
          </div>

          <div class="detail-description">
            <h3>Description</h3>
            <div v-if="draft.description" class="rich-content" v-html="draft.description"></div>
            <p v-else class="no-description">No description provided.</p>
          </div>

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

          <div class="detail-actions" v-if="allowedTransitions(selectedTicket).length > 0">
            <h3>Move to</h3>
            <div class="status-buttons">
              <button
                v-for="nextStatus in allowedTransitions(selectedTicket)"
                :key="nextStatus"
                @click="chooseStatus(nextStatus)"
                class="btn-status"
                :class="{ chosen: draft.status === nextStatus }"
                :aria-pressed="draft.status === nextStatus"
                :style="{ background: statusHex[nextStatus] }"
              >
                {{ statusLabels[nextStatus] }}
              </button>
            </div>
          </div>

          <div class="detail-dependencies">
            <h3>Depends on</h3>
            <ul v-if="selectedDependsOn.length > 0" class="dependency-list">
              <li v-for="dep in selectedDependsOn" :key="dep.id" class="dependency-item" :class="dep.pending && `pending-${dep.pending}`">
                <button
                  class="dependency-link"
                  :disabled="!canOpen(dep.id)"
                  :title="canOpen(dep.id) ? 'Open ticket' : 'In another project'"
                  @click="openLinkedTicket(dep.id)"
                >
                  <span class="dependency-id">#{{ dep.id }}</span> {{ dep.title }}
                </button>
                <StatusBadge :color="statusColor[dep.status]" soft size="xs">{{ statusLabels[dep.status] || dep.status }}</StatusBadge>
                <span v-if="dep.pending === 'add'" class="dependency-pending">unsaved</span>
                <button
                  v-if="canWork && dep.pending === 'remove'"
                  class="dependency-undo"
                  :aria-label="`Keep dependency on #${dep.id}`"
                  @click="toggleDependency(dep)"
                >Undo</button>
                <button
                  v-else-if="canWork"
                  class="dependency-remove"
                  :aria-label="`Remove dependency on #${dep.id}`"
                  title="Remove dependency"
                  @click="toggleDependency(dep)"
                >&times;</button>
              </li>
            </ul>
            <p v-else class="no-dependencies">No dependencies.</p>

            <div v-if="canWork" class="dependency-add">
              <select v-model="newDependencyId" aria-label="Add a dependency" @change="addDependency">
                <option value="">Add a ticket this depends on...</option>
                <option v-for="t in dependencyCandidates" :key="t.id" :value="t.id">
                  #{{ t.id }} {{ t.title }} ({{ statusLabels[t.status] || t.status }})
                </option>
              </select>
            </div>

            <template v-if="selectedBlocking.length > 0">
              <h3 class="blocking-heading">Blocking</h3>
              <ul class="dependency-list">
                <li v-for="dep in selectedBlocking" :key="dep.id" class="dependency-item">
                  <button
                    class="dependency-link"
                    :disabled="!canOpen(dep.id)"
                    :title="canOpen(dep.id) ? 'Open ticket' : 'In another project'"
                    @click="openLinkedTicket(dep.id)"
                  >
                    <span class="dependency-id">#{{ dep.id }}</span> {{ dep.title }}
                  </button>
                  <StatusBadge :color="statusColor[dep.status]" soft size="xs">{{ statusLabels[dep.status] || dep.status }}</StatusBadge>
                </li>
              </ul>
            </template>
          </div>

          <div class="detail-comments">
            <h3>Comments ({{ ticketComments.filter(c => !c.is_deleted).length }})</h3>

            <div v-if="ticketComments.length > 0" class="comments-list">
              <div v-for="comment in ticketComments" :key="comment.id" class="comment-item">
                <template v-if="comment.is_deleted">
                  <p class="comment-deleted">Comment deleted.</p>
                </template>
                <template v-else-if="editingCommentId === comment.id">
                  <div class="comment-edit-form">
                    <textarea v-model="editCommentText" rows="2" class="comment-input"></textarea>
                    <div class="comment-edit-actions">
                      <button class="btn-primary btn-sm" @click="saveEditComment(comment.id)" :disabled="!editCommentText.trim()">Save</button>
                      <button class="btn-secondary btn-sm" @click="cancelEditComment">Cancel</button>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <div class="comment-header">
                    <span class="comment-author">{{ comment.handle }}</span>
                    <span class="comment-date">{{ formatDate(comment.created_at) }}</span>
                    <span v-if="comment.updated_at !== comment.created_at" class="comment-edited">(edited)</span>
                    <div v-if="comment.handle === user.username" class="comment-actions">
                      <button class="btn-link" @click="startEditComment(comment)">Edit</button>
                      <button class="btn-link btn-danger" @click="deleteComment(comment.id)">Delete</button>
                    </div>
                  </div>
                  <p class="comment-content">{{ comment.content }}</p>
                </template>
              </div>
            </div>
            <p v-else class="no-comments">No comments yet.</p>

            <div class="comment-compose">
              <textarea
                v-model="commentText"
                placeholder="Add a comment..."
                rows="2"
                class="comment-input"
              ></textarea>
              <button
                class="btn-primary btn-sm"
                @click="addComment"
                :disabled="postingComment || !commentText.trim()"
              >
                {{ postingComment ? 'Posting...' : 'Add Comment' }}
              </button>
            </div>
          </div>
        </template>

        <!-- Edit Mode -->
        <form v-else @submit.prevent="saveChanges" class="edit-form">
          <div class="form-group">
            <label for="edit-title">Title</label>
            <input
              id="edit-title"
              v-model="draft.title"
              type="text"
              placeholder="Ticket title"
              required
            />
          </div>

          <div class="form-group">
            <label>Description</label>
            <RichTextEditor v-model="draft.description" />
          </div>

          <div class="form-group">
            <label for="edit-priority">Priority</label>
            <select id="edit-priority" v-model="draft.priority">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>

          <div class="modal-actions">
            <button type="button" class="btn-secondary" @click="editingTicket = false">
              Back to ticket
            </button>
          </div>
        </form>

        <!-- Appears once anything is changed; nothing is saved until clicked -->
        <div v-if="isDirty || saveError" class="save-bar" role="region" aria-label="Unsaved changes">
          <p v-if="saveError" class="save-error" role="alert">{{ saveError }}</p>
          <div class="save-bar-row">
            <span class="save-bar-note">{{ isDirty ? 'You have unsaved changes' : '' }}</span>
            <div class="save-bar-buttons">
              <button type="button" class="btn-secondary" :disabled="savingChanges || !isDirty" @click="discardChanges">
                Discard Changes
              </button>
              <button type="button" class="btn-primary" :disabled="savingChanges || !isDirty" @click="saveChanges">
                {{ savingChanges ? 'Saving...' : 'Save Changes' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <SplitTicketDialog
      v-if="showSplitDialog && selectedTicket"
      :ticket="selectedTicket"
      @close="showSplitDialog = false"
      @split="onSplit"
    />

    <!-- Leaving the ticket (close, Escape, another ticket, another page) with unsaved changes -->
    <div v-if="leavePrompt" class="modal-overlay leave-overlay" @click.self="resolveLeave('keep')">
      <div class="modal leave-dialog" role="alertdialog" aria-modal="true" aria-labelledby="leave-title" aria-describedby="leave-desc">
        <h2 id="leave-title">Unsaved changes</h2>
        <p id="leave-desc">You have unsaved changes to this ticket. Save them before leaving?</p>
        <div class="leave-actions">
          <button type="button" class="btn-secondary" @click="resolveLeave('keep')">Keep Editing</button>
          <button type="button" class="btn-secondary btn-discard" @click="resolveLeave('discard')">Discard Changes</button>
          <button ref="leaveSaveBtn" type="button" class="btn-primary" @click="resolveLeave('save')">Save Changes</button>
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading"><LoadingSpinner size="small" /> Loading project...</div>

    <!-- Error State -->
    <div v-else-if="error" class="error-box">
      <p>{{ error }}</p>
      <button @click="fetchProject">Retry</button>
    </div>

    <!-- Backlog link on the left, closed-ticket link over the Resolved lane -->
    <div v-if="!loading && !error && props.view === 'board'" class="board-toolbar">
      <RouterLink :to="backlogLink" class="closed-tickets-link">
        {{ backlogTickets.length }} Backlog ticket{{ backlogTickets.length === 1 ? '' : 's' }}
      </RouterLink>
      <RouterLink :to="closedTicketsLink" class="closed-tickets-link">
        {{ closedCount }} Closed ticket{{ closedCount === 1 ? '' : 's' }}
      </RouterLink>
    </div>

    <!-- Backlog list -->
    <section v-if="!loading && !error && props.view === 'backlog'" class="backlog-view">
      <RouterLink :to="boardLink" class="closed-tickets-link backlog-back">&larr; Back to Kanban Board</RouterLink>
      <div class="backlog-head">
        <h2>Backlog ({{ backlogTickets.length }})</h2>
        <input
          v-if="backlogTickets.length"
          v-model="backlogSearch"
          type="search"
          class="backlog-search"
          placeholder="Search #id or title"
          aria-label="Search the backlog"
        />
      </div>

      <p v-if="!backlogTickets.length" class="backlog-empty">The backlog is empty.</p>
      <p v-else-if="!backlogRows.length" class="backlog-empty">No backlog tickets match "{{ backlogSearch }}".</p>
      <ul v-else class="backlog-list">
        <li
          v-for="row in backlogRows"
          :key="row.key"
          :class="{ 'backlog-child': row.child, 'backlog-group-end': row.lastChild }"
        >
          <!-- Split parent: group header -->
          <div v-if="row.kind === 'parent'" class="backlog-parent">
            <button
              class="group-toggle"
              :aria-expanded="!row.collapsed"
              :aria-label="`${row.collapsed ? 'Show' : 'Hide'} subtasks of #${row.ticket.id}`"
              @click="toggleGroup(row.ticket.id)"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" :class="{ rotated: !row.collapsed }"><polyline points="9 6 15 12 9 18" /></svg>
            </button>
            <button class="backlog-parent-main" :data-ticket-id="row.ticket.id" @click="selectTicket(row.ticket)">
              <span class="ticket-id">#{{ row.ticket.id }}</span>
              <span class="backlog-main">
                <span class="backlog-parent-title">{{ row.ticket.title }}</span>
                <span class="backlog-meta">
                  <span>{{ row.subtaskCount }} subtask{{ row.subtaskCount === 1 ? '' : 's' }}</span>
                  <span>{{ row.backlogCount }} in backlog</span>
                  <span v-if="row.doneCount">{{ row.doneCount }} done</span>
                </span>
              </span>
              <span class="split-kind">{{ row.ticket.split_mode === 'category' ? 'Category' : 'Split ticket' }}</span>
            </button>
          </div>

          <button v-else class="backlog-item" :data-ticket-id="row.ticket.id" @click="selectTicket(row.ticket)">
            <span class="ticket-id">#{{ row.ticket.id }}</span>
            <span class="backlog-main">
              <span class="backlog-title">{{ row.ticket.title }}</span>
              <span class="backlog-meta">
                <span v-if="openBlockersByTicket[row.ticket.id]" class="backlog-blocked">
                  Blocked by {{ openBlockersByTicket[row.ticket.id].map(id => '#' + id).join(', ') }}
                </span>
                <span v-if="row.ticket.assignee_handle">{{ getAssigneeName(row.ticket) }}</span>
                <span>Opened {{ formatDate(row.ticket.created_at) }}</span>
              </span>
            </span>
            <span class="backlog-badges">
              <span v-if="hasEstimate(row.ticket)" class="ticket-estimate" :title="`Estimate: ${formatEstimate(row.ticket)}`">{{ formatEstimateShort(row.ticket) }}</span>
              <StatusBadge :color="priorityColor[row.ticket.priority]" size="xs">{{ row.ticket.priority }}</StatusBadge>
            </span>
          </button>
        </li>
      </ul>
    </section>

    <!-- Kanban Board -->
    <div v-if="!loading && !error && props.view === 'board'" class="kanban-board">
      <div
        v-for="status in kanbanStatuses"
        :key="status"
        class="kanban-column"
      >
        <div class="column-header" :style="{ borderTopColor: statusHex[status] }">
          <h3>{{ statusLabels[status] }}</h3>
          <span class="ticket-count">{{ ticketsByStatus[status].length }}</span>
        </div>

        <draggable
          :list="ticketsByStatus[status]"
          group="tickets"
          item-key="id"
          class="ticket-list"
          :disabled="!canWork"
          :data-status="status"
          @change="(e) => onDragChange(e, status)"
        >
          <template #item="{ element: ticket }">
            <div
              class="ticket-card"
              :data-ticket-id="ticket.id"
              @click="selectTicket(ticket)"
            >
              <div class="ticket-header">
                <span class="ticket-id">#{{ ticket.id }}</span>
                <span class="ticket-header-right">
                  <span
                    v-if="hasEstimate(ticket)"
                    class="ticket-estimate"
                    :title="`Estimate: ${formatEstimate(ticket)}`"
                  >{{ formatEstimateShort(ticket) }}</span>
                  <StatusBadge :color="priorityColor[ticket.priority]" size="xs">
                    {{ ticket.priority }}
                  </StatusBadge>
                </span>
              </div>
              <h4 class="ticket-title">{{ ticket.title }}</h4>
              <div
                v-if="parentOf(ticket)"
                class="ticket-parent"
                :title="`Subtask of #${ticket.parent_ticket_id} ${parentOf(ticket).title}`"
              >↳ #{{ ticket.parent_ticket_id }} {{ parentOf(ticket).title }}</div>
              <div
                v-if="openBlockersByTicket[ticket.id]"
                class="ticket-blocked"
                :title="`Waiting on ${openBlockersByTicket[ticket.id].map(id => '#' + id).join(', ')}`"
              >
                Blocked by {{ openBlockersByTicket[ticket.id].map(id => '#' + id).join(', ') }}
              </div>
              <div class="ticket-footer">
                <span class="ticket-creator">{{ getCreatorName(ticket) }}</span>
                <span v-if="ticket.assignee_handle" class="ticket-assignee">{{ getAssigneeName(ticket) }}</span>
              </div>
            </div>
          </template>
        </draggable>

        <div v-if="ticketsByStatus[status].length === 0" class="empty-column">
          No tickets
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.project-page {
  max-width: 1400px;
}

.project-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1.5rem;
}

.project-header.embedded {
  justify-content: flex-end;
}

.project-header h1 {
  font-size: 2.2rem;
  font-weight: 700;
  color: var(--color-accent);
  margin: 0;
}

.company-name {
  color: var(--color-text-muted);
  margin: 0.25rem 0 0;
  font-size: 0.95rem;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.new-ticket-btn {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
  font-weight: 500;
}

.new-ticket-btn:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.new-ticket-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Modal styles */
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
  padding: 25px;
  border-radius: 12px;
  width: 500px;
  max-width: 90%;
  max-height: 90vh;
  overflow-y: auto;
}

.modal h2 {
  margin: 0 0 20px;
  color: var(--color-text);
}

.form-group {
  margin-bottom: 15px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.form-hint {
  margin: 4px 0 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.form-group input,
.form-group textarea,
.form-group select {
  width: 100%;
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 1rem;
  box-sizing: border-box;
  background: var(--color-background-input);
  color: var(--color-text);
}

.form-group textarea {
  resize: vertical;
}

.modal-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 20px;
}

.btn-primary {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.btn-primary:disabled {
  background: var(--color-button-secondary);
}

.btn-secondary {
  background: var(--color-button-secondary);
  color: var(--color-text);
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
}

.btn-secondary:hover {
  background: var(--color-button-secondary-hover);
}

/* Ticket Detail Modal */
.ticket-detail {
  width: 600px;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 15px;
}

.detail-header h2 {
  margin: 0;
  flex: 1;
  padding-right: 20px;
}

.header-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-edit {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: 6px 14px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
}

.btn-edit:hover {
  background: var(--color-accent-hover);
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.8rem;
  cursor: pointer;
  color: var(--color-text-light);
  line-height: 1;
}

.close-btn:hover {
  color: var(--color-text);
}

.edit-form {
  margin-top: 10px;
}

.detail-meta {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}

.detail-info {
  background: var(--color-background-soft);
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.detail-info p {
  margin: 0 0 8px;
  color: var(--color-text-secondary);
}

.detail-info p:last-child {
  margin-bottom: 0;
}

.detail-assign {
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.detail-assign label {
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.detail-assign select {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 0.95rem;
  background: var(--color-background-input);
  color: var(--color-text);
  cursor: pointer;
}

.detail-assign select:hover {
  border-color: var(--color-accent);
}

.detail-description {
  margin-bottom: 20px;
}

.detail-description h3 {
  margin: 0 0 10px;
  color: var(--color-text);
  font-size: 1rem;
}

.detail-description p {
  color: var(--color-text-secondary);
  line-height: 1.6;
  white-space: pre-wrap;
}

.rich-content {
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.rich-content :deep(p) { margin: 0 0 0.75em; }
.rich-content :deep(p:last-child) { margin-bottom: 0; }
.rich-content :deep(ul),
.rich-content :deep(ol) { padding-left: 1.5em; margin: 0.5em 0; }
.rich-content :deep(h3) { font-size: 1.05rem; font-weight: 600; margin: 0.75em 0 0.4em; }
.rich-content :deep(strong) { font-weight: 700; }
.rich-content :deep(em) { font-style: italic; }

.no-description {
  color: var(--color-text-light);
  font-style: italic;
}

.detail-actions h3 {
  margin: 0 0 10px;
  color: var(--color-text);
  font-size: 1rem;
}

.status-buttons {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.btn-status {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  color: white;
}

.btn-status:hover {
  opacity: 0.9;
}

.board-toolbar {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

/* Backlog list (view 'backlog') */
.backlog-view {
  max-width: 900px;
}

.backlog-back {
  display: inline-block;
  margin-bottom: 12px;
}

.backlog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}

.backlog-head h2 {
  margin: 0;
  font-size: 1.2rem;
  color: var(--color-text);
}

.backlog-search {
  width: 240px;
  max-width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-card);
  color: var(--color-text);
  font-size: 0.9rem;
}

.backlog-empty {
  padding: 30px;
  text-align: center;
  color: var(--color-text-light);
}

.backlog-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.backlog-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  border-left: 3px solid var(--color-accent);
  border-radius: var(--card-radius-sm);
  background: var(--color-background-card);
  box-shadow: var(--shadow-sm);
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: box-shadow 0.15s;
}

.backlog-item:hover,
.backlog-item:focus-visible {
  box-shadow: var(--shadow-md);
}

.backlog-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.backlog-title {
  font-weight: 500;
}

.backlog-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.backlog-blocked {
  color: var(--color-warning, #c77700);
}

/* Split parent group header: flat, muted panel with a bracket-like left
   rule, so it reads as a container rather than a ticket card */
.backlog-parent {
  display: flex;
  align-items: stretch;
  margin-top: 6px;
  border: 1px solid var(--color-border);
  border-left: 4px solid var(--color-text-secondary);
  border-radius: var(--card-radius-sm);
  background: var(--color-background-soft);
}

.group-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  flex-shrink: 0;
  border: none;
  border-right: 1px solid var(--color-border);
  background: none;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.group-toggle:hover {
  color: var(--color-accent);
}

.group-toggle svg {
  transition: transform 0.15s;
}

.group-toggle svg.rotated {
  transform: rotate(90deg);
}

.backlog-parent-main {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  padding: 10px 14px;
  border: none;
  background: none;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.backlog-parent-main:hover .backlog-parent-title,
.backlog-parent-main:focus-visible .backlog-parent-title {
  color: var(--color-accent);
  text-decoration: underline;
}

.backlog-parent-title {
  font-weight: 700;
}

.split-kind {
  flex-shrink: 0;
  padding: 2px 8px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}

/* Subtasks: indented under their parent with a connecting rule */
.backlog-child {
  position: relative;
  margin-left: 28px;
}

.backlog-child::before {
  content: '';
  position: absolute;
  top: -8px;
  bottom: 0;
  left: -16px;
  border-left: 2px solid var(--color-border);
}

.backlog-child::after {
  content: '';
  position: absolute;
  top: 50%;
  left: -16px;
  width: 12px;
  border-top: 2px solid var(--color-border);
}

.backlog-group-end::before {
  bottom: 50%;
}

.backlog-group-end {
  margin-bottom: 6px;
}

.backlog-badges {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.closed-tickets-link {
  padding: 2px 4px;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--color-accent);
  text-decoration: none;
}

.closed-tickets-link:hover {
  background: none;
  text-decoration: underline;
}

/* Kanban Board */
.kanban-board {
  display: flex;
  gap: 12px;
  padding-bottom: 16px;
  min-height: 500px;
}

.kanban-column {
  flex: 1;
  min-width: 0;
  background: var(--color-background-soft);
  border-radius: var(--card-radius-sm);
  border: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 200px);
}

.column-header {
  padding: 12px 16px;
  border-top: 4px solid;
  border-radius: 8px 8px 0 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--color-background-card);
  position: sticky;
  top: 0;
  z-index: 1;
}

.column-header h3 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text);
}

.ticket-count {
  background: var(--color-background-soft);
  color: var(--color-text-muted);
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 500;
}

.ticket-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 100px;
}

.ticket-card {
  background: var(--color-background-card);
  border-radius: var(--card-radius-sm);
  padding: 12px;
  box-shadow: var(--shadow-sm);
  cursor: grab;
  transition: transform 0.15s, box-shadow 0.15s;
  border-left: 3px solid var(--color-accent);
}

.ticket-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.ticket-card:active {
  cursor: grabbing;
}

.ticket-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.ticket-id {
  color: var(--color-text-light);
  font-size: 0.8rem;
  font-weight: 500;
}

.ticket-title {
  margin: 0 0 8px;
  font-size: 0.9rem;
  color: var(--color-text);
  line-height: 1.3;
  font-weight: 500;
}

.ticket-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.ticket-creator {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.ticket-assignee {
  font-size: 0.7rem;
  color: white;
  background: var(--color-accent);
  padding: 2px 6px;
  border-radius: 4px;
}

/* Drag states */
.sortable-ghost {
  opacity: 0.4;
  background: var(--color-accent);
}

.sortable-drag {
  opacity: 1;
  box-shadow: var(--shadow-lg);
}

.sortable-chosen {
  box-shadow: var(--shadow-md);
}

/* Empty column state */
.empty-column {
  text-align: center;
  padding: 24px 16px;
  color: var(--color-text-light);
  font-size: 0.85rem;
  font-style: italic;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px;
  color: var(--color-text-muted);
}

.error-box {
  background: var(--color-error-bg);
  color: var(--color-error);
  padding: 20px;
  border-radius: 8px;
  text-align: center;
}

.error-box button {
  margin-top: 10px;
  padding: 8px 16px;
  background: var(--color-error);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

/* Responsive: Mobile styles */
@media (max-width: 768px) {
  .project-header {
    flex-direction: column;
    gap: 12px;
  }

  .project-header h1 {
    font-size: 1.4rem;
  }

  .company-name {
    font-size: 0.85rem;
  }

  .header-actions {
    width: 100%;
  }

  .header-actions button {
    flex: 1;
  }

  .kanban-board {
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
  }

  .kanban-column {
    flex: 0 0 85vw;
    min-width: 85vw;
    scroll-snap-align: start;
  }
}

@media (max-width: 900px) and (min-width: 769px) {
  .kanban-board {
    overflow-x: auto;
  }

  .kanban-column {
    flex: 0 0 220px;
    min-width: 220px;
  }
}

/* Comments */
.detail-comments {
  margin-top: 20px;
  border-top: 1px solid var(--color-border);
  padding-top: 16px;
}

.detail-comments h3 {
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0 0 12px;
  color: var(--color-text);
}

.comments-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.comment-item {
  background: var(--color-surface-variant, #f5f5f5);
  border-radius: 8px;
  padding: 10px 12px;
}

.comment-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  flex-wrap: wrap;
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
  color: var(--color-text-light);
  font-style: italic;
}

.comment-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.comment-content {
  font-size: 0.9rem;
  color: var(--color-text);
  white-space: pre-wrap;
  margin: 0;
}

.comment-deleted {
  font-style: italic;
  color: var(--color-text-light);
  font-size: 0.85rem;
  margin: 0;
}

.comment-edit-form {
  display: flex;
  flex-direction: column;
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
  font-size: 0.9rem;
  resize: vertical;
  font-family: inherit;
  box-sizing: border-box;
}

.comment-compose {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.no-comments {
  color: var(--color-text-light);
  font-style: italic;
  font-size: 0.875rem;
  margin: 0 0 12px;
}

.btn-link {
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 0.8rem;
  padding: 0;
  text-decoration: underline;
}

.btn-link.btn-danger {
  color: var(--color-danger, #dc3545);
}

.btn-sm {
  padding: 6px 14px;
  font-size: 0.85rem;
}

/* Estimates */
.ticket-header-right {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ticket-estimate {
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-muted);
}

.detail-estimate {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.estimate-fields {
  display: flex;
  gap: 8px;
}

.estimate-fields input {
  flex: 1;
  min-width: 0;
}

.estimate-fields select {
  width: auto;
}

.detail-estimate input,
.detail-estimate select {
  width: 90px;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-card);
  color: var(--color-text);
  font-size: 0.875rem;
}

.estimate-status {
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

/* Subtasks */
.subtask-of {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0 0 12px;
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.split-summary {
  margin-bottom: 16px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
}

.split-note {
  margin: 0 0 8px;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.ticket-parent {
  margin-top: 4px;
  overflow: hidden;
  font-size: 0.75rem;
  color: var(--color-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Unsaved changes */
.save-bar {
  position: sticky;
  bottom: 0;
  margin: 20px -25px -25px;
  padding: 12px 25px;
  background: var(--color-background-card);
  border-top: 1px solid var(--color-border);
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

.btn-status.chosen {
  outline: 3px solid var(--color-text);
  outline-offset: 2px;
}

.dependency-item.pending-remove .dependency-link {
  text-decoration: line-through;
  opacity: 0.6;
}

.dependency-pending {
  font-size: 0.75rem;
  font-style: italic;
  color: var(--color-text-muted);
}

.dependency-undo {
  padding: 0 4px;
  border: none;
  background: none;
  color: var(--color-accent);
  font-size: 0.8rem;
  cursor: pointer;
}

.leave-overlay {
  z-index: 1100;
}

.leave-dialog {
  width: 420px;
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

.btn-discard:hover {
  border-color: var(--color-error);
  color: var(--color-error);
}

/* Dependencies */
.ticket-blocked {
  margin: -4px 0 8px;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--badge-orange);
}

.detail-dependencies {
  margin-top: 20px;
  border-top: 1px solid var(--color-border);
  padding-top: 16px;
}

.detail-dependencies h3 {
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0 0 10px;
  color: var(--color-text);
}

.detail-dependencies .blocking-heading {
  margin-top: 16px;
}

.dependency-list {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dependency-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--color-background-soft);
  border-radius: 6px;
}

.dependency-link {
  flex: 1;
  min-width: 0;
  padding: 0;
  background: none;
  border: none;
  text-align: left;
  font-size: 0.875rem;
  color: var(--color-text);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dependency-link:hover:not(:disabled) {
  color: var(--color-accent);
  text-decoration: underline;
}

.dependency-link:disabled {
  cursor: default;
}

.dependency-id {
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.dependency-remove {
  flex-shrink: 0;
  padding: 0 4px;
  background: none;
  border: none;
  font-size: 1.1rem;
  line-height: 1;
  color: var(--color-text-muted);
  cursor: pointer;
}

.dependency-remove:hover {
  color: var(--color-error);
}

.no-dependencies {
  color: var(--color-text-light);
  font-style: italic;
  font-size: 0.875rem;
  margin: 0 0 12px;
}

.dependency-add {
  display: flex;
  gap: 8px;
}

.dependency-add select {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-card);
  color: var(--color-text);
  font-size: 0.875rem;
}

.dependency-error {
  margin: 8px 0 0;
  font-size: 0.85rem;
  color: var(--color-error);
}
</style>
