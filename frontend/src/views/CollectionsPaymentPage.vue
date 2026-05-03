<template>
  <main class="setup-page page-container">
    <div class="setup-header">
      <RouterLink to="/collections" class="back-link">← Collections</RouterLink>
      <h1>Payment Setup</h1>
    </div>
    <div class="setup-body">
      <div class="setup-placeholder">
        <div class="placeholder-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
            <line x1="1" y1="10" x2="23" y2="10"/>
          </svg>
        </div>
        <h2>Payment Setup Coming Soon</h2>
        <p>Connect a payment method so you can receive payments for items sold through your collections. We'll support Stripe and other providers.</p>
      </div>
    </div>
  </main>
</template>

<script setup>
import { RouterLink } from 'vue-router'
</script>

<style scoped>
.setup-page {
  padding: 32px 20px;
  max-width: 720px;
  margin: 0 auto;
}

.setup-header {
  margin-bottom: 32px;
}

.back-link {
  display: inline-block;
  color: var(--color-link);
  text-decoration: none;
  font-size: 0.9rem;
  margin-bottom: 12px;
}

.back-link:hover {
  text-decoration: underline;
}

.setup-header h1 {
  font-size: 1.8rem;
  color: var(--color-text);
  margin: 0;
}

.setup-placeholder {
  text-align: center;
  padding: 80px 20px;
  border: 2px dashed var(--color-border);
  border-radius: 12px;
  color: var(--color-text-secondary);
}

.placeholder-icon {
  margin-bottom: 20px;
  color: var(--color-text-muted, var(--color-text-secondary));
}

.setup-placeholder h2 {
  font-size: 1.4rem;
  color: var(--color-text);
  margin: 0 0 12px;
}

.setup-placeholder p {
  max-width: 420px;
  margin: 0 auto;
  line-height: 1.6;
}
</style>
