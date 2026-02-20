<script setup>
import { ref, watch, onMounted, computed } from 'vue'
import { breakroom } from '@/stores/breakroom.js'
import { chat } from '@/stores/chat.js'

const emit = defineEmits(['close', 'added'])

// Get chat room IDs already on the breakroom page
const existingChatRoomIds = computed(() => {
  return new Set(
    breakroom.blocks
      .filter(b => b.block_type === 'chat' && b.content_id)
      .map(b => b.content_id)
  )
})

// Filter out rooms already on the page
const availableRooms = computed(() => {
  return chat.rooms.filter(room => !existingChatRoomIds.value.has(room.id))
})

const blockType = ref('widget')
const selectedRoom = ref(null)
const selectedWidget = ref('placeholder')
const blockWidth = ref(2)
const blockHeight = ref(2)
const customTitle = ref('')
const loading = ref(false)
const error = ref('')

// Available widget types with default sizes
const widgetTypes = [
  { value: 'placeholder', label: 'Placeholder', desc: 'Empty block for later', w: 2, h: 2 },
  { value: 'updates', label: 'Breakroom Updates', desc: 'Latest news and updates', w: 2, h: 2 },
  { value: 'calendar', label: 'Calendar/Time', desc: 'Date and time display', w: 1, h: 2 },
  { value: 'weather', label: 'Weather', desc: 'Current weather conditions', w: 1, h: 2 },
  { value: 'news', label: 'News', desc: 'NPR news headlines', w: 2, h: 2 },
  { value: 'blog', label: 'Blog Posts', desc: 'Your recent blog posts', w: 3, h: 2 }
]

// Default sizes for block types
const defaultSizes = {
  chat: { w: 2, h: 2 }
}

// Update size when block type changes
watch(blockType, (newType) => {
  if (newType === 'chat') {
    blockWidth.value = defaultSizes.chat.w
    blockHeight.value = defaultSizes.chat.h
  } else {
    // Use widget default
    const widget = widgetTypes.find(w => w.value === selectedWidget.value)
    if (widget) {
      blockWidth.value = widget.w
      blockHeight.value = widget.h
    }
  }
})

// Update size when widget type changes
watch(selectedWidget, (newWidget) => {
  if (blockType.value === 'widget') {
    const widget = widgetTypes.find(w => w.value === newWidget)
    if (widget) {
      blockWidth.value = widget.w
      blockHeight.value = widget.h
    }
  }
})

// Fetch rooms when modal opens
onMounted(async () => {
  if (chat.rooms.length === 0) {
    await chat.fetchRooms()
  }
  // Select first available room (not already on page)
  if (availableRooms.value.length > 0) {
    selectedRoom.value = availableRooms.value[0].id
  }
})

// Find the first available position for a block of given width and height
const findNextPosition = (w, h, cols = 5) => {
  const blocks = breakroom.blocks

  // Build a grid of occupied cells (track up to 20 rows)
  const maxRows = 20
  const occupied = Array(maxRows).fill(null).map(() => Array(cols).fill(false))

  // Mark occupied cells
  blocks.forEach(block => {
    for (let row = block.y; row < block.y + block.h && row < maxRows; row++) {
      for (let col = block.x; col < block.x + block.w && col < cols; col++) {
        occupied[row][col] = true
      }
    }
  })

  // Find first position where block fits (top-left priority)
  for (let y = 0; y < maxRows; y++) {
    for (let x = 0; x <= cols - w; x++) {
      // Check if all cells needed for this block are free
      let fits = true
      for (let row = y; row < y + h && fits; row++) {
        for (let col = x; col < x + w && fits; col++) {
          if (row >= maxRows || occupied[row][col]) {
            fits = false
          }
        }
      }
      if (fits) {
        return { x, y }
      }
    }
  }

  // Fallback: place at bottom
  return { x: 0, y: maxRows }
}

const handleSubmit = async () => {
  error.value = ''
  loading.value = true

  try {
    // Validate
    if (blockType.value === 'chat' && !selectedRoom.value) {
      throw new Error('Please select a chat room')
    }

    // Find next available position that fits the block
    const { x: nextX, y: nextY } = findNextPosition(blockWidth.value, blockHeight.value)

    // Determine actual block type (chat or the selected widget type)
    const actualBlockType = blockType.value === 'chat' ? 'chat' : selectedWidget.value

    await breakroom.addBlock(
      actualBlockType,
      blockType.value === 'chat' ? selectedRoom.value : null,
      {
        x: nextX,
        y: nextY,
        w: blockWidth.value,
        h: blockHeight.value,
        title: customTitle.value || null
      }
    )

    emit('added')
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal">
      <h2>Add Block</h2>

      <form @submit.prevent="handleSubmit">
        <!-- Block Type -->
        <div class="form-group">
          <label>Block Type</label>
          <div class="type-options">
            <label class="type-option" :class="{ selected: blockType === 'chat' }">
              <input type="radio" v-model="blockType" value="chat" />
              <span class="type-label">Chat Room</span>
              <span class="type-desc">Embed a chat room</span>
            </label>
            <label class="type-option" :class="{ selected: blockType === 'widget' }">
              <input type="radio" v-model="blockType" value="widget" />
              <span class="type-label">Widget</span>
              <span class="type-desc">Add a widget block</span>
            </label>
          </div>
        </div>

        <!-- Chat Room Selection -->
        <div v-if="blockType === 'chat'" class="form-group">
          <label for="room">Chat Room</label>
          <select v-if="availableRooms.length > 0" id="room" v-model="selectedRoom" required>
            <option v-for="room in availableRooms" :key="room.id" :value="room.id">
              # {{ room.name }}
            </option>
          </select>
          <p v-else class="no-rooms-msg">All chat rooms are already on your page</p>
        </div>

        <!-- Widget Type Selection -->
        <div v-if="blockType === 'widget'" class="form-group">
          <label for="widget">Widget Type</label>
          <select id="widget" v-model="selectedWidget">
            <option v-for="widget in widgetTypes" :key="widget.value" :value="widget.value">
              {{ widget.label }}
            </option>
          </select>
          <p class="widget-desc">{{ widgetTypes.find(w => w.value === selectedWidget)?.desc }}</p>
        </div>

        <!-- Size Options (hidden on mobile) -->
        <div class="form-row size-options">
          <div class="form-group">
            <label for="width">Width</label>
            <select id="width" v-model="blockWidth">
              <option :value="1">1 column</option>
              <option :value="2">2 columns</option>
              <option :value="3">3 columns</option>
              <option :value="4">4 columns</option>
              <option :value="5">5 columns</option>
            </select>
          </div>
          <div class="form-group">
            <label for="height">Height</label>
            <select id="height" v-model="blockHeight">
              <option :value="1">1 row</option>
              <option :value="2">2 rows</option>
              <option :value="3">3 rows</option>
              <option :value="4">4 rows</option>
            </select>
          </div>
        </div>

        <!-- Custom Title -->
        <div class="form-group">
          <label for="title">Custom Title (optional)</label>
          <input
            id="title"
            type="text"
            v-model="customTitle"
            placeholder="Leave empty to use default"
            maxlength="64"
          />
        </div>

        <p v-if="error" class="error">{{ error }}</p>

        <div class="modal-actions">
          <button type="submit" class="btn-primary" :disabled="loading">
            {{ loading ? 'Adding...' : 'Add Block' }}
          </button>
          <button type="button" class="btn-secondary" @click="emit('close')">
            Cancel
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
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
  border-radius: 10px;
  width: 450px;
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

.form-row {
  display: flex;
  gap: 15px;
}

.form-row .form-group {
  flex: 1;
}

.type-options {
  display: flex;
  gap: 10px;
}

.type-option {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 12px;
  border: 2px solid var(--color-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.type-option:hover {
  border-color: var(--color-accent);
}

.type-option.selected {
  border-color: var(--color-accent);
  background: var(--color-accent-light);
}

.type-option input {
  display: none;
}

.type-label {
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 4px;
}

.type-desc {
  font-size: 0.8rem;
  color: var(--color-text-light);
}

select,
input[type="text"] {
  width: 100%;
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 1rem;
  box-sizing: border-box;
  background: var(--color-background-input);
  color: var(--color-text);
}

select:focus,
input[type="text"]:focus {
  outline: none;
  border-color: var(--color-accent);
}

.error {
  color: var(--color-error);
  margin: 0 0 15px;
  font-size: 0.9rem;
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
  background: var(--color-button-disabled);
  cursor: not-allowed;
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

.widget-desc {
  margin: 8px 0 0;
  font-size: 0.85rem;
}

.no-rooms-msg {
  margin: 0;
  padding: 10px;
  background: var(--color-background-hover);
  border-radius: 6px;
  font-size: 0.9rem;
  color: var(--color-text-muted);
  color: var(--color-text-muted);
}
</style>
