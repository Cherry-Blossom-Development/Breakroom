<template>
  <div class="mention-toast-container">
    <TransitionGroup name="toast">
      <div
        v-for="mention in mentions"
        :key="mention.id"
        class="mention-toast"
        @click="navigate(mention)"
      >
        <div class="mention-toast-body">
          <span class="mention-icon">@</span>
          <div class="mention-text">
            <span class="mention-from">{{ mention.fromHandle }}</span>
            mentioned you in <span class="mention-room">#{{ mention.roomName }}</span>
            <div class="mention-excerpt">{{ mention.excerpt }}</div>
          </div>
        </div>
        <button class="mention-close" @click.stop="$emit('dismiss', mention.id)">✕</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'

defineProps({ mentions: Array })
defineEmits(['dismiss'])

const router = useRouter()

function navigate(mention) {
  router.push({ path: '/chat', query: { room: mention.roomId } })
}
</script>

<style scoped>
.mention-toast-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 9000;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}

.mention-toast {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: var(--color-background-card);
  border: 1px solid var(--color-accent);
  border-radius: 12px;
  padding: 12px 14px;
  box-shadow: var(--shadow-lg);
  cursor: pointer;
  pointer-events: all;
  max-width: 320px;
  min-width: 240px;
}

.mention-toast:hover {
  background: var(--color-background-hover);
}

.mention-toast-body {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.mention-icon {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-accent);
  flex-shrink: 0;
  line-height: 1.4;
}

.mention-text {
  font-size: 0.85rem;
  color: var(--color-text);
  line-height: 1.4;
  min-width: 0;
}

.mention-from {
  font-weight: 600;
}

.mention-room {
  font-weight: 600;
  color: var(--color-accent);
}

.mention-excerpt {
  margin-top: 3px;
  color: var(--color-text-muted);
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mention-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: 0.75rem;
  padding: 0;
  line-height: 1;
  flex-shrink: 0;
}

.mention-close:hover {
  color: var(--color-text);
}

.toast-enter-active {
  transition: all 0.25s ease;
}
.toast-leave-active {
  transition: all 0.3s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(40px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(40px);
}

@media (max-width: 768px) {
  .mention-toast-container {
    bottom: 70px;
    right: 12px;
    left: 12px;
  }
  .mention-toast {
    max-width: 100%;
  }
}
</style>
