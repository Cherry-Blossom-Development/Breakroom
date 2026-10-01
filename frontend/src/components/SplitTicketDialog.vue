<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { authFetch } from '../utilities/authFetch'
import { ESTIMATE_UNITS, hasEstimate, formatEstimate, splitEvenly } from '../utilities/ticketEstimates'

// Split a ticket into subtasks (migration 086). Subtask estimates start as
// the parent's estimate divided evenly (same unit) and stay editable; once
// any estimate is edited by hand, adding/removing rows stops re-dividing.
// A ticket that's already split can be split again to add subtasks: its
// mode is fixed and nothing is pre-divided.
const props = defineProps({
  ticket: { type: Object, required: true }
})
const emit = defineEmits(['close', 'split'])

const MAX_SUBTASKS = 20
const alreadySplit = computed(() => !!props.ticket.split_mode)
const mode = ref(props.ticket.split_mode || 'hidden')
const parentHasEstimate = computed(() => !alreadySplit.value && hasEstimate(props.ticket))
const parentUnit = props.ticket.estimate_unit || 'hours'

const newRow = () => ({ title: '', estimate_amount: '', estimate_unit: parentUnit })
const rows = ref(alreadySplit.value ? [newRow()] : [newRow(), newRow()])
const estimatesEdited = ref(false)
const submitting = ref(false)
const error = ref('')
const firstTitle = ref(null)

function redivide() {
  if (!parentHasEstimate.value || estimatesEdited.value) return
  const parts = splitEvenly(props.ticket.estimate_amount, rows.value.length)
  rows.value.forEach((r, i) => {
    r.estimate_amount = parts[i]
    r.estimate_unit = parentUnit
  })
}
watch(() => rows.value.length, redivide, { immediate: true })

function addRow() {
  if (rows.value.length < MAX_SUBTASKS) rows.value.push(newRow())
}

function removeRow(i) {
  rows.value.splice(i, 1)
}

const minRows = computed(() => (alreadySplit.value ? 1 : 2))

// Total of the subtask estimates, when they share one unit
const subtaskTotal = computed(() => {
  const filled = rows.value.filter(r => r.estimate_amount !== '' && r.estimate_amount !== null)
  if (!filled.length) return ''
  const units = new Set(filled.map(r => r.estimate_unit))
  if (units.size > 1) return 'mixed units'
  const sum = Math.round(filled.reduce((s, r) => s + Number(r.estimate_amount), 0) * 100) / 100
  return formatEstimate({ estimate_amount: sum, estimate_unit: [...units][0] })
})

async function submit() {
  error.value = ''
  if (rows.value.some(r => !r.title.trim())) {
    error.value = 'Every subtask needs a title'
    return
  }
  submitting.value = true
  try {
    const res = await authFetch(`/api/helpdesk/ticket/${props.ticket.id}/split`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: mode.value,
        subtasks: rows.value.map(r => ({
          title: r.title.trim(),
          estimate_amount: r.estimate_amount === '' ? null : r.estimate_amount,
          estimate_unit: r.estimate_unit
        }))
      })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message || 'Failed to split the ticket')
    emit('split', data)
  } catch (err) {
    error.value = err.message
  } finally {
    submitting.value = false
  }
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
}

onMounted(() => nextTick(() => firstTitle.value?.focus()))
</script>

<template>
  <div class="modal-overlay split-overlay" @click.self="emit('close')" @keydown="onKeydown">
    <form class="modal split-dialog" role="dialog" aria-modal="true" aria-labelledby="split-title" @submit.prevent="submit">
      <h2 id="split-title">{{ alreadySplit ? 'Add subtasks' : 'Split into subtasks' }}</h2>
      <p class="split-parent">
        <span class="split-id">#{{ ticket.id }}</span> {{ ticket.title }}
        <span v-if="hasEstimate(ticket)" class="split-muted"> · estimate {{ formatEstimate(ticket) }}</span>
      </p>

      <fieldset class="split-modes" :disabled="alreadySplit">
        <legend>What happens to #{{ ticket.id }}</legend>
        <label class="mode-option" :class="{ selected: mode === 'hidden' }">
          <input v-model="mode" type="radio" value="hidden" />
          <span>
            <strong>Hide it</strong>
            <span class="split-muted">Off every board and chart; still reachable from each subtask's link.</span>
          </span>
        </label>
        <label class="mode-option" :class="{ selected: mode === 'category' }">
          <input v-model="mode" type="radio" value="category" />
          <span>
            <strong>Make it a category</strong>
            <span class="split-muted">Off the Kanban board, but shown over its subtasks on the GANTT chart and as a Burndown filter.</span>
          </span>
        </label>
        <p v-if="alreadySplit" class="split-muted mode-fixed">Already split — new subtasks join the existing {{ ticket.split_mode === 'category' ? 'category' : 'hidden parent' }}.</p>
      </fieldset>

      <div class="subtask-head">
        <span>Subtasks</span>
        <span class="split-muted">Estimate</span>
      </div>
      <ol class="subtask-rows">
        <li v-for="(row, i) in rows" :key="i" class="subtask-row">
          <span class="row-num">{{ i + 1 }}.</span>
          <input
            :ref="el => { if (i === 0) firstTitle = el }"
            v-model="row.title"
            type="text"
            maxlength="255"
            class="row-title"
            :placeholder="`Subtask ${i + 1}`"
            :aria-label="`Subtask ${i + 1} title`"
          />
          <input
            v-model="row.estimate_amount"
            type="number"
            min="0.01"
            max="9999"
            step="any"
            class="row-amount"
            placeholder="—"
            :aria-label="`Subtask ${i + 1} estimate`"
            @input="estimatesEdited = true"
          />
          <select
            v-model="row.estimate_unit"
            class="row-unit"
            :aria-label="`Subtask ${i + 1} estimate unit`"
            @change="estimatesEdited = true"
          >
            <option v-for="unit in ESTIMATE_UNITS" :key="unit" :value="unit">{{ unit }}</option>
          </select>
          <button
            type="button"
            class="row-remove"
            :disabled="rows.length <= minRows"
            :aria-label="`Remove subtask ${i + 1}`"
            title="Remove"
            @click="removeRow(i)"
          >&times;</button>
        </li>
      </ol>

      <div class="subtask-foot">
        <button type="button" class="btn-link-add" :disabled="rows.length >= MAX_SUBTASKS" @click="addRow">+ Add subtask</button>
        <span v-if="subtaskTotal" class="split-muted">
          Subtasks total {{ subtaskTotal }}<template v-if="parentHasEstimate"> (parent: {{ formatEstimate(ticket) }})</template>
        </span>
      </div>
      <p v-if="parentHasEstimate && !estimatesEdited" class="split-muted split-hint">
        The parent's estimate is divided evenly; edit any amount to set your own.
      </p>

      <p v-if="error" class="split-error" role="alert">{{ error }}</p>

      <div class="split-actions">
        <button type="button" class="btn-secondary" :disabled="submitting" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn-primary" :disabled="submitting">
          {{ submitting ? 'Creating...' : `Create ${rows.length} subtask${rows.length === 1 ? '' : 's'}` }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.split-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-overlay);
}

.split-dialog {
  width: 620px;
  max-width: calc(100% - 32px);
  max-height: 90vh;
  overflow-y: auto;
  padding: 24px;
  border-radius: 12px;
  background: var(--color-background-card);
  color: var(--color-text);
}

.split-dialog h2 {
  margin: 0 0 6px;
}

.split-parent {
  margin: 0 0 16px;
  font-weight: 500;
}

.split-id {
  color: var(--color-text-muted);
}

.split-muted {
  font-size: 0.85rem;
  font-weight: 400;
  color: var(--color-text-muted);
}

.split-modes {
  margin: 0 0 18px;
  padding: 0;
  border: none;
}

.split-modes legend {
  margin-bottom: 8px;
  font-weight: 600;
}

.mode-option {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-bottom: 8px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  cursor: pointer;
}

.mode-option.selected {
  border-color: var(--color-accent);
}

.mode-option > span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mode-option input {
  margin-top: 3px;
}

.split-modes:disabled .mode-option {
  cursor: default;
  opacity: 0.65;
}

.mode-fixed {
  margin: 0;
}

.subtask-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
  padding-right: 34px;
  font-weight: 600;
}

.subtask-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.subtask-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.row-num {
  width: 22px;
  flex-shrink: 0;
  text-align: right;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

.subtask-row input,
.subtask-row select {
  padding: 7px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-input, var(--color-background-card));
  color: var(--color-text);
  font-size: 0.9rem;
}

.row-title {
  flex: 1;
  min-width: 0;
}

.row-amount {
  width: 72px;
}

.row-remove {
  width: 28px;
  flex-shrink: 0;
  border: none;
  background: none;
  color: var(--color-text-muted);
  font-size: 1.2rem;
  cursor: pointer;
}

.row-remove:hover:not(:disabled) {
  color: var(--color-error);
}

.row-remove:disabled {
  opacity: 0.3;
  cursor: default;
}

.subtask-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.btn-link-add {
  padding: 0;
  border: none;
  background: none;
  color: var(--color-accent);
  font-size: 0.9rem;
  cursor: pointer;
}

.btn-link-add:disabled {
  opacity: 0.5;
  cursor: default;
}

.split-hint {
  margin: 6px 0 0;
}

.split-error {
  margin: 12px 0 0;
  font-size: 0.85rem;
  color: var(--color-error);
}

.split-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}

/* Same buttons as the Kanban page's modals */
.btn-primary,
.btn-secondary {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  font-size: 1rem;
  cursor: pointer;
}

.btn-primary {
  background: var(--color-accent);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.btn-secondary {
  background: var(--color-button-secondary);
  color: var(--color-text);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--color-button-secondary-hover);
}

.btn-primary:disabled,
.btn-secondary:disabled {
  opacity: 0.6;
  cursor: default;
}

@media (max-width: 520px) {
  .row-amount {
    width: 56px;
  }

  .row-unit {
    max-width: 82px;
  }
}
</style>
