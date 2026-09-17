<script setup>
import { computed } from 'vue'
import { presence } from '@/stores/presence.js'

const props = defineProps({
  userId: { type: [Number, String], required: true },
  // Show "Online now" text next to the dot when online (used on the
  // Friends list). Everywhere else (chat messages, the chat carousel)
  // just the dot is shown, to the left of the handle.
  showLabel: { type: Boolean, default: false }
})

const online = computed(() => presence.isOnline(props.userId))
</script>

<template>
  <span class="status-indicator">
    <span class="status-dot" :class="{ online }" :title="online ? 'Online now' : 'Offline'"></span>
    <span v-if="showLabel && online" class="status-text">Online now</span>
  </span>
</template>

<style scoped>
.status-indicator {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-status-offline);
  flex-shrink: 0;
}

.status-dot.online {
  background: var(--color-success);
}

.status-text {
  font-size: 0.8rem;
  color: var(--color-success);
}
</style>
