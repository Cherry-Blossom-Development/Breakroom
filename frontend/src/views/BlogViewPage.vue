<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authFetch } from '../utilities/authFetch'
import BlogComments from '../components/BlogComments.vue'
import LoadingSpinner from '../components/LoadingSpinner.vue'

const route = useRoute()
const router = useRouter()

const post = ref(null)
const loading = ref(true)
const error = ref(null)

const authorPhotoUrl = computed(() => {
  if (post.value?.author_photo) {
    return `/api/uploads/${post.value.author_photo}`
  }
  return null
})

const authorName = computed(() => {
  if (!post.value) return ''
  if (post.value.author_first_name || post.value.author_last_name) {
    return `${post.value.author_first_name || ''} ${post.value.author_last_name || ''}`.trim()
  }
  return post.value.author_handle
})

const formattedDate = computed(() => {
  if (!post.value?.updated_at) return ''
  return new Date(post.value.updated_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
})

async function fetchPost() {
  loading.value = true
  error.value = null

  try {
    const res = await authFetch(`/api/blog/view/${route.params.id}`)

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error('Blog post not found')
      }
      throw new Error('Failed to load blog post')
    }

    const data = await res.json()
    post.value = data.post
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

function goToAuthorProfile() {
  router.push(`/user/${post.value.author_handle}`)
}

function goBack() {
  router.back()
}

onMounted(() => {
  fetchPost()
})
</script>

<template>
  <div class="page-container blog-view-page">
    <div v-if="loading" class="loading"><LoadingSpinner size="small" /> Loading blog post...</div>

    <div v-else-if="error" class="error-box">
      <p>{{ error }}</p>
      <button @click="goBack" class="back-btn">Go Back</button>
    </div>

    <template v-else-if="post">
      <!-- Author header -->
      <div class="author-header" @click="goToAuthorProfile">
        <div class="author-photo-container">
          <img
            v-if="authorPhotoUrl"
            :src="authorPhotoUrl"
            alt="Author photo"
            class="author-photo"
          />
          <div v-else class="author-photo-placeholder">
            {{ post.author_first_name?.charAt(0) || post.author_handle?.charAt(0) || '?' }}
          </div>
        </div>
        <div class="author-info">
          <span class="author-name">{{ authorName }}</span>
          <span class="author-handle">@{{ post.author_handle }}</span>
        </div>
        <span class="view-profile-link">View Profile</span>
      </div>

      <!-- Post content -->
      <article class="blog-post">
        <h1 class="post-title">{{ post.title }}</h1>
        <div class="post-meta">
          <span class="post-date">{{ formattedDate }}</span>
        </div>
        <div class="post-content" v-html="post.content"></div>
      </article>

      <!-- Comments section -->
      <BlogComments :postId="post.id" />

      <button @click="goBack" class="back-btn">Back</button>
    </template>
  </div>
</template>

<style scoped>
.blog-view-page {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
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

.error-box p {
  margin: 0 0 15px;
}

.author-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 15px;
  background: var(--color-background-soft);
  border-radius: var(--card-radius);
  margin-bottom: 25px;
  cursor: pointer;
  transition: background 0.2s;
}

.author-header:hover {
  background: var(--color-background-hover);
}

.author-photo-container {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
}

.author-photo {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.author-photo-placeholder {
  width: 100%;
  height: 100%;
  background: var(--color-accent);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: bold;
  text-transform: uppercase;
}

.author-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.author-name {
  font-weight: 600;
  color: var(--color-text);
  font-size: 1rem;
}

.author-handle {
  color: var(--color-accent);
  font-size: 0.85rem;
}

.view-profile-link {
  color: var(--color-accent);
  font-size: 0.85rem;
  font-weight: 500;
}

.blog-post {
  background: var(--color-background-card);
  border-radius: var(--card-radius);
  padding: 25px;
  box-shadow: var(--shadow-sm);
  margin-bottom: 20px;
}

.post-title {
  margin: 0 0 10px;
  font-size: 1.8rem;
  color: var(--color-text);
  line-height: 1.3;
}

.post-meta {
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid var(--color-border);
}

.post-date {
  color: var(--color-text-light);
  font-size: 0.9rem;
}

.post-content {
  color: var(--color-text);
  line-height: 1.7;
  font-size: 1.05rem;
}

.post-content :deep(p) {
  margin: 0 0 1em;
}

.post-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  margin: 1em 0;
}

.post-content :deep(a) {
  color: var(--color-accent);
}

.post-content :deep(blockquote) {
  border-left: 3px solid var(--color-accent);
  margin: 1em 0;
  padding-left: 1em;
  color: var(--color-text-muted);
}

.post-content :deep(pre) {
  background: var(--color-background-soft);
  padding: 1em;
  border-radius: 4px;
  overflow-x: auto;
}

.post-content :deep(code) {
  background: var(--color-background-soft);
  padding: 0.2em 0.4em;
  border-radius: 3px;
  font-size: 0.9em;
}

.post-content :deep(ul),
.post-content :deep(ol) {
  margin: 0 0 1em;
  padding-left: 1.5em;
}

.back-btn {
  background: var(--color-button-secondary);
  color: var(--color-text-muted);
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
}

.back-btn:hover {
  background: var(--color-button-secondary-hover);
}
</style>
