<script setup>
import { useRoute } from 'vue-router'

// Holding page for project views that aren't built yet (GANTT, Burndown).
// The route's meta.title names the view.
const route = useRoute()
</script>

<template>
  <div class="page-container placeholder-page">
    <div class="placeholder-card">
      <h2>{{ route.meta.title }}</h2>
      <p>Coming soon.</p>
    </div>
  </div>
</template>

<style scoped>
.placeholder-card {
  margin-top: 40px;
  padding: 60px 20px;
  text-align: center;
  background: var(--color-background-card);
  border: 1px dashed var(--color-border);
  border-radius: var(--card-radius);
}

.placeholder-card h2 {
  margin: 0 0 8px;
  color: var(--color-text);
}

.placeholder-card p {
  margin: 0;
  color: var(--color-text-muted);
}
</style>
