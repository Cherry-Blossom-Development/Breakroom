<script setup>
import { ref, computed, onMounted } from 'vue'
import { authFetch } from '../utilities/authFetch'
import StatusBadge from '../components/StatusBadge.vue'
import LoadingSpinner from '../components/LoadingSpinner.vue'

// Default to Cherry Blossom Development (company_id = 1)
const companyId = ref(1)
const company = ref(null)
const tickets = ref([])
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

const priorityColor = {
  low: 'gray',
  medium: 'blue',
  high: 'orange',
  urgent: 'red'
}

const statusColor = {
  open: 'green',
  backlog: 'purple',
  in_progress: 'yellow',
  resolved: 'teal',
  closed: 'gray'
}

const formatDate = (dateStr) => {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const getCreatorName = (ticket) => {
  if (ticket.creator_first_name || ticket.creator_last_name) {
    return `${ticket.creator_first_name || ''} ${ticket.creator_last_name || ''}`.trim()
  }
  return ticket.creator_handle
}

const openTickets = computed(() => tickets.value.filter(t => t.status === 'open' || t.status === 'in_progress' || t.status === 'backlog'))
const closedTickets = computed(() => tickets.value.filter(t => t.status === 'resolved' || t.status === 'closed'))

async function fetchCompany() {
  try {
    const res = await authFetch(`/api/helpdesk/company/${companyId.value}`)
    if (res.ok) {
      const data = await res.json()
      company.value = data.company
    }
  } catch (err) {
    console.error('Error fetching company:', err)
  }
}

async function fetchTickets() {
  loading.value = true
  error.value = null

  try {
    const res = await authFetch(`/api/helpdesk/tickets/${companyId.value}`)
    if (!res.ok) {
      throw new Error('Failed to fetch tickets')
    }
    const data = await res.json()
    tickets.value = data.tickets
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

async function createTicket() {
  if (!newTicket.value.title.trim()) {
    return
  }

  submitting.value = true

  try {
    const res = await authFetch('/api/helpdesk/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_id: companyId.value,
        title: newTicket.value.title,
        description: newTicket.value.description,
        priority: newTicket.value.priority
      })
    })

    if (!res.ok) {
      throw new Error('Failed to create ticket')
    }

    // Reset form and refresh tickets
    newTicket.value = { title: '', description: '', priority: 'medium' }
    showNewTicketForm.value = false
    await fetchTickets()
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
      await fetchTickets()
      if (selectedTicket.value?.id === ticketId) {
        selectedTicket.value.status = newStatus
      }
    }
  } catch (err) {
    console.error('Error updating ticket:', err)
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

onMounted(() => {
  fetchCompany()
  fetchTickets()
})
</script>

<template>
  <div class="page-container helpdesk-page">
    <header class="helpdesk-header">
      <div>
        <h1>Help Desk</h1>
        <p v-if="company" class="company-name">{{ company.name }}</p>
      </div>
      <button class="new-ticket-btn" @click="showNewTicketForm = true">
        + New Ticket
      </button>
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
            <StatusBadge :color="statusColor[selectedTicket.status]">
              {{ selectedTicket.status.replace('_', ' ') }}
            </StatusBadge>
            <StatusBadge :color="priorityColor[selectedTicket.priority]">
              {{ selectedTicket.priority }}
            </StatusBadge>
          </div>

          <div class="detail-info">
            <p><strong>Created by:</strong> {{ getCreatorName(selectedTicket) }}</p>
            <p><strong>Created:</strong> {{ formatDate(selectedTicket.created_at) }}</p>
            <p v-if="selectedTicket.resolved_at"><strong>Resolved:</strong> {{ formatDate(selectedTicket.resolved_at) }}</p>
          </div>

          <div class="detail-description">
            <h3>Description</h3>
            <p>{{ selectedTicket.description || 'No description provided.' }}</p>
          </div>

          <div class="detail-actions" v-if="selectedTicket.status !== 'closed'">
            <h3>Update Status</h3>
            <div class="status-buttons">
              <button
                v-if="selectedTicket.status === 'open' || selectedTicket.status === 'backlog'"
                @click="updateTicketStatus(selectedTicket.id, 'in_progress')"
                class="btn-status in-progress"
              >
                Mark In Progress
              </button>
              <button
                v-if="selectedTicket.status === 'open' || selectedTicket.status === 'backlog' || selectedTicket.status === 'in_progress'"
                @click="updateTicketStatus(selectedTicket.id, 'resolved')"
                class="btn-status resolved"
              >
                Mark Resolved
              </button>
              <button
                v-if="selectedTicket.status === 'resolved'"
                @click="updateTicketStatus(selectedTicket.id, 'closed')"
                class="btn-status closed"
              >
                Close Ticket
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
    <div v-if="loading" class="loading"><LoadingSpinner size="small" /> Loading tickets...</div>

    <!-- Error State -->
    <div v-else-if="error" class="error-box">
      <p>{{ error }}</p>
      <button @click="fetchTickets">Retry</button>
    </div>

    <!-- Tickets List -->
    <div v-else class="tickets-container">
      <!-- Open Tickets -->
      <section class="ticket-section">
        <h2>Open Tickets ({{ openTickets.length }})</h2>
        <div v-if="openTickets.length === 0" class="empty-state">
          No open tickets
        </div>
        <div v-else class="ticket-list">
          <div
            v-for="ticket in openTickets"
            :key="ticket.id"
            class="ticket-card"
            @click="selectTicket(ticket)"
          >
            <div class="ticket-header">
              <span class="ticket-id">#{{ ticket.id }}</span>
              <StatusBadge :color="priorityColor[ticket.priority]">
                {{ ticket.priority }}
              </StatusBadge>
            </div>
            <h3 class="ticket-title">{{ ticket.title }}</h3>
            <div class="ticket-meta">
              <StatusBadge :color="statusColor[ticket.status]">
                {{ ticket.status.replace('_', ' ') }}
              </StatusBadge>
              <span class="ticket-date">{{ formatDate(ticket.created_at) }}</span>
            </div>
            <p class="ticket-creator">by {{ getCreatorName(ticket) }}</p>
          </div>
        </div>
      </section>

      <!-- Closed Tickets -->
      <section class="ticket-section closed-section">
        <h2>Resolved/Closed ({{ closedTickets.length }})</h2>
        <div v-if="closedTickets.length === 0" class="empty-state">
          No resolved tickets
        </div>
        <div v-else class="ticket-list">
          <div
            v-for="ticket in closedTickets"
            :key="ticket.id"
            class="ticket-card closed"
            @click="selectTicket(ticket)"
          >
            <div class="ticket-header">
              <span class="ticket-id">#{{ ticket.id }}</span>
              <StatusBadge :color="priorityColor[ticket.priority]">
                {{ ticket.priority }}
              </StatusBadge>
            </div>
            <h3 class="ticket-title">{{ ticket.title }}</h3>
            <div class="ticket-meta">
              <StatusBadge :color="statusColor[ticket.status]">
                {{ ticket.status }}
              </StatusBadge>
              <span class="ticket-date">{{ formatDate(ticket.resolved_at || ticket.updated_at) }}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.helpdesk-page {
  max-width: 1000px;
}

.helpdesk-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1.5rem;
}

.helpdesk-header h1 {
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

.new-ticket-btn:hover {
  background: var(--color-accent-hover);
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
  border-radius: var(--card-radius-sm);
  margin-bottom: 20px;
}

.detail-info p {
  margin: 0 0 8px;
  color: var(--color-text-secondary);
}

.detail-info p:last-child {
  margin-bottom: 0;
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

.btn-status.in-progress {
  background: var(--badge-yellow);
  color: #333;
}

.btn-status.resolved {
  background: var(--badge-teal);
}

.btn-status.closed {
  background: var(--badge-gray);
}

/* Tickets Container */
.tickets-container {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.ticket-section h2 {
  color: var(--color-text);
  font-size: 1.2rem;
  margin: 0 0 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid var(--color-accent);
}

.closed-section h2 {
  border-bottom-color: #6c757d;
}

.ticket-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 15px;
}

.ticket-card {
  background: var(--color-background-card);
  border-radius: var(--card-radius-sm);
  padding: 15px;
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
  border-left: 4px solid var(--color-accent);
}

.ticket-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.ticket-card.closed {
  border-left-color: #6c757d;
  opacity: 0.8;
}

.ticket-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.ticket-id {
  color: var(--color-text-light);
  font-size: 0.85rem;
  font-weight: 500;
}

.ticket-title {
  margin: 0 0 10px;
  font-size: 1rem;
  color: var(--color-text);
  line-height: 1.3;
}

.ticket-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.ticket-date {
  font-size: 0.8rem;
  color: var(--color-text-light);
}

.ticket-creator {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
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

.empty-state {
  text-align: center;
  padding: 30px;
  color: var(--color-text-light);
  background: var(--color-background-soft);
  border-radius: var(--card-radius-sm);
}
</style>
