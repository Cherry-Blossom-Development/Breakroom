<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authFetch } from '../utilities/authFetch'
import draggable from 'vuedraggable'

const route = useRoute()
const router = useRouter()

const project = ref(null)
const tickets = ref([])
const employees = ref([])
const loading = ref(true)
const error = ref(null)

// New ticket form
const showNewTicketForm = ref(false)
const newTicket = ref({
  title: '',
  description: '',
  priority: 'medium'
})
const submitting = ref(false)

// Selected ticket for detail view
const selectedTicket = ref(null)

// Edit ticket state
const editingTicket = ref(false)
const editForm = ref({
  title: '',
  description: '',
  priority: 'medium'
})
const savingTicket = ref(false)

const priorityColors = {
  low: '#6c757d',
  medium: '#0d6efd',
  high: '#fd7e14',
  urgent: '#dc3545'
}

const statusColors = {
  backlog: '#6c757d',
  'on-deck': '#17a2b8',
  in_progress: '#ffc107',
  resolved: '#28a745',
  closed: '#343a40'
}

const statusLabels = {
  backlog: 'Backlog',
  'on-deck': 'On Deck',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed'
}

const kanbanStatuses = ['backlog', 'on-deck', 'in_progress', 'resolved', 'closed']

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
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

async function fetchEmployees() {
  if (!project.value?.company_id) return

  try {
    const res = await authFetch(`/api/company/${project.value.company_id}/employees`)
    if (res.ok) {
      const data = await res.json()
      employees.value = data.employees.filter(e => e.status === 'active')
    }
  } catch (err) {
    console.error('Error fetching employees:', err)
  }
}

async function assignTicket(ticketId, userId) {
  try {
    const res = await authFetch(`/api/helpdesk/ticket/${ticketId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigned_to: userId || null })
    })

    if (res.ok) {
      await fetchProject()
      // Update selected ticket if open
      if (selectedTicket.value?.id === ticketId) {
        const updated = tickets.value.find(t => t.id === ticketId)
        if (updated) {
          selectedTicket.value = { ...updated }
        }
      }
    }
  } catch (err) {
    console.error('Error assigning ticket:', err)
  }
}

async function createTicket() {
  if (!newTicket.value.title.trim()) {
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
        priority: newTicket.value.priority
      })
    })

    if (!res.ok) {
      throw new Error('Failed to create ticket')
    }

    // Reset form and refresh project data
    newTicket.value = { title: '', description: '', priority: 'medium' }
    showNewTicketForm.value = false
    await fetchProject()
  } catch (err) {
    error.value = err.message
  } finally {
    submitting.value = false
  }
}

async function updateTicketStatus(ticketId, newStatus) {
  try {
    const res = await authFetch(`/api/helpdesk/ticket/${ticketId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    })

    if (res.ok) {
      // Update local state
      const ticket = tickets.value.find(t => t.id === ticketId)
      if (ticket) {
        ticket.status = newStatus
      }
      if (selectedTicket.value?.id === ticketId) {
        selectedTicket.value.status = newStatus
      }
    }
  } catch (err) {
    console.error('Error updating ticket:', err)
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
}

function closeDetail() {
  selectedTicket.value = null
  editingTicket.value = false
}

function startEditTicket() {
  editForm.value = {
    title: selectedTicket.value.title,
    description: selectedTicket.value.description || '',
    priority: selectedTicket.value.priority
  }
  editingTicket.value = true
}

function cancelEdit() {
  editingTicket.value = false
}

async function saveTicket() {
  if (!editForm.value.title.trim()) {
    return
  }

  savingTicket.value = true

  try {
    const res = await authFetch(`/api/helpdesk/ticket/${selectedTicket.value.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: editForm.value.title,
        description: editForm.value.description,
        priority: editForm.value.priority
      })
    })

    if (res.ok) {
      const data = await res.json()
      // Update selected ticket with new data
      selectedTicket.value = { ...selectedTicket.value, ...data.ticket }
      // Update in tickets list
      const index = tickets.value.findIndex(t => t.id === selectedTicket.value.id)
      if (index !== -1) {
        tickets.value[index] = { ...tickets.value[index], ...data.ticket }
      }
      editingTicket.value = false
    }
  } catch (err) {
    console.error('Error saving ticket:', err)
  } finally {
    savingTicket.value = false
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
  await fetchEmployees()
})
</script>

<template>
  <div class="page-container project-page">
    <header class="project-header">
      <div>
        <h1>{{ project?.title || 'Loading...' }}</h1>
        <p v-if="project" class="company-name">{{ project.company_name }}</p>
      </div>
      <div class="header-actions">
        <button class="new-ticket-btn" @click="showNewTicketForm = true" :disabled="loading || error">
          + New Ticket
        </button>
        <button @click="goBack" class="btn-secondary">Back</button>
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
    <div v-if="selectedTicket" class="modal-overlay" @click.self="closeDetail">
      <div class="modal ticket-detail">
        <div class="detail-header">
          <h2 v-if="!editingTicket">{{ selectedTicket.title }}</h2>
          <h2 v-else>Edit Ticket</h2>
          <div class="header-buttons">
            <button v-if="!editingTicket" class="btn-edit" @click="startEditTicket">Edit</button>
            <button class="close-btn" @click="closeDetail">&times;</button>
          </div>
        </div>

        <!-- View Mode -->
        <template v-if="!editingTicket">
          <div class="detail-meta">
            <span class="status-badge" :style="{ background: statusColors[selectedTicket.status] }">
              {{ statusLabels[selectedTicket.status] || selectedTicket.status }}
            </span>
            <span class="priority-badge" :style="{ background: priorityColors[selectedTicket.priority] }">
              {{ selectedTicket.priority }}
            </span>
          </div>

          <div class="detail-info">
            <p><strong>Created by:</strong> {{ getCreatorName(selectedTicket) }}</p>
            <p><strong>Created:</strong> {{ formatDate(selectedTicket.created_at) }}</p>
            <p v-if="selectedTicket.resolved_at"><strong>Resolved:</strong> {{ formatDate(selectedTicket.resolved_at) }}</p>
            <p><strong>Assigned to:</strong> {{ getAssigneeName(selectedTicket) }}</p>
          </div>

          <div class="detail-assign">
            <label for="assign-select"><strong>Assign to:</strong></label>
            <select
              id="assign-select"
              :value="selectedTicket.assignee_id || ''"
              @change="(e) => assignTicket(selectedTicket.id, e.target.value ? parseInt(e.target.value) : null)"
            >
              <option value="">Unassigned</option>
              <option v-for="emp in employees" :key="emp.user_id" :value="emp.user_id">
                {{ emp.first_name }} {{ emp.last_name }} ({{ emp.handle }})
              </option>
            </select>
          </div>

          <div class="detail-description">
            <h3>Description</h3>
            <p>{{ selectedTicket.description || 'No description provided.' }}</p>
          </div>

          <div class="detail-actions" v-if="getAvailableTransitions(selectedTicket.status).length > 0">
            <h3>Move to</h3>
            <div class="status-buttons">
              <button
                v-for="nextStatus in getAvailableTransitions(selectedTicket.status)"
                :key="nextStatus"
                @click="updateTicketStatus(selectedTicket.id, nextStatus)"
                class="btn-status"
                :style="{ background: statusColors[nextStatus] }"
              >
                {{ statusLabels[nextStatus] }}
              </button>
            </div>
          </div>
        </template>

        <!-- Edit Mode -->
        <form v-else @submit.prevent="saveTicket" class="edit-form">
          <div class="form-group">
            <label for="edit-title">Title</label>
            <input
              id="edit-title"
              v-model="editForm.title"
              type="text"
              placeholder="Ticket title"
              required
            />
          </div>

          <div class="form-group">
            <label for="edit-description">Description</label>
            <textarea
              id="edit-description"
              v-model="editForm.description"
              rows="5"
              placeholder="Ticket description..."
            ></textarea>
          </div>

          <div class="form-group">
            <label for="edit-priority">Priority</label>
            <select id="edit-priority" v-model="editForm.priority">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>

          <div class="modal-actions">
            <button type="submit" class="btn-primary" :disabled="savingTicket">
              {{ savingTicket ? 'Saving...' : 'Save Changes' }}
            </button>
            <button type="button" class="btn-secondary" @click="cancelEdit">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading">Loading project...</div>

    <!-- Error State -->
    <div v-else-if="error" class="error-box">
      <p>{{ error }}</p>
      <button @click="fetchProject">Retry</button>
    </div>

    <!-- Kanban Board -->
    <div v-else class="kanban-board">
      <div
        v-for="status in kanbanStatuses"
        :key="status"
        class="kanban-column"
      >
        <div class="column-header" :style="{ borderTopColor: statusColors[status] }">
          <h3>{{ statusLabels[status] }}</h3>
          <span class="ticket-count">{{ ticketsByStatus[status].length }}</span>
        </div>

        <draggable
          :list="ticketsByStatus[status]"
          group="tickets"
          item-key="id"
          class="ticket-list"
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
                <span
                  class="priority-badge"
                  :style="{ background: priorityColors[ticket.priority] }"
                >
                  {{ ticket.priority }}
                </span>
              </div>
              <h4 class="ticket-title">{{ ticket.title }}</h4>
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

.project-header h1 {
  font-size: 2.2rem;
  font-weight: 700;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #42b983 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
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
  border-radius: 8px;
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
  border-radius: 6px;
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

.status-badge,
.priority-badge {
  display: inline-block;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 500;
  color: white;
  text-transform: capitalize;
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
  text-align: center;
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
</style>
