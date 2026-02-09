<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { authFetch } from '../utilities/authFetch'
import StatusBadge from '../components/StatusBadge.vue'

const router = useRouter()

const positions = ref([])
const loading = ref(true)
const error = ref(null)

// Filters
const searchQuery = ref('')
const locationFilter = ref('')
const employmentFilter = ref('')

// Selected position for detail view
const selectedPosition = ref(null)

const filteredPositions = computed(() => {
  let result = positions.value

  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(p =>
      p.title.toLowerCase().includes(query) ||
      p.company_name.toLowerCase().includes(query) ||
      (p.description && p.description.toLowerCase().includes(query))
    )
  }

  if (locationFilter.value) {
    result = result.filter(p => p.location_type === locationFilter.value)
  }

  if (employmentFilter.value) {
    result = result.filter(p => p.employment_type === employmentFilter.value)
  }

  return result
})

async function fetchPositions() {
  loading.value = true
  error.value = null

  try {
    const res = await authFetch('/api/positions')

    if (!res.ok) {
      throw new Error('Failed to load positions')
    }

    const data = await res.json()
    positions.value = data.positions
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

function viewPosition(position) {
  selectedPosition.value = position
}

function closePositionDetail() {
  selectedPosition.value = null
}

function viewCompany(companyId) {
  router.push(`/company/${companyId}`)
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
  if (!type) return ''
  return type.charAt(0).toUpperCase() + type.slice(1)
}

function formatEmploymentType(type) {
  if (!type) return ''
  return type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-')
}

function getLocationString(position) {
  const parts = []
  if (position.city) parts.push(position.city)
  if (position.state) parts.push(position.state)
  if (parts.length === 0 && position.company_city) parts.push(position.company_city)
  if (parts.length === 0 && position.company_state) parts.push(position.company_state)
  return parts.join(', ') || 'Location not specified'
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()

  // Compare calendar days, not time difference
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.round((nowDay - dateDay) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  return date.toLocaleDateString()
}

function clearFilters() {
  searchQuery.value = ''
  locationFilter.value = ''
  employmentFilter.value = ''
}

onMounted(() => {
  fetchPositions()
})
</script>

<template>
  <div class="page-container employment-page">
    <header class="page-header">
      <h1>Employment Opportunities</h1>
      <p class="subtitle">Find your next career opportunity</p>
    </header>

    <!-- Filters -->
    <div class="filters-bar">
      <div class="search-box">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search jobs by title, company, or keywords..."
        />
      </div>
      <div class="filter-group">
        <select v-model="locationFilter">
          <option value="">All Locations</option>
          <option value="remote">Remote</option>
          <option value="onsite">Onsite</option>
          <option value="hybrid">Hybrid</option>
        </select>
        <select v-model="employmentFilter">
          <option value="">All Types</option>
          <option value="full-time">Full-time</option>
          <option value="part-time">Part-time</option>
          <option value="contract">Contract</option>
          <option value="internship">Internship</option>
          <option value="temporary">Temporary</option>
        </select>
        <button v-if="searchQuery || locationFilter || employmentFilter" @click="clearFilters" class="btn-clear">
          Clear
        </button>
      </div>
    </div>

    <!-- Loading/Error States -->
    <div v-if="loading" class="loading">Loading positions...</div>

    <div v-else-if="error" class="error-box">
      <p>{{ error }}</p>
      <button @click="fetchPositions" class="btn-secondary">Try Again</button>
    </div>

    <!-- Results -->
    <template v-else>
      <div class="results-header">
        <span>{{ filteredPositions.length }} position{{ filteredPositions.length !== 1 ? 's' : '' }} available</span>
      </div>

      <div v-if="filteredPositions.length === 0" class="empty-state">
        <p v-if="positions.length === 0">No positions are currently available.</p>
        <p v-else>No positions match your search criteria.</p>
      </div>

      <div v-else class="positions-grid">
        <div
          v-for="pos in filteredPositions"
          :key="pos.id"
          class="position-card"
          @click="viewPosition(pos)"
        >
          <div class="position-header">
            <h3>{{ pos.title }}</h3>
            <span class="pay">{{ formatPay(pos) }}</span>
          </div>
          <div class="company-name" @click.stop="viewCompany(pos.company_id)">
            {{ pos.company_name }}
          </div>
          <div class="position-meta">
            <StatusBadge color="green" soft>{{ formatEmploymentType(pos.employment_type) }}</StatusBadge>
            <StatusBadge color="blue" soft>{{ formatLocationType(pos.location_type) }}</StatusBadge>
            <span class="meta-location">{{ getLocationString(pos) }}</span>
          </div>
          <p v-if="pos.description" class="position-excerpt">
            {{ pos.description.substring(0, 150) }}{{ pos.description.length > 150 ? '...' : '' }}
          </p>
          <div class="position-footer">
            <span class="posted-date">Posted {{ formatDate(pos.created_at) }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- Position Detail Modal -->
    <div v-if="selectedPosition" class="modal-overlay" @click.self="closePositionDetail">
      <div class="modal-content">
        <button @click="closePositionDetail" class="modal-close">&times;</button>

        <div class="detail-header">
          <h2>{{ selectedPosition.title }}</h2>
          <div class="company-link" @click="viewCompany(selectedPosition.company_id)">
            {{ selectedPosition.company_name }}
          </div>
        </div>

        <div class="detail-meta">
          <div class="meta-row">
            <span class="meta-label">Employment Type</span>
            <span class="meta-value">{{ formatEmploymentType(selectedPosition.employment_type) }}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Location Type</span>
            <span class="meta-value">{{ formatLocationType(selectedPosition.location_type) }}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Location</span>
            <span class="meta-value">{{ getLocationString(selectedPosition) }}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Compensation</span>
            <span class="meta-value pay">{{ formatPay(selectedPosition) }}</span>
          </div>
          <div v-if="selectedPosition.department" class="meta-row">
            <span class="meta-label">Department</span>
            <span class="meta-value">{{ selectedPosition.department }}</span>
          </div>
        </div>

        <div v-if="selectedPosition.description" class="detail-section">
          <h3>Description</h3>
          <p>{{ selectedPosition.description }}</p>
        </div>

        <div v-if="selectedPosition.requirements" class="detail-section">
          <h3>Requirements</h3>
          <p>{{ selectedPosition.requirements }}</p>
        </div>

        <div v-if="selectedPosition.benefits" class="detail-section">
          <h3>Benefits</h3>
          <p>{{ selectedPosition.benefits }}</p>
        </div>

        <div class="detail-footer">
          <span class="posted-info">Posted {{ formatDate(selectedPosition.created_at) }}</span>
          <button @click="viewCompany(selectedPosition.company_id)" class="btn-primary">
            View Company
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.employment-page {
  max-width: 1000px;
}

.page-header {
  margin-bottom: 24px;
}

.page-header h1 {
  font-size: 2.2rem;
  font-weight: 700;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #42b983 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin: 0 0 8px;
}

.subtitle {
  color: var(--color-text-muted);
  margin: 0;
  font-size: 1.1rem;
}

/* Filters */
.filters-bar {
  background: var(--color-background-card);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 20px;
  box-shadow: var(--shadow-sm);
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.search-box {
  flex: 1;
  min-width: 250px;
}

.search-box input {
  width: 100%;
  padding: 12px 16px;
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

.filter-group {
  display: flex;
  gap: 12px;
  align-items: center;
}

.filter-group select {
  padding: 12px 16px;
  font-size: 0.95rem;
  border: 2px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-input);
  color: var(--color-text);
  cursor: pointer;
}

.filter-group select:focus {
  outline: none;
  border-color: var(--color-accent);
}

.btn-clear {
  padding: 12px 16px;
  background: var(--color-button-secondary);
  border: none;
  border-radius: 8px;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 0.95rem;
}

.btn-clear:hover {
  background: var(--color-button-secondary-hover);
}

/* Results */
.results-header {
  margin-bottom: 16px;
  color: var(--color-text-muted);
  font-size: 0.95rem;
}

.positions-grid {
  display: grid;
  gap: 16px;
}

.position-card {
  background: var(--color-background-card);
  border-radius: 12px;
  padding: 20px;
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.position-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
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
  font-size: 1.2rem;
}

.pay {
  color: var(--color-accent);
  font-weight: 600;
  font-size: 1rem;
  white-space: nowrap;
}

.company-name {
  color: var(--color-link);
  font-size: 1rem;
  margin-bottom: 12px;
  cursor: pointer;
}

.company-name:hover {
  text-decoration: underline;
}

.position-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

/* Employment and location tags handled by StatusBadge component */

.meta-location {
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.position-excerpt {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  line-height: 1.5;
  margin: 0 0 12px;
}

.position-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.posted-date {
  color: var(--color-text-light);
  font-size: 0.85rem;
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
  max-width: 700px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  position: relative;
}

.modal-close {
  position: absolute;
  top: 16px;
  right: 16px;
  background: none;
  border: none;
  font-size: 1.5rem;
  color: var(--color-text-light);
  cursor: pointer;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.modal-close:hover {
  background: var(--color-background-soft);
  color: var(--color-text);
}

.detail-header {
  margin-bottom: 20px;
  padding-right: 40px;
}

.detail-header h2 {
  margin: 0 0 8px;
  color: var(--color-text);
  font-size: 1.5rem;
}

.company-link {
  color: var(--color-link);
  font-size: 1.1rem;
  cursor: pointer;
}

.company-link:hover {
  text-decoration: underline;
}

.detail-meta {
  background: var(--color-background-soft);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 20px;
}

.meta-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);
}

.meta-row:last-child {
  border-bottom: none;
}

.meta-label {
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.meta-value {
  color: var(--color-text);
  font-weight: 500;
}

.meta-value.pay {
  color: var(--color-accent);
}

.detail-section {
  margin-bottom: 20px;
}

.detail-section h3 {
  margin: 0 0 12px;
  color: var(--color-text);
  font-size: 1.1rem;
}

.detail-section p {
  margin: 0;
  color: var(--color-text-secondary);
  line-height: 1.6;
  white-space: pre-wrap;
}

.detail-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
}

.posted-info {
  color: var(--color-text-light);
  font-size: 0.9rem;
}

/* Buttons */
.btn-primary {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
  font-weight: 500;
}

.btn-primary:hover {
  background: var(--color-accent-hover);
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

/* States */
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
  padding: 60px 20px;
  color: var(--color-text-light);
  background: var(--color-background-card);
  border-radius: 12px;
  box-shadow: var(--shadow-sm);
}

.empty-state p {
  margin: 0;
  font-size: 1.1rem;
}

@media (max-width: 600px) {
  .filters-bar {
    flex-direction: column;
  }

  .filter-group {
    flex-wrap: wrap;
  }

  .position-header {
    flex-direction: column;
    gap: 8px;
  }
}
</style>
