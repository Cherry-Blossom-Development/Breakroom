<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { user } from '@/stores/user.js'
import { authFetch } from '@/utilities/authFetch'

const props = defineProps({
  sessionId: {
    type: Number,
    required: true
  }
})

const commentsList = ref([])
const loading = ref(true)
const submitting = ref(false)
const error = ref('')

const newComment = ref('')
const replyingTo = ref(null)
const replyContent = ref('')

const isAuthenticated = computed(() => !!user.username)
const commentCount = computed(() => {
  let count = 0
  const countRecursive = (items) => {
    for (const item of items) {
      count++
      if (item.replies) countRecursive(item.replies)
    }
  }
  countRecursive(commentsList.value)
  return count
})

async function fetchComments() {
  loading.value = true
  try {
    const res = await authFetch(`/api/sessions/${props.sessionId}/comments`)
    if (res.ok) {
      const data = await res.json()
      commentsList.value = data.comments
    }
  } catch (err) {
    console.error('Failed to load comments:', err)
  } finally {
    loading.value = false
  }
}

async function postComment(content, parentId) {
  if (!content.trim()) return
  submitting.value = true
  error.value = ''
  try {
    const res = await authFetch(`/api/sessions/${props.sessionId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.trim(), parent_id: parentId || null })
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.message || 'Failed to post comment')
    }
    await fetchComments()
  } catch (err) {
    error.value = err.message
    throw err
  } finally {
    submitting.value = false
  }
}

async function submitComment() {
  try {
    await postComment(newComment.value)
    newComment.value = ''
  } catch (err) {
    // error already surfaced via `error` ref
  }
}

function startReply(commentId) {
  replyingTo.value = commentId
  replyContent.value = ''
}

function cancelReply() {
  replyingTo.value = null
  replyContent.value = ''
}

async function submitReply() {
  if (!replyingTo.value) return
  try {
    await postComment(replyContent.value, replyingTo.value)
    replyContent.value = ''
    replyingTo.value = null
  } catch (err) {
    // error already surfaced via `error` ref
  }
}

async function deleteComment(commentId) {
  if (!confirm('Delete this comment?')) return
  try {
    const res = await authFetch(`/api/sessions/comments/${commentId}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete comment')
    await fetchComments()
  } catch (err) {
    error.value = err.message
  }
}

function formatDate(dateStr) {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  })
}

function getAuthorDisplayName(author) {
  if (author?.firstName || author?.lastName) {
    return `${author.firstName || ''} ${author.lastName || ''}`.trim()
  }
  return author?.handle || 'Unknown'
}

function getAuthorInitial(author) {
  if (author?.firstName) return author.firstName.charAt(0).toUpperCase()
  if (author?.handle) return author.handle.charAt(0).toUpperCase()
  return '?'
}

function isOwnComment(comment) {
  return user.username && comment.author?.handle === user.username
}

onMounted(fetchComments)

watch(() => props.sessionId, (newId, oldId) => {
  if (newId !== oldId) fetchComments()
})
</script>

<template>
  <div class="session-comments">
    <h4 class="comments-header">
      Discussion <span v-if="commentCount > 0">({{ commentCount }})</span>
    </h4>

    <div v-if="isAuthenticated" class="add-comment-form">
      <textarea
        v-model="newComment"
        placeholder="Write a comment..."
        rows="2"
        :disabled="submitting"
      ></textarea>
      <button
        @click="submitComment"
        :disabled="!newComment.trim() || submitting"
        class="submit-btn"
      >
        {{ submitting ? 'Posting…' : 'Post Comment' }}
      </button>
    </div>

    <div v-if="error" class="error-message">
      {{ error }}
      <button @click="error = ''" class="dismiss-btn">Dismiss</button>
    </div>

    <div v-if="loading" class="loading">Loading discussion…</div>

    <div v-else-if="commentsList.length > 0" class="comments-list">
      <div v-for="comment in commentsList" :key="comment.id" class="comment-thread">
        <div class="comment">
          <div class="comment-avatar">
            <div class="avatar-placeholder">{{ getAuthorInitial(comment.author) }}</div>
          </div>
          <div class="comment-body">
            <div class="comment-header">
              <span class="author-name">{{ getAuthorDisplayName(comment.author) }}</span>
              <span class="comment-date">{{ formatDate(comment.createdAt) }}</span>
            </div>
            <p class="comment-content">{{ comment.content }}</p>
            <div class="comment-actions">
              <button v-if="isAuthenticated" @click="startReply(comment.id)" class="action-btn">Reply</button>
              <button v-if="isOwnComment(comment)" @click="deleteComment(comment.id)" class="action-btn delete-btn">Delete</button>
            </div>

            <div v-if="replyingTo === comment.id" class="reply-form">
              <textarea v-model="replyContent" placeholder="Write a reply…" rows="2"></textarea>
              <div class="reply-actions">
                <button @click="submitReply" :disabled="!replyContent.trim() || submitting" class="submit-btn">Reply</button>
                <button @click="cancelReply" class="cancel-btn">Cancel</button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="comment.replies && comment.replies.length > 0" class="replies">
          <div v-for="reply in comment.replies" :key="reply.id" class="comment reply">
            <div class="comment-avatar">
              <div class="avatar-placeholder">{{ getAuthorInitial(reply.author) }}</div>
            </div>
            <div class="comment-body">
              <div class="comment-header">
                <span class="author-name">{{ getAuthorDisplayName(reply.author) }}</span>
                <span class="comment-date">{{ formatDate(reply.createdAt) }}</span>
              </div>
              <p class="comment-content">{{ reply.content }}</p>
              <div class="comment-actions">
                <button v-if="isOwnComment(reply)" @click="deleteComment(reply.id)" class="action-btn delete-btn">Delete</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="no-comments">No comments yet. Start the discussion.</div>
  </div>
</template>

<style scoped>
.session-comments { padding: 16px 0; }

.comments-header { margin: 0 0 14px; font-size: 1rem; color: var(--color-text); }
.comments-header span { color: var(--color-text-muted); font-weight: normal; }

.add-comment-form { margin-bottom: 18px; }

.add-comment-form textarea,
.reply-form textarea {
  width: 100%;
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  resize: vertical;
  font-family: inherit;
  font-size: 0.88rem;
  box-sizing: border-box;
  background: var(--color-background);
  color: var(--color-text);
}

.add-comment-form textarea:focus,
.reply-form textarea:focus {
  outline: none;
  border-color: var(--color-link);
}

.submit-btn {
  margin-top: 8px;
  padding: 8px 16px;
  background: var(--color-link);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.submit-btn:hover:not(:disabled) { opacity: 0.88; }
.submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.error-message {
  background: rgba(229, 57, 53, 0.08);
  color: var(--color-error, #e53935);
  padding: 10px 14px;
  border-radius: 6px;
  margin-bottom: 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85rem;
}

.dismiss-btn { background: none; border: none; color: inherit; cursor: pointer; font-size: 0.8rem; }

.loading { color: var(--color-text-muted); font-size: 0.88rem; padding: 10px 0; }

.comments-list { display: flex; flex-direction: column; gap: 16px; }

.comment-thread { border-bottom: 1px solid var(--color-border); padding-bottom: 16px; }
.comment-thread:last-child { border-bottom: none; }

.comment { display: flex; gap: 10px; }
.comment-avatar { flex-shrink: 0; }

.avatar-placeholder {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--color-link);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.85rem;
}

.comment-body { flex: 1; min-width: 0; }

.comment-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.author-name { font-weight: 600; color: var(--color-text); font-size: 0.85rem; }
.comment-date { color: var(--color-text-muted); font-size: 0.78rem; }

.comment-content {
  margin: 0 0 6px;
  color: var(--color-text-secondary);
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-size: 0.88rem;
}

.comment-actions { display: flex; gap: 12px; }

.action-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: 0.78rem;
  cursor: pointer;
  padding: 0;
}
.action-btn:hover { color: var(--color-link); }
.action-btn.delete-btn:hover { color: var(--color-error, #e53935); }

.reply-form { margin-top: 10px; }
.reply-actions { display: flex; gap: 8px; margin-top: 6px; }

.cancel-btn {
  padding: 8px 16px;
  background: var(--color-background-soft, rgba(0,0,0,0.04));
  color: var(--color-text);
  border: none;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
}
.cancel-btn:hover { background: var(--color-background-soft-hover, rgba(0,0,0,0.08)); }

.replies {
  margin-left: 42px;
  margin-top: 12px;
  padding-left: 12px;
  border-left: 2px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.reply .avatar-placeholder { width: 26px; height: 26px; font-size: 0.75rem; }

.no-comments { color: var(--color-text-muted); font-size: 0.88rem; padding: 10px 0; }

@media (max-width: 600px) {
  .replies { margin-left: 16px; }
}
</style>
