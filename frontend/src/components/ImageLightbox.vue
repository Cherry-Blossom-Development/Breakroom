<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="lightbox-overlay"
      role="dialog"
      aria-modal="true"
      :aria-label="alt || 'Image viewer'"
      @click.self="$emit('close')"
    >
      <div class="lightbox-frame" :class="{ zoomed }">
        <button ref="closeBtn" type="button" class="lightbox-close" aria-label="Close" @click="$emit('close')">&times;</button>
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
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch, nextTick, onUnmounted } from 'vue'

const props = defineProps({
  visible: Boolean,
  src: { type: String, default: null },
  alt: { type: String, default: '' },
})
const emit = defineEmits(['close'])

const zoomed = ref(false)
const closeBtn = ref(null)

function handleKeydown(e) {
  if (e.key === 'Escape') emit('close')
}

watch(() => props.visible, (isVisible) => {
  zoomed.value = false
  document.body.style.overflow = isVisible ? 'hidden' : ''
  if (isVisible) {
    document.addEventListener('keydown', handleKeydown)
    nextTick(() => closeBtn.value?.focus())
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
  padding: 24px;
  box-sizing: border-box;
}

/* Standard size regardless of where the image was opened from -- 80% of
   the viewport, not the triggering widget. */
.lightbox-frame {
  position: relative;
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45);
  padding: 14px;
  max-width: 80vw;
  max-height: 80vh;
  box-sizing: border-box;
  display: flex;
}

.lightbox-frame.zoomed {
  max-width: 95vw;
  max-height: 90vh;
}

/* Anchored to the frame's corner, outside the image area, so it always
   sits against the overlay backdrop rather than arbitrary image pixels. */
.lightbox-close {
  position: absolute;
  top: -16px;
  right: -16px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  font-size: 1.4rem;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}

.lightbox-close:hover {
  background: var(--color-button-secondary-hover);
}

.lightbox-viewport {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lightbox-viewport.zoomed {
  overflow: auto;
  align-items: flex-start;
  justify-content: flex-start;
}

.lightbox-image {
  max-width: 100%;
  max-height: 100%;
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
