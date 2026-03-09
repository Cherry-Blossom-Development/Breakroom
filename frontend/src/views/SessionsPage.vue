<script setup>
</script>

<template>
  <div class="page-container sessions-page">
    <header class="page-header">
      <h1>Sessions</h1>
      <p class="subtitle">Track and manage your recording sessions</p>
    </header>

    <div class="coming-soon-card">
      <div class="coming-soon-icon">&#127925;</div>
      <h2>Coming Soon</h2>
      <p>Sessions is currently in early access. Full functionality is on its way!</p>
    </div>
  </div>
</template>

<style scoped>
.sessions-page {
  max-width: 800px;
}

.page-header {
  margin-bottom: 32px;
}

.page-header h1 {
  font-size: 2.2rem;
  font-weight: 700;
  color: var(--color-accent);
  margin: 0 0 8px;
}

.subtitle {
  color: var(--color-text-muted);
  margin: 0;
  font-size: 1.1rem;
}

.coming-soon-card {
  background: var(--color-background-card);
  border-radius: var(--card-radius);
  padding: 60px 24px;
  box-shadow: var(--shadow-sm);
  text-align: center;
}

.coming-soon-icon {
  font-size: 3.5rem;
  margin-bottom: 20px;
}

.coming-soon-card h2 {
  margin: 0 0 12px;
  color: var(--color-text);
  font-size: 1.6rem;
}

.coming-soon-card p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 1rem;
  line-height: 1.6;
}
</style>
