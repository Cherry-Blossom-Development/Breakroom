<script setup>
import { ref, computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { authFetch } from '../utilities/authFetch'
import { getProjectHomepageLink } from '../utilities/projectLinks'
import StatusBadge from '../components/StatusBadge.vue'
import LoadingSpinner from '../components/LoadingSpinner.vue'

// Cross-company view of the same projects each company's Projects section
// (CompanyDetailPage.vue) shows, pulled from every company the user is an
// active employee of. Management (add/edit/deactivate/delete) stays on the
// company page -- this is for getting to a project quickly.
const projects = ref([])
const loading = ref(true)
const error = ref(null)
const companyFilter = ref('all')

// Shortcut tracking -- maps project URL to shortcut id, same as the company page
const projectShortcuts = ref({})

const companies = computed(() => {
  const byId = new Map()
  for (const p of projects.value) byId.set(p.company_id, p.company_name)
  return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
})

const filteredProjects = computed(() => {
  if (companyFilter.value === 'all') return projects.value
  return projects.value.filter(p => p.company_id === companyFilter.value)
})

const activeCount = computed(() => filteredProjects.value.filter(p => p.is_active).length)

async function fetchProjects() {
  loading.value = true
  error.value = null
  try {
    const res = await authFetch('/api/projects/my/list')
    if (!res.ok) throw new Error('Failed to load projects')
    const data = await res.json()
    projects.value = data.projects
  } catch (err) {
    console.error('Error fetching projects:', err)
    error.value = err.message
  } finally {
    loading.value = false
  }
}

function hasShortcut(project) {
  return !!projectShortcuts.value[getProjectHomepageLink(project)]
}

async function fetchProjectShortcuts() {
  try {
    const res = await authFetch('/api/shortcuts')
    if (res.ok) {
      const data = await res.json()
      const shortcutMap = {}
      data.shortcuts.forEach(s => {
        shortcutMap[s.url] = s.id
      })
      projectShortcuts.value = shortcutMap
    }
  } catch (err) {
    console.error('Error fetching shortcuts:', err)
  }
}

async function toggleShortcut(project) {
  const url = getProjectHomepageLink(project)

  if (hasShortcut(project)) {
    try {
      const res = await authFetch(`/api/shortcuts/${projectShortcuts.value[url]}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        const { [url]: _removed, ...rest } = projectShortcuts.value
        projectShortcuts.value = rest
      } else {
        const data = await res.json()
        alert(data.message || 'Failed to remove shortcut')
      }
    } catch (err) {
      console.error('Error removing shortcut:', err)
      alert('Failed to remove shortcut')
    }
  } else {
    try {
      const res = await authFetch('/api/shortcuts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: project.title, url })
      })
      if (res.ok) {
        const data = await res.json()
        projectShortcuts.value = { ...projectShortcuts.value, [url]: data.shortcut.id }
      } else {
        const data = await res.json()
        alert(data.message || 'Failed to create shortcut')
      }
    } catch (err) {
      console.error('Error creating shortcut:', err)
      alert('Failed to create shortcut')
    }
  }
}

onMounted(() => {
  fetchProjects()
  fetchProjectShortcuts()
})
</script>

<template>
  <div class="page-container projects-page">
    <h1>Projects</h1>

    <div v-if="loading" class="loading"><LoadingSpinner size="small" /> Loading projects...</div>

    <div v-else-if="error" class="error-box">{{ error }}</div>

    <section v-else class="section-card">
      <div class="section-header">
        <h2>Projects ({{ activeCount }})</h2>
        <select v-if="companies.length > 1" v-model="companyFilter" class="company-filter" aria-label="Filter by company">
          <option value="all">All companies</option>
          <option v-for="c in companies" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>

      <div v-if="projects.length === 0" class="empty-state">
        No projects yet. Projects belong to companies — join or create one in the
        <RouterLink to="/company-portal">Company Portal</RouterLink>.
      </div>

      <div v-else class="projects-list">
        <div v-for="proj in filteredProjects" :key="proj.id" class="project-card" :class="{ inactive: !proj.is_active }">
          <div class="project-main">
            <RouterLink :to="`/company/${proj.company_id}`" class="project-company">{{ proj.company_name }}</RouterLink>
            <div class="project-header">
              <h3><RouterLink :to="`/projects/${proj.id}`" class="project-title-link">{{ proj.title }}</RouterLink></h3>
              <div class="project-badges">
                <StatusBadge v-if="proj.is_default" color="purple" size="xs">Default</StatusBadge>
                <StatusBadge :color="proj.is_public ? 'green' : 'orange'" soft size="xs">
                  {{ proj.is_public ? 'Public' : 'Private' }}
                </StatusBadge>
                <StatusBadge :color="proj.is_active ? 'green' : 'red'" soft size="xs">
                  {{ proj.is_active ? 'Active' : 'Inactive' }}
                </StatusBadge>
              </div>
            </div>
            <p v-if="proj.description" class="project-description">{{ proj.description }}</p>
            <div class="project-meta">
              <span class="meta-item">{{ proj.ticket_count || 0 }} ticket{{ proj.ticket_count == 1 ? '' : 's' }}</span>
            </div>
          </div>
          <div v-if="proj.is_active" class="project-actions">
            <RouterLink :to="getProjectHomepageLink(proj)" class="btn-small btn-homepage">
              View Tickets
            </RouterLink>
            <button
              @click="toggleShortcut(proj)"
              class="btn-small"
              :class="{ 'btn-shortcut-active': hasShortcut(proj) }"
            >
              {{ hasShortcut(proj) ? 'Remove Shortcut' : 'Create Shortcut' }}
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.projects-page h1 {
  color: var(--color-text);
  margin-bottom: 20px;
}

.loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-muted);
}

.error-box {
  padding: 16px;
  border-radius: var(--card-radius-sm);
  background: var(--color-error-bg);
  color: var(--color-error);
}

.section-card {
  background: var(--color-background-card);
  border-radius: var(--card-radius);
  padding: 24px;
  box-shadow: var(--shadow-sm);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--color-accent);
}

.section-header h2 {
  margin: 0;
  color: var(--color-text);
  font-size: 1.2rem;
}

.company-filter {
  padding: 6px 10px;
  font-size: 0.9rem;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-background-card);
  color: var(--color-text);
}

.empty-state {
  text-align: center;
  padding: 30px;
  color: var(--color-text-light);
}

.projects-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.project-card {
  border: 1px solid var(--color-border);
  border-radius: var(--card-radius-sm);
  padding: 16px;
  background: var(--color-background-soft);
}

.project-card.inactive {
  opacity: 0.6;
}

.project-company {
  display: inline-block;
  margin-bottom: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-accent);
  text-decoration: none;
}

.project-company:hover {
  text-decoration: underline;
}

.project-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.project-header h3 {
  margin: 0;
  color: var(--color-text);
  font-size: 1.1rem;
}

.project-title-link {
  padding: 0;
  color: inherit;
  text-decoration: none;
}

.project-title-link:hover {
  background: none;
  color: var(--color-accent);
  text-decoration: underline;
}

.project-badges {
  display: flex;
  gap: 6px;
}

.project-description {
  margin: 8px 0;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  line-height: 1.5;
}

.project-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
}

.meta-item {
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

.project-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
}

.btn-small {
  padding: 6px 12px;
  font-size: 0.85rem;
  border: 1px solid var(--color-border);
  background: var(--color-background-card);
  color: var(--color-text);
  border-radius: 4px;
  cursor: pointer;
}

.btn-small:hover {
  background: var(--color-background-soft);
}

.btn-small.btn-homepage {
  background: var(--color-accent);
  color: white;
  border-color: var(--color-accent);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}

.btn-small.btn-homepage:hover {
  background: var(--color-accent-hover);
  border-color: var(--color-accent-hover);
}

.btn-small.btn-shortcut-active {
  background: #764ba2;
  color: white;
  border-color: #764ba2;
}

.btn-small.btn-shortcut-active:hover {
  background: #5a3a7e;
  border-color: #5a3a7e;
}
</style>
