<template>
  <div class="profile-layout page-container">
    <div class="profile-container">
      <nav class="profile-nav">
        <RouterLink to="/profile" class="nav-tab" :class="{ active: $route.path === '/profile' }">
          Profile
        </RouterLink>
        <RouterLink to="/profile/billing" class="nav-tab" :class="{ active: $route.path === '/profile/billing' }">
          Billing
        </RouterLink>
        <RouterLink to="/profile/settings" class="nav-tab" :class="{ active: $route.path === '/profile/settings' }">
          Settings
        </RouterLink>
        <RouterLink to="/profile/legal" class="nav-tab" :class="{ active: $route.path === '/profile/legal' }">
          Legal
        </RouterLink>
      </nav>

      <main class="main-content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<script setup>
</script>

<style scoped>
.profile-layout {
  min-height: calc(100vh - 60px);
  background-color: var(--color-background-page);
  padding: 30px 20px;
}

.profile-container {
  max-width: 900px;
  margin: 0 auto;
}

.profile-nav {
  display: flex;
  justify-content: flex-end;
  gap: 5px;
}

.nav-tab {
  padding: 10px 20px;
  text-decoration: none;
  color: var(--color-text-muted);
  background: var(--color-background-card);
  border-radius: 6px 6px 0 0;
  border: 1px solid var(--color-border-medium);
  border-bottom: none;
  font-size: 0.95rem;
  transition: all 0.2s;
}

.nav-tab:hover {
  color: var(--color-accent);
  background: var(--color-background-hover);
}

.nav-tab.active {
  color: var(--color-accent);
  background: var(--color-background-card);
  font-weight: 600;
  border-color: var(--color-accent);
  border-bottom: 2px solid var(--color-background-card);
  margin-bottom: -1px;
}

.main-content {
  background: var(--color-background-card);
  border-radius: 10px;
  border-top-right-radius: 0;
  padding: 30px;
  box-shadow: var(--shadow-md);
  border: 1px solid var(--color-border-medium);
}
</style>
