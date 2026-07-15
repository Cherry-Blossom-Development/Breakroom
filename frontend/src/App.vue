<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { RouterLink, RouterView, useRouter, useRoute } from 'vue-router'
import { user } from './stores/user.js'
import { notificationStore } from './stores/notification.js'
import { moderationStore } from './stores/moderation.js'
import { badges } from './stores/badges.js'
import { initEventService, destroyEventService } from './utilities/eventService.js'
import HeaderNotification from './components/HeaderNotification.vue'
import PopupNotification from './components/PopupNotification.vue'
import MentionToast from './components/MentionToast.vue'
import AppSidebar from './components/AppSidebar.vue'
import BottomTabBar from './components/BottomTabBar.vue'
import SupportModal from './components/SupportModal.vue'
import { io } from 'socket.io-client'

const mentionQueue = ref([])
const scheduledWarning = ref(null)
const scheduledMissed = ref(null)

function addMention(data) {
  const id = Date.now()
  mentionQueue.value.push({ id, ...data })
  setTimeout(() => {
    mentionQueue.value = mentionQueue.value.filter(m => m.id !== id)
  }, 6000)
}

function dismissMention(id) {
  mentionQueue.value = mentionQueue.value.filter(m => m.id !== id)
}

const router = useRouter()
const route = useRoute()
const sidebarOpen = ref(false)
const isAdmin = ref(false)
const isMarketing = ref(false)
const showSupport = ref(false)

// Impersonation banner
const impersonatedUser = ref(localStorage.getItem('impersonatedUser'))

watch(impersonatedUser, (val) => {
  document.body.classList.toggle('has-impersonation-banner', !!val)
}, { immediate: true })

async function stopImpersonation() {
  const adminToken = localStorage.getItem('adminToken')
  if (!adminToken) return
  try {
    await fetch('/api/admin/impersonate/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ adminToken }),
    })
  } catch {}
  localStorage.removeItem('adminToken')
  localStorage.removeItem('impersonatedUser')
  impersonatedUser.value = null
  await user.fetchUser()
  router.push('/breakroom')
}

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

async function checkMarketingPermission() {
  if (!user.username) {
    isMarketing.value = false
    return
  }
  try {
    const res = await fetch('/api/auth/can/marketing_access', {
      credentials: 'include'
    })
    const data = await res.json()
    isMarketing.value = data.has_permission || false
  } catch (err) {
    isMarketing.value = false
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

  socket.on('chat_mention', (data) => {
    addMention(data)
  })

  socket.on('chat_badge_update', ({ roomId }) => {
    badges.onChatBadgeUpdate(roomId)
  })

  socket.on('friend_badge_update', () => {
    badges.onFriendBadgeUpdate()
  })

  socket.on('blog_badge_update', ({ postId }) => {
    badges.onBlogBadgeUpdate(postId)
  })

  socket.on('scheduled_message_warning', (data) => {
    scheduledWarning.value = data
  })

  socket.on('scheduled_message_missed', (data) => {
    scheduledMissed.value = data
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
  checkMarketingPermission()
  if (user.username) {
    notificationStore.fetchNotifications()
    moderationStore.fetchBlockList()
    badges.fetchAll()
    initEventService()
    setupNotificationSocket()
  }
})

watch(() => user.username, (newUsername) => {
  checkAdminPermission()
  checkMarketingPermission()
  if (newUsername) {
    notificationStore.fetchNotifications()
    moderationStore.fetchBlockList()
    badges.fetchAll()
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

async function confirmScheduledSend() {
  if (!scheduledWarning.value) return
  try {
    await fetch(`/api/scheduled-messages/${scheduledWarning.value.id}/confirm`, {
      method: 'POST', credentials: 'include'
    })
  } catch {}
  scheduledWarning.value = null
}

async function cancelScheduledSend() {
  if (!scheduledWarning.value) return
  try {
    await fetch(`/api/scheduled-messages/${scheduledWarning.value.id}`, {
      method: 'DELETE', credentials: 'include'
    })
  } catch {}
  scheduledWarning.value = null
}

async function editScheduledSend() {
  if (!scheduledWarning.value) return
  try {
    await fetch(`/api/scheduled-messages/${scheduledWarning.value.id}/pause-edit`, {
      method: 'POST', credentials: 'include'
    })
  } catch {}
  scheduledWarning.value = null
  router.push('/breakroom')
}

async function logout() {
  await user.logout()
  window.location.href = '/login'
}

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value
  if (sidebarOpen.value) {
    badges.onSidebarOpen()
  }
}

function closeSidebar() {
  sidebarOpen.value = false
}

setInterval(() => {
  user.fetchUser()
  const publicRoutes = ['/', '/login', '/signup', '/about', '/welcome', '/chat', '/privacy', '/eula', '/terms', '/child-safety']
  // bareLayout routes (public stores) are always accessible — never redirect from them
  if (route.meta.bareLayout) return

  // Only redirect if on a protected route and not logged in.
  // Routes with publicLayout:true (e.g. public blog) are always accessible — never redirect from them.
  if (!user.username && !publicRoutes.includes(route.path) && !route.meta.publicLayout) {
    router.push('/')
  }
}, 5 * 60 * 1000) // every 5 minutes

</script>

<template>
  <!-- Bare layout: public store pages — no Prosaurus chrome at all -->
  <template v-if="route.meta.bareLayout">
    <RouterView />
  </template>

  <template v-else>
  <!-- Notification components -->
  <HeaderNotification />
  <PopupNotification />
  <MentionToast :mentions="mentionQueue" @dismiss="dismissMention" />
  <SupportModal :visible="showSupport" @close="showSupport = false" />

  <!-- Scheduled message warning modal -->
  <div v-if="scheduledWarning" class="sched-overlay">
    <div class="sched-modal">
      <div class="sched-header">
        <span class="sched-icon">&#9200;</span>
        <strong>Scheduled Message Reminder</strong>
      </div>
      <p class="sched-desc">
        Your message to <strong>#{{ scheduledWarning.roomName }}</strong> sends in
        <strong>{{ scheduledWarning.minutesRemaining }} minute{{ scheduledWarning.minutesRemaining === 1 ? '' : 's' }}</strong>.
      </p>
      <div class="sched-preview">{{ scheduledWarning.messagePreview }}</div>
      <div class="sched-actions">
        <button class="sched-btn confirm" @click="confirmScheduledSend">Send it</button>
        <button class="sched-btn cancel" @click="cancelScheduledSend">Don't send</button>
        <button class="sched-btn edit" @click="editScheduledSend">Edit first</button>
      </div>
    </div>
  </div>

  <!-- Scheduled message missed/expired modal -->
  <div v-if="scheduledMissed" class="sched-overlay">
    <div class="sched-modal">
      <div class="sched-header">
        <span class="sched-icon">&#9888;</span>
        <strong>Scheduled Message Not Sent</strong>
      </div>
      <p class="sched-desc">
        Your scheduled message expired while you were editing it and was <strong>not sent</strong>.
      </p>
      <div class="sched-preview">{{ scheduledMissed.messagePreview }}</div>
      <div class="sched-actions">
        <button class="sched-btn confirm" @click="scheduledMissed = null">OK</button>
      </div>
    </div>
  </div>

  <!-- Logged-in: sidebar + bottom bar navigation -->
  <template v-if="user.username && !route.meta.publicLayout">
    <!-- Impersonation banner -->
    <div v-if="impersonatedUser" class="impersonation-banner">
      <span>⚠ Admin impersonation of <strong>{{ impersonatedUser }}</strong> — all actions are real</span>
      <button class="impersonation-stop" @click="stopImpersonation">Stop Impersonating</button>
    </div>

    <AppSidebar
      :is-admin="isAdmin"
      :is-marketing="isMarketing"
      :visible="sidebarOpen"
      @close="closeSidebar"
      @logout="logout"
      @support="showSupport = true"
    />

    <!-- Tablet hamburger top bar -->
    <div class="tablet-top-bar">
      <button class="hamburger-btn" @click="toggleSidebar" aria-label="Open menu" :class="{ 'has-badge': badges.hasUnseenBadges }">
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
      :is-marketing="isMarketing"
      @logout="logout"
    />
  </template>

  <!-- Logged-out OR publicLayout routes (e.g. public blog) -->
  <template v-else>
    <header class="public-header">
      <div class="wrapper page-container">
        <nav class="public-nav">
          <!-- Logged-in user previewing a public-layout page: no Login/Signup, add Back + Logout -->
          <template v-if="user.username">
            <RouterLink to="/">Home</RouterLink>
            <RouterLink to="/about">About</RouterLink>
            <RouterLink to="/eula">EULA</RouterLink>
            <RouterLink v-if="route.name === 'publicBlog' || route.name === 'publicBlogPost'" to="/blog" class="back-link">← Blog Edit</RouterLink>
            <RouterLink v-else-if="route.name === 'publicGallery' || route.name === 'publicGalleryArtwork'" to="/art-gallery" class="back-link">← Gallery Edit</RouterLink>
            <RouterLink v-else-if="route.name === 'publicProfile'" to="/profile" class="back-link">← My Profile</RouterLink>
            <a href="#" class="logout-link" @click.prevent="logout">Logout</a>
          </template>
          <!-- Standard public nav for non-logged-in visitors -->
          <template v-else>
            <RouterLink to="/">Home</RouterLink>
            <RouterLink to="/about">About</RouterLink>
            <RouterLink to="/eula">EULA</RouterLink>
            <a href="#" @click.prevent="showSupport = true">Support</a>
            <RouterLink to="/login">Login</RouterLink>
            <RouterLink to="/signup">Sign Up</RouterLink>
          </template>
        </nav>
      </div>
    </header>

    <RouterView />
  </template>
  </template> <!-- end v-else (non-bareLayout) -->
</template>

<style>
/* ============================================
   SCHEDULED MESSAGE MODAL
   ============================================ */

.sched-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.sched-modal {
  background: var(--color-background-card);
  border-radius: 12px;
  padding: 24px;
  width: 360px;
  max-width: 90vw;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
}

.sched-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 1rem;
  color: var(--color-text);
}

.sched-icon {
  font-size: 1.3rem;
}

.sched-desc {
  margin: 0 0 12px;
  font-size: 0.9rem;
  color: var(--color-text);
  line-height: 1.5;
}

.sched-preview {
  background: var(--color-background-soft);
  border-left: 3px solid rgba(237, 137, 54, 0.6);
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin-bottom: 16px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 100px;
  overflow-y: auto;
}

.sched-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.sched-btn {
  flex: 1;
  min-width: 80px;
  padding: 9px 12px;
  border: none;
  border-radius: 7px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s;
}

.sched-btn:hover {
  opacity: 0.85;
}

.sched-btn.confirm {
  background: var(--color-accent);
  color: white;
}

.sched-btn.cancel {
  background: var(--color-error, #e53e3e);
  color: white;
}

.sched-btn.edit {
  background: var(--color-button-secondary);
  color: var(--color-text);
}

/* Main body styles */
body {
  margin: 0;
  background: var(--color-background-page);
  min-height: 100vh;
}

/* ============================================
   IMPERSONATION BANNER
   ============================================ */

.impersonation-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1100;
  background: #ecc94b;
  color: #744210;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 8px 16px;
  font-size: 0.88rem;
  font-weight: 600;
  text-align: center;
  flex-wrap: wrap;
}

.impersonation-stop {
  background: #744210;
  color: #fff;
  border: none;
  border-radius: 5px;
  padding: 4px 12px;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.15s;
}
.impersonation-stop:hover { opacity: 0.85; }

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

/* Tablet & Mobile: hamburger top bar, no sidebar margin */
@media (max-width: 768px) {
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

/* Push content down when impersonation banner is visible */
.has-impersonation-banner .app-content {
  padding-top: 40px;
}
@media (max-width: 768px) {
  .has-impersonation-banner .app-content {
    padding-top: 88px;
  }
  .has-impersonation-banner .tablet-top-bar {
    top: 40px;
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

.hamburger-btn.has-badge {
  border-radius: 50%;
  box-shadow: 0 0 0 2px #e53e3e, 0 0 6px 2px rgba(229, 62, 62, 0.5);
  animation: badge-pulse 2s ease-in-out infinite;
}

@keyframes badge-pulse {
  0%, 100% { box-shadow: 0 0 0 2px #e53e3e, 0 0 6px 2px rgba(229, 62, 62, 0.4); }
  50%       { box-shadow: 0 0 0 2px #e53e3e, 0 0 10px 4px rgba(229, 62, 62, 0.7); }
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
