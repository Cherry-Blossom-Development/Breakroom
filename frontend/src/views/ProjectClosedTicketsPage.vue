<script setup>
import { ref, computed, onMounted } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { authFetch } from '../utilities/authFetch'
import StatusBadge from '../components/StatusBadge.vue'
import LoadingSpinner from '../components/LoadingSpinner.vue'

// Closed tickets for one project, most recently closed first -- the Kanban
// board (ProjectPage.vue) has no Closed lane and links here instead.
// embedded: rendered inside ProjectWorkspacePage, which already shows the
// project title.
const props = defineProps({
  embedded: { type: Boolean, default: false }
})

const route = useRoute()

const project = ref(null)
const tickets = ref([])
const loading = ref(true)
const error = ref(null)

const priorityColor = {
  low: 'gray',
  medium: 'blue',
  high: 'orange',
  urgent: 'red'
}

// Back to whichever board linked here
const boardLink = computed(() => props.embedded
  ? { name: 'projectKanban', params: { id: route.params.id } }
  : `/project/${route.params.id}`
)

// resolved_at is stamped when a ticket moves to closed (see PUT
// /api/helpdesk/ticket/:id), so for closed tickets it's the close time.
const closedTickets = computed(() => tickets.value
  .filter(t => t.status === 'closed')
  .sort((a, b) => new Date(b.resolved_at || b.updated_at) - new Date(a.resolved_at || a.updated_at))
)

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

function personName(first, last, handle) {
  return (first || last) ? `${first || ''} ${last || ''}`.trim() : handle
}

async function fetchTickets() {
  loading.value = true
  error.value = null
  try {
    const res = await authFetch(`/api/projects/${route.params.id}`)
    if (!res.ok) {
      throw new Error(res.status === 404 ? 'Project not found' : 'Failed to load tickets')
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

onMounted(fetchTickets)
</script>

<template>
  <div class="page-container closed-tickets-page">
    <RouterLink :to="boardLink" class="board-link">&larr; Back to Kanban Board</RouterLink>

    <header class="closed-header">
      <h1 v-if="!props.embedded">{{ project?.title || 'Loading...' }}</h1>
      <p v-if="!props.embedded && project" class="company-name">{{ project.company_name }}</p>
      <h2>Closed Tickets<span v-if="!loading && !error"> ({{ closedTickets.length }})</span></h2>
    </header>

    <div v-if="loading" class="loading"><LoadingSpinner size="small" /> Loading tickets...</div>

    <div v-else-if="error" class="error-box">{{ error }}</div>

    <div v-else-if="closedTickets.length === 0" class="empty-state">No closed tickets yet.</div>

    <ul v-else class="closed-list">
      <li v-for="ticket in closedTickets" :key="ticket.id" class="closed-item">
        <div class="closed-item-main">
          <span class="ticket-id">#{{ ticket.id }}</span>
          <span class="ticket-title">{{ ticket.title }}</span>
          <StatusBadge :color="priorityColor[ticket.priority]" size="xs">{{ ticket.priority }}</StatusBadge>
        </div>
        <div class="closed-item-meta">
          <span>Closed {{ formatDate(ticket.resolved_at || ticket.updated_at) }}</span>
          <span>Opened by {{ personName(ticket.creator_first_name, ticket.creator_last_name, ticket.creator_handle) }}</span>
          <span v-if="ticket.assignee_handle">Assigned to {{ personName(ticket.assignee_first_name, ticket.assignee_last_name, ticket.assignee_handle) }}</span>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.closed-tickets-page {
  max-width: 900px;
}

.board-link {
  display: inline-block;
  padding: 2px 0;
  margin-bottom: 12px;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--color-accent);
  text-decoration: none;
}

.board-link:hover {
  background: none;
  text-decoration: underline;
}

.closed-header {
  margin-bottom: 16px;
}

.closed-header h1 {
  margin: 0;
  font-size: 2.2rem;
  font-weight: 700;
  color: var(--color-accent);
}

.company-name {
  margin: 0.25rem 0 12px;
  font-size: 0.95rem;
  color: var(--color-text-muted);
}

.closed-header h2 {
  margin: 0;
  font-size: 1.2rem;
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

.empty-state {
  padding: 30px;
  text-align: center;
  color: var(--color-text-light);
  background: var(--color-background-card);
  border-radius: var(--card-radius-sm);
}

.closed-list {
  list-style: none;
  margin: 0;
  padding: 0;
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: var(--card-radius-sm);
}

.closed-item {
  padding: 12px 16px;
}

.closed-item + .closed-item {
  border-top: 1px solid var(--color-border);
}

.closed-item-main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ticket-id {
  flex-shrink: 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.ticket-title {
  flex: 1;
  min-width: 0;
  color: var(--color-text);
  font-weight: 500;
}

.closed-item-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin-top: 4px;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

@media (max-width: 768px) {
  .closed-header h1 {
    font-size: 1.4rem;
  }
}
</style>
