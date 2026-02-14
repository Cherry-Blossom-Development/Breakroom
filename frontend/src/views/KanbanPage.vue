<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { authFetch } from '../utilities/authFetch'
import LoadingSpinner from '../components/LoadingSpinner.vue'

const router = useRouter()
const loading = ref(true)
const error = ref(null)
const statusMessage = ref('Loading...')

async function init() {
  try {
    // Step 1: Check if user has any companies
    statusMessage.value = 'Checking your projects...'
    const companiesRes = await authFetch('/api/company/my/list')

    if (!companiesRes.ok) {
      throw new Error('Failed to fetch your companies')
    }

    const companiesData = await companiesRes.json()

    if (companiesData.companies && companiesData.companies.length > 0) {
      // User has companies - get the first one's projects
      const firstCompany = companiesData.companies[0]
      statusMessage.value = 'Finding your project board...'

      const projectsRes = await authFetch(`/api/projects/company/${firstCompany.id}`)

      if (!projectsRes.ok) {
        throw new Error('Failed to fetch projects')
      }

      const projectsData = await projectsRes.json()

      if (projectsData.projects && projectsData.projects.length > 0) {
        // Find the first active project (prefer non-default if available, else use default)
        const activeProjects = projectsData.projects.filter(p => p.is_active)

        if (activeProjects.length > 0) {
          // Prefer a non-default project, otherwise use the default
          const nonDefaultProject = activeProjects.find(p => !p.is_default)
          const projectToOpen = nonDefaultProject || activeProjects[0]

          // Redirect to the project
          router.replace(`/project/${projectToOpen.id}`)
          return
        }
      }

      // No active projects found - redirect to company detail page projects tab
      router.replace(`/company/${firstCompany.id}`)
      return
    }

    // User has no companies - create a default one
    statusMessage.value = 'Setting up your personal project board...'

    const createRes = await authFetch('/api/company', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Personal Workspace',
        description: 'My personal project management workspace',
        employee_title: 'Owner'
      })
    })

    if (!createRes.ok) {
      const createData = await createRes.json()
      throw new Error(createData.message || 'Failed to create personal workspace')
    }

    const createData = await createRes.json()
    const newCompanyId = createData.company.id

    // The company creation automatically creates a default "Help Desk" project
    // Fetch the projects to get the default project ID
    const newProjectsRes = await authFetch(`/api/projects/company/${newCompanyId}`)

    if (!newProjectsRes.ok) {
      throw new Error('Failed to fetch new project')
    }

    const newProjectsData = await newProjectsRes.json()

    if (newProjectsData.projects && newProjectsData.projects.length > 0) {
      // Redirect to the first (default) project
      router.replace(`/project/${newProjectsData.projects[0].id}`)
      return
    }

    // Fallback: redirect to the company detail page
    router.replace(`/company/${newCompanyId}`)

  } catch (err) {
    console.error('Error initializing Kanban:', err)
    error.value = err.message
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  init()
})
</script>

<template>
  <div class="page-container kanban-loading-page">
    <div v-if="loading" class="loading-container">
      <LoadingSpinner size="large" />
      <p class="status-message">{{ statusMessage }}</p>
    </div>

    <div v-else-if="error" class="error-container">
      <h2>Something went wrong</h2>
      <p>{{ error }}</p>
      <button @click="init" class="btn-primary">Try Again</button>
      <button @click="router.push('/company-portal')" class="btn-secondary">Go to Company Portal</button>
    </div>
  </div>
</template>

<style scoped>
.kanban-loading-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}

.loading-container {
  text-align: center;
}

.loading-container :deep(.spinner) {
  margin: 0 auto 20px;
}

.status-message {
  color: var(--color-text-muted);
  font-size: 1.1rem;
}

.error-container {
  text-align: center;
  background: var(--color-background-card);
  padding: 40px;
  border-radius: 12px;
  box-shadow: var(--shadow-sm);
}

.error-container h2 {
  margin: 0 0 12px;
  color: var(--color-text);
}

.error-container p {
  margin: 0 0 24px;
  color: var(--color-error);
}

.btn-primary {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
  margin-right: 12px;
}

.btn-primary:hover {
  background: var(--color-accent-hover);
}

.btn-secondary {
  background: var(--color-button-secondary);
  color: var(--color-text);
  border: none;
  padding: 12px 24px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
}

.btn-secondary:hover {
  background: var(--color-button-secondary-hover);
}
</style>
