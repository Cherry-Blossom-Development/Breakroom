<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const isLoading = ref(true)
const error = ref(null)

const profile = ref({
  handle: '',
  firstName: '',
  lastName: '',
  bio: '',
  workBio: '',
  photoPath: null,
  createdAt: null,
  friendCount: 0,
  skills: [],
  jobs: []
})

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

const displayName = computed(() => {
  if (profile.value.firstName || profile.value.lastName) {
    return `${profile.value.firstName || ''} ${profile.value.lastName || ''}`.trim()
  }
  return profile.value.handle
})

function formatJobDate(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

async function fetchProfile() {
  isLoading.value = true
  error.value = null

  try {
    const handle = route.params.handle
    const res = await fetch(`/api/profile/user/${handle}`, {
      credentials: 'include'
    })

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error('User not found')
      }
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

watch(() => route.params.handle, () => {
  fetchProfile()
})

onMounted(() => {
  fetchProfile()
})
</script>

<template>
  <div class="page-container public-profile-page">
    <div v-if="isLoading" class="loading">Loading profile...</div>

    <div v-else-if="error" class="error-box">
      {{ error }}
    </div>

    <template v-else>
      <div class="profile-header">
        <div class="photo-section">
          <div class="photo-container">
            <img
              v-if="photoUrl"
              :src="photoUrl"
              alt="Profile photo"
              class="profile-photo"
            />
            <div v-else class="photo-placeholder">
              {{ profile.firstName?.charAt(0) || profile.handle?.charAt(0) || '?' }}
            </div>
          </div>
        </div>

        <div class="user-info">
          <h1>{{ displayName }}</h1>
          <p class="handle">@{{ profile.handle }}</p>
          <p class="member-since">Member since {{ memberSince }}</p>
          <p class="friend-count">{{ profile.friendCount }} {{ profile.friendCount === 1 ? 'friend' : 'friends' }}</p>
        </div>
      </div>

      <div class="profile-card">
        <div class="bio-section">
          <h2>About</h2>
          <p v-if="profile.bio" class="bio-text">{{ profile.bio }}</p>
          <p v-else class="bio-empty">This user hasn't added a bio yet.</p>
        </div>

        <div class="work-bio-section">
          <h2>Work Biography</h2>
          <p v-if="profile.workBio" class="bio-text">{{ profile.workBio }}</p>
          <p v-else class="empty-state-text">No work biography added yet.</p>
        </div>

        <div class="skills-section">
          <h2>Skills</h2>
          <div v-if="profile.skills && profile.skills.length > 0" class="skills-list">
            <span
              v-for="skill in profile.skills"
              :key="skill.id"
              class="skill-tag"
            >
              {{ skill.name }}
            </span>
          </div>
          <p v-else class="empty-state-text">No skills listed yet.</p>
        </div>

        <div class="jobs-section">
          <h2>Work Experience</h2>
          <div v-if="profile.jobs && profile.jobs.length > 0" class="jobs-list">
            <div v-for="job in profile.jobs" :key="job.id" class="job-card">
              <div class="job-header">
                <h3>{{ job.title }}</h3>
                <span class="company-name">{{ job.company }}</span>
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
          <p v-else class="empty-state-text">No work experience listed yet.</p>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.public-profile-page {
  max-width: 700px;
  margin: 0 auto;
  padding: 20px;
}

.loading {
  text-align: center;
  padding: 40px;
  color: var(--color-text-muted);
}

.error-box {
  background: var(--color-error-bg);
  color: var(--color-error);
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
  border: 3px solid var(--color-accent);
}

.profile-photo {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.photo-placeholder {
  width: 100%;
  height: 100%;
  background: var(--color-accent);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  font-weight: bold;
  text-transform: uppercase;
}

.user-info h1 {
  margin: 0 0 5px 0;
  font-size: 1.5rem;
  color: var(--color-text);
}

.handle {
  color: var(--color-accent);
  font-size: 1rem;
  margin: 0 0 8px 0;
}

.member-since {
  color: var(--color-text-light);
  font-size: 0.85rem;
  margin: 0 0 5px 0;
}

.friend-count {
  color: var(--color-text-muted);
  font-size: 0.9rem;
  margin: 0;
  font-weight: 500;
}

.profile-card {
  background: var(--color-background-soft);
  border-radius: var(--card-radius);
  padding: 20px;
}

.bio-section,
.work-bio-section,
.skills-section,
.jobs-section {
  margin-bottom: 20px;
}

.bio-section:last-child,
.work-bio-section:last-child,
.skills-section:last-child,
.jobs-section:last-child {
  margin-bottom: 0;
}

.bio-section h2,
.work-bio-section h2,
.skills-section h2,
.jobs-section h2 {
  font-size: 1.1rem;
  color: var(--color-text);
  margin: 0 0 12px 0;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border);
}

.bio-text {
  color: var(--color-text-secondary);
  line-height: 1.5;
  white-space: pre-wrap;
  margin: 0;
}

.bio-empty,
.empty-state-text {
  color: var(--color-text-light);
  font-style: italic;
  margin: 0;
}

.skills-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.skill-tag {
  display: inline-block;
  background: var(--badge-green-soft);
  color: var(--badge-green-text);
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 0.9rem;
  font-weight: 500;
}

/* Jobs styles */
.jobs-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.job-card {
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: var(--card-radius);
  padding: 15px;
}

.job-header h3 {
  margin: 0 0 4px 0;
  font-size: 1rem;
  color: var(--color-text);
}

.company-name {
  color: var(--color-accent);
  font-weight: 500;
  font-size: 0.95rem;
}

.job-meta {
  display: flex;
  gap: 15px;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  margin: 8px 0;
}

.job-dates {
  font-weight: 500;
}

.job-location {
  color: var(--color-text-light);
}

.job-location::before {
  content: '📍 ';
}

.job-description {
  margin: 0;
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
  white-space: pre-wrap;
}
</style>
