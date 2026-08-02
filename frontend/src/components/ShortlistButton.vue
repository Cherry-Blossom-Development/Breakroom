<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { shortlists } from '@/stores/shortlists'

const props = defineProps({
  session: { type: Object, required: true },
  bands: { type: Array, default: () => [] } // [{id, name}] bands the current user is active in
})

const open = ref(false)
const myShortlistIds = ref([])
const hasLoadedIds = ref(false)
const loadingIds = ref(false)
const creating = ref(false)
const newName = ref('')
const newBandId = ref('')
const error = ref('')

const bookmarked = computed(() => {
  if (hasLoadedIds.value) return myShortlistIds.value.length > 0
  return (props.session.shortlist_count || 0) > 0
})

async function openPopover(event) {
  event.stopPropagation()
  if (open.value) { open.value = false; return }
  open.value = true
  error.value = ''
  if (!newBandId.value && props.bands.length > 0) {
    newBandId.value = props.session.band_id || props.bands[0].id
  }
  await shortlists.load()
  loadingIds.value = true
  try {
    myShortlistIds.value = await shortlists.sessionShortlistIds(props.session.id)
    hasLoadedIds.value = true
  } finally {
    loadingIds.value = false
  }
}

function closePopover() { open.value = false }

async function toggle(shortlistId) {
  const idx = myShortlistIds.value.indexOf(shortlistId)
  error.value = ''
  try {
    if (idx === -1) {
      await shortlists.addSession(shortlistId, props.session.id)
      myShortlistIds.value.push(shortlistId)
    } else {
      await shortlists.removeSession(shortlistId, props.session.id)
      myShortlistIds.value.splice(idx, 1)
    }
  } catch (err) {
    error.value = err.message
  }
}

async function createAndAdd() {
  if (!newName.value.trim() || !newBandId.value || creating.value) return
  creating.value = true
  error.value = ''
  try {
    const sl = await shortlists.create(parseInt(newBandId.value, 10), newName.value.trim())
    await shortlists.addSession(sl.id, props.session.id)
    myShortlistIds.value.push(sl.id)
    newName.value = ''
  } catch (err) {
    error.value = err.message
  } finally {
    creating.value = false
  }
}

onMounted(() => document.addEventListener('click', closePopover))
onUnmounted(() => document.removeEventListener('click', closePopover))
</script>

<template>
  <div class="shortlist-btn-wrap">
    <button class="shortlist-btn" :class="{ bookmarked }" @click="openPopover" title="Add to shortlist">
      {{ bookmarked ? '🔖' : '📑' }}
    </button>
    <div v-if="open" class="shortlist-popover" @click.stop>
      <div class="popup-label">Add to shortlist</div>

      <div v-if="loadingIds" class="popup-loading">Loading…</div>
      <template v-else>
        <div v-if="shortlists.list.length === 0" class="popup-empty">No shortlists yet — create one below.</div>
        <label v-for="sl in shortlists.list" :key="sl.id" class="popup-checkbox-row">
          <input type="checkbox" :checked="myShortlistIds.includes(sl.id)" @change="toggle(sl.id)" />
          <span class="popup-sl-name">{{ sl.name }}</span>
          <span class="popup-band-tag">{{ sl.band_name }}</span>
        </label>
      </template>

      <div class="popup-divider"></div>
      <div class="popup-new-shortlist">
        <select v-if="bands.length > 1" v-model="newBandId" class="popup-band-select">
          <option v-for="b in bands" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select>
        <input v-model="newName" type="text" placeholder="New shortlist name…" class="popup-new-input"
               @keydown.enter="createAndAdd" @click.stop />
        <button class="popup-add-btn" :disabled="!newName.trim() || creating" @click="createAndAdd">
          {{ creating ? '…' : '+ Add' }}
        </button>
      </div>
      <p v-if="error" class="popup-error">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.shortlist-btn-wrap { position: relative; display: inline-block; }

.shortlist-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  padding: 2px 4px;
  opacity: 0.55;
  transition: opacity 0.15s;
}
.shortlist-btn:hover { opacity: 0.85; }
.shortlist-btn.bookmarked { opacity: 1; }

.shortlist-popover {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 20;
  background: var(--color-background-card, #fff);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.18);
  padding: 12px;
  width: 240px;
}

.popup-label {
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-muted);
  margin-bottom: 8px;
}

.popup-loading, .popup-empty {
  font-size: 0.82rem;
  color: var(--color-text-muted);
  padding: 4px 0;
}

.popup-checkbox-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  color: var(--color-text);
  padding: 4px 0;
  cursor: pointer;
}

.popup-sl-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.popup-band-tag { font-size: 0.72rem; color: var(--color-text-muted); }

.popup-divider { border-top: 1px solid var(--color-border); margin: 8px 0; }

.popup-new-shortlist { display: flex; flex-direction: column; gap: 6px; }

.popup-band-select, .popup-new-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  font-size: 0.82rem;
  box-sizing: border-box;
  background: var(--color-background);
  color: var(--color-text);
}

.popup-add-btn {
  padding: 6px 10px;
  background: var(--color-link);
  color: #fff;
  border: none;
  border-radius: 5px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}
.popup-add-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.popup-error { color: var(--color-error, #e53935); font-size: 0.78rem; margin: 6px 0 0; }
</style>
