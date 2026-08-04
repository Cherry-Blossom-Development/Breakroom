<template>
  <div class="shortlist-toast-container">
    <TransitionGroup name="toast">
      <div
        v-for="item in items"
        :key="item.id"
        class="shortlist-toast"
        @click="navigate(item)"
      >
        <div class="shortlist-toast-body">
          <span class="shortlist-toast-icon">💬</span>
          <div class="shortlist-toast-text">
            <span class="shortlist-toast-from">{{ item.commenterHandle }}</span>
            commented on a shortlisted recording
            <div class="shortlist-toast-excerpt">{{ item.preview }}</div>
          </div>
        </div>
        <button class="shortlist-toast-close" @click.stop="$emit('dismiss', item.id)">✕</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'

defineProps({ items: Array })
defineEmits(['dismiss'])

const router = useRouter()

function navigate() {
  // Sessions page defaults to the band tab, where Shortlists lives.
  router.push({ path: '/sessions' })
}
</script>

<style scoped>
.shortlist-toast-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 9000;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}

.shortlist-toast {
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

.shortlist-toast:hover { background: var(--color-background-hover); }

.shortlist-toast-body { display: flex; align-items: flex-start; gap: 10px; flex: 1; min-width: 0; }

.shortlist-toast-icon { font-size: 1.1rem; flex-shrink: 0; line-height: 1.4; }

.shortlist-toast-text { font-size: 0.85rem; color: var(--color-text); line-height: 1.4; min-width: 0; }

.shortlist-toast-from { font-weight: 600; }

.shortlist-toast-excerpt {
  margin-top: 3px;
  color: var(--color-text-muted);
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shortlist-toast-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: 0.75rem;
  padding: 0;
  line-height: 1;
  flex-shrink: 0;
}
.shortlist-toast-close:hover { color: var(--color-text); }

.toast-enter-active { transition: all 0.25s ease; }
.toast-leave-active { transition: all 0.3s ease; }
.toast-enter-from { opacity: 0; transform: translateX(40px); }
.toast-leave-to { opacity: 0; transform: translateX(40px); }

@media (max-width: 768px) {
  .shortlist-toast-container { bottom: 70px; right: 12px; left: 12px; }
  .shortlist-toast { max-width: 100%; }
}
</style>
