<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { authFetch } from '../utilities/authFetch'

// "Invite someone" box on the project settings page (ARIA combobox).
// Typing 2+ characters suggests up to 10 people from
// GET /api/projects/:id/invite-suggestions (company people first, then
// handle/name prefix matches, then the rest). Picking one fills in their
// handle; the form's Send Invite does the inviting. Any handle or email
// can still be typed in full -- suggestions are only a shortcut.
const props = defineProps({
  modelValue: { type: String, default: '' },
  projectId: { type: [String, Number], required: true },
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

const MIN_CHARS = 2
const DEBOUNCE_MS = 200
const listId = `invite-list-${Math.random().toString(36).slice(2, 8)}`

const results = ref([])
const open = ref(false)
const activeIndex = ref(-1)
const loading = ref(false)
let timer = null
let requestSeq = 0

const personName = (p) => `${p.first_name || ''} ${p.last_name || ''}`.trim()

// Skip the lookup when the text is exactly a suggestion just picked
let justPicked = null

watch(() => props.modelValue, (value) => {
  clearTimeout(timer)
  const q = value.trim()
  if (q === justPicked) return
  justPicked = null
  if (q.length < MIN_CHARS || q.indexOf('@') > 0) {
    // too short, or an email address -- nothing to suggest
    results.value = []
    open.value = false
    return
  }
  timer = setTimeout(() => search(q), DEBOUNCE_MS)
})

async function search(q) {
  const seq = ++requestSeq
  loading.value = true
  try {
    const res = await authFetch(`/api/projects/${props.projectId}/invite-suggestions?q=${encodeURIComponent(q)}`)
    if (seq !== requestSeq) return // a newer search is on its way
    results.value = res.ok ? (await res.json()).users : []
    activeIndex.value = results.value.length ? 0 : -1
    open.value = true
  } catch (err) {
    if (seq === requestSeq) results.value = []
    console.error('Error fetching invite suggestions:', err)
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

function pick(person) {
  justPicked = person.handle
  emit('update:modelValue', person.handle)
  open.value = false
}

function onKeydown(e) {
  if (!open.value || !results.value.length) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % results.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value - 1 + results.value.length) % results.value.length
  } else if (e.key === 'Enter' && activeIndex.value >= 0) {
    // Enter picks the highlighted person rather than submitting the form
    e.preventDefault()
    pick(results.value[activeIndex.value])
  } else if (e.key === 'Escape') {
    open.value = false
  }
}

// Close after focus leaves (later than a click on a suggestion lands)
function onBlur() {
  setTimeout(() => { open.value = false }, 150)
}

const activeId = computed(() => (open.value && activeIndex.value >= 0 ? `${listId}-${activeIndex.value}` : undefined))

onUnmounted(() => clearTimeout(timer))
</script>

<template>
  <div class="invite-autocomplete">
    <input
      :value="modelValue"
      type="text"
      placeholder="Name, handle or email"
      aria-label="Name, handle or email of the person to invite"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="open"
      :aria-controls="listId"
      :aria-activedescendant="activeId"
      autocomplete="off"
      :disabled="disabled"
      @input="emit('update:modelValue', $event.target.value)"
      @keydown="onKeydown"
      @focus="results.length && modelValue.trim().length >= MIN_CHARS && (open = true)"
      @blur="onBlur"
    />
    <ul v-show="open" :id="listId" class="suggestions" role="listbox">
      <li
        v-for="(p, i) in results"
        :id="`${listId}-${i}`"
        :key="p.user_id"
        role="option"
        :aria-selected="i === activeIndex"
        class="suggestion"
        :class="{ active: i === activeIndex }"
        @mousedown.prevent="pick(p)"
        @mousemove="activeIndex = i"
      >
        <span class="suggestion-name">{{ personName(p) || p.handle }}</span>
        <span class="suggestion-handle">@{{ p.handle }}</span>
        <span v-if="p.in_company" class="suggestion-tag">Company</span>
      </li>
      <li v-if="!results.length && !loading" class="suggestion-empty">
        No one matches — you can still invite by full handle or email
      </li>
    </ul>
  </div>
</template>

<style scoped>
.invite-autocomplete {
  position: relative;
  flex: 1 1 220px;
  min-width: 0;
}

.invite-autocomplete input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-background-card);
  color: var(--color-text);
  font-size: 0.9rem;
}

.suggestions {
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
  border-radius: 6px;
  background: var(--color-background-card);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
}

.suggestion {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 7px 12px;
  font-size: 0.9rem;
  cursor: pointer;
}

.suggestion.active {
  background: var(--color-background-soft);
}

.suggestion-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text);
  font-weight: 500;
}

.suggestion-handle {
  flex-shrink: 0;
  color: var(--color-text-muted);
  font-size: 0.82rem;
}

.suggestion-tag {
  flex-shrink: 0;
  margin-left: auto;
  padding: 1px 7px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  color: var(--color-text-secondary);
  font-size: 0.7rem;
  font-weight: 600;
}

.suggestion-empty {
  padding: 8px 12px;
  color: var(--color-text-muted);
  font-size: 0.85rem;
  font-style: italic;
}
</style>
