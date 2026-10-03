<script setup>
import { ref, computed } from 'vue'

// Ticket contributors (migration 088): people on a ticket besides its
// assignee, each with a freeform role. Used by the ticket popup
// (ProjectPage.vue) and the full-page view (TicketPage.vue). Purely
// presentational -- the parent stages every change in its draft until
// Save Changes (see composables/useTicketDetail.js).
const props = defineProps({
  contributors: { type: Array, required: true }, // [{ user_id, role, handle, first_name, last_name }]
  people: { type: Array, default: () => [] },     // who can be added: the project's assignees list
  canEdit: { type: Boolean, default: false },
  idPrefix: { type: String, default: 'contrib' }
})
const emit = defineEmits(['add', 'remove', 'set-role'])

const MAX_ROLE_LENGTH = 100

const personName = (p) => `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.handle

const available = computed(() => {
  const taken = new Set(props.contributors.map(c => c.user_id))
  return props.people.filter(p => !taken.has(p.user_id))
})

const newPersonId = ref(null)
const newRole = ref('')

function add() {
  const person = props.people.find(p => p.user_id === newPersonId.value)
  if (!person) return
  emit('add', person, newRole.value)
  newPersonId.value = null
  newRole.value = ''
}
</script>

<template>
  <div class="contributors">
    <ul v-if="contributors.length > 0" class="contributor-list">
      <li v-for="c in contributors" :key="c.user_id" class="contributor">
        <span class="contributor-name" :title="c.handle">{{ personName(c) }}</span>
        <input
          v-if="canEdit"
          :value="c.role"
          class="contributor-role-input"
          type="text"
          :maxlength="MAX_ROLE_LENGTH"
          placeholder="Role"
          :aria-label="`Role for ${personName(c)}`"
          @input="emit('set-role', c.user_id, $event.target.value)"
        />
        <span v-else-if="c.role" class="contributor-role">{{ c.role }}</span>
        <button
          v-if="canEdit"
          type="button"
          class="contributor-remove"
          :aria-label="`Remove ${personName(c)}`"
          title="Remove contributor"
          @click="emit('remove', c.user_id)"
        >&times;</button>
      </li>
    </ul>
    <p v-else class="no-contributors">No contributors.</p>

    <form v-if="canEdit && available.length > 0" class="contributor-add" @submit.prevent="add">
      <select :id="`${idPrefix}-person`" v-model="newPersonId" aria-label="Person to add">
        <option :value="null" disabled>Add a person...</option>
        <option v-for="p in available" :key="p.user_id" :value="p.user_id">{{ personName(p) }} ({{ p.handle }})</option>
      </select>
      <input
        v-model="newRole"
        type="text"
        :maxlength="MAX_ROLE_LENGTH"
        placeholder="Role (optional)"
        aria-label="Role for the new contributor"
      />
      <button type="submit" class="contributor-add-btn" :disabled="newPersonId === null">Add</button>
    </form>
  </div>
</template>

<style scoped>
.contributor-list {
  list-style: none;
  margin: 0 0 10px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.contributor {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px 4px 10px;
  border-radius: 6px;
  background: var(--color-background-soft);
  font-size: 0.875rem;
}

.contributor-name {
  flex-shrink: 0;
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text);
  font-weight: 500;
}

.contributor-role {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-secondary);
}

/* Reads as text until hovered or focused */
.contributor-role-input {
  flex: 1;
  min-width: 0;
  padding: 3px 6px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  font-family: inherit;
}

.contributor-role-input:hover {
  border-color: var(--color-border);
  background: var(--color-background-input);
}

.contributor-role-input:focus {
  outline: none;
  border-color: var(--color-accent);
  background: var(--color-background-input);
  color: var(--color-text);
}

.contributor-remove {
  flex-shrink: 0;
  margin-left: auto;
  padding: 0 4px;
  border: none;
  background: none;
  font-size: 1.1rem;
  line-height: 1;
  color: var(--color-text-muted);
  cursor: pointer;
}

.contributor-remove:hover {
  color: var(--color-error);
}

.no-contributors {
  margin: 0 0 10px;
  color: var(--color-text-light);
  font-size: 0.875rem;
  font-style: italic;
}

.contributor-add {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.contributor-add select,
.contributor-add input {
  flex: 1 1 140px;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-input);
  color: var(--color-text);
  font-size: 0.85rem;
  font-family: inherit;
}

.contributor-add-btn {
  padding: 6px 14px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-card);
  color: var(--color-text);
  font-size: 0.85rem;
  cursor: pointer;
}

.contributor-add-btn:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.contributor-add-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
