<script setup>
import { computed } from 'vue'
import draggable from 'vuedraggable'
import BacklogTicketRow from './BacklogTicketRow.vue'

// One split ticket's group in the backlog list (ProjectPage.vue, view
// 'backlog'): a header row for the split parent, then its backlog items
// indented beneath -- tickets, and the groups of subtasks that were split
// again, which render as this same component one level deeper. Splits nest
// to any depth, mirroring the GANTT chart's nested categories.
//
// Items are { key, ticket } or { key, parent, children }. Drag reorders
// within this group only (each group has its own drag group name); the
// parent saves the whole order on `reorder`.
const props = defineProps({
  entry: { type: Object, required: true },
  canReorder: { type: Boolean, default: false },
  visibleKeys: { type: Set, default: null }, // null = everything shows (no search)
  collapsed: { type: Set, required: true },  // collapsed parent ids
  blockers: { type: Object, default: () => ({}) }, // ticket id -> open blocker ids
  assigneeName: { type: Function, required: true },
  stats: { type: Function, required: true } // parent -> { total, inBacklog, done }
})
const emit = defineEmits(['open', 'toggle', 'reorder'])

const isVisible = (item) => !props.visibleKeys || props.visibleKeys.has(item.key)
// Searching shows every match, so collapsing only applies without a search
const isCollapsed = computed(() => !props.visibleKeys && props.collapsed.has(props.entry.parent.id))
const lastVisibleKey = computed(() => {
  const shown = props.entry.children.filter(isVisible)
  return shown.length ? shown[shown.length - 1].key : null
})
const groupStats = computed(() => props.stats(props.entry.parent))
</script>

<template>
  <div class="backlog-group">
    <div class="backlog-parent">
      <span v-if="canReorder" class="drag-handle group-handle" title="Drag to reorder this group" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
      </span>
      <button
        class="group-toggle"
        :aria-expanded="!isCollapsed"
        :aria-label="`${isCollapsed ? 'Show' : 'Hide'} subtasks of #${entry.parent.id}`"
        @click="emit('toggle', entry.parent.id)"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" :class="{ rotated: !isCollapsed }"><polyline points="9 6 15 12 9 18" /></svg>
      </button>
      <button class="backlog-parent-main" :data-ticket-id="entry.parent.id" @click="emit('open', entry.parent)">
        <span class="ticket-id">#{{ entry.parent.id }}</span>
        <span class="backlog-main">
          <span class="backlog-parent-title">{{ entry.parent.title }}</span>
          <span class="backlog-meta">
            <span>{{ groupStats.total }} subtask{{ groupStats.total === 1 ? '' : 's' }}</span>
            <span>{{ groupStats.inBacklog }} in backlog</span>
            <span v-if="groupStats.done">{{ groupStats.done }} done</span>
          </span>
        </span>
        <span class="split-kind">{{ entry.parent.split_mode === 'category' ? 'Category' : 'Split ticket' }}</span>
      </button>
    </div>

    <draggable
      v-show="!isCollapsed"
      :list="entry.children"
      item-key="key"
      tag="ul"
      class="backlog-children"
      :group="`backlog-sub-${entry.parent.id}`"
      handle=".drag-handle"
      ghost-class="backlog-ghost"
      :animation="150"
      :disabled="!canReorder"
      @end="e => emit('reorder', e)"
    >
      <template #item="{ element: child }">
        <li
          v-show="isVisible(child)"
          class="backlog-child"
          :class="{ 'backlog-group-end': child.key === lastVisibleKey, 'backlog-child-group': child.parent }"
        >
          <BacklogGroup
            v-if="child.parent"
            :entry="child"
            :can-reorder="canReorder"
            :visible-keys="visibleKeys"
            :collapsed="collapsed"
            :blockers="blockers"
            :assignee-name="assigneeName"
            :stats="stats"
            @open="t => emit('open', t)"
            @toggle="id => emit('toggle', id)"
            @reorder="e => emit('reorder', e)"
          />
          <BacklogTicketRow
            v-else
            :ticket="child.ticket"
            :blocked-by="blockers[child.ticket.id] || null"
            :assignee-name="child.ticket.assignee_handle ? assigneeName(child.ticket) : ''"
            :draggable="canReorder"
            @open="t => emit('open', t)"
          />
        </li>
      </template>
    </draggable>
  </div>
</template>

<style scoped>
.backlog-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.backlog-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.ticket-id {
  flex-shrink: 0;
  color: var(--color-text-light);
  font-size: 0.8rem;
  font-weight: 500;
}

.backlog-children {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

/* Where a dragged row will land */
.backlog-ghost {
  opacity: 0.4;
}

.group-handle {
  display: inline-flex;
  align-items: center;
  padding: 0 2px 0 8px;
  color: var(--color-text-muted);
  cursor: grab;
}

.group-handle:active {
  cursor: grabbing;
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

/* Items: indented under their parent with a connecting rule */
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

/* The rule stops at the last item's connector */
.backlog-group-end::before {
  bottom: 50%;
}

/* A nested group connects at its header row, not the middle of the block */
.backlog-child-group::after {
  top: 35px;
}

.backlog-child-group.backlog-group-end::before {
  bottom: auto;
  height: 43px;
}

.backlog-group-end {
  margin-bottom: 6px;
}
</style>
