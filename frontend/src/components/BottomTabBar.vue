<script setup>
import { ref } from 'vue'
import { RouterLink } from 'vue-router'

const props = defineProps({
  isAdmin: Boolean
})

const emit = defineEmits(['logout'])

const drawerOpen = ref(false)

function toggleDrawer() {
  drawerOpen.value = !drawerOpen.value
}

function closeDrawer() {
  drawerOpen.value = false
}

function handleLogout() {
  emit('logout')
  closeDrawer()
}
</script>

<template>
  <!-- More drawer overlay -->
  <div v-if="drawerOpen" class="drawer-overlay" @click="closeDrawer"></div>

  <!-- More drawer -->
  <div class="more-drawer" :class="{ open: drawerOpen }">
    <div class="drawer-handle" @click="closeDrawer">
      <div class="handle-bar"></div>
    </div>
    <nav class="drawer-nav" @click="closeDrawer">
      <div class="drawer-section-label">Company</div>
      <RouterLink to="/about-company" class="drawer-item">
        <svg class="drawer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
        About Company
      </RouterLink>
      <RouterLink to="/employment" class="drawer-item">
        <svg class="drawer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
        Employment
      </RouterLink>
      <RouterLink to="/help-desk" class="drawer-item">
        <svg class="drawer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        Help Desk
      </RouterLink>
      <RouterLink to="/company-portal" class="drawer-item">
        <svg class="drawer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        Company Portal
      </RouterLink>

      <div class="drawer-section-label">Tools</div>
      <RouterLink to="/tool-shed" class="drawer-item">
        <svg class="drawer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
        Tool Shed
      </RouterLink>

      <div class="drawer-divider"></div>
      <RouterLink to="/profile" class="drawer-item">
        <svg class="drawer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Profile
      </RouterLink>
      <RouterLink v-if="isAdmin" to="/admin" class="drawer-item">
        <svg class="drawer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        Admin
      </RouterLink>
      <a href="#" class="drawer-item logout-item" @click.prevent="handleLogout">
        <svg class="drawer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Logout
      </a>
    </nav>
  </div>

  <!-- Bottom tab bar -->
  <nav class="bottom-tab-bar">
    <RouterLink to="/breakroom" class="tab-item">
      <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      <span class="tab-label">Home</span>
    </RouterLink>
    <RouterLink to="/chat" class="tab-item">
      <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <span class="tab-label">Chat</span>
    </RouterLink>
    <RouterLink to="/blog" class="tab-item">
      <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      <span class="tab-label">Blog</span>
    </RouterLink>
    <RouterLink to="/friends" class="tab-item">
      <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      <span class="tab-label">Friends</span>
    </RouterLink>
    <button class="tab-item more-tab" :class="{ active: drawerOpen }" @click="toggleDrawer">
      <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
      <span class="tab-label">More</span>
    </button>
  </nav>
</template>

<style scoped>
/* Bottom Tab Bar */
.bottom-tab-bar {
  display: none;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--color-background-card);
  border-top: 1px solid var(--color-border);
  z-index: 1000;
  padding: 4px 0;
  padding-bottom: env(safe-area-inset-bottom, 4px);
}

.tab-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 6px 0;
  color: var(--color-text-muted);
  text-decoration: none;
  font-size: 0.65rem;
  font-weight: 500;
  background: none;
  border: none;
  cursor: pointer;
  flex: 1;
  transition: color 0.15s;
}

.tab-item:hover {
  color: var(--color-accent);
  background: none;
}

.tab-item.router-link-exact-active,
.tab-item.active {
  color: var(--color-accent);
}

.tab-icon {
  width: 22px;
  height: 22px;
}

.tab-label {
  line-height: 1;
}

/* More Drawer */
.drawer-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: var(--color-overlay);
  z-index: 998;
}

.more-drawer {
  display: none;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--color-background-card);
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15);
  z-index: 999;
  transform: translateY(100%);
  transition: transform 0.3s ease;
  max-height: 70vh;
  overflow-y: auto;
  padding-bottom: calc(60px + env(safe-area-inset-bottom, 4px));
}

.more-drawer.open {
  transform: translateY(0);
}

.drawer-handle {
  display: flex;
  justify-content: center;
  padding: 12px 0 8px;
  cursor: pointer;
}

.handle-bar {
  width: 36px;
  height: 4px;
  background: var(--color-border-medium);
  border-radius: 2px;
}

.drawer-nav {
  padding: 0 8px 8px;
}

.drawer-section-label {
  padding: 12px 16px 4px;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-light);
  font-weight: 600;
}

.drawer-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  color: var(--color-text);
  text-decoration: none;
  font-size: 0.95rem;
  border-radius: 8px;
  transition: background-color 0.15s;
}

.drawer-item:hover {
  background: var(--color-background-hover);
}

.drawer-item.router-link-exact-active {
  color: var(--color-accent);
  background: var(--color-accent-light);
}

.drawer-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.drawer-divider {
  height: 1px;
  background: var(--color-border);
  margin: 8px 16px;
}

.logout-item {
  color: var(--color-text-muted);
}

.logout-item:hover {
  color: var(--color-error, #ff6b6b);
  background: rgba(255, 100, 100, 0.08);
}

</style>
