<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authFetch } from '../utilities/authFetch'
import StatusBadge from '../components/StatusBadge.vue'

const route = useRoute()
const router = useRouter()

const company = ref(null)
const employees = ref([])
const positions = ref([])
const projects = ref([])
const userRole = ref(null)
const loading = ref(true)
const error = ref(null)

// Sidebar navigation
const activeSection = ref('info')
const menuItems = [
  { id: 'info', label: 'Company Info', icon: 'building' },
  { id: 'employees', label: 'Employees', icon: 'users' },
  { id: 'positions', label: 'Open Positions', icon: 'briefcase' },
  { id: 'projects', label: 'Projects', icon: 'folder' }
]

// Position management
const showPositionModal = ref(false)
const editingPosition = ref(null)
const positionForm = ref({
  title: '',
  description: '',
  department: '',
  location_type: 'onsite',
  city: '',
  state: '',
  country: '',
  employment_type: 'full-time',
  pay_rate_min: '',
  pay_rate_max: '',
  pay_type: 'salary',
  requirements: '',
  benefits: ''
})
const savingPosition = ref(false)
const positionError = ref('')

const canManagePositions = computed(() => {
  return userRole.value && (userRole.value.is_owner || userRole.value.is_admin)
})

// Project management
const showProjectModal = ref(false)
const editingProject = ref(null)
const projectForm = ref({
  title: '',
  description: '',
  is_public: false
})
const savingProject = ref(false)
const projectError = ref('')

// Shortcut tracking for projects
const projectShortcuts = ref({}) // Maps project URL to shortcut id

const canManageProjects = computed(() => {
  return userRole.value && (userRole.value.is_owner || userRole.value.is_admin)
})

// Company info editing
const editingCompanyInfo = ref(false)
const companyForm = ref({
  name: '',
  description: '',
  address: '',
  city: '',
  state: '',
  country: '',
  postal_code: '',
  phone: '',
  email: '',
  website: ''
})
const savingCompany = ref(false)
const companyError = ref('')

const canEditCompany = computed(() => {
  return userRole.value && (userRole.value.is_owner || userRole.value.is_admin)
})

function startEditingCompany() {
  companyForm.value = {
    name: company.value.name || '',
    description: company.value.description || '',
    address: company.value.address || '',
    city: company.value.city || '',
    state: company.value.state || '',
    country: company.value.country || '',
    postal_code: company.value.postal_code || '',
    phone: company.value.phone || '',
    email: company.value.email || '',
    website: company.value.website || ''
  }
  companyError.value = ''
  editingCompanyInfo.value = true
}

function cancelEditingCompany() {
  editingCompanyInfo.value = false
  companyError.value = ''
}

async function saveCompany() {
  if (!companyForm.value.name.trim()) {
    companyError.value = 'Company name is required'
    return
  }

  savingCompany.value = true
  companyError.value = ''

  try {
    const res = await authFetch(`/api/company/${route.params.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(companyForm.value)
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.message || 'Failed to update company')
    }

    const data = await res.json()
    company.value = data.company
    editingCompanyInfo.value = false
  } catch (err) {
    companyError.value = err.message
  } finally {
    savingCompany.value = false
  }
}

// Employee management
const showEmployeeModal = ref(false)
const editingEmployee = ref(null)
const employeeForm = ref({
  user_id: null,
  title: '',
  department: '',
  is_admin: false,
  hire_date: ''
})
const savingEmployee = ref(false)
const employeeError = ref('')
const userSearchQuery = ref('')
const userSearchResults = ref([])
const searchingUsers = ref(false)

const canManageEmployees = computed(() => {
  return userRole.value && (userRole.value.is_owner || userRole.value.is_admin)
})

async function searchUsers() {
  if (userSearchQuery.value.length < 2) {
    userSearchResults.value = []
    return
  }

  searchingUsers.value = true
  try {
    const res = await authFetch(`/api/company/${route.params.id}/employees/search?q=${encodeURIComponent(userSearchQuery.value)}`)
    if (res.ok) {
      const data = await res.json()
      userSearchResults.value = data.users
    }
  } catch (err) {
    console.error('Error searching users:', err)
  } finally {
    searchingUsers.value = false
  }
}

function selectUserForEmployee(user) {
  employeeForm.value.user_id = user.id
  employeeForm.value.selectedUser = user
  userSearchQuery.value = ''
  userSearchResults.value = []
}

function openEmployeeModal(employee = null) {
  editingEmployee.value = employee
  if (employee) {
    employeeForm.value = {
      user_id: employee.user_id,
      title: employee.title || '',
      department: employee.department || '',
      is_admin: employee.is_admin || false,
      hire_date: employee.hire_date ? employee.hire_date.split('T')[0] : '',
      selectedUser: {
        id: employee.user_id,
        handle: employee.handle,
        first_name: employee.first_name,
        last_name: employee.last_name
      }
    }
  } else {
    employeeForm.value = {
      user_id: null,
      title: '',
      department: '',
      is_admin: false,
      hire_date: new Date().toISOString().split('T')[0],
      selectedUser: null
    }
  }
  userSearchQuery.value = ''
  userSearchResults.value = []
  employeeError.value = ''
  showEmployeeModal.value = true
}

function closeEmployeeModal() {
  showEmployeeModal.value = false
  editingEmployee.value = null
  employeeError.value = ''
  userSearchQuery.value = ''
  userSearchResults.value = []
}

async function saveEmployee() {
  if (!editingEmployee.value && !employeeForm.value.user_id) {
    employeeError.value = 'Please select a user'
    return
  }

  if (!employeeForm.value.title.trim()) {
    employeeError.value = 'Job title is required'
    return
  }

  savingEmployee.value = true
  employeeError.value = ''

  try {
    const payload = {
      title: employeeForm.value.title,
      department: employeeForm.value.department || null,
      is_admin: employeeForm.value.is_admin,
      hire_date: employeeForm.value.hire_date || null
    }

    let res
    if (editingEmployee.value) {
      res = await authFetch(`/api/company/${route.params.id}/employees/${editingEmployee.value.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    } else {
      payload.user_id = employeeForm.value.user_id
      res = await authFetch(`/api/company/${route.params.id}/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    }

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.message || 'Failed to save employee')
    }

    await fetchCompany()
    closeEmployeeModal()
  } catch (err) {
    employeeError.value = err.message
  } finally {
    savingEmployee.value = false
  }
}

async function removeEmployee(employee) {
  if (employee.is_owner) {
    alert('Cannot remove the company owner')
    return
  }

  if (!confirm(`Remove ${employee.first_name || employee.handle} from this company?`)) {
    return
  }

  try {
    const res = await authFetch(`/api/company/${route.params.id}/employees/${employee.id}`, {
      method: 'DELETE'
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.message || 'Failed to remove employee')
    }

    await fetchCompany()
  } catch (err) {
    alert(err.message)
  }
}

async function fetchCompany() {
  loading.value = true
  error.value = null

  try {
    const res = await authFetch(`/api/company/${route.params.id}`)

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error('Company not found')
      }
      throw new Error('Failed to load company')
    }

    const data = await res.json()
    company.value = data.company
    employees.value = data.employees
    userRole.value = data.userRole

    // Fetch positions and projects
    await Promise.all([fetchPositions(), fetchProjects()])
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

async function fetchPositions() {
  try {
    const res = await authFetch(`/api/positions/company/${route.params.id}`)
    if (res.ok) {
      const data = await res.json()
      positions.value = data.positions
    }
  } catch (err) {
    console.error('Error fetching positions:', err)
  }
}

async function fetchProjects() {
  try {
    const res = await authFetch(`/api/projects/company/${route.params.id}`)
    if (res.ok) {
      const data = await res.json()
      projects.value = data.projects
    }
  } catch (err) {
    console.error('Error fetching projects:', err)
  }
}

function getEmployeeName(emp) {
  if (emp.first_name || emp.last_name) {
    return `${emp.first_name || ''} ${emp.last_name || ''}`.trim()
  }
  return emp.handle
}

function getLocationString() {
  if (!company.value) return ''
  const parts = []
  if (company.value.address) parts.push(company.value.address)
  if (company.value.city) parts.push(company.value.city)
  if (company.value.state) parts.push(company.value.state)
  if (company.value.postal_code) parts.push(company.value.postal_code)
  if (company.value.country) parts.push(company.value.country)
  return parts.join(', ')
}

function goBack() {
  router.push('/company-portal')
}

function openPositionModal(position = null) {
  editingPosition.value = position
  if (position) {
    positionForm.value = {
      title: position.title || '',
      description: position.description || '',
      department: position.department || '',
      location_type: position.location_type || 'onsite',
      city: position.city || '',
      state: position.state || '',
      country: position.country || '',
      employment_type: position.employment_type || 'full-time',
      pay_rate_min: position.pay_rate_min || '',
      pay_rate_max: position.pay_rate_max || '',
      pay_type: position.pay_type || 'salary',
      requirements: position.requirements || '',
      benefits: position.benefits || ''
    }
  } else {
    positionForm.value = {
      title: '',
      description: '',
      department: '',
      location_type: 'onsite',
      city: company.value?.city || '',
      state: company.value?.state || '',
      country: company.value?.country || '',
      employment_type: 'full-time',
      pay_rate_min: '',
      pay_rate_max: '',
      pay_type: 'salary',
      requirements: '',
      benefits: ''
    }
  }
  positionError.value = ''
  showPositionModal.value = true
}

function closePositionModal() {
  showPositionModal.value = false
  editingPosition.value = null
  positionError.value = ''
}

async function savePosition() {
  if (!positionForm.value.title.trim()) {
    positionError.value = 'Position title is required'
    return
  }

  savingPosition.value = true
  positionError.value = ''

  try {
    const payload = {
      ...positionForm.value,
      pay_rate_min: positionForm.value.pay_rate_min ? parseFloat(positionForm.value.pay_rate_min) : null,
      pay_rate_max: positionForm.value.pay_rate_max ? parseFloat(positionForm.value.pay_rate_max) : null
    }

    let res
    if (editingPosition.value) {
      res = await authFetch(`/api/positions/${editingPosition.value.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    } else {
      res = await authFetch(`/api/positions/company/${route.params.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    }

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.message || 'Failed to save position')
    }

    await fetchPositions()
    closePositionModal()
  } catch (err) {
    positionError.value = err.message
  } finally {
    savingPosition.value = false
  }
}

async function deletePosition(position) {
  if (!confirm(`Delete the position "${position.title}"?`)) {
    return
  }

  try {
    const res = await authFetch(`/api/positions/${position.id}`, {
      method: 'DELETE'
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.message || 'Failed to delete position')
    }

    await fetchPositions()
  } catch (err) {
    alert(err.message)
  }
}

async function togglePositionStatus(position) {
  const newStatus = position.status === 'open' ? 'closed' : 'open'

  try {
    const res = await authFetch(`/api/positions/${position.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.message || 'Failed to update position')
    }

    await fetchPositions()
  } catch (err) {
    alert(err.message)
  }
}

function formatPay(position) {
  if (!position.pay_rate_min && !position.pay_rate_max) {
    return 'Negotiable'
  }

  const formatNum = (n) => {
    if (n >= 1000) {
      return '$' + (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'k'
    }
    return '$' + n
  }

  const typeLabel = position.pay_type === 'hourly' ? '/hr' : position.pay_type === 'salary' ? '/yr' : ''

  if (position.pay_rate_min && position.pay_rate_max) {
    return `${formatNum(position.pay_rate_min)} - ${formatNum(position.pay_rate_max)}${typeLabel}`
  } else if (position.pay_rate_min) {
    return `${formatNum(position.pay_rate_min)}+${typeLabel}`
  } else {
    return `Up to ${formatNum(position.pay_rate_max)}${typeLabel}`
  }
}

function formatLocationType(type) {
  return type.charAt(0).toUpperCase() + type.slice(1)
}

function formatEmploymentType(type) {
  return type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-')
}

// Project management functions
function openProjectModal(project = null) {
  editingProject.value = project
  if (project) {
    projectForm.value = {
      title: project.title || '',
      description: project.description || '',
      is_public: project.is_public || false
    }
  } else {
    projectForm.value = {
      title: '',
      description: '',
      is_public: false
    }
  }
  projectError.value = ''
  showProjectModal.value = true
}

function closeProjectModal() {
  showProjectModal.value = false
  editingProject.value = null
  projectError.value = ''
}

async function saveProject() {
  if (!projectForm.value.title.trim()) {
    projectError.value = 'Project title is required'
    return
  }

  savingProject.value = true
  projectError.value = ''

  try {
    const payload = {
      title: projectForm.value.title,
      description: projectForm.value.description || null,
      is_public: projectForm.value.is_public,
      company_id: route.params.id
    }

    let res
    if (editingProject.value) {
      res = await authFetch(`/api/projects/${editingProject.value.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    } else {
      res = await authFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    }

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.message || 'Failed to save project')
    }

    await fetchProjects()
    closeProjectModal()
  } catch (err) {
    projectError.value = err.message
  } finally {
    savingProject.value = false
  }
}

async function deleteProject(project) {
  if (project.is_default) {
    alert('Cannot delete the default project')
    return
  }

  if (!confirm(`Delete the project "${project.title}"? This will remove all ticket associations.`)) {
    return
  }

  try {
    const res = await authFetch(`/api/projects/${project.id}`, {
      method: 'DELETE'
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.message || 'Failed to delete project')
    }

    await fetchProjects()
  } catch (err) {
    alert(err.message)
  }
}

async function toggleProjectStatus(project) {
  if (project.is_default && project.is_active) {
    alert('Cannot deactivate the default project')
    return
  }

  try {
    const res = await authFetch(`/api/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !project.is_active })
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.message || 'Failed to update project')
    }

    await fetchProjects()
  } catch (err) {
    alert(err.message)
  }
}

function getProjectHomepageLink(project) {
  // Default Help Desk project goes to /help-desk
  if (project.is_default) {
    return '/help-desk'
  }
  // Other projects go to /project/:id
  return `/project/${project.id}`
}

// Check if a project has an existing shortcut
function hasShortcut(project) {
  const url = getProjectHomepageLink(project)
  return !!projectShortcuts.value[url]
}

// Fetch shortcuts for all projects
async function fetchProjectShortcuts() {
  try {
    const res = await authFetch('/api/shortcuts')
    if (res.ok) {
      const data = await res.json()
      // Build a map of URL -> shortcut id
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

// Toggle shortcut for a project
async function toggleShortcut(project) {
  const url = getProjectHomepageLink(project)

  if (hasShortcut(project)) {
    // Remove shortcut
    try {
      const shortcutId = projectShortcuts.value[url]
      const res = await authFetch(`/api/shortcuts/${shortcutId}`, {
        method: 'DELETE'
      })

      if (res.ok) {
        delete projectShortcuts.value[url]
        // Trigger reactivity
        projectShortcuts.value = { ...projectShortcuts.value }
      } else {
        const data = await res.json()
        alert(data.message || 'Failed to remove shortcut')
      }
    } catch (err) {
      console.error('Error removing shortcut:', err)
      alert('Failed to remove shortcut')
    }
  } else {
    // Create shortcut
    try {
      const res = await authFetch('/api/shortcuts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: project.title,
          url: url
        })
      })

      if (res.ok) {
        const data = await res.json()
        projectShortcuts.value[url] = data.shortcut.id
        // Trigger reactivity
        projectShortcuts.value = { ...projectShortcuts.value }
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
  fetchCompany()
  fetchProjectShortcuts()
})
</script>

<template>
  <div class="page-container company-detail-page">
    <div v-if="loading" class="loading">Loading company...</div>

    <div v-else-if="error" class="error-box">
      <p>{{ error }}</p>
      <button @click="goBack" class="btn-secondary">Back to Portal</button>
    </div>

    <template v-else-if="company">
      <header class="company-header">
        <div>
          <h1>{{ company.name }}</h1>
          <p v-if="userRole" class="your-role">
            You are: <strong>{{ userRole.title }}</strong>
            <span v-if="userRole.is_owner" class="badge owner">Owner</span>
            <span v-else-if="userRole.is_admin" class="badge admin">Admin</span>
          </p>
        </div>
        <button @click="goBack" class="btn-secondary">Back</button>
      </header>

      <div class="company-layout">
        <!-- Sidebar Navigation -->
        <aside class="sidebar">
          <nav class="sidebar-nav">
            <button
              v-for="item in menuItems"
              :key="item.id"
              @click="activeSection = item.id"
              class="nav-item"
              :class="{ active: activeSection === item.id }"
            >
              <span class="nav-icon">
                <template v-if="item.icon === 'building'">🏢</template>
                <template v-else-if="item.icon === 'users'">👥</template>
                <template v-else-if="item.icon === 'briefcase'">💼</template>
                <template v-else-if="item.icon === 'folder'">📁</template>
              </span>
              <span class="nav-label">{{ item.label }}</span>
              <span v-if="item.id === 'employees'" class="nav-count">{{ employees.length }}</span>
              <span v-else-if="item.id === 'positions'" class="nav-count">{{ positions.filter(p => p.status === 'open').length }}</span>
              <span v-else-if="item.id === 'projects'" class="nav-count">{{ projects.filter(p => p.is_active).length }}</span>
            </button>
          </nav>
        </aside>

        <!-- Main Content -->
        <main class="content-panel">
          <!-- Company Info Section -->
          <section v-if="activeSection === 'info'" class="section-card">
            <div class="section-header">
              <h2>Company Information</h2>
              <button v-if="canEditCompany && !editingCompanyInfo" @click="startEditingCompany" class="btn-primary">
                Edit
              </button>
            </div>

            <!-- View Mode -->
            <template v-if="!editingCompanyInfo">
              <div v-if="company.description" class="info-row">
                <label>Description</label>
                <p>{{ company.description }}</p>
              </div>

              <div v-if="getLocationString()" class="info-row">
                <label>Location</label>
                <p>{{ getLocationString() }}</p>
              </div>

              <div v-if="company.phone" class="info-row">
                <label>Phone</label>
                <p>{{ company.phone }}</p>
              </div>

              <div v-if="company.email" class="info-row">
                <label>Email</label>
                <p><a :href="'mailto:' + company.email">{{ company.email }}</a></p>
              </div>

              <div v-if="company.website" class="info-row">
                <label>Website</label>
                <p><a :href="company.website" target="_blank">{{ company.website }}</a></p>
              </div>

              <div v-if="!company.description && !getLocationString() && !company.phone && !company.email && !company.website" class="empty-state">
                No company information available
              </div>
            </template>

            <!-- Edit Mode -->
            <form v-else @submit.prevent="saveCompany" class="company-edit-form">
              <div class="form-group">
                <label for="company-name">Company Name *</label>
                <input id="company-name" v-model="companyForm.name" type="text" required placeholder="Company name" />
              </div>

              <div class="form-group">
                <label for="company-description">Description</label>
                <textarea id="company-description" v-model="companyForm.description" rows="4" placeholder="Tell people about your company..."></textarea>
              </div>

              <h3 class="form-section-title">Location</h3>

              <div class="form-group">
                <label for="company-address">Address</label>
                <input id="company-address" v-model="companyForm.address" type="text" placeholder="Street address" />
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label for="company-city">City</label>
                  <input id="company-city" v-model="companyForm.city" type="text" placeholder="City" />
                </div>
                <div class="form-group">
                  <label for="company-state">State</label>
                  <input id="company-state" v-model="companyForm.state" type="text" placeholder="State" />
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label for="company-postal">Postal Code</label>
                  <input id="company-postal" v-model="companyForm.postal_code" type="text" placeholder="Postal code" />
                </div>
                <div class="form-group">
                  <label for="company-country">Country</label>
                  <input id="company-country" v-model="companyForm.country" type="text" placeholder="Country" />
                </div>
              </div>

              <h3 class="form-section-title">Contact</h3>

              <div class="form-row">
                <div class="form-group">
                  <label for="company-phone">Phone</label>
                  <input id="company-phone" v-model="companyForm.phone" type="tel" placeholder="Phone number" />
                </div>
                <div class="form-group">
                  <label for="company-email">Email</label>
                  <input id="company-email" v-model="companyForm.email" type="email" placeholder="contact@company.com" />
                </div>
              </div>

              <div class="form-group">
                <label for="company-website">Website</label>
                <input id="company-website" v-model="companyForm.website" type="url" placeholder="https://www.company.com" />
              </div>

              <div v-if="companyError" class="error-message">{{ companyError }}</div>

              <div class="form-actions">
                <button type="button" @click="cancelEditingCompany" class="btn-secondary">Cancel</button>
                <button type="submit" class="btn-primary" :disabled="savingCompany">
                  {{ savingCompany ? 'Saving...' : 'Save Changes' }}
                </button>
              </div>
            </form>
          </section>

          <!-- Employees Section -->
          <section v-if="activeSection === 'employees'" class="section-card">
            <div class="section-header">
              <h2>Employees ({{ employees.length }})</h2>
              <button v-if="canManageEmployees" @click="openEmployeeModal()" class="btn-primary">
                + Add Employee
              </button>
            </div>

            <div v-if="employees.length === 0" class="empty-state">
              No employees listed
            </div>

            <div v-else class="employee-list">
              <div v-for="emp in employees" :key="emp.id" class="employee-item-card">
                <div class="employee-main">
                  <div class="employee-avatar">
                    {{ (emp.first_name || emp.handle || '?').charAt(0).toUpperCase() }}
                  </div>
                  <div class="employee-info">
                    <span class="employee-name">{{ getEmployeeName(emp) }}</span>
                    <span class="employee-title">{{ emp.title || 'Employee' }}</span>
                    <span v-if="emp.department" class="employee-department">{{ emp.department }}</span>
                  </div>
                  <div class="employee-badges">
                    <StatusBadge v-if="emp.is_owner" color="orange" size="xs">Owner</StatusBadge>
                    <StatusBadge v-else-if="emp.is_admin" color="blue" size="xs">Admin</StatusBadge>
                  </div>
                </div>
                <div v-if="canManageEmployees" class="employee-actions">
                  <button @click="openEmployeeModal(emp)" class="btn-small">Edit</button>
                  <button v-if="!emp.is_owner" @click="removeEmployee(emp)" class="btn-small danger">Remove</button>
                </div>
              </div>
            </div>
          </section>

          <!-- Open Positions Section -->
          <section v-if="activeSection === 'positions'" class="section-card">
            <div class="section-header">
              <h2>Open Positions ({{ positions.filter(p => p.status === 'open').length }})</h2>
              <button v-if="canManagePositions" @click="openPositionModal()" class="btn-primary">
                + Add Position
              </button>
            </div>

            <div v-if="positions.length === 0" class="empty-state">
              No positions listed
            </div>

            <div v-else class="positions-list">
              <div v-for="pos in positions" :key="pos.id" class="position-card" :class="{ closed: pos.status !== 'open' }">
                <div class="position-main">
                  <div class="position-header">
                    <h3>{{ pos.title }}</h3>
                    <span class="position-status" :class="pos.status">{{ pos.status }}</span>
                  </div>
                  <div class="position-meta">
                    <span class="meta-item">{{ formatEmploymentType(pos.employment_type) }}</span>
                    <span class="meta-item">{{ formatLocationType(pos.location_type) }}</span>
                    <span v-if="pos.city || pos.state" class="meta-item">{{ [pos.city, pos.state].filter(Boolean).join(', ') }}</span>
                    <span class="meta-item pay">{{ formatPay(pos) }}</span>
                  </div>
                  <p v-if="pos.description" class="position-description">{{ pos.description }}</p>
                </div>
                <div v-if="canManagePositions" class="position-actions">
                  <button @click="openPositionModal(pos)" class="btn-small">Edit</button>
                  <button @click="togglePositionStatus(pos)" class="btn-small">
                    {{ pos.status === 'open' ? 'Close' : 'Reopen' }}
                  </button>
                  <button @click="deletePosition(pos)" class="btn-small danger">Delete</button>
                </div>
              </div>
            </div>
          </section>

          <!-- Projects Section -->
          <section v-if="activeSection === 'projects'" class="section-card">
            <div class="section-header">
              <h2>Projects ({{ projects.filter(p => p.is_active).length }})</h2>
              <button v-if="canManageProjects" @click="openProjectModal()" class="btn-primary">
                + Add Project
              </button>
            </div>

            <div v-if="projects.length === 0" class="empty-state">
              No projects yet
            </div>

            <div v-else class="projects-list">
              <div v-for="proj in projects" :key="proj.id" class="project-card" :class="{ inactive: !proj.is_active }">
                <div class="project-main">
                  <div class="project-header">
                    <h3>{{ proj.title }}</h3>
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
                <div class="project-actions">
                  <router-link
                    v-if="proj.is_active"
                    :to="getProjectHomepageLink(proj)"
                    class="btn-small btn-homepage"
                  >
                    View Tickets
                  </router-link>
                  <button
                    v-if="proj.is_active"
                    @click="toggleShortcut(proj)"
                    class="btn-small"
                    :class="{ 'btn-shortcut-active': hasShortcut(proj) }"
                  >
                    {{ hasShortcut(proj) ? 'Remove Shortcut' : 'Create Shortcut' }}
                  </button>
                  <button v-if="canManageProjects" @click="openProjectModal(proj)" class="btn-small">Edit</button>
                  <button v-if="canManageProjects && !proj.is_default" @click="toggleProjectStatus(proj)" class="btn-small">
                    {{ proj.is_active ? 'Deactivate' : 'Activate' }}
                  </button>
                  <button v-if="canManageProjects && !proj.is_default" @click="deleteProject(proj)" class="btn-small danger">Delete</button>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </template>

    <!-- Position Modal -->
    <div v-if="showPositionModal" class="modal-overlay" @click.self="closePositionModal">
      <div class="modal-content">
        <h2>{{ editingPosition ? 'Edit Position' : 'Add New Position' }}</h2>

        <form @submit.prevent="savePosition">
          <div class="form-group">
            <label for="pos-title">Position Title *</label>
            <input id="pos-title" v-model="positionForm.title" type="text" required placeholder="e.g., Software Engineer" />
          </div>

          <div class="form-group">
            <label for="pos-description">Description</label>
            <textarea id="pos-description" v-model="positionForm.description" rows="3" placeholder="Job description..."></textarea>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="pos-department">Department</label>
              <input id="pos-department" v-model="positionForm.department" type="text" placeholder="e.g., Engineering" />
            </div>
            <div class="form-group">
              <label for="pos-employment-type">Employment Type</label>
              <select id="pos-employment-type" v-model="positionForm.employment_type">
                <option value="full-time">Full-time</option>
                <option value="part-time">Part-time</option>
                <option value="contract">Contract</option>
                <option value="internship">Internship</option>
                <option value="temporary">Temporary</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="pos-location-type">Location Type</label>
              <select id="pos-location-type" v-model="positionForm.location_type">
                <option value="onsite">Onsite</option>
                <option value="remote">Remote</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>
            <div class="form-group">
              <label for="pos-city">City</label>
              <input id="pos-city" v-model="positionForm.city" type="text" placeholder="City" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="pos-state">State</label>
              <input id="pos-state" v-model="positionForm.state" type="text" placeholder="State" />
            </div>
            <div class="form-group">
              <label for="pos-country">Country</label>
              <input id="pos-country" v-model="positionForm.country" type="text" placeholder="Country" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="pos-pay-type">Pay Type</label>
              <select id="pos-pay-type" v-model="positionForm.pay_type">
                <option value="salary">Salary</option>
                <option value="hourly">Hourly</option>
                <option value="commission">Commission</option>
                <option value="negotiable">Negotiable</option>
              </select>
            </div>
            <div class="form-group">
              <label for="pos-pay-min">Pay Min</label>
              <input id="pos-pay-min" v-model="positionForm.pay_rate_min" type="number" step="0.01" placeholder="Minimum" />
            </div>
            <div class="form-group">
              <label for="pos-pay-max">Pay Max</label>
              <input id="pos-pay-max" v-model="positionForm.pay_rate_max" type="number" step="0.01" placeholder="Maximum" />
            </div>
          </div>

          <div class="form-group">
            <label for="pos-requirements">Requirements</label>
            <textarea id="pos-requirements" v-model="positionForm.requirements" rows="3" placeholder="Required skills, experience, etc."></textarea>
          </div>

          <div class="form-group">
            <label for="pos-benefits">Benefits</label>
            <textarea id="pos-benefits" v-model="positionForm.benefits" rows="2" placeholder="Health insurance, PTO, etc."></textarea>
          </div>

          <div v-if="positionError" class="error-message">{{ positionError }}</div>

          <div class="modal-actions">
            <button type="button" @click="closePositionModal" class="btn-secondary">Cancel</button>
            <button type="submit" class="btn-primary" :disabled="savingPosition">
              {{ savingPosition ? 'Saving...' : (editingPosition ? 'Update Position' : 'Create Position') }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Project Modal -->
    <div v-if="showProjectModal" class="modal-overlay" @click.self="closeProjectModal">
      <div class="modal-content modal-small">
        <h2>{{ editingProject ? 'Edit Project' : 'Add New Project' }}</h2>

        <form @submit.prevent="saveProject">
          <div class="form-group">
            <label for="proj-title">Project Title *</label>
            <input id="proj-title" v-model="projectForm.title" type="text" required placeholder="e.g., Mobile App Development" />
          </div>

          <div class="form-group">
            <label for="proj-description">Description</label>
            <textarea id="proj-description" v-model="projectForm.description" rows="4" placeholder="Project description..."></textarea>
          </div>

          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="projectForm.is_public" />
              <span>Public project</span>
            </label>
            <p class="field-hint">Public projects are visible to all employees. Private projects are only visible to assigned members.</p>
          </div>

          <div v-if="projectError" class="error-message">{{ projectError }}</div>

          <div class="modal-actions">
            <button type="button" @click="closeProjectModal" class="btn-secondary">Cancel</button>
            <button type="submit" class="btn-primary" :disabled="savingProject">
              {{ savingProject ? 'Saving...' : (editingProject ? 'Update Project' : 'Create Project') }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Employee Modal -->
    <div v-if="showEmployeeModal" class="modal-overlay" @click.self="closeEmployeeModal">
      <div class="modal-content">
        <h2>{{ editingEmployee ? 'Edit Employee' : 'Add New Employee' }}</h2>

        <form @submit.prevent="saveEmployee">
          <!-- User Selection (only for new employees) -->
          <div v-if="!editingEmployee" class="form-group">
            <label>Select User *</label>
            <div v-if="employeeForm.selectedUser" class="selected-user">
              <div class="selected-user-info">
                <span class="selected-user-name">
                  {{ employeeForm.selectedUser.first_name || '' }} {{ employeeForm.selectedUser.last_name || '' }}
                  <span v-if="!employeeForm.selectedUser.first_name && !employeeForm.selectedUser.last_name">
                    @{{ employeeForm.selectedUser.handle }}
                  </span>
                </span>
                <span class="selected-user-handle">@{{ employeeForm.selectedUser.handle }}</span>
              </div>
              <button type="button" @click="employeeForm.selectedUser = null; employeeForm.user_id = null" class="btn-small">
                Change
              </button>
            </div>
            <div v-else class="user-search">
              <input
                v-model="userSearchQuery"
                @input="searchUsers"
                type="text"
                placeholder="Search by name, handle, or email..."
              />
              <div v-if="searchingUsers" class="search-status">Searching...</div>
              <div v-if="userSearchResults.length > 0" class="user-search-results">
                <div
                  v-for="user in userSearchResults"
                  :key="user.id"
                  @click="selectUserForEmployee(user)"
                  class="user-search-item"
                >
                  <div class="user-avatar">
                    {{ (user.first_name || user.handle || '?').charAt(0).toUpperCase() }}
                  </div>
                  <div class="user-info">
                    <span class="user-name">
                      {{ user.first_name || '' }} {{ user.last_name || '' }}
                      <span v-if="!user.first_name && !user.last_name">@{{ user.handle }}</span>
                    </span>
                    <span class="user-handle">@{{ user.handle }}</span>
                  </div>
                </div>
              </div>
              <div v-else-if="userSearchQuery.length >= 2 && !searchingUsers" class="search-status">
                No users found
              </div>
            </div>
          </div>

          <!-- Show selected user for editing -->
          <div v-else class="form-group">
            <label>Employee</label>
            <div class="selected-user readonly">
              <div class="selected-user-info">
                <span class="selected-user-name">
                  {{ employeeForm.selectedUser?.first_name || '' }} {{ employeeForm.selectedUser?.last_name || '' }}
                  <span v-if="!employeeForm.selectedUser?.first_name && !employeeForm.selectedUser?.last_name">
                    @{{ employeeForm.selectedUser?.handle }}
                  </span>
                </span>
                <span class="selected-user-handle">@{{ employeeForm.selectedUser?.handle }}</span>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label for="emp-title">Job Title *</label>
            <input id="emp-title" v-model="employeeForm.title" type="text" required placeholder="e.g., Software Engineer" />
          </div>

          <div class="form-group">
            <label for="emp-department">Department</label>
            <input id="emp-department" v-model="employeeForm.department" type="text" placeholder="e.g., Engineering" />
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="emp-hire-date">Hire Date</label>
              <input id="emp-hire-date" v-model="employeeForm.hire_date" type="date" />
            </div>
            <div class="form-group">
              <label class="checkbox-label">
                <input type="checkbox" v-model="employeeForm.is_admin" :disabled="editingEmployee?.is_owner" />
                <span>Admin privileges</span>
              </label>
            </div>
          </div>

          <div v-if="employeeError" class="error-message">{{ employeeError }}</div>

          <div class="modal-actions">
            <button type="button" @click="closeEmployeeModal" class="btn-secondary">Cancel</button>
            <button type="submit" class="btn-primary" :disabled="savingEmployee">
              {{ savingEmployee ? 'Saving...' : (editingEmployee ? 'Update Employee' : 'Add Employee') }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.company-detail-page {
  max-width: 1000px;
}

.company-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 2rem;
}

.company-header h1 {
  font-size: 2.2rem;
  font-weight: 700;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #42b983 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin: 0 0 8px;
}

.your-role {
  color: var(--color-text-muted);
  margin: 0;
  font-size: 0.95rem;
}

.your-role strong {
  color: var(--color-text);
}

/* Sidebar Layout */
.company-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 24px;
  min-height: 500px;
}

@media (max-width: 768px) {
  .company-layout {
    grid-template-columns: 1fr;
  }
}

.sidebar {
  background: var(--color-background-card);
  border-radius: var(--card-radius);
  padding: 16px;
  box-shadow: var(--shadow-sm);
  height: fit-content;
  position: sticky;
  top: 20px;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  color: var(--color-text);
  font-size: 0.95rem;
  transition: all 0.2s ease;
  width: 100%;
}

.nav-item:hover {
  background: var(--color-background-soft);
}

.nav-item.active {
  background: var(--color-accent);
  color: white;
}

.nav-icon {
  font-size: 1.1rem;
  width: 24px;
  text-align: center;
}

.nav-label {
  flex: 1;
  font-weight: 500;
}

.nav-count {
  font-size: 0.8rem;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--color-background-soft);
  color: var(--color-text-muted);
}

.nav-item.active .nav-count {
  background: rgba(255, 255, 255, 0.2);
  color: white;
}

/* Content Panel */
.content-panel {
  flex: 1;
}

.section-card {
  background: var(--color-background-card);
  border-radius: var(--card-radius);
  padding: 24px;
  box-shadow: var(--shadow-sm);
}

.section-card h2 {
  margin: 0 0 20px;
  color: var(--color-text);
  font-size: 1.2rem;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--color-accent);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--color-accent);
}

.section-header h2 {
  margin: 0;
  padding: 0;
  border: 0;
}

.info-row {
  margin-bottom: 16px;
}

.info-row label {
  display: block;
  font-size: 0.85rem;
  color: var(--color-text-light);
  margin-bottom: 4px;
}

.info-row p {
  margin: 0;
  color: var(--color-text);
}

.info-row a {
  color: var(--color-accent);
  text-decoration: none;
}

.info-row a:hover {
  text-decoration: underline;
}

.employee-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.employee-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--color-background-soft);
  border-radius: 8px;
}

.employee-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea, #42b983);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 1rem;
  flex-shrink: 0;
}

.employee-info {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.employee-name {
  font-weight: 500;
  color: var(--color-text);
}

.employee-title {
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

.employee-badges {
  display: flex;
  gap: 6px;
}

/* Role and status badges handled by StatusBadge component */

/* Positions List */
.positions-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.position-card {
  border: 1px solid var(--color-border);
  border-radius: var(--card-radius-sm);
  padding: 16px;
  background: var(--color-background-soft);
}

.position-card.closed {
  opacity: 0.6;
}

.position-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.position-header h3 {
  margin: 0;
  color: var(--color-text);
  font-size: 1.1rem;
}

.position-status {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.position-status.open {
  background: var(--color-success-bg);
  color: var(--color-success);
}

.position-status.closed {
  background: var(--color-error-bg);
  color: var(--color-error);
}

.position-status.filled {
  background: #e0e0ff;
  color: #008;
}

.position-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 8px;
}

.meta-item {
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

.meta-item.pay {
  color: var(--color-accent);
  font-weight: 600;
}

.position-description {
  margin: 8px 0 0;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  line-height: 1.5;
}

.position-actions {
  display: flex;
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

.btn-small.danger {
  color: var(--color-error);
  border-color: var(--color-error-bg);
}

.btn-small.danger:hover {
  background: var(--color-error-bg);
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

/* Buttons */
.btn-primary {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.95rem;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.btn-primary:disabled {
  background: var(--color-button-secondary);
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--color-button-secondary);
  color: var(--color-text);
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.95rem;
}

.btn-secondary:hover {
  background: var(--color-button-secondary-hover);
}

/* Modal */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--color-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal-content {
  background: var(--color-background-card);
  border-radius: 12px;
  padding: 24px;
  max-width: 600px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-content h2 {
  margin: 0 0 20px;
  color: var(--color-text);
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.form-group input,
.form-group textarea,
.form-group select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 1rem;
  box-sizing: border-box;
  background: var(--color-background-input);
  color: var(--color-text);
}

.form-group textarea {
  resize: vertical;
}

.form-group input:focus,
.form-group textarea:focus,
.form-group select:focus {
  outline: none;
  border-color: var(--color-accent);
}

.form-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px;
}

.form-section-title {
  margin: 24px 0 16px;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text);
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border);
}

.form-section-title:first-of-type {
  margin-top: 16px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
}

.company-edit-form {
  margin-top: -8px;
}

.error-message {
  background: var(--color-error-bg);
  color: var(--color-error);
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 16px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
}

.loading {
  text-align: center;
  padding: 60px;
  color: var(--color-text-muted);
}

.error-box {
  background: var(--color-error-bg);
  color: var(--color-error);
  padding: 30px;
  border-radius: 12px;
  text-align: center;
}

.error-box p {
  margin: 0 0 16px;
}

.empty-state {
  text-align: center;
  padding: 30px;
  color: var(--color-text-light);
}

/* Projects List */
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

.project-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.project-header h3 {
  margin: 0;
  color: var(--color-text);
  font-size: 1.1rem;
}

.project-badges {
  display: flex;
  gap: 6px;
}

/* Project badges handled by StatusBadge component */

.field-hint {
  margin: 4px 0 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
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

.project-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
}

/* Modal sizes */
.modal-small {
  max-width: 450px;
}

/* Employee Card Styles */
.employee-item-card {
  border: 1px solid var(--color-border);
  border-radius: var(--card-radius-sm);
  padding: 16px;
  background: var(--color-background-soft);
}

.employee-main {
  display: flex;
  align-items: center;
  gap: 12px;
}

.employee-department {
  font-size: 0.8rem;
  color: var(--color-text-light);
}

.employee-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
}

/* User Search Styles */
.user-search {
  position: relative;
}

.user-search input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 1rem;
  background: var(--color-background-input);
  color: var(--color-text);
}

.user-search input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.search-status {
  padding: 10px;
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.user-search-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  margin-top: 4px;
  max-height: 200px;
  overflow-y: auto;
  z-index: 10;
  box-shadow: var(--shadow-sm);
}

.user-search-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  cursor: pointer;
}

.user-search-item:hover {
  background: var(--color-background-soft);
}

.user-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea, #42b983);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 0.9rem;
  flex-shrink: 0;
}

.user-info {
  display: flex;
  flex-direction: column;
}

.user-name {
  font-weight: 500;
  color: var(--color-text);
}

.user-handle {
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

.selected-user {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  background: var(--color-background-soft);
  border-radius: 6px;
  border: 1px solid var(--color-border);
}

.selected-user.readonly {
  background: var(--color-background-soft);
  opacity: 0.8;
}

.selected-user-info {
  display: flex;
  flex-direction: column;
}

.selected-user-name {
  font-weight: 500;
  color: var(--color-text);
}

.selected-user-handle {
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

/* Checkbox label */
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding-top: 24px;
}

.checkbox-label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.checkbox-label span {
  color: var(--color-text);
}
</style>
