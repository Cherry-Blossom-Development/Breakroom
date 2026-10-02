<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { rankDependencyCandidates } from '../utilities/ticketSearch'

// "Depends on" autocomplete for the ticket panel (ARIA combobox). Focusing
// it lists the ticket's category (other subtasks of the same split ticket);
// typing filters the category first and fills up to 10 results from the
// rest of the board. Picking one emits `select`; the panel stages it.
const props = defineProps({
  candidates: { type: Array, required: true },   // tickets that may be chosen
  categoryIds: { type: Set, default: () => new Set() },
  categoryName: { type: String, default: '' },
  statusLabels: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['select'])

const LIMIT = 10
const listId = `dep-picker-${Math.random().toString(36).slice(2, 8)}`

const query = ref('')
const open = ref(false)
const openUp = ref(false)
const activeIndex = ref(-1)
const input = ref(null)

const results = computed(() => rankDependencyCandidates(props.candidates, query.value, props.categoryIds, LIMIT))

// Index of the first non-category result, for the "Other tickets" divider
const firstOtherIndex = computed(() => {
  const i = results.value.findIndex(r => !r.inCategory)
  return i > 0 ? i : -1
})

const emptyMessage = computed(() => {
  if (results.value.length) return ''
  if (query.value.trim()) return 'No matching tickets'
  return props.categoryIds.size ? 'Every ticket in this category is already linked' : 'Type a ticket number or title'
})

watch(results, () => { activeIndex.value = results.value.length ? 0 : -1 })

// Open upward when the panel (or window) has more room above the input --
// the picker often sits near the bottom of a scrolling ticket panel
function placeList() {
  const el = input.value
  if (!el) return
  const box = el.getBoundingClientRect()
  const bounds = el.closest('.modal')?.getBoundingClientRect() || { top: 0, bottom: window.innerHeight }
  const below = bounds.bottom - box.bottom
  const above = box.top - bounds.top
  openUp.value = below < 240 && above > below
}

function show() {
  if (!open.value) placeList()
  open.value = true
  activeIndex.value = results.value.length ? 0 : -1
}

function hide() {
  open.value = false
  activeIndex.value = -1
}

function choose(result) {
  emit('select', result.ticket.id)
  query.value = ''
  // Stay open for adding another; the list refreshes without the one picked
  nextTick(() => {
    input.value?.focus()
    show()
  })
}

function onKeydown(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (!open.value) return show()
    const n = results.value.length
    if (!n) return
    activeIndex.value = (activeIndex.value + (e.key === 'ArrowDown' ? 1 : -1) + n) % n
  } else if (e.key === 'Enter') {
    if (open.value && results.value[activeIndex.value]) {
      e.preventDefault()
      choose(results.value[activeIndex.value])
    }
  } else if (e.key === 'Escape') {
    // Close the list without also closing the ticket panel
    if (open.value) {
      e.stopPropagation()
      hide()
    }
  }
}

const optionId = (i) => `${listId}-opt-${i}`
</script>

<template>
  <div class="dep-picker">
    <input
      ref="input"
      v-model="query"
      type="text"
      class="dep-input"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="open"
      :aria-controls="listId"
      :aria-activedescendant="open && activeIndex >= 0 ? optionId(activeIndex) : undefined"
      aria-label="Add a ticket this depends on"
      placeholder="Add a ticket this depends on — type # or a title"
      autocomplete="off"
      @focus="show"
      @click="show"
      @input="show"
      @blur="hide"
      @keydown="onKeydown"
    />
    <ul v-show="open" :id="listId" class="dep-options" :class="{ up: openUp }" role="listbox">
      <li v-if="results.length && results[0].inCategory" class="dep-group-label" role="presentation">
        In this category<template v-if="categoryName">: {{ categoryName }}</template>
      </li>
      <template v-for="(r, i) in results" :key="r.ticket.id">
        <li v-if="i === firstOtherIndex || (i === 0 && !r.inCategory && categoryIds.size)" class="dep-group-label" role="presentation">
          Other tickets
        </li>
        <li
          :id="optionId(i)"
          class="dep-option"
          :class="{ active: i === activeIndex }"
          role="option"
          :aria-selected="i === activeIndex"
          @mousedown.prevent="choose(r)"
          @mousemove="activeIndex = i"
        >
          <span class="dep-option-id">#{{ r.ticket.id }}</span>
          <span class="dep-option-title">{{ r.ticket.title }}</span>
          <span class="dep-option-status">{{ statusLabels[r.ticket.status] || r.ticket.status }}</span>
        </li>
      </template>
      <li v-if="emptyMessage" class="dep-empty" role="presentation">{{ emptyMessage }}</li>
    </ul>
  </div>
</template>

<style scoped>
.dep-picker {
  position: relative;
  flex: 1;
  min-width: 0;
}

.dep-input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-card);
  color: var(--color-text);
  font-size: 0.875rem;
}

.dep-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.dep-options {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 20;
  max-height: 320px;
  overflow-y: auto;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-card);
  box-shadow: var(--shadow-md, 0 6px 18px rgba(0, 0, 0, 0.15));
}

.dep-options.up {
  top: auto;
  bottom: calc(100% + 4px);
}

.dep-group-label {
  padding: 6px 12px 2px;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.dep-option {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 7px 12px;
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--color-text);
}

.dep-option.active {
  background: var(--color-background-soft);
}

.dep-option-id {
  flex-shrink: 0;
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.dep-option-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dep-option-status {
  flex-shrink: 0;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.dep-empty {
  padding: 8px 12px;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
</style>
