<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'

// Ticket attachments list + picker (migration 085). Presentational: the
// parent decides whether picked files upload right away (Help Desk) or wait
// for Save Changes (Kanban panel), and passes the pending state back in.
//
// Files open through /api/helpdesk/attachment/:id, which checks ticket
// access; images preview inline, everything else downloads.
const props = defineProps({
  attachments: { type: Array, default: () => [] },   // saved
  pendingFiles: { type: Array, default: () => [] },  // File objects not yet uploaded
  pendingRemovals: { type: Array, default: () => [] }, // saved ids marked for removal
  canAttach: { type: Boolean, default: false },
  canRemove: { type: Function, default: () => false }, // (attachment) => bool
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' }
})
const emit = defineEmits(['add', 'remove', 'undo-remove', 'drop-pending'])

const MAX_BYTES = 25 * 1024 * 1024
const MAX_FILES = 10
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

const fileInput = ref(null)
const localError = ref('')
const dragging = ref(false)

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const url = (a) => `/api/helpdesk/attachment/${a.id}`

// Object URLs for previews of images that haven't been uploaded yet
const previewUrls = new Map()
function previewOf(file) {
  if (!IMAGE_TYPES.includes(file.type)) return null
  if (!previewUrls.has(file)) previewUrls.set(file, URL.createObjectURL(file))
  return previewUrls.get(file)
}
watch(() => props.pendingFiles, (files) => {
  for (const [file, objectUrl] of previewUrls) {
    if (!files.includes(file)) {
      URL.revokeObjectURL(objectUrl)
      previewUrls.delete(file)
    }
  }
})
onBeforeUnmount(() => previewUrls.forEach(u => URL.revokeObjectURL(u)))

function pick(fileList) {
  localError.value = ''
  const files = [...fileList]
  if (!files.length) return
  const tooBig = files.filter(f => f.size > MAX_BYTES)
  if (tooBig.length) {
    localError.value = `${tooBig.map(f => f.name).join(', ')} ${tooBig.length === 1 ? 'is' : 'are'} over 25 MB`
    return
  }
  if (files.length + props.pendingFiles.length > MAX_FILES) {
    localError.value = `Attach at most ${MAX_FILES} files at a time`
    return
  }
  emit('add', files)
}

function onInputChange(e) {
  pick(e.target.files)
  e.target.value = '' // let the same file be picked again
}

function onDrop(e) {
  dragging.value = false
  if (props.canAttach && !props.busy) pick(e.dataTransfer.files)
}

const removing = computed(() => new Set(props.pendingRemovals))
const shownError = computed(() => localError.value || props.error)
const isEmpty = computed(() => !props.attachments.length && !props.pendingFiles.length)
</script>

<template>
  <div
    class="ticket-attachments"
    :class="{ dragging }"
    @dragover.prevent="canAttach && (dragging = true)"
    @dragleave.self="dragging = false"
    @drop.prevent="onDrop"
  >
    <div class="attachments-header">
      <h3>Attachments</h3>
      <template v-if="canAttach">
        <button type="button" class="btn-attach" :disabled="busy" @click="fileInput.click()">
          {{ busy ? 'Uploading...' : 'Attach files' }}
        </button>
        <input ref="fileInput" type="file" multiple class="visually-hidden" tabindex="-1" @change="onInputChange" />
      </template>
    </div>

    <p v-if="isEmpty" class="no-attachments">
      {{ canAttach ? 'No attachments. Drop files here or use Attach files (up to 25 MB each).' : 'No attachments.' }}
    </p>

    <ul v-else class="attachment-list">
      <li
        v-for="a in attachments"
        :key="a.id"
        class="attachment"
        :class="{ 'pending-remove': removing.has(a.id) }"
      >
        <a :href="a.is_image ? url(a) : `${url(a)}?download`" :target="a.is_image ? '_blank' : null" rel="noopener" class="attachment-link">
          <img v-if="a.is_image" :src="url(a)" :alt="a.file_name" class="thumb" loading="lazy" />
          <span v-else class="file-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </span>
          <span class="attachment-text">
            <span class="attachment-name">{{ a.file_name }}</span>
            <span class="attachment-meta">{{ formatSize(a.size_bytes) }}<template v-if="a.uploader_handle"> · {{ a.uploader_handle }}</template></span>
          </span>
        </a>
        <button
          v-if="removing.has(a.id)"
          type="button"
          class="attachment-action undo"
          @click="emit('undo-remove', a)"
        >Undo</button>
        <button
          v-else-if="canRemove(a)"
          type="button"
          class="attachment-action"
          :aria-label="`Remove ${a.file_name}`"
          title="Remove"
          :disabled="busy"
          @click="emit('remove', a)"
        >&times;</button>
      </li>

      <li v-for="(file, i) in pendingFiles" :key="`p${i}-${file.name}`" class="attachment pending-add">
        <span class="attachment-link">
          <img v-if="previewOf(file)" :src="previewOf(file)" :alt="file.name" class="thumb" />
          <span v-else class="file-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </span>
          <span class="attachment-text">
            <span class="attachment-name">{{ file.name }}</span>
            <span class="attachment-meta">{{ formatSize(file.size) }} · <em>unsaved</em></span>
          </span>
        </span>
        <button
          type="button"
          class="attachment-action"
          :aria-label="`Don't attach ${file.name}`"
          title="Don't attach"
          :disabled="busy"
          @click="emit('drop-pending', i)"
        >&times;</button>
      </li>
    </ul>

    <p v-if="shownError" class="attachment-error" role="alert">{{ shownError }}</p>
  </div>
</template>

<style scoped>
.ticket-attachments {
  margin-bottom: 20px;
  padding: 4px;
  border: 2px dashed transparent;
  border-radius: 8px;
  transition: border-color 0.15s;
}

.ticket-attachments.dragging {
  border-color: var(--color-accent);
}

.attachments-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.attachments-header h3 {
  margin: 0;
  font-size: 1rem;
  color: var(--color-text);
}

.btn-attach {
  padding: 4px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-card);
  color: var(--color-text);
  font-size: 0.85rem;
  cursor: pointer;
}

.btn-attach:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.no-attachments {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

.attachment-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.attachment {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-soft);
}

.attachment-link {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  color: var(--color-text);
  text-decoration: none;
}

a.attachment-link:hover .attachment-name {
  color: var(--color-accent);
  text-decoration: underline;
}

.thumb {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  object-fit: cover;
  border-radius: 4px;
  background: var(--color-background-card);
}

.file-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  color: var(--color-text-muted);
}

.attachment-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.attachment-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
}

.attachment-meta {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.attachment.pending-remove .attachment-link {
  opacity: 0.55;
}

.attachment.pending-remove .attachment-name {
  text-decoration: line-through;
}

.attachment-action {
  flex-shrink: 0;
  padding: 2px 8px;
  border: none;
  background: none;
  color: var(--color-text-muted);
  font-size: 1.1rem;
  cursor: pointer;
}

.attachment-action:hover:not(:disabled) {
  color: var(--color-error);
}

.attachment-action.undo {
  font-size: 0.8rem;
  color: var(--color-accent);
}

.attachment-error {
  margin: 8px 0 0;
  font-size: 0.85rem;
  color: var(--color-error);
}
</style>
