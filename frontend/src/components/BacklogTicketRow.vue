<script setup>
import StatusBadge from './StatusBadge.vue'
import { hasEstimate, formatEstimate, formatEstimateShort } from '../utilities/ticketEstimates'

// One ticket in the backlog list (ProjectPage.vue, view 'backlog'): a drag
// handle when reordering is allowed, then a button that opens the ticket.
defineProps({
  ticket: { type: Object, required: true },
  blockedBy: { type: Array, default: null }, // open blocker ids
  assigneeName: { type: String, default: '' },
  draggable: { type: Boolean, default: false }
})
defineEmits(['open'])

const priorityColor = { low: 'gray', medium: 'blue', high: 'orange', urgent: 'red' }

function formatDate(dateStr) {
  return dateStr ? new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
}
</script>

<template>
  <div class="backlog-item">
    <span v-if="draggable" class="drag-handle" title="Drag to reorder" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
    </span>
    <button class="backlog-open" :data-ticket-id="ticket.id" @click="$emit('open', ticket)">
      <span class="ticket-id">#{{ ticket.id }}</span>
      <span class="backlog-main">
        <span class="backlog-title">{{ ticket.title }}</span>
        <span class="backlog-meta">
          <span v-if="blockedBy" class="backlog-blocked">Blocked by {{ blockedBy.map(id => '#' + id).join(', ') }}</span>
          <span v-if="assigneeName">{{ assigneeName }}</span>
          <span>Opened {{ formatDate(ticket.created_at) }}</span>
        </span>
      </span>
      <span class="backlog-badges">
        <span v-if="hasEstimate(ticket)" class="ticket-estimate" :title="`Estimate: ${formatEstimate(ticket)}`">{{ formatEstimateShort(ticket) }}</span>
        <StatusBadge :color="priorityColor[ticket.priority]" size="xs">{{ ticket.priority }}</StatusBadge>
      </span>
    </button>
  </div>
</template>

<style scoped>
.backlog-item {
  display: flex;
  align-items: stretch;
  width: 100%;
  border-left: 3px solid var(--color-accent);
  border-radius: var(--card-radius-sm);
  background: var(--color-background-card);
  box-shadow: var(--shadow-sm);
  transition: box-shadow 0.15s;
}

.backlog-item:hover {
  box-shadow: var(--shadow-md);
}

.drag-handle {
  display: inline-flex;
  align-items: center;
  padding: 0 4px 0 8px;
  color: var(--color-text-muted);
  cursor: grab;
}

.drag-handle:active {
  cursor: grabbing;
}

.backlog-open {
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

.drag-handle + .backlog-open {
  padding-left: 6px;
}

.ticket-id {
  font-size: 0.75rem;
  color: var(--color-text-muted);
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

.backlog-open:hover .backlog-title,
.backlog-open:focus-visible .backlog-title {
  color: var(--color-accent);
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

.backlog-badges {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.ticket-estimate {
  padding: 1px 6px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft);
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-muted);
}
</style>
