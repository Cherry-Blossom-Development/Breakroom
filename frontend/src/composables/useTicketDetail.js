import { ref, computed, nextTick, onUnmounted } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { authFetch } from '../utilities/authFetch'
import { user } from '../stores/user'
import { hasEstimate } from '../utilities/ticketEstimates'

// Everything behind the ticket detail: the selected ticket, its draft of
// unsaved changes and Save/Discard, dependencies, subtasks/splitting,
// attachments, comments and the leave-with-unsaved-changes prompt. Shared
// by the board/backlog popup (ProjectPage.vue) and the full-page ticket
// view (TicketPage.vue); both load a project into the tickets,
// splitParents, dependencies and canWork refs returned here.
//
// Options:
//   reload()       refetch the project (after a split)
//   openTicket(t)  open a linked ticket; default: select it in place

export const priorityColor = {
  low: 'gray',
  medium: 'blue',
  high: 'orange',
  urgent: 'red'
}

export const statusColor = {
  backlog: 'gray',
  'on-deck': 'teal',
  in_progress: 'yellow',
  resolved: 'green',
  closed: 'gray'
}

// Hex colors needed for kanban column borders and transition buttons
export const statusHex = {
  backlog: 'var(--badge-gray)',
  'on-deck': 'var(--badge-teal)',
  in_progress: 'var(--badge-yellow)',
  resolved: 'var(--badge-green)',
  closed: 'var(--badge-gray)'
}

export const statusLabels = {
  backlog: 'Backlog',
  'on-deck': 'On Deck',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed'
}

export function useTicketDetail({ reload = async () => {}, openTicket = null } = {}) {
  const tickets = ref([])

  // Selected ticket for detail view
  const selectedTicket = ref(null)

  // Comments state
  const ticketComments = ref([])
  const commentText = ref('')
  const postingComment = ref(false)
  const editingCommentId = ref(null)
  const editCommentText = ref('')

  // Edit mode: shows the title/description/priority form (ticket creator
  // only). Its changes are staged in `draft` like every other change.
  const editingTicket = ref(false)

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

  // ---- Ticket dependencies (migration 079) ----
  // Edges touching this project's tickets: { ticket_id, depends_on_ticket_id,
  // ticket_title/status, depends_on_title/status }. Either end may be in
  // another project of the same company.
  const dependencies = ref([])
  const canWork = ref(false)

  // Prefer the board's live status (it changes on drag/transition) over the
  // status captured in the edge when the board loaded.
  const ticketsById = computed(() => new Map(tickets.value.map(t => [t.id, t])))

  // ---- Subtasks (migration 086) ----
  // Split tickets are off the board (the API returns them separately) but
  // open from their subtasks' "Subtask of" link.
  const splitParents = ref([])
  const splitParentsById = computed(() => new Map(splitParents.value.map(t => [t.id, t])))
  // Splits nest to any depth, so a ticket's subtasks can include split
  // tickets of their own (in splitParents rather than on the board)
  const subtasksOf = (id) => [...tickets.value, ...splitParents.value].filter(t => t.parent_ticket_id === id)
  const parentOf = (ticket) => (ticket?.parent_ticket_id ? splitParentsById.value.get(ticket.parent_ticket_id) : null)
  // The split tickets above this one, outermost first
  function ancestorsOf(ticket) {
    const chain = []
    const seen = new Set()
    for (let p = parentOf(ticket); p && !seen.has(p.id); p = parentOf(p)) {
      seen.add(p.id)
      chain.unshift(p)
    }
    return chain
  }

  const showSplitDialog = ref(false)
  // Split: any open ticket, subtasks included; finished work isn't split
  const canSplit = computed(() => {
    const t = selectedTicket.value
    return !!t && canWork.value && !isDone(t.status)
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
    await reload()
    // The parent is off the board now; reopen it to show its subtasks
    const parent = splitParentsById.value.get(parentId)
    if (parent) selectTicket(parent)
  }
  function liveStatus(id, fallback, seen = new Set()) {
    const ticket = ticketsById.value.get(id)
    if (ticket) return ticket.status
    // A split ticket's own status goes stale -- its subtasks carry the work --
    // so anything depending on it follows them: done once they all are.
    // Subtasks that were split in turn follow their own subtasks.
    if (splitParentsById.value.has(id) && !seen.has(id)) {
      seen.add(id)
      const subs = subtasksOf(id).map(t => liveStatus(t.id, t.status, seen))
      if (subs.length) {
        if (subs.every(isDone)) return 'resolved'
        return subs.some(s => s !== 'backlog' && s !== 'open') ? 'in_progress' : 'backlog'
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
  // ticket in the autocomplete stages it immediately -- there's no separate
  // Add step to forget.
  function addDependency(id) {
    if (!draft.value || !id) return
    if (draft.value.removeDeps.includes(id)) {
      draft.value.removeDeps = draft.value.removeDeps.filter(x => x !== id)
    } else if (!draft.value.addDeps.includes(id)) {
      draft.value.addDeps.push(id)
    }
  }

  // The selected ticket's category for the autocomplete: the other subtasks
  // of its split ticket (either split mode), offered before anything else
  const dependencyCategoryIds = computed(() => {
    const sel = selectedTicket.value
    if (!sel?.parent_ticket_id) return new Set()
    return new Set(tickets.value.filter(t => t.parent_ticket_id === sel.parent_ticket_id && t.id !== sel.id).map(t => t.id))
  })
  const dependencyCategoryName = computed(() => parentOf(selectedTicket.value)?.title || '')

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

  // Leaving the route closes the ticket too: the board and the backlog list
  // are the same component, so Vue reuses it between them and an open (or
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
  onUnmounted(() => window.removeEventListener('beforeunload', handleBeforeUnload))

  // Status changes: employees (and working project members) can make any
  // move; anyone else who created
  // the ticket may only resolve or close it (mirrors PUT /api/helpdesk/ticket).
  function allowedTransitions(ticket) {
    const transitions = getAvailableTransitions(ticket.status)
    if (canWork.value) return transitions
    if (ticket.creator_handle === user.username) return transitions.filter(s => s === 'resolved' || s === 'closed')
    return []
  }

  // Jumps to a ticket on this board, or to a split parent (off the board)
  async function openLinkedTicket(id) {
    const ticket = ticketsById.value.get(id) || splitParentsById.value.get(id)
    if (ticket && await confirmLeave()) (openTicket || selectTicket)(ticket)
  }

  function selectTicket(ticket) {
    selectedTicket.value = { ...ticket }
    editingTicket.value = false
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
    editingTicket.value = false
    ticketComments.value = []
    ticketAttachments.value = []
    commentText.value = ''
    editingCommentId.value = null
    editCommentText.value = ''
  }

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

  // Status transitions for the ticket detail
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

  return {
    tickets,
    selectedTicket,
    ticketComments,
    commentText,
    postingComment,
    editingCommentId,
    editCommentText,
    editingTicket,
    formatDate,
    getCreatorName,
    getAssigneeName,
    dependencies,
    canWork,
    ticketsById,
    splitParents,
    splitParentsById,
    subtasksOf,
    parentOf,
    ancestorsOf,
    showSplitDialog,
    canSplit,
    openSplitDialog,
    onSplit,
    liveStatus,
    canOpen,
    isDone,
    openBlockersByTicket,
    selectedDependsOn,
    selectedBlocking,
    dependencyCandidates,
    replaceTicketEdges,
    addDependency,
    dependencyCategoryIds,
    dependencyCategoryName,
    toggleDependency,
    draft,
    original,
    savingChanges,
    saveError,
    resetDraft,
    isDirty,
    applyTicketUpdate,
    saveChanges,
    ticketAttachments,
    fetchAttachments,
    uploadAttachments,
    canAttach,
    canRemoveAttachment,
    discardChanges,
    chooseStatus,
    leavePrompt,
    leaveSaveBtn,
    confirmLeave,
    resolveLeave,
    requestClose,
    allowedTransitions,
    openLinkedTicket,
    selectTicket,
    closeDetail,
    fetchComments,
    addComment,
    startEditComment,
    cancelEditComment,
    saveEditComment,
    deleteComment,
    getAvailableTransitions
  }
}
