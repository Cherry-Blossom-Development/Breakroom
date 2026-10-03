<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { authFetch } from '../utilities/authFetch'

// Project-level workspace shell (/projects/:id/*). App.vue drops the main
// sidebar/tab bar for routes with meta.projectLayout, and this page supplies
// its own project menu instead; the child route (Kanban / GANTT / Burndown)
// renders in the content area.
const route = useRoute()
const router = useRouter()

const projectId = route.params.id
const project = ref(null)
const error = ref(null)
const menuOpen = ref(false)

// Where to go on "Back": the page the user came from before entering the
// workspace. Captured once here -- this component stays mounted while the
// user switches between project tabs, so later history entries are just
// other tabs. vue-router keeps the previous path in history.state.back;
// fall back to the Projects list if there isn't one (direct link, reload)
// or it's one of this workspace's own tabs.
const workspacePrefix = `/projects/${projectId}`
const previousPath = router.options.history.state.back
const returnPath = typeof previousPath === 'string' && !previousPath.startsWith(workspacePrefix)
  ? previousPath
  : '/projects'

const menuItems = [
  // also highlighted on the board's Backlog and Closed Tickets lists and
  // on a ticket's full page
  { name: 'projectKanban', label: 'Kanban Board', icon: 'kanban', alsoActiveOn: ['projectWorkspaceBacklog', 'projectWorkspaceClosed', 'projectWorkspaceTicket'] },
  { name: 'projectGantt', label: 'GANTT Chart', icon: 'gantt' },
  { name: 'projectBurndown', label: 'Burndown Chart', icon: 'burndown' },
]

// The desktop menu stays in view (sticky below the top bar) so Settings,
// pinned to its bottom, is always reachable; the top bar's height varies
// (title wraps on narrow screens), so it's measured.
const topbar = ref(null)
const topbarHeight = ref(0)
let topbarObserver = null
onMounted(() => {
  topbarObserver = new ResizeObserver(() => {
    topbarHeight.value = topbar.value?.offsetHeight || 0
  })
  if (topbar.value) topbarObserver.observe(topbar.value)
})
onBeforeUnmount(() => topbarObserver?.disconnect())

async function fetchProject() {
  try {
    const res = await authFetch(`/api/projects/${projectId}`)
    if (!res.ok) {
      if (res.status === 404) throw new Error('Project not found')
      if (res.status === 403) throw new Error("You don't have access to this project")
      throw new Error('Failed to load project')
    }
    const data = await res.json()
    project.value = data.project
  } catch (err) {
    error.value = err.message
  }
}

function goBack() {
  router.push(returnPath)
}

onMounted(fetchProject)
</script>

<template>
  <div class="project-workspace" :style="{ '--topbar-height': `${topbarHeight}px` }">
    <header ref="topbar" class="workspace-topbar">
      <button class="menu-toggle" @click="menuOpen = !menuOpen" :aria-expanded="menuOpen" aria-label="Project menu">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <button class="back-btn" @click="goBack">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polyline points="15 18 9 12 15 6"/></svg>
        <span>Back to Prosaurus</span>
      </button>
      <div class="workspace-title">
        <h1>{{ project?.title || (error ? 'Project' : 'Loading...') }}</h1>
        <span v-if="project" class="workspace-company">{{ project.company_name }}</span>
      </div>
    </header>

    <div class="workspace-body">
      <div v-if="menuOpen" class="menu-overlay" @click="menuOpen = false"></div>
      <nav class="workspace-menu" :class="{ open: menuOpen }">
        <div class="menu-label">Project</div>
        <RouterLink
          v-for="item in menuItems"
          :key="item.name"
          :to="{ name: item.name, params: { id: projectId } }"
          class="menu-item"
          :class="{ 'router-link-exact-active': item.alsoActiveOn?.includes(route.name) }"
          @click="menuOpen = false"
        >
          <svg v-if="item.icon === 'kanban'" class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="4" height="8" rx="1"/></svg>
          <svg v-else-if="item.icon === 'gantt'" class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="3" x2="3" y2="21"/><rect x="5" y="5" width="8" height="3" rx="1"/><rect x="9" y="10.5" width="9" height="3" rx="1"/><rect x="13" y="16" width="7" height="3" rx="1"/></svg>
          <svg v-else class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="3" x2="3" y2="21"/><line x1="3" y1="21" x2="21" y2="21"/><polyline points="5 6 10 10 14 12 20 18"/></svg>
          <span>{{ item.label }}</span>
        </RouterLink>

        <RouterLink
          :to="{ name: 'projectSettings', params: { id: projectId } }"
          class="menu-item menu-item-settings"
          @click="menuOpen = false"
        >
          <svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <span>Settings</span>
        </RouterLink>
      </nav>

      <main class="workspace-content">
        <div v-if="error" class="workspace-error">
          <p>{{ error }}</p>
          <button class="back-btn" @click="goBack">Back to Prosaurus</button>
        </div>
        <RouterView v-else />
      </main>
    </div>
  </div>
</template>

<style scoped>
.project-workspace {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.workspace-topbar {
  position: sticky;
  top: 0;
  z-index: 900;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 20px;
  background: var(--color-header-bg);
  color: var(--color-header-text);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.workspace-title {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
}

.workspace-title h1 {
  margin: 0;
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--color-accent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.workspace-company {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.6);
  white-space: nowrap;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 6px 12px 6px 8px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 6px;
  background: transparent;
  color: var(--color-header-text);
  font-size: 0.9rem;
  cursor: pointer;
  transition: background-color 0.15s;
}

.back-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.menu-toggle {
  display: none;
  background: none;
  border: none;
  padding: 4px;
  color: var(--color-header-text);
  cursor: pointer;
}

.workspace-body {
  flex: 1;
  display: flex;
}

.workspace-menu {
  position: sticky;
  top: var(--topbar-height);
  align-self: flex-start;
  display: flex;
  flex-direction: column;
  width: 220px;
  height: calc(100vh - var(--topbar-height));
  overflow-y: auto;
  flex-shrink: 0;
  padding: 8px 0;
  background: var(--color-header-bg);
  color: var(--color-header-text);
}

/* Settings sits at the bottom of the menu */
.menu-item-settings {
  margin-top: auto;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.menu-label {
  padding: 4px 16px;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(255, 255, 255, 0.4);
  font-weight: 600;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  color: rgba(255, 255, 255, 0.8);
  text-decoration: none;
  font-size: 0.9rem;
  border-radius: 0;
  transition: background-color 0.15s, color 0.15s;
}

.menu-item:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.menu-item.router-link-exact-active {
  background: rgba(255, 255, 255, 0.15);
  color: var(--color-accent);
  font-weight: 500;
}

.menu-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.workspace-content {
  flex: 1;
  min-width: 0;
}

.workspace-error {
  padding: 40px 20px;
  text-align: center;
  color: var(--color-error);
}

.workspace-error .back-btn {
  margin-top: 12px;
  color: var(--color-text);
  border-color: var(--color-border);
}

.menu-overlay {
  display: none;
}

/* Tablet & mobile: project menu becomes a slide-out drawer */
@media (max-width: 768px) {
  .workspace-topbar {
    gap: 10px;
    padding: 8px 12px;
  }

  .menu-toggle {
    display: inline-flex;
  }

  .back-btn span {
    display: none;
  }

  .back-btn {
    padding: 6px;
  }

  .workspace-title {
    flex-direction: column;
    gap: 0;
  }

  .workspace-title h1 {
    font-size: 1.1rem;
  }

  .workspace-company {
    font-size: 0.75rem;
  }

  .workspace-menu {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    height: auto;
    z-index: 1000;
    padding-top: 16px;
    transform: translateX(-100%);
    transition: transform 0.3s ease;
  }

  .workspace-menu.open {
    transform: translateX(0);
  }

  .menu-overlay {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 999;
    background: var(--color-overlay);
  }
}
</style>
