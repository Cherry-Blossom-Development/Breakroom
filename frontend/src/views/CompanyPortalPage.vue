<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { authFetch } from '../utilities/authFetch'

const router = useRouter()

// Tabs
const activeTab = ref('search') // 'search', 'create', 'my-companies'

// Search state
const searchQuery = ref('')
const searchResults = ref([])
const searching = ref(false)

// My companies
const myCompanies = ref([])
const loadingMyCompanies = ref(false)

// Create company form
const newCompany = ref({
  name: '',
  description: '',
  address: '',
  city: '',
  state: '',
  country: '',
  postal_code: '',
  phone: '',
  email: '',
  website: '',
  employee_title: ''
})
const creating = ref(false)
const createError = ref('')
const createSuccess = ref('')

// Debounce timer for search
let searchTimeout = null

async function searchCompanies() {
  if (searchQuery.value.trim().length < 2) {
    searchResults.value = []
    return
  }

  searching.value = true

  try {
    const res = await authFetch(`/api/company/search?q=${encodeURIComponent(searchQuery.value)}`)
    if (res.ok) {
      const data = await res.json()
      searchResults.value = data.companies
    }
  } catch (err) {
    console.error('Search error:', err)
  } finally {
    searching.value = false
  }
}

function handleSearchInput() {
  if (searchTimeout) {
    clearTimeout(searchTimeout)
  }
  searchTimeout = setTimeout(searchCompanies, 300)
}

async function fetchMyCompanies() {
  loadingMyCompanies.value = true

  try {
    const res = await authFetch('/api/company/my/list')
    if (res.ok) {
      const data = await res.json()
      myCompanies.value = data.companies
    }
  } catch (err) {
    console.error('Error fetching my companies:', err)
  } finally {
    loadingMyCompanies.value = false
  }
}

async function createCompany() {
  if (!newCompany.value.name.trim()) {
    createError.value = 'Company name is required'
    return
  }

  if (!newCompany.value.employee_title.trim()) {
    createError.value = 'Your title/role is required'
    return
  }

  creating.value = true
  createError.value = ''
  createSuccess.value = ''

  try {
    const res = await authFetch('/api/company', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newCompany.value)
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.message || 'Failed to create company')
    }

    const data = await res.json()
    createSuccess.value = `Company "${data.company.name}" created successfully!`

    // Reset form
    newCompany.value = {
      name: '',
      description: '',
      address: '',
      city: '',
      state: '',
      country: '',
      postal_code: '',
      phone: '',
      email: '',
      website: '',
      employee_title: ''
    }

    // Refresh my companies
    await fetchMyCompanies()

    // Switch to my companies tab after a moment
    setTimeout(() => {
      activeTab.value = 'my-companies'
      createSuccess.value = ''
    }, 2000)
  } catch (err) {
    createError.value = err.message
  } finally {
    creating.value = false
  }
}

function viewCompany(companyId) {
  // For now, just show in console. Later could navigate to company detail page
  router.push(`/company/${companyId}`)
}

function getLocationString(company) {
  const parts = []
  if (company.city) parts.push(company.city)
  if (company.state) parts.push(company.state)
  if (company.country && parts.length === 0) parts.push(company.country)
  return parts.join(', ') || 'Location not specified'
}

onMounted(() => {
  fetchMyCompanies()
})
</script>

<template>
  <div class="page-container company-portal-page">
    <h1>Company Portal</h1>

    <!-- Tab Navigation -->
    <div class="tabs">
      <button
        :class="{ active: activeTab === 'search' }"
        @click="activeTab = 'search'"
      >
        Search Companies
      </button>
      <button
        :class="{ active: activeTab === 'my-companies' }"
        @click="activeTab = 'my-companies'"
      >
        My Companies ({{ myCompanies.length }})
      </button>
      <button
        :class="{ active: activeTab === 'create' }"
        @click="activeTab = 'create'"
      >
        Create Company
      </button>
    </div>

    <!-- Search Tab -->
    <div v-if="activeTab === 'search'" class="tab-content">
      <div class="search-box">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search companies by name..."
          @input="handleSearchInput"
        />
        <span v-if="searching" class="searching-indicator">Searching...</span>
      </div>

      <div v-if="searchQuery.length >= 2 && searchResults.length === 0 && !searching" class="no-results">
        No companies found matching "{{ searchQuery }}"
      </div>

      <div v-if="searchResults.length > 0" class="results-list">
        <div
          v-for="company in searchResults"
          :key="company.id"
          class="company-card"
          @click="viewCompany(company.id)"
        >
          <h3>{{ company.name }}</h3>
          <p class="location">{{ getLocationString(company) }}</p>
          <p v-if="company.description" class="description">{{ company.description }}</p>
        </div>
      </div>
    </div>

    <!-- My Companies Tab -->
    <div v-if="activeTab === 'my-companies'" class="tab-content">
      <div v-if="loadingMyCompanies" class="loading">Loading your companies...</div>

      <div v-else-if="myCompanies.length === 0" class="empty-state">
        <p>You are not associated with any companies yet.</p>
        <p>Search for a company to join or create a new one.</p>
      </div>

      <div v-else class="company-list">
        <div
          v-for="company in myCompanies"
          :key="company.id"
          class="company-card my-company"
          @click="viewCompany(company.id)"
        >
          <div class="company-header">
            <h3>{{ company.name }}</h3>
            <div class="badges">
              <span v-if="company.is_owner" class="badge owner">Owner</span>
              <span v-else-if="company.is_admin" class="badge admin">Admin</span>
            </div>
          </div>
          <p class="title">{{ company.title }}</p>
          <p v-if="company.city || company.state" class="location">
            {{ getLocationString(company) }}
          </p>
        </div>
      </div>
    </div>

    <!-- Create Company Tab -->
    <div v-if="activeTab === 'create'" class="tab-content">
      <div class="create-form">
        <h2>Create a New Company</h2>

        <form @submit.prevent="createCompany">
          <div class="form-section">
            <h3>Company Information</h3>

            <div class="form-group">
              <label for="name">Company Name *</label>
              <input
                id="name"
                v-model="newCompany.name"
                type="text"
                required
                placeholder="Enter company name"
              />
            </div>

            <div class="form-group">
              <label for="description">Description</label>
              <textarea
                id="description"
                v-model="newCompany.description"
                rows="3"
                placeholder="Brief description of the company"
              ></textarea>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="phone">Phone</label>
                <input id="phone" v-model="newCompany.phone" type="tel" placeholder="Phone number" />
              </div>
              <div class="form-group">
                <label for="email">Email</label>
                <input id="email" v-model="newCompany.email" type="email" placeholder="Contact email" />
              </div>
            </div>

            <div class="form-group">
              <label for="website">Website</label>
              <input id="website" v-model="newCompany.website" type="url" placeholder="https://..." />
            </div>
          </div>

          <div class="form-section">
            <h3>Location</h3>

            <div class="form-group">
              <label for="address">Address</label>
              <input id="address" v-model="newCompany.address" type="text" placeholder="Street address" />
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="city">City</label>
                <input id="city" v-model="newCompany.city" type="text" placeholder="City" />
              </div>
              <div class="form-group">
                <label for="state">State/Province</label>
                <input id="state" v-model="newCompany.state" type="text" placeholder="State" />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="country">Country</label>
                <input id="country" v-model="newCompany.country" type="text" placeholder="Country" />
              </div>
              <div class="form-group">
                <label for="postal_code">Postal Code</label>
                <input id="postal_code" v-model="newCompany.postal_code" type="text" placeholder="Postal code" />
              </div>
            </div>
          </div>

          <div class="form-section">
            <h3>Your Role</h3>
            <p class="section-hint">As the creator, you will be the owner of this company.</p>

            <div class="form-group">
              <label for="employee_title">Your Title/Position *</label>
              <input
                id="employee_title"
                v-model="newCompany.employee_title"
                type="text"
                required
                placeholder="e.g., CEO, Founder, President"
              />
            </div>
          </div>

          <div v-if="createError" class="error-message">{{ createError }}</div>
          <div v-if="createSuccess" class="success-message">{{ createSuccess }}</div>

          <div class="form-actions">
            <button type="submit" class="btn-primary" :disabled="creating">
              {{ creating ? 'Creating...' : 'Create Company' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.company-portal-page {
  max-width: 900px;
}

.company-portal-page h1 {
  font-size: 2.2rem;
  font-weight: 700;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #42b983 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 1.5rem;
}

/* Tabs */
.tabs {
  display: flex;
  gap: 0;
  margin-bottom: 1.5rem;
  border-bottom: 2px solid var(--color-border);
}

.tabs button {
  padding: 12px 24px;
  background: none;
  border: none;
  font-size: 1rem;
  color: var(--color-text-muted);
  cursor: pointer;
  position: relative;
  transition: color 0.2s;
}

.tabs button:hover {
  color: var(--color-accent);
}

.tabs button.active {
  color: var(--color-accent);
  font-weight: 600;
}

.tabs button.active::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--color-accent);
}

/* Tab Content */
.tab-content {
  background: var(--color-background-card);
  border-radius: var(--card-radius);
  padding: 24px;
  box-shadow: var(--shadow-sm);
}

/* Search */
.search-box {
  position: relative;
  margin-bottom: 20px;
}

.search-box input {
  width: 100%;
  padding: 14px 16px;
  font-size: 1rem;
  border: 2px solid var(--color-border);
  border-radius: 8px;
  box-sizing: border-box;
  background: var(--color-background-input);
  color: var(--color-text);
}

.search-box input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.searching-indicator {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-light);
  font-size: 0.9rem;
}

.no-results {
  text-align: center;
  padding: 40px;
  color: var(--color-text-light);
}

/* Company Cards */
.results-list,
.company-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.company-card {
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--card-radius-sm);
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
  background: var(--color-background-soft);
}

.company-card:hover {
  border-color: var(--color-accent);
  box-shadow: 0 2px 8px rgba(66, 185, 131, 0.15);
}

.company-card h3 {
  margin: 0 0 6px;
  color: var(--color-text);
  font-size: 1.1rem;
}

.company-card .location {
  margin: 0 0 6px;
  color: var(--color-accent);
  font-size: 0.9rem;
}

.company-card .description {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.9rem;
  line-height: 1.4;
}

.company-card .title {
  margin: 0 0 4px;
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.company-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.badges {
  display: flex;
  gap: 6px;
}

.badge {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.badge.owner {
  background: var(--color-accent);
  color: white;
}

.badge.admin {
  background: #667eea;
  color: white;
}

/* Create Form */
.create-form h2 {
  margin: 0 0 24px;
  color: var(--color-text);
}

.form-section {
  margin-bottom: 28px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--color-border);
}

.form-section:last-of-type {
  border-bottom: none;
}

.form-section h3 {
  margin: 0 0 16px;
  color: var(--color-text);
  font-size: 1.1rem;
}

.section-hint {
  color: var(--color-text-light);
  font-size: 0.9rem;
  margin: -8px 0 16px;
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
.form-group textarea {
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
.form-group textarea:focus {
  outline: none;
  border-color: var(--color-accent);
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.error-message {
  background: var(--color-error-bg);
  color: var(--color-error);
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 16px;
}

.success-message {
  background: var(--color-success-bg);
  color: var(--color-success);
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 16px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
}

.btn-primary {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: 12px 28px;
  border-radius: 6px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.btn-primary:disabled {
  background: var(--color-button-secondary);
  cursor: not-allowed;
}

/* Loading/Empty States */
.loading {
  text-align: center;
  padding: 40px;
  color: var(--color-text-muted);
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: var(--color-text-light);
}

.empty-state p {
  margin: 0 0 8px;
}
</style>
