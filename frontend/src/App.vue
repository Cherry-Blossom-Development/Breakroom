<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { RouterLink, RouterView, useRouter, useRoute } from 'vue-router'
import { user } from './stores/user.js'
import { notificationStore } from './stores/notification.js'
import { initEventService, destroyEventService } from './utilities/eventService.js'
import HeaderNotification from './components/HeaderNotification.vue'
import PopupNotification from './components/PopupNotification.vue'
import { io } from 'socket.io-client'

const router = useRouter()
const route = useRoute()
const showMenu = ref(false)
const userMenuRef = ref(null)

// Close menu when clicking outside
function handleClickOutside(event) {
  if (userMenuRef.value && !userMenuRef.value.contains(event.target)) {
    showMenu.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
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

function toggleMenu() {
  showMenu.value = !showMenu.value
}

function logout() {
  user.logout()
  isAdmin.value = false
  router.push('/login')
  showMenu.value = false
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

  <header>

    <div class="wrapper page-container">
      <nav>

        <template v-if="user.username">
          <RouterLink to="/breakroom">Home</RouterLink>
          <RouterLink to="/blog">Blog</RouterLink>
          <RouterLink to="/chat">Chat</RouterLink>
          <RouterLink to="/friends">Friends</RouterLink>
          <RouterLink v-if="isAdmin" to="/admin">Admin</RouterLink>
          <div class="user-menu" ref="userMenuRef">
            <div @click="toggleMenu">
              <span class="username-text">{{ user.username }}</span>
              <svg class="user-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v2h20v-2c0-3.3-6.7-5-10-5z"/>
              </svg>
            </div>
            <div
              v-if="showMenu"
              class="dropdown"
              @click.stop
            >
              <RouterLink to="/profile" @click="showMenu = false">Profile</RouterLink>
              <a href="#" @click.prevent="logout">Logout</a>
            </div>
          </div>
        </template>

        <template v-else>
          <RouterLink to="/">Home</RouterLink>
          <RouterLink to="/about">About</RouterLink>
          <RouterLink to="/login">Login</RouterLink>
          <RouterLink to="/signup">Sign Up</RouterLink>
        </template>
      </nav>
    </div>
  </header>

  <RouterView />
</template>

<style>
/* Main body styles */
body {
  margin: 0;
  background: var(--color-background-page);
  min-height: 100vh;
}

header {
  line-height: 1.5;
  max-height: 100vh;
  padding: 0.25rem 0;
}

header .page-container {
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
}

nav {
  width: 100%;
  font-size: 15px;
  text-align: right;
  margin-top: 0rem;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0;
}

nav a.router-link-exact-active {
  color: var(--color-accent);
  font-weight: 500;
}

nav a.router-link-exact-active:hover {
  background-color: transparent;
  color: var(--color-accent);
}

nav a {
  display: inline-block;
  padding: 0.5rem 1rem;
  border-left: 1px solid var(--color-border);
  text-decoration: none;
  color: var(--color-text-secondary);
  transition: color 0.2s;
}

nav a:hover {
  color: var(--color-accent);
}

nav a:first-of-type {
  border: 0;
}

/* User menu styles */
.user-menu {
  position: relative;
  display: inline-block;
  cursor: pointer;
  padding: 0.5rem 1rem;
  border-left: 1px solid var(--color-border);
  color: var(--color-accent);
  font-weight: 500;
  transition: background-color 0.2s;
  border-radius: 4px;
}

.user-menu:hover {
  background-color: var(--color-accent-light);
}

.dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 8px 0;
  min-width: 160px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  z-index: 1000;
}

.dropdown::before {
  content: '';
  position: absolute;
  top: -6px;
  right: 16px;
  width: 12px;
  height: 12px;
  background: var(--color-background-card);
  transform: rotate(45deg);
  border-left: 1px solid var(--color-border);
  border-top: 1px solid var(--color-border);
}

.dropdown a {
  padding: 10px 16px;
  text-decoration: none;
  color: var(--color-text);
  border: none;
  transition: background-color 0.15s, color 0.15s;
  font-size: 14px;
}

.dropdown a:hover {
  background-color: var(--color-background-hover);
  color: var(--color-accent);
  text-decoration: none;
}

/* User icon - hidden on desktop, shown on mobile */
.user-icon {
  display: none;
  width: 24px;
  height: 24px;
  vertical-align: middle;
}
</style>
