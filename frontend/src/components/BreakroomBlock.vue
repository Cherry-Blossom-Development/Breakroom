<script setup>
import { computed } from 'vue'
import ChatWidget from './ChatWidget.vue'
import UpdatesWidget from './UpdatesWidget.vue'
import CalendarWidget from './CalendarWidget.vue'
import WeatherWidget from './WeatherWidget.vue'
import NewsWidget from './NewsWidget.vue'
import BlogPostsWidget from './BlogPostsWidget.vue'

const props = defineProps({
  block: {
    type: Object,
    required: true
  },
  expanded: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['remove', 'toggle'])

// Determine block title (user title or fallback to block type name)
const blockTitle = computed(() => {
  if (props.block.title) {
    return props.block.title
  }
  if (props.block.block_type === 'chat' && props.block.content_name) {
    return `# ${props.block.content_name}`
  }
  switch (props.block.block_type) {
    case 'chat': return 'Chat'
    case 'placeholder': return 'Empty'
    case 'updates': return 'Breakroom Updates'
    case 'calendar': return 'Calendar'
    case 'weather': return 'Weather'
    case 'news': return 'News'
    case 'blog': return 'Blog Posts'
    default: return 'Block'
  }
})
</script>

<template>
  <div class="breakroom-block" :class="{ expanded, 'chat-type': block.block_type === 'chat' }">
    <div class="block-header" @click="emit('toggle')">
      <button class="remove-btn" @click.stop="emit('remove')" title="Remove block">
        &times;
      </button>
      <span class="block-title">{{ blockTitle }}</span>
      <div class="block-actions">
        <button class="expand-btn" :class="{ rotated: expanded }" title="Expand/Collapse">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 10l5 5 5-5z"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="block-content">
      <!-- Chat block -->
      <ChatWidget
        v-if="block.block_type === 'chat' && block.content_id"
        :room-id="block.content_id"
      />

      <!-- Placeholder block -->
      <div v-else-if="block.block_type === 'placeholder'" class="placeholder-content">
        <p>Empty Block</p>
        <p class="hint">This is a placeholder for future content</p>
      </div>

      <!-- Updates block -->
      <UpdatesWidget v-else-if="block.block_type === 'updates'" />

      <!-- Calendar block -->
      <CalendarWidget v-else-if="block.block_type === 'calendar'" />

      <!-- Weather block -->
      <WeatherWidget v-else-if="block.block_type === 'weather'" />

      <!-- News block -->
      <NewsWidget v-else-if="block.block_type === 'news'" />

      <!-- Blog Posts block -->
      <BlogPostsWidget v-else-if="block.block_type === 'blog'" />

      <!-- Unknown block type -->
      <div v-else class="unknown-content">
        <p>Unknown block type: {{ block.block_type }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.breakroom-block {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-background-card);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  overflow: hidden;
}

.block-header {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: var(--color-header-bg);
  color: var(--color-header-text);
  cursor: move;
  flex-shrink: 0;
  gap: 8px;
}

.remove-btn {
  background: none;
  border: none;
  color: var(--color-header-text);
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0 4px;
  opacity: 0.7;
  line-height: 1;
  flex-shrink: 0;
}

.remove-btn:hover {
  opacity: 1;
  color: var(--color-error);
}

.block-title {
  font-weight: 500;
  font-size: 0.9rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.block-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.expand-btn {
  display: none;
  background: none;
  border: none;
  color: var(--color-header-text);
  cursor: pointer;
  padding: 0;
  opacity: 0.7;
  line-height: 1;
}

.expand-btn svg {
  width: 20px;
  height: 20px;
  transition: transform 0.2s;
}

.expand-btn.rotated svg {
  transform: rotate(180deg);
}

.block-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.placeholder-content,
.unknown-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: var(--color-background-soft);
  color: var(--color-text-light);
  text-align: center;
  padding: 20px;
}

.placeholder-content p,
.unknown-content p {
  margin: 0;
}

.placeholder-content .hint {
  font-size: 0.85rem;
  margin-top: 8px;
  color: var(--color-text-light);
}
</style>
