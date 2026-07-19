<template>
  <div v-if="visible" class="lightbox-overlay" @click.self="$emit('close')">
    <button type="button" class="lightbox-close" aria-label="Close" @click="$emit('close')">&times;</button>
    <div class="lightbox-viewport" :class="{ zoomed }">
      <img
        :src="src"
        :alt="alt"
        class="lightbox-image"
        :class="{ zoomed }"
        :title="zoomed ? 'Click to zoom out' : 'Click to zoom in'"
        @click="zoomed = !zoomed"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onUnmounted } from 'vue'

const props = defineProps({
  visible: Boolean,
  src: { type: String, default: null },
  alt: { type: String, default: '' },
})
const emit = defineEmits(['close'])

const zoomed = ref(false)

function handleKeydown(e) {
  if (e.key === 'Escape') emit('close')
}

watch(() => props.visible, (isVisible) => {
  zoomed.value = false
  document.body.style.overflow = isVisible ? 'hidden' : ''
  if (isVisible) {
    document.addEventListener('keydown', handleKeydown)
  } else {
    document.removeEventListener('keydown', handleKeydown)
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.body.style.overflow = ''
})
</script>

<style scoped>
.lightbox-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.lightbox-close {
  position: absolute;
  top: 16px;
  right: 20px;
  background: none;
  border: none;
  color: #fff;
  font-size: 2rem;
  line-height: 1;
  cursor: pointer;
  z-index: 2001;
}

.lightbox-viewport {
  max-width: 90vw;
  max-height: 85vh;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lightbox-viewport.zoomed {
  overflow: auto;
  max-width: 95vw;
  max-height: 90vh;
  align-items: flex-start;
  justify-content: flex-start;
}

.lightbox-image {
  max-width: 90vw;
  max-height: 85vh;
  object-fit: contain;
  cursor: zoom-in;
  display: block;
  border-radius: 4px;
}

.lightbox-image.zoomed {
  max-width: none;
  max-height: none;
  width: auto;
  height: auto;
  cursor: zoom-out;
  border-radius: 0;
}
</style>
