<script setup>
defineProps({
  color: {
    type: String,
    default: 'gray',
    validator: v => ['gray', 'blue', 'green', 'yellow', 'orange', 'red', 'purple', 'teal'].includes(v)
  },
  soft: {
    type: Boolean,
    default: false
  },
  size: {
    type: String,
    default: 'sm',
    validator: v => ['xs', 'sm'].includes(v)
  },
  dot: {
    type: Boolean,
    default: false
  }
})
</script>

<template>
  <span v-if="dot" class="status-dot" :class="[`dot-${color}`]">
    <span class="dot-circle"></span>
    <slot />
  </span>
  <span v-else class="status-badge" :class="[`badge-${color}`, { 'badge-soft': soft }, `badge-${size}`]">
    <slot />
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-block;
  border-radius: 4px;
  font-weight: 500;
  text-transform: capitalize;
  white-space: nowrap;
}

.badge-sm {
  padding: 3px 8px;
  font-size: 0.75rem;
}

.badge-xs {
  padding: 2px 6px;
  font-size: 0.7rem;
}

/* Solid variants (white text on colored background) */
.badge-gray { background: var(--badge-gray); color: #fff; }
.badge-blue { background: var(--badge-blue); color: #fff; }
.badge-green { background: var(--badge-green); color: #fff; }
.badge-yellow { background: var(--badge-yellow); color: #000; }
.badge-orange { background: var(--badge-orange); color: #fff; }
.badge-red { background: var(--badge-red); color: #fff; }
.badge-purple { background: var(--badge-purple); color: #fff; }
.badge-teal { background: var(--badge-teal); color: #fff; }

/* Soft variants (colored text on light tinted background) */
.badge-soft.badge-gray { background: var(--badge-gray-soft); color: var(--badge-gray-text); }
.badge-soft.badge-blue { background: var(--badge-blue-soft); color: var(--badge-blue-text); }
.badge-soft.badge-green { background: var(--badge-green-soft); color: var(--badge-green-text); }
.badge-soft.badge-yellow { background: var(--badge-yellow-soft); color: var(--badge-yellow-text); }
.badge-soft.badge-orange { background: var(--badge-orange-soft); color: var(--badge-orange-text); }
.badge-soft.badge-red { background: var(--badge-red-soft); color: var(--badge-red-text); }
.badge-soft.badge-purple { background: var(--badge-purple-soft); color: var(--badge-purple-text); }
.badge-soft.badge-teal { background: var(--badge-teal-soft); color: var(--badge-teal-text); }

/* Dot variant (small colored circle + text) */
.status-dot {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.dot-circle {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-gray .dot-circle { background: var(--badge-gray); }
.dot-blue .dot-circle { background: var(--badge-blue); }
.dot-green .dot-circle { background: var(--badge-green); }
.dot-yellow .dot-circle { background: var(--badge-yellow); }
.dot-orange .dot-circle { background: var(--badge-orange); }
.dot-red .dot-circle { background: var(--badge-red); }
.dot-purple .dot-circle { background: var(--badge-purple); }
.dot-teal .dot-circle { background: var(--badge-teal); }
</style>
