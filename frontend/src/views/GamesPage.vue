<script setup>
</script>

<template>
  <div class="page-container games-page">
    <div class="coming-soon">
      <svg class="coming-soon-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="56" height="56" aria-hidden="true">
        <rect x="2" y="6" width="20" height="12" rx="6"/>
        <line x1="6" y1="12" x2="10" y2="12"/>
        <line x1="8" y1="10" x2="8" y2="14"/>
        <circle cx="15" cy="10.5" r="1"/>
        <circle cx="18" cy="13.5" r="1"/>
      </svg>
      <h1>Games</h1>
      <p>Coming soon.</p>
    </div>
  </div>
</template>

<style scoped>
.games-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}

.coming-soon {
  text-align: center;
  color: var(--color-text-muted);
}

.coming-soon-icon {
  color: var(--color-text-light);
  margin-bottom: 12px;
}

.coming-soon h1 {
  color: var(--color-text);
  margin: 0 0 6px;
}

.coming-soon p {
  margin: 0;
  font-size: 1rem;
}
</style>
