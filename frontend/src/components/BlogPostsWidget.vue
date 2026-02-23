<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { authFetch } from '../utilities/authFetch'
import LoadingSpinner from './LoadingSpinner.vue'

const router = useRouter()
const posts = ref([])
const loading = ref(true)
const error = ref(null)

const fetchPosts = async () => {
  loading.value = true
  error.value = null

  try {
    const response = await authFetch('/api/blog/feed')

    if (!response.ok) {
      throw new Error('Failed to fetch posts')
    }

    const data = await response.json()
    posts.value = data.posts || []
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

const formatDate = (dateStr) => {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()

  // Compare calendar days, not time difference
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.round((nowDay - dateDay) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return 'Today'
  } else if (diffDays === 1) {
    return 'Yesterday'
  } else if (diffDays < 7) {
    return `${diffDays}d ago`
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
}

const viewPost = (postId) => {
  router.push(`/blog/view/${postId}`)
}

const goToBlog = () => {
  router.push('/blog')
}

const stripHtml = (html) => {
  if (!html) return ''
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  return tmp.textContent || tmp.innerText || ''
}

const getFirstImage = (html) => {
  if (!html) return null
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  const img = tmp.querySelector('img')
  return img ? img.src : null
}

const getAuthorName = (post) => {
  if (post.author_first_name || post.author_last_name) {
    return `${post.author_first_name || ''} ${post.author_last_name || ''}`.trim()
  }
  return post.author_handle
}

onMounted(() => {
  fetchPosts()
})
</script>

<template>
  <div class="blog-posts-widget">
    <!-- Loading state -->
    <div v-if="loading" class="loading-state">
      <LoadingSpinner size="small" />
      <span>Loading posts...</span>
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="error-state">
      <span class="error-icon">!</span>
      <p>{{ error }}</p>
      <button @click="fetchPosts">Retry</button>
    </div>

    <!-- Posts list -->
    <div v-else-if="posts.length > 0" class="posts-list">
      <div
        v-for="post in posts.slice(0, 5)"
        :key="post.id"
        class="post-item"
        :class="{ 'has-image': getFirstImage(post.content) }"
        @click="viewPost(post.id)"
      >
        <img
          v-if="getFirstImage(post.content)"
          :src="getFirstImage(post.content)"
          class="post-image"
          alt=""
        />
        <div class="post-content">
          <div class="post-header">
            <span class="post-author">{{ getAuthorName(post) }}</span>
            <span class="post-date">{{ formatDate(post.updated_at) }}</span>
          </div>
          <h3 class="post-title">{{ post.title }}</h3>
          <p class="post-preview">{{ stripHtml(post.content) }}</p>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="empty-state">
      <p>No blog posts yet</p>
      <button @click="goToBlog" class="create-btn">Create your first post</button>
    </div>
  </div>
</template>

<style scoped>
.blog-posts-widget {
  overflow-y: auto;
  background: var(--color-background-soft);
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 80px;
  padding: 20px;
  color: var(--color-text-light);
  gap: 12px;
}

.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 80px;
  padding: 20px;
  text-align: center;
  color: var(--color-error);
}

.error-icon {
  width: 32px;
  height: 32px;
  background: var(--color-error-bg);
  color: var(--color-error);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  margin-bottom: 8px;
}

.error-state button {
  margin-top: 12px;
  padding: 6px 16px;
  background: var(--color-accent);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.error-state button:hover {
  background: var(--color-accent-hover);
}

.posts-list {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
  overflow-y: auto;
}

.post-item {
  background: var(--color-background-card);
  border-radius: var(--card-radius-sm);
  padding: var(--card-padding-compact);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: box-shadow 0.2s, transform 0.1s;
  border-left: 3px solid var(--color-accent);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.post-item.has-image {
  flex-direction: row;
  gap: 10px;
}

.post-image {
  width: 60px;
  height: 60px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}

.post-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.post-item:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

.post-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
  flex-shrink: 0;
}

.post-author {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-accent);
}

.post-date {
  font-size: 0.7rem;
  color: var(--color-text-light);
}

.post-title {
  margin: 0 0 6px 0;
  font-size: 0.85rem;
  font-weight: 600;
  line-height: 1.3;
  color: var(--color-text);
  flex-shrink: 0;
}

.post-preview {
  margin: 0;
  font-size: 0.75rem;
  color: var(--color-text-muted);
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 80px;
  color: var(--color-text-light);
  text-align: center;
  padding: 20px;
}

.empty-state p {
  margin: 0 0 12px;
}

.create-btn {
  padding: 8px 16px;
  background: var(--color-accent);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
}

.create-btn:hover {
  background: var(--color-accent-hover);
}
</style>
