<template>
  <section class="test-results">
    <h1>Test Results</h1>

    <!-- Filters -->
    <div class="filters">
      <select v-model="filters.platform" @change="fetchRuns">
        <option value="">All Platforms</option>
        <option value="web">Web</option>
        <option value="android">Android</option>
      </select>
      <select v-model="filters.status" @change="fetchRuns">
        <option value="">All Statuses</option>
        <option value="completed">Completed</option>
        <option value="failed">Failed</option>
        <option value="running">Running</option>
      </select>
      <button @click="fetchRuns" class="refresh-btn">Refresh</button>
    </div>

    <!-- Loading State -->
    <p v-if="loading" class="loading"><LoadingSpinner size="small" /> Loading test runs...</p>

    <!-- Error State -->
    <p v-if="error" class="error">{{ error }}</p>

    <!-- Runs Table -->
    <table v-if="!loading && runs.length > 0">
      <thead>
        <tr>
          <th>ID</th>
          <th>Platform</th>
          <th>Categories</th>
          <th>Status</th>
          <th>Tests</th>
          <th>Passed</th>
          <th>Failed</th>
          <th>Date</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="run in runs" :key="run.id" :class="getRowClass(run)">
          <td>{{ run.id }}</td>
          <td>
            <StatusBadge :color="platformColor[run.platform] || 'gray'">
              {{ run.platform }}
            </StatusBadge>
          </td>
          <td>
            <StatusBadge v-for="cat in run.categories" :key="cat" color="teal" style="margin-right: 4px; margin-bottom: 2px;">
              {{ cat }}
            </StatusBadge>
            <span v-if="!run.categories || run.categories.length === 0" class="no-categories">-</span>
          </td>
          <td>
            <StatusBadge :color="testStatusColor[run.status] || 'gray'">
              {{ run.status }}
            </StatusBadge>
          </td>
          <td>{{ run.total_tests }}</td>
          <td class="passed">{{ run.passed_tests }}</td>
          <td class="failed">{{ run.failed_tests }}</td>
          <td>{{ formatDate(run.created_at) }}</td>
          <td>
            <button @click="viewRun(run.id)" class="view-btn">View</button>
            <button @click="deleteRun(run.id)" class="delete-btn">Delete</button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Empty State -->
    <p v-if="!loading && runs.length === 0" class="empty">No test runs found.</p>

    <!-- Pagination -->
    <div v-if="pagination.pages > 1" class="pagination">
      <button
        @click="goToPage(pagination.page - 1)"
        :disabled="pagination.page <= 1"
      >
        Previous
      </button>
      <span>Page {{ pagination.page }} of {{ pagination.pages }}</span>
      <button
        @click="goToPage(pagination.page + 1)"
        :disabled="pagination.page >= pagination.pages"
      >
        Next
      </button>
    </div>

    <!-- Run Detail Modal -->
    <div v-if="selectedRun" class="modal-overlay" @click.self="closeModal">
      <div class="modal run-detail-modal">
        <div class="modal-header">
          <h2>Test Run #{{ selectedRun.id }}</h2>
          <button @click="closeModal" class="close-btn">&times;</button>
        </div>

        <div class="run-summary">
          <div class="summary-item">
            <span class="label">Platform:</span>
            <StatusBadge :color="platformColor[selectedRun.platform] || 'gray'">
              {{ selectedRun.platform }}
            </StatusBadge>
          </div>
          <div class="summary-item">
            <span class="label">Environment:</span>
            <span>{{ selectedRun.environment }}</span>
          </div>
          <div class="summary-item">
            <span class="label">Status:</span>
            <StatusBadge :color="testStatusColor[selectedRun.status] || 'gray'">
              {{ selectedRun.status }}
            </StatusBadge>
          </div>
          <div class="summary-item" v-if="selectedRun.branch">
            <span class="label">Branch:</span>
            <span>{{ selectedRun.branch }}</span>
          </div>
          <div class="summary-item" v-if="selectedRun.commit_hash">
            <span class="label">Commit:</span>
            <span class="commit">{{ selectedRun.commit_hash.substring(0, 7) }}</span>
          </div>
          <div class="summary-item">
            <span class="label">Started:</span>
            <span>{{ formatDateTime(selectedRun.started_at) }}</span>
          </div>
        </div>

        <div class="test-counts">
          <div class="count total">
            <span class="number">{{ selectedRun.total_tests }}</span>
            <span class="label">Total</span>
          </div>
          <div class="count passed">
            <span class="number">{{ selectedRun.passed_tests }}</span>
            <span class="label">Passed</span>
          </div>
          <div class="count failed">
            <span class="number">{{ selectedRun.failed_tests }}</span>
            <span class="label">Failed</span>
          </div>
          <div class="count skipped">
            <span class="number">{{ selectedRun.skipped_tests }}</span>
            <span class="label">Skipped</span>
          </div>
        </div>

        <!-- Suites -->
        <div class="suites">
          <h3>Test Suites</h3>
          <div v-for="suite in suites" :key="suite.id" class="suite">
            <div class="suite-header" @click="toggleSuite(suite.id)">
              <StatusBadge :color="testStatusColor[suite.status] || 'gray'" dot />
              <StatusBadge v-if="suite.category" color="teal">{{ suite.category }}</StatusBadge>
              <span class="suite-name">{{ suite.name }}</span>
              <span class="suite-stats">
                {{ suite.passed_tests }}/{{ suite.total_tests }} passed
              </span>
              <span class="expand-icon">{{ expandedSuites.has(suite.id) ? '−' : '+' }}</span>
            </div>

            <div v-if="expandedSuites.has(suite.id)" class="suite-cases">
              <div
                v-for="testCase in suite.cases"
                :key="testCase.id"
                class="test-case"
                :class="testCase.status"
              >
                <span class="case-status">
                  <span v-if="testCase.status === 'passed'" class="icon passed">✓</span>
                  <span v-else-if="testCase.status === 'failed'" class="icon failed">✗</span>
                  <span v-else-if="testCase.status === 'skipped'" class="icon skipped">○</span>
                  <span v-else class="icon pending">?</span>
                </span>
                <span class="case-name">{{ testCase.name }}</span>
                <span class="case-duration" v-if="testCase.duration_ms">
                  {{ testCase.duration_ms }}ms
                </span>
              </div>

              <!-- Error details for failed tests -->
              <div
                v-for="testCase in suite.cases.filter(c => c.status === 'failed' && c.error_message)"
                :key="'error-' + testCase.id"
                class="error-details"
              >
                <strong>{{ testCase.name }}</strong>
                <pre class="error-message">{{ testCase.error_message }}</pre>
                <pre v-if="testCase.error_stack" class="error-stack">{{ testCase.error_stack }}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import StatusBadge from '../../components/StatusBadge.vue'
import LoadingSpinner from '../../components/LoadingSpinner.vue'

const platformColor = { web: 'purple', android: 'green' }
const testStatusColor = {
  completed: 'green', passed: 'green',
  failed: 'red',
  running: 'yellow', pending: 'yellow',
  cancelled: 'gray', skipped: 'gray'
}

const runs = ref([])
const loading = ref(false)
const error = ref(null)
const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0,
  pages: 0
})
const filters = reactive({
  platform: '',
  status: ''
})

const selectedRun = ref(null)
const suites = ref([])
const expandedSuites = ref(new Set())

async function fetchRuns() {
  loading.value = true
  error.value = null

  try {
    const params = new URLSearchParams({
      page: pagination.page,
      limit: pagination.limit
    })
    if (filters.platform) params.append('platform', filters.platform)
    if (filters.status) params.append('status', filters.status)

    const res = await fetch(`/api/test-results/runs?${params}`, {
      credentials: 'include'
    })

    if (!res.ok) throw new Error('Failed to fetch test runs')

    const data = await res.json()
    runs.value = data.runs
    pagination.page = data.pagination.page
    pagination.total = data.pagination.total
    pagination.pages = data.pagination.pages
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

async function viewRun(runId) {
  try {
    const res = await fetch(`/api/test-results/runs/${runId}`, {
      credentials: 'include'
    })

    if (!res.ok) throw new Error('Failed to fetch run details')

    const data = await res.json()
    selectedRun.value = data.run
    suites.value = data.suites
    expandedSuites.value = new Set()

    // Auto-expand failed suites
    data.suites.forEach(suite => {
      if (suite.status === 'failed') {
        expandedSuites.value.add(suite.id)
      }
    })
  } catch (err) {
    alert('Failed to load run details: ' + err.message)
  }
}

async function deleteRun(runId) {
  if (!confirm('Are you sure you want to delete this test run?')) return

  try {
    const res = await fetch(`/api/test-results/runs/${runId}`, {
      method: 'DELETE',
      credentials: 'include'
    })

    if (!res.ok) throw new Error('Failed to delete run')

    fetchRuns()
  } catch (err) {
    alert('Failed to delete run: ' + err.message)
  }
}

function closeModal() {
  selectedRun.value = null
  suites.value = []
}

function toggleSuite(suiteId) {
  if (expandedSuites.value.has(suiteId)) {
    expandedSuites.value.delete(suiteId)
  } else {
    expandedSuites.value.add(suiteId)
  }
  // Force reactivity
  expandedSuites.value = new Set(expandedSuites.value)
}

function goToPage(page) {
  pagination.page = page
  fetchRuns()
}

function getRowClass(run) {
  return {
    'run-failed': run.status === 'failed',
    'run-running': run.status === 'running'
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString()
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString()
}

onMounted(() => {
  fetchRuns()
})
</script>

<style scoped>
h1 {
  color: var(--color-text);
  margin-bottom: 20px;
}

.filters {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}

.filters select {
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-background-input);
  color: var(--color-text);
}

.refresh-btn {
  padding: 8px 16px;
  background: var(--color-accent);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.refresh-btn:hover {
  background: var(--color-accent-hover);
}

.loading, .error, .empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px;
  color: var(--color-text);
}

.error {
  color: #dc3545;
}

table {
  width: 100%;
  border-collapse: collapse;
  background: var(--color-background-card);
}

th, td {
  border: 1px solid var(--color-border);
  padding: 10px;
  text-align: left;
  color: var(--color-text);
}

thead {
  background-color: var(--color-background-soft);
}

.run-failed {
  background-color: rgba(220, 53, 69, 0.1);
}

.run-running {
  background-color: rgba(255, 193, 7, 0.1);
}

/* Platform, status, and category badges handled by StatusBadge component */

td.passed {
  color: #28a745;
  font-weight: 500;
}

td.failed {
  color: #dc3545;
  font-weight: 500;
}

.view-btn, .delete-btn {
  padding: 4px 10px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  margin-right: 5px;
}

.view-btn {
  background: var(--color-accent);
  color: white;
}

.delete-btn {
  background: #dc3545;
  color: white;
}

.view-btn:hover {
  background: var(--color-accent-hover);
}

.delete-btn:hover {
  background: #c82333;
}

.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 15px;
  margin-top: 20px;
  color: var(--color-text);
}

.pagination button {
  padding: 8px 16px;
  background: var(--color-accent);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.pagination button:disabled {
  background: var(--color-button-secondary);
  cursor: not-allowed;
}

/* Modal styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: var(--color-overlay, rgba(0, 0, 0, 0.5));
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--color-background-card);
  border-radius: 8px;
  max-width: 90%;
  max-height: 90vh;
  overflow-y: auto;
}

.run-detail-modal {
  width: 800px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid var(--color-border);
}

.modal-header h2 {
  margin: 0;
  color: var(--color-text);
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--color-text);
}

.run-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 15px;
  padding: 20px;
  border-bottom: 1px solid var(--color-border);
}

.summary-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text);
}

.summary-item .label {
  font-weight: 500;
  color: var(--color-text-muted, #6c757d);
}

.commit {
  font-family: monospace;
  background: var(--color-background-soft);
  padding: 2px 6px;
  border-radius: 3px;
}

.test-counts {
  display: flex;
  justify-content: space-around;
  padding: 20px;
  border-bottom: 1px solid var(--color-border);
}

.count {
  text-align: center;
}

.count .number {
  display: block;
  font-size: 2em;
  font-weight: bold;
}

.count .label {
  font-size: 0.9em;
  color: var(--color-text-muted, #6c757d);
}

.count.total .number {
  color: var(--color-text);
}

.count.passed .number {
  color: #28a745;
}

.count.failed .number {
  color: #dc3545;
}

.count.skipped .number {
  color: #6c757d;
}

.suites {
  padding: 20px;
}

.suites h3 {
  color: var(--color-text);
  margin-bottom: 15px;
}

.suite {
  margin-bottom: 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
}

.suite-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  cursor: pointer;
  background: var(--color-background-soft);
}

.suite-header:hover {
  background: var(--color-background);
}

/* Status indicators and category badges handled by StatusBadge component */

.no-categories {
  color: var(--color-text-muted, #6c757d);
}

.suite-name {
  font-weight: 500;
  color: var(--color-text);
}

.suite-file {
  color: var(--color-text-muted, #6c757d);
  font-size: 0.85em;
  flex-grow: 1;
}

.suite-stats {
  color: var(--color-text-muted, #6c757d);
  font-size: 0.9em;
}

.expand-icon {
  font-size: 1.2em;
  color: var(--color-text-muted, #6c757d);
}

.suite-cases {
  padding: 10px;
  background: var(--color-background);
}

.test-case {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 4px;
}

.test-case.failed {
  background: rgba(220, 53, 69, 0.1);
}

.case-status .icon {
  display: inline-block;
  width: 20px;
  height: 20px;
  line-height: 20px;
  text-align: center;
  border-radius: 50%;
  font-size: 12px;
}

.icon.passed {
  background: var(--badge-green);
  color: white;
}

.icon.failed {
  background: var(--badge-red);
  color: white;
}

.icon.skipped {
  background: var(--badge-gray);
  color: white;
}

.icon.pending {
  background: var(--badge-yellow);
  color: black;
}

.case-name {
  flex-grow: 1;
  color: var(--color-text);
}

.case-duration {
  color: var(--color-text-muted, #6c757d);
  font-size: 0.85em;
}

.error-details {
  margin-top: 10px;
  padding: 10px;
  background: rgba(220, 53, 69, 0.1);
  border-radius: 4px;
  border-left: 3px solid #dc3545;
}

.error-details strong {
  color: #dc3545;
  display: block;
  margin-bottom: 8px;
}

.error-message, .error-stack {
  font-family: monospace;
  font-size: 0.85em;
  white-space: pre-wrap;
  overflow-x: auto;
  margin: 0;
  padding: 8px;
  background: var(--color-background-soft);
  border-radius: 4px;
  color: var(--color-text);
}

.error-stack {
  margin-top: 8px;
  color: var(--color-text-muted, #6c757d);
}
</style>
