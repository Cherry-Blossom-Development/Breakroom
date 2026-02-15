<script setup>
import { ref, onMounted, computed } from 'vue'
import LoadingSpinner from '../../components/LoadingSpinner.vue'

const isEditing = ref(false)
const isLoading = ref(true)
const isSaving = ref(false)
const error = ref(null)
const successMessage = ref(null)

const profile = ref({
  handle: '',
  firstName: '',
  lastName: '',
  email: '',
  bio: '',
  workBio: '',
  photoPath: null,
  createdAt: null,
  friendCount: 0,
  skills: [],
  jobs: []
})

const editForm = ref({
  firstName: '',
  lastName: '',
  bio: '',
  workBio: ''
})

// Skills management
const skillInput = ref('')
const skillSuggestions = ref([])
const showSuggestions = ref(false)
const isAddingSkill = ref(false)
let skillSearchTimeout = null

// Jobs management
const showJobModal = ref(false)
const editingJob = ref(null)
const isSavingJob = ref(false)
const jobForm = ref({
  title: '',
  company: '',
  location: '',
  startDate: '',
  endDate: '',
  isCurrent: false,
  description: ''
})

// Location management
const locationInput = ref('')
const isSavingLocation = ref(false)
const locationEditing = ref(false)

const photoInput = ref(null)

const photoUrl = computed(() => {
  if (profile.value.photoPath) {
    return `/api/uploads/${profile.value.photoPath}`
  }
  return null
})

const memberSince = computed(() => {
  if (profile.value.createdAt) {
    return new Date(profile.value.createdAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long'
    })
  }
  return ''
})

async function fetchProfile() {
  isLoading.value = true
  error.value = null

  try {
    const res = await fetch('/api/profile', {
      credentials: 'include'
    })

    if (!res.ok) {
      throw new Error('Failed to load profile')
    }

    const data = await res.json()
    profile.value = data.user
  } catch (err) {
    error.value = err.message
  } finally {
    isLoading.value = false
  }
}

function startEdit() {
  editForm.value = {
    firstName: profile.value.firstName || '',
    lastName: profile.value.lastName || '',
    bio: profile.value.bio || '',
    workBio: profile.value.workBio || ''
  }
  isEditing.value = true
  error.value = null
  successMessage.value = null
}

function cancelEdit() {
  isEditing.value = false
  error.value = null
}

async function saveProfile() {
  isSaving.value = true
  error.value = null

  try {
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(editForm.value)
    })

    if (!res.ok) {
      throw new Error('Failed to save profile')
    }

    profile.value.firstName = editForm.value.firstName
    profile.value.lastName = editForm.value.lastName
    profile.value.bio = editForm.value.bio
    profile.value.workBio = editForm.value.workBio
    isEditing.value = false
    successMessage.value = 'Profile updated successfully!'
    setTimeout(() => { successMessage.value = null }, 3000)
  } catch (err) {
    error.value = err.message
  } finally {
    isSaving.value = false
  }
}

function triggerPhotoUpload() {
  photoInput.value?.click()
}

async function onPhotoSelected(event) {
  const file = event.target.files[0]
  if (!file) return

  error.value = null
  const formData = new FormData()
  formData.append('photo', file)

  try {
    const res = await fetch('/api/profile/photo', {
      method: 'POST',
      credentials: 'include',
      body: formData
    })

    if (!res.ok) {
      throw new Error('Failed to upload photo')
    }

    const data = await res.json()
    profile.value.photoPath = data.photoPath
    successMessage.value = 'Photo uploaded successfully!'
    setTimeout(() => { successMessage.value = null }, 3000)
  } catch (err) {
    error.value = err.message
  }

  event.target.value = ''
}

async function deletePhoto() {
  if (!confirm('Are you sure you want to delete your profile photo?')) return

  error.value = null

  try {
    const res = await fetch('/api/profile/photo', {
      method: 'DELETE',
      credentials: 'include'
    })

    if (!res.ok) {
      throw new Error('Failed to delete photo')
    }

    profile.value.photoPath = null
    successMessage.value = 'Photo deleted successfully!'
    setTimeout(() => { successMessage.value = null }, 3000)
  } catch (err) {
    error.value = err.message
  }
}

// Location functions
function startLocationEdit() {
  locationInput.value = profile.value.city || ''
  locationEditing.value = true
}

function cancelLocationEdit() {
  locationEditing.value = false
  locationInput.value = ''
}

async function saveLocation() {
  if (!locationInput.value.trim()) return

  isSavingLocation.value = true
  error.value = null

  try {
    const res = await fetch('/api/profile/location', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ city: locationInput.value.trim() })
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.message || 'Failed to update location')
    }

    const data = await res.json()
    profile.value.city = data.city
    profile.value.latitude = data.latitude
    profile.value.longitude = data.longitude
    locationEditing.value = false
    successMessage.value = 'Location updated successfully!'
    setTimeout(() => { successMessage.value = null }, 3000)
  } catch (err) {
    error.value = err.message
    setTimeout(() => { error.value = null }, 3000)
  } finally {
    isSavingLocation.value = false
  }
}

async function clearLocation() {
  isSavingLocation.value = true
  error.value = null

  try {
    const res = await fetch('/api/profile/location', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ city: '' })
    })

    if (!res.ok) {
      throw new Error('Failed to clear location')
    }

    profile.value.city = null
    profile.value.latitude = null
    profile.value.longitude = null
    locationEditing.value = false
    successMessage.value = 'Location cleared!'
    setTimeout(() => { successMessage.value = null }, 3000)
  } catch (err) {
    error.value = err.message
    setTimeout(() => { error.value = null }, 3000)
  } finally {
    isSavingLocation.value = false
  }
}

// Skills functions
async function searchSkills() {
  if (skillInput.value.trim().length === 0) {
    skillSuggestions.value = []
    showSuggestions.value = false
    return
  }

  try {
    const res = await fetch(`/api/profile/skills/search?q=${encodeURIComponent(skillInput.value)}`, {
      credentials: 'include'
    })

    if (res.ok) {
      const data = await res.json()
      skillSuggestions.value = data.skills
      showSuggestions.value = true
    }
  } catch (err) {
    console.error('Error searching skills:', err)
  }
}

function onSkillInput() {
  if (skillSearchTimeout) {
    clearTimeout(skillSearchTimeout)
  }
  skillSearchTimeout = setTimeout(searchSkills, 300)
}

async function addSkill(skillName = null) {
  const name = skillName || skillInput.value.trim()
  if (!name) return

  // Check if already has this skill
  if (profile.value.skills.some(s => s.name.toLowerCase() === name.toLowerCase())) {
    error.value = 'Skill already added'
    setTimeout(() => { error.value = null }, 2000)
    return
  }

  isAddingSkill.value = true
  error.value = null

  try {
    const res = await fetch('/api/profile/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name })
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.message || 'Failed to add skill')
    }

    const data = await res.json()
    profile.value.skills.push(data.skill)
    skillInput.value = ''
    skillSuggestions.value = []
    showSuggestions.value = false
  } catch (err) {
    error.value = err.message
    setTimeout(() => { error.value = null }, 3000)
  } finally {
    isAddingSkill.value = false
  }
}

function selectSuggestion(skill) {
  addSkill(skill.name)
}

async function removeSkill(skillId) {
  try {
    const res = await fetch(`/api/profile/skills/${skillId}`, {
      method: 'DELETE',
      credentials: 'include'
    })

    if (!res.ok) {
      throw new Error('Failed to remove skill')
    }

    profile.value.skills = profile.value.skills.filter(s => s.id !== skillId)
  } catch (err) {
    error.value = err.message
    setTimeout(() => { error.value = null }, 3000)
  }
}

function hideSuggestions() {
  // Small delay to allow click on suggestion
  setTimeout(() => {
    showSuggestions.value = false
  }, 200)
}

// Jobs functions
function openAddJobModal() {
  editingJob.value = null
  jobForm.value = {
    title: '',
    company: '',
    location: '',
    startDate: '',
    endDate: '',
    isCurrent: false,
    description: ''
  }
  showJobModal.value = true
}

function openEditJobModal(job) {
  editingJob.value = job
  jobForm.value = {
    title: job.title || '',
    company: job.company || '',
    location: job.location || '',
    startDate: job.start_date ? job.start_date.split('T')[0] : '',
    endDate: job.end_date ? job.end_date.split('T')[0] : '',
    isCurrent: job.is_current || false,
    description: job.description || ''
  }
  showJobModal.value = true
}

function closeJobModal() {
  showJobModal.value = false
  editingJob.value = null
}

async function saveJob() {
  if (!jobForm.value.title.trim() || !jobForm.value.company.trim() || !jobForm.value.startDate) {
    error.value = 'Title, company, and start date are required'
    setTimeout(() => { error.value = null }, 3000)
    return
  }

  isSavingJob.value = true
  error.value = null

  try {
    const url = editingJob.value
      ? `/api/profile/jobs/${editingJob.value.id}`
      : '/api/profile/jobs'
    const method = editingJob.value ? 'PUT' : 'POST'

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(jobForm.value)
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.message || 'Failed to save job')
    }

    const data = await res.json()

    if (editingJob.value) {
      // Update existing job
      const index = profile.value.jobs.findIndex(j => j.id === editingJob.value.id)
      if (index !== -1) {
        profile.value.jobs[index] = data.job
      }
    } else {
      // Add new job
      profile.value.jobs.unshift(data.job)
    }

    // Re-sort jobs (current first, then by start date desc)
    profile.value.jobs.sort((a, b) => {
      if (a.is_current && !b.is_current) return -1
      if (!a.is_current && b.is_current) return 1
      return new Date(b.start_date) - new Date(a.start_date)
    })

    closeJobModal()
    successMessage.value = editingJob.value ? 'Job updated successfully!' : 'Job added successfully!'
    setTimeout(() => { successMessage.value = null }, 3000)
  } catch (err) {
    error.value = err.message
    setTimeout(() => { error.value = null }, 3000)
  } finally {
    isSavingJob.value = false
  }
}

async function deleteJob(jobId) {
  if (!confirm('Are you sure you want to remove this job?')) return

  try {
    const res = await fetch(`/api/profile/jobs/${jobId}`, {
      method: 'DELETE',
      credentials: 'include'
    })

    if (!res.ok) {
      throw new Error('Failed to remove job')
    }

    profile.value.jobs = profile.value.jobs.filter(j => j.id !== jobId)
    successMessage.value = 'Job removed successfully!'
    setTimeout(() => { successMessage.value = null }, 3000)
  } catch (err) {
    error.value = err.message
    setTimeout(() => { error.value = null }, 3000)
  }
}

function formatJobDate(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

onMounted(() => {
  fetchProfile()
})
</script>

<template>
  <div class="profile-content">
    <div v-if="isLoading" class="loading"><LoadingSpinner size="small" /> Loading profile...</div>

    <div v-else-if="error && !profile.handle" class="error-box">
      {{ error }}
    </div>

    <template v-else>
      <div class="profile-header">
        <div class="photo-section">
          <div class="photo-container" @click="triggerPhotoUpload">
            <img
              v-if="photoUrl"
              :src="photoUrl"
              alt="Profile photo"
              class="profile-photo"
            />
            <div v-else class="photo-placeholder">
              {{ profile.firstName?.charAt(0) || profile.handle?.charAt(0) || '?' }}
            </div>
            <div class="photo-overlay">
              <span>Change</span>
            </div>
          </div>
          <input
            ref="photoInput"
            type="file"
            accept="image/*"
            @change="onPhotoSelected"
            class="hidden-input"
          />
          <button v-if="photoUrl" @click.stop="deletePhoto" class="delete-photo-btn">
            Remove Photo
          </button>
        </div>

        <div class="user-info">
          <h1>{{ profile.firstName }} {{ profile.lastName }}</h1>
          <p class="handle">@{{ profile.handle }}</p>
          <p class="member-since">Member since {{ memberSince }}</p>
          <p class="friend-count">{{ profile.friendCount }} {{ profile.friendCount === 1 ? 'friend' : 'friends' }}</p>
        </div>
      </div>

      <div v-if="successMessage" class="success-message">{{ successMessage }}</div>
      <div v-if="error" class="error-message">{{ error }}</div>

      <div class="profile-card">
        <template v-if="!isEditing">
          <div class="bio-section">
            <h2>About</h2>
            <p v-if="profile.bio" class="bio-text">{{ profile.bio }}</p>
            <p v-else class="bio-empty">No bio yet. Click edit to add one!</p>
          </div>

          <div class="work-bio-section">
            <h2>Work Biography</h2>
            <p v-if="profile.workBio" class="bio-text">{{ profile.workBio }}</p>
            <p v-else class="bio-empty">No work biography yet. Click edit to add one!</p>
          </div>

          <div class="skills-section">
            <h2>Skills</h2>
            <div class="skills-list" v-if="profile.skills && profile.skills.length > 0">
              <span
                v-for="skill in profile.skills"
                :key="skill.id"
                class="skill-tag"
              >
                {{ skill.name }}
                <button @click="removeSkill(skill.id)" class="remove-skill" title="Remove skill">&times;</button>
              </span>
            </div>
            <p v-else class="bio-empty">No skills added yet.</p>

            <div class="add-skill-form">
              <div class="skill-input-wrapper">
                <input
                  v-model="skillInput"
                  type="text"
                  placeholder="Add a skill..."
                  @input="onSkillInput"
                  @blur="hideSuggestions"
                  @keyup.enter="addSkill()"
                  maxlength="100"
                />
                <div v-if="showSuggestions && skillSuggestions.length > 0" class="suggestions-dropdown">
                  <div
                    v-for="skill in skillSuggestions"
                    :key="skill.id"
                    class="suggestion-item"
                    @mousedown="selectSuggestion(skill)"
                  >
                    {{ skill.name }}
                  </div>
                </div>
              </div>
              <button
                @click="addSkill()"
                :disabled="!skillInput.trim() || isAddingSkill"
                class="add-skill-btn"
              >
                {{ isAddingSkill ? 'Adding...' : 'Add' }}
              </button>
            </div>
          </div>

          <div class="jobs-section">
            <div class="section-header">
              <h2>Work Experience</h2>
              <button @click="openAddJobModal" class="add-job-btn">+ Add Job</button>
            </div>

            <div v-if="profile.jobs && profile.jobs.length > 0" class="jobs-list">
              <div v-for="job in profile.jobs" :key="job.id" class="job-card">
                <div class="job-header">
                  <div class="job-title-company">
                    <h3>{{ job.title }}</h3>
                    <span class="company-name">{{ job.company }}</span>
                  </div>
                  <div class="job-actions">
                    <button @click="openEditJobModal(job)" class="job-action-btn edit" title="Edit">✎</button>
                    <button @click="deleteJob(job.id)" class="job-action-btn delete" title="Delete">&times;</button>
                  </div>
                </div>
                <div class="job-meta">
                  <span class="job-dates">
                    {{ formatJobDate(job.start_date) }} - {{ job.is_current ? 'Present' : formatJobDate(job.end_date) }}
                  </span>
                  <span v-if="job.location" class="job-location">{{ job.location }}</span>
                </div>
                <p v-if="job.description" class="job-description">{{ job.description }}</p>
              </div>
            </div>
            <p v-else class="bio-empty">No work experience added yet. Click "Add Job" to get started!</p>
          </div>

          <div class="location-section">
            <h2>Location</h2>
            <template v-if="!locationEditing">
              <div v-if="profile.city" class="location-display">
                <span class="location-city">{{ profile.city }}</span>
                <div class="location-actions">
                  <button @click="startLocationEdit" class="location-edit-btn">Change</button>
                  <button @click="clearLocation" :disabled="isSavingLocation" class="location-clear-btn">Clear</button>
                </div>
              </div>
              <div v-else class="location-empty">
                <p class="bio-empty">No location set. Your location is used by the weather widget.</p>
                <button @click="startLocationEdit" class="location-set-btn">Set Location</button>
              </div>
            </template>
            <div v-else class="location-edit-form">
              <div class="location-input-row">
                <input
                  v-model="locationInput"
                  type="text"
                  placeholder="Enter a city (e.g., Denver, CO)"
                  @keyup.enter="saveLocation"
                  maxlength="128"
                />
                <button
                  @click="saveLocation"
                  :disabled="!locationInput.trim() || isSavingLocation"
                  class="save-btn"
                >
                  {{ isSavingLocation ? 'Saving...' : 'Save' }}
                </button>
                <button @click="cancelLocationEdit" class="cancel-btn">Cancel</button>
              </div>
              <p class="location-hint">Enter a city name. It will be geocoded automatically for the weather widget.</p>
            </div>
          </div>

          <div class="details-section">
            <h2>Details</h2>
            <div class="detail-row">
              <span class="label">Email:</span>
              <span class="value">{{ profile.email }}</span>
            </div>
            <div class="detail-row">
              <span class="label">First Name:</span>
              <span class="value">{{ profile.firstName || 'Not set' }}</span>
            </div>
            <div class="detail-row">
              <span class="label">Last Name:</span>
              <span class="value">{{ profile.lastName || 'Not set' }}</span>
            </div>
          </div>

          <button @click="startEdit" class="edit-btn">Edit Profile</button>
        </template>

        <template v-else>
          <form @submit.prevent="saveProfile" class="edit-form">
            <div class="form-group">
              <label for="firstName">First Name</label>
              <input
                id="firstName"
                v-model="editForm.firstName"
                type="text"
                placeholder="Enter your first name"
              />
            </div>

            <div class="form-group">
              <label for="lastName">Last Name</label>
              <input
                id="lastName"
                v-model="editForm.lastName"
                type="text"
                placeholder="Enter your last name"
              />
            </div>

            <div class="form-group">
              <label for="bio">Bio</label>
              <textarea
                id="bio"
                v-model="editForm.bio"
                placeholder="Tell us about yourself..."
                rows="4"
                maxlength="500"
              ></textarea>
              <span class="char-count">{{ editForm.bio?.length || 0 }}/500</span>
            </div>

            <div class="form-group">
              <label for="workBio">Work Biography</label>
              <textarea
                id="workBio"
                v-model="editForm.workBio"
                placeholder="Describe your professional background, experience, and career journey..."
                rows="4"
                maxlength="1000"
              ></textarea>
              <span class="char-count">{{ editForm.workBio?.length || 0 }}/1000</span>
            </div>

            <div class="form-actions">
              <button type="submit" :disabled="isSaving" class="save-btn">
                {{ isSaving ? 'Saving...' : 'Save Changes' }}
              </button>
              <button type="button" @click="cancelEdit" class="cancel-btn">
                Cancel
              </button>
            </div>
          </form>
        </template>
      </div>
    </template>

    <!-- Job Modal -->
    <div v-if="showJobModal" class="modal-overlay" @click.self="closeJobModal">
      <div class="modal-content job-modal">
        <div class="modal-header">
          <h2>{{ editingJob ? 'Edit Job' : 'Add Job' }}</h2>
          <button @click="closeJobModal" class="modal-close">&times;</button>
        </div>

        <form @submit.prevent="saveJob" class="job-form">
          <div class="form-group">
            <label for="jobTitle">Job Title *</label>
            <input
              id="jobTitle"
              v-model="jobForm.title"
              type="text"
              placeholder="e.g., Software Engineer"
              maxlength="150"
              required
            />
          </div>

          <div class="form-group">
            <label for="jobCompany">Company *</label>
            <input
              id="jobCompany"
              v-model="jobForm.company"
              type="text"
              placeholder="e.g., Acme Inc."
              maxlength="150"
              required
            />
          </div>

          <div class="form-group">
            <label for="jobLocation">Location</label>
            <input
              id="jobLocation"
              v-model="jobForm.location"
              type="text"
              placeholder="e.g., San Francisco, CA"
              maxlength="150"
            />
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="jobStartDate">Start Date *</label>
              <input
                id="jobStartDate"
                v-model="jobForm.startDate"
                type="date"
                required
              />
            </div>

            <div class="form-group">
              <label for="jobEndDate">End Date</label>
              <input
                id="jobEndDate"
                v-model="jobForm.endDate"
                type="date"
                :disabled="jobForm.isCurrent"
              />
            </div>
          </div>

          <div class="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                v-model="jobForm.isCurrent"
                @change="jobForm.isCurrent && (jobForm.endDate = '')"
              />
              I currently work here
            </label>
          </div>

          <div class="form-group">
            <label for="jobDescription">Description</label>
            <textarea
              id="jobDescription"
              v-model="jobForm.description"
              placeholder="Describe your responsibilities and achievements..."
              rows="4"
            ></textarea>
          </div>

          <div class="form-actions">
            <button type="submit" :disabled="isSavingJob" class="save-btn">
              {{ isSavingJob ? 'Saving...' : (editingJob ? 'Update Job' : 'Add Job') }}
            </button>
            <button type="button" @click="closeJobModal" class="cancel-btn">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-content {
  max-width: 700px;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px;
  color: #666;
}

.error-box {
  background: #ffe0e0;
  color: #c00;
  padding: 20px;
  border-radius: 8px;
  text-align: center;
}

.profile-header {
  display: flex;
  gap: 25px;
  align-items: flex-start;
  margin-bottom: 25px;
}

.photo-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.photo-container {
  position: relative;
  width: 100px;
  height: 100px;
  border-radius: 50%;
  overflow: hidden;
  cursor: pointer;
  border: 3px solid #42b983;
}

.profile-photo {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.photo-placeholder {
  width: 100%;
  height: 100%;
  background: #42b983;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  font-weight: bold;
  text-transform: uppercase;
}

.photo-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
  font-size: 0.9rem;
}

.photo-container:hover .photo-overlay {
  opacity: 1;
}

.hidden-input {
  display: none;
}

.delete-photo-btn {
  background: none;
  border: none;
  color: #c00;
  cursor: pointer;
  font-size: 0.8em;
  text-decoration: underline;
}

.user-info h1 {
  margin: 0 0 5px 0;
  font-size: 1.5rem;
  color: #333;
}

.handle {
  color: #42b983;
  font-size: 1rem;
  margin: 0 0 8px 0;
}

.member-since {
  color: #888;
  font-size: 0.85rem;
  margin: 0 0 5px 0;
}

.friend-count {
  color: #666;
  font-size: 0.9rem;
  margin: 0;
  font-weight: 500;
}

.success-message {
  background: #d4edda;
  color: #155724;
  padding: 10px 15px;
  border-radius: 6px;
  margin-bottom: 15px;
}

.error-message {
  background: #ffe0e0;
  color: #c00;
  padding: 10px 15px;
  border-radius: 6px;
  margin-bottom: 15px;
}

.profile-card {
  padding-top: 10px;
}

.bio-section,
.work-bio-section,
.skills-section,
.location-section,
.details-section {
  margin-bottom: 20px;
}

.bio-section h2,
.work-bio-section h2,
.skills-section h2,
.location-section h2,
.details-section h2 {
  font-size: 1.1rem;
  color: #333;
  margin: 0 0 12px 0;
  padding-bottom: 8px;
  border-bottom: 1px solid #eee;
}

.bio-text {
  color: #555;
  line-height: 1.5;
  white-space: pre-wrap;
  margin: 0;
}

.bio-empty {
  color: #999;
  font-style: italic;
  margin: 0;
}

.detail-row {
  display: flex;
  padding: 6px 0;
  border-bottom: 1px solid #f5f5f5;
}

.detail-row:last-child {
  border-bottom: none;
}

.label {
  font-weight: 600;
  color: #666;
  width: 100px;
  flex-shrink: 0;
}

.value {
  color: #333;
}

.edit-btn {
  background: #42b983;
  color: white;
  border: none;
  padding: 10px 25px;
  border-radius: 6px;
  font-size: 0.95rem;
  cursor: pointer;
}

.edit-btn:hover {
  background: #3aa876;
}

.edit-form {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.form-group label {
  font-weight: 600;
  color: #555;
  font-size: 0.9rem;
}

.form-group input,
.form-group textarea {
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 0.95rem;
  font-family: inherit;
}

.form-group input:focus,
.form-group textarea:focus {
  outline: none;
  border-color: #42b983;
}

.form-group textarea {
  resize: vertical;
  min-height: 80px;
}

.char-count {
  font-size: 0.75rem;
  color: #888;
  text-align: right;
}

.form-actions {
  display: flex;
  gap: 10px;
  margin-top: 5px;
}

.save-btn {
  background: #42b983;
  color: white;
  border: none;
  padding: 10px 25px;
  border-radius: 6px;
  font-size: 0.95rem;
  cursor: pointer;
}

.save-btn:hover:not(:disabled) {
  background: #3aa876;
}

.save-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.cancel-btn {
  background: #eee;
  color: #666;
  border: none;
  padding: 10px 25px;
  border-radius: 6px;
  font-size: 0.95rem;
  cursor: pointer;
}

.cancel-btn:hover {
  background: #ddd;
}

/* Location styles */
.location-display {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.location-city {
  color: #555;
  font-size: 0.95rem;
}

.location-actions {
  display: flex;
  gap: 8px;
}

.location-edit-btn,
.location-set-btn {
  background: none;
  border: 1px solid #42b983;
  color: #42b983;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
}

.location-edit-btn:hover,
.location-set-btn:hover {
  background: #42b983;
  color: white;
}

.location-clear-btn {
  background: none;
  border: 1px solid #ccc;
  color: #888;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
}

.location-clear-btn:hover {
  border-color: #c00;
  color: #c00;
}

.location-clear-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.location-empty {
  display: flex;
  align-items: center;
  gap: 12px;
}

.location-empty .bio-empty {
  flex: 1;
}

.location-edit-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.location-input-row {
  display: flex;
  gap: 10px;
}

.location-input-row input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 0.9rem;
}

.location-input-row input:focus {
  outline: none;
  border-color: #42b983;
}

.location-input-row .save-btn,
.location-input-row .cancel-btn {
  padding: 8px 16px;
  font-size: 0.85rem;
}

.location-hint {
  font-size: 0.8rem;
  color: #888;
  margin: 0;
}

/* Skills styles */
.skills-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 15px;
}

.skill-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--badge-green-soft);
  color: var(--badge-green-text);
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 0.9rem;
  font-weight: 500;
}

.remove-skill {
  background: none;
  border: none;
  color: var(--badge-green-text);
  font-size: 1.1rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  opacity: 0.6;
}

.remove-skill:hover {
  opacity: 1;
  color: #c00;
}

.add-skill-form {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}

.skill-input-wrapper {
  position: relative;
  flex: 1;
}

.skill-input-wrapper input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 0.9rem;
  box-sizing: border-box;
}

.skill-input-wrapper input:focus {
  outline: none;
  border-color: #42b983;
}

.suggestions-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: white;
  border: 1px solid #ddd;
  border-top: none;
  border-radius: 0 0 6px 6px;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
  z-index: 10;
  max-height: 200px;
  overflow-y: auto;
}

.suggestion-item {
  padding: 10px 12px;
  cursor: pointer;
  font-size: 0.9rem;
}

.suggestion-item:hover {
  background: #f5f5f5;
}

.add-skill-btn {
  background: #42b983;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
  white-space: nowrap;
}

.add-skill-btn:hover:not(:disabled) {
  background: #3aa876;
}

.add-skill-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

/* Jobs styles */
.jobs-section {
  margin-bottom: 20px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 8px;
  border-bottom: 1px solid #eee;
  margin-bottom: 15px;
}

.section-header h2 {
  font-size: 1.1rem;
  color: #333;
  margin: 0;
}

.add-job-btn {
  background: #42b983;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
}

.add-job-btn:hover {
  background: #3aa876;
}

.jobs-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.job-card {
  background: #f9f9f9;
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 15px;
}

.job-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.job-title-company h3 {
  margin: 0 0 4px 0;
  font-size: 1rem;
  color: #333;
}

.company-name {
  color: #42b983;
  font-weight: 500;
  font-size: 0.95rem;
}

.job-actions {
  display: flex;
  gap: 5px;
}

.job-action-btn {
  background: none;
  border: 1px solid #ddd;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.job-action-btn.edit:hover {
  background: #e8f5e9;
  border-color: #42b983;
  color: #42b983;
}

.job-action-btn.delete:hover {
  background: #ffe0e0;
  border-color: #c00;
  color: #c00;
}

.job-meta {
  display: flex;
  gap: 15px;
  font-size: 0.85rem;
  color: #666;
  margin-bottom: 8px;
}

.job-dates {
  font-weight: 500;
}

.job-location {
  color: #888;
}

.job-location::before {
  content: '📍 ';
}

.job-description {
  margin: 0;
  font-size: 0.9rem;
  color: #555;
  line-height: 1.5;
  white-space: pre-wrap;
}

/* Modal styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  border-radius: 12px;
  width: 90%;
  max-width: 500px;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 20px;
  border-bottom: 1px solid #eee;
}

.modal-header h2 {
  margin: 0;
  font-size: 1.2rem;
  color: #333;
}

.modal-close {
  background: none;
  border: none;
  font-size: 1.5rem;
  color: #666;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.modal-close:hover {
  color: #333;
}

.job-form {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.form-row {
  display: flex;
  gap: 15px;
}

.form-row .form-group {
  flex: 1;
}

.checkbox-group label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-weight: normal;
}

.checkbox-group input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}
</style>
