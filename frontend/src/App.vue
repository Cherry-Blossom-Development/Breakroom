<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { RouterLink, RouterView, useRouter, useRoute } from 'vue-router'
import { user } from './stores/user.js'
import { notificationStore } from './stores/notification.js'
import { initEventService, destroyEventService } from './utilities/eventService.js'
import HeaderNotification from './components/HeaderNotification.vue'
import PopupNotification from './components/PopupNotification.vue'
import AppSidebar from './components/AppSidebar.vue'
import BottomTabBar from './components/BottomTabBar.vue'
import { io } from 'socket.io-client'

const router = useRouter()
const route = useRoute()
const sidebarOpen = ref(false)
const isAdmin = ref(false)

async function checkAdminPermission() {
  if (!user.username) {
    isAdmin.value = false
    return
  }
  try {
    const res = await fetch('/api/auth/can/admin_access', {
      credentials: 'include'
    })
    const data = await res.json()
    isAdmin.value = data.has_permission || false
  } catch (err) {
    isAdmin.value = false
  }
}

// Socket.IO for real-time notifications
let socket = null
const baseUrl = import.meta.env.VITE_API_BASE_URL || ''

function setupNotificationSocket() {
  if (socket) return

  socket = io(baseUrl, {
    withCredentials: true,
    autoConnect: false
  })

  socket.on('connect', () => {
    console.log('Notification socket connected')
  })

  socket.on('new_notification', (notification) => {
    console.log('Received new notification:', notification)
    notificationStore.addNotification(notification)
  })

  socket.on('disconnect', () => {
    console.log('Notification socket disconnected')
  })

  socket.connect()
}

function teardownNotificationSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}

user.fetchUser().then(() => {
  checkAdminPermission()
  if (user.username) {
    notificationStore.fetchNotifications()
    initEventService()
    setupNotificationSocket()
  }
})

watch(() => user.username, (newUsername) => {
  checkAdminPermission()
  if (newUsername) {
    notificationStore.fetchNotifications()
    initEventService()
    setupNotificationSocket()
  } else {
    destroyEventService()
    teardownNotificationSocket()
  }
})

onUnmounted(() => {
  destroyEventService()
  teardownNotificationSocket()
})

function logout() {
  user.logout()
  isAdmin.value = false
  sidebarOpen.value = false
  router.push('/login')
}

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value
}

function closeSidebar() {
  sidebarOpen.value = false
}

setInterval(() => {
  user.fetchUser()
  const publicRoutes = ['/', '/login', '/signup', '/about', '/welcome', '/chat']

  // Only redirect if on a protected route and not logged in
  if (!user.username && !publicRoutes.includes(route.path)) {
    router.push('/')
  }
}, 5 * 60 * 1000) // every 5 minutes

</script>

<template>
  <!-- Notification components -->
  <HeaderNotification />
  <PopupNotification />

  <!-- Logged-in: sidebar + bottom bar navigation -->
  <template v-if="user.username">
    <AppSidebar
      :is-admin="isAdmin"
      :visible="sidebarOpen"
      @close="closeSidebar"
      @logout="logout"
    />

    <!-- Tablet hamburger top bar -->
    <div class="tablet-top-bar">
      <button class="hamburger-btn" @click="toggleSidebar" aria-label="Open menu">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
          <line x1="3" y1="6" x2="21" y2="6"/>
          <line x1="3" y1="12" x2="21" y2="12"/>
          <line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>
      <img src="/logo-192x192-no-text.png" alt="Prosaurus" class="tablet-logo" />
    </div>

    <div class="app-content">
      <RouterView />
    </div>

    <BottomTabBar
      :is-admin="isAdmin"
      @logout="logout"
    />
  </template>

  <!-- Logged-out: simple top nav -->
  <template v-else>
    <header class="public-header">
      <div class="wrapper page-container">
        <nav class="public-nav">
          <RouterLink to="/">Home</RouterLink>
          <RouterLink to="/about">About</RouterLink>
          <RouterLink to="/login">Login</RouterLink>
          <RouterLink to="/signup">Sign Up</RouterLink>
        </nav>
      </div>
    </header>

    <RouterView />
  </template>
</template>

<style>
/* Main body styles */
body {
  margin: 0;
  background: var(--color-background-page);
  min-height: 100vh;
}

/* ============================================
   LOGGED-IN LAYOUT
   ============================================ */

/* Desktop: content shifts right for sidebar */
@media (min-width: 769px) {
  .app-content {
    margin-left: 220px;
  }

  .tablet-top-bar {
    display: none;
  }
}

/* Tablet: hamburger top bar, no sidebar margin */
@media (max-width: 768px) and (min-width: 481px) {
  .app-content {
    margin-left: 0;
    padding-top: 48px;
  }

  .tablet-top-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 48px;
    background: var(--color-header-bg);
    color: var(--color-header-text);
    padding: 0 12px;
    z-index: 998;
  }
}

/* Mobile: no sidebar margin, pad bottom for tab bar */
@media (max-width: 480px) {
  .app-content {
    margin-left: 0;
    padding-bottom: 64px;
  }

  .tablet-top-bar {
    display: none;
  }
}

.hamburger-btn {
  background: none;
  border: none;
  color: var(--color-header-text);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
}

.hamburger-btn:hover {
  opacity: 0.8;
}

.tablet-logo {
  width: 32px;
  height: 32px;
  border-radius: 50%;
}

/* ============================================
   LOGGED-OUT PUBLIC HEADER
   ============================================ */

.public-header {
  line-height: 1.5;
  max-height: 100vh;
  padding: 0.25rem 0;
}

.public-header .page-container {
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
}

.public-nav {
  width: 100%;
  font-size: 15px;
  text-align: right;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0;
}

.public-nav a.router-link-exact-active {
  color: var(--color-accent);
  font-weight: 500;
}

.public-nav a.router-link-exact-active:hover {
  background-color: transparent;
  color: var(--color-accent);
}

.public-nav a {
  display: inline-block;
  padding: 0.5rem 1rem;
  border-left: 1px solid var(--color-border);
  text-decoration: none;
  color: var(--color-text-secondary);
  transition: color 0.2s;
}

.public-nav a:hover {
  color: var(--color-accent);
}

.public-nav a:first-of-type {
  border: 0;
}
</style>
