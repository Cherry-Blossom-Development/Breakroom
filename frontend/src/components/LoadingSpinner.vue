<template>
  <div class="spinner" :class="size"></div>
</template>

<script setup>
defineProps({
  size: {
    type: String,
    default: 'small',
    validator: (v) => ['small', 'medium', 'large'].includes(v)
  }
})
</script>

<style scoped>
.spinner {
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

.small {
  width: 20px;
  height: 20px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-accent);
}

.medium {
  width: 32px;
  height: 32px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-accent);
}

.large {
  width: 50px;
  height: 50px;
  border: 4px solid var(--color-border);
  border-top-color: var(--color-accent);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
