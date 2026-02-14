<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { io } from 'socket.io-client'
import { user } from '@/stores/user.js'
import { comments } from '@/stores/comments.js'
import LoadingSpinner from './LoadingSpinner.vue'

const props = defineProps({
  postId: {
    type: Number,
    required: true
  }
})

const baseUrl = import.meta.env.VITE_API_BASE_URL || ''

// Local state
const newComment = ref('')
const replyingTo = ref(null)
const replyContent = ref('')
const editingId = ref(null)
const editContent = ref('')
const loading = ref(true)

// Socket reference
let socket = null

// Computed
const isAuthenticated = computed(() => !!user.username)
const postComments = computed(() => comments.getComments(props.postId))
const commentCount = computed(() => {
  let count = 0
  const countRecursive = (items) => {
    for (const item of items) {
      count++
      if (item.replies) countRecursive(item.replies)
    }
  }
  countRecursive(postComments.value)
  return count
})

// Socket setup
function setupSocket() {
  socket = io(baseUrl, {
    withCredentials: true,
    autoConnect: true
  })

  socket.on('connect', () => {
    socket.emit('join_post', props.postId)
  })

  socket.on('new_comment', (data) => {
    comments.handleNewComment(props.postId, data.comment)
  })

  socket.on('comment_updated', (data) => {
    comments.handleCommentUpdated(props.postId, data.comment)
  })

  socket.on('comment_deleted', (data) => {
    comments.handleCommentDeleted(props.postId, data.commentId)
  })
}

function teardownSocket() {
  if (socket) {
    socket.emit('leave_post', props.postId)
    socket.disconnect()
    socket = null
  }
}

// Actions
async function submitComment() {
  if (!newComment.value.trim()) return

  try {
    await comments.addComment(props.postId, newComment.value.trim())
    newComment.value = ''
  } catch (err) {
    // Error handled in store
  }
}

async function submitReply() {
  if (!replyContent.value.trim() || !replyingTo.value) return

  try {
    await comments.addComment(props.postId, replyContent.value.trim(), replyingTo.value)
    replyContent.value = ''
    replyingTo.value = null
  } catch (err) {
    // Error handled in store
  }
}

function startReply(commentId) {
  replyingTo.value = commentId
  replyContent.value = ''
  editingId.value = null
}

function cancelReply() {
  replyingTo.value = null
  replyContent.value = ''
}

function startEdit(comment) {
  editingId.value = comment.id
  editContent.value = comment.content
  replyingTo.value = null
}

function cancelEdit() {
  editingId.value = null
  editContent.value = ''
}

async function saveEdit() {
  if (!editContent.value.trim()) return

  try {
    await comments.updateComment(editingId.value, editContent.value.trim())
    editingId.value = null
    editContent.value = ''
  } catch (err) {
    // Error handled in store
  }
}

async function deleteComment(commentId) {
  if (!confirm('Are you sure you want to delete this comment?')) return

  try {
    await comments.deleteComment(commentId)
  } catch (err) {
    // Error handled in store
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

function getAuthorPhotoUrl(author) {
  if (author?.photo) {
    return `/api/uploads/${author.photo}`
  }
  return null
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

// Lifecycle
onMounted(async () => {
  loading.value = true
  await comments.fetchComments(props.postId)
  loading.value = false
  setupSocket()
})

onUnmounted(() => {
  teardownSocket()
})

// Watch for postId changes
watch(() => props.postId, async (newId, oldId) => {
  if (newId !== oldId) {
    teardownSocket()
    loading.value = true
    await comments.fetchComments(newId)
    loading.value = false
    setupSocket()
  }
})
</script>

<template>
  <div class="blog-comments">
    <h3 class="comments-header">
      Comments <span v-if="commentCount > 0">({{ commentCount }})</span>
    </h3>

    <!-- Add comment form -->
    <div v-if="isAuthenticated" class="add-comment-form">
      <textarea
        v-model="newComment"
        placeholder="Write a comment..."
        rows="3"
        :disabled="comments.submitting"
      ></textarea>
      <button
        @click="submitComment"
        :disabled="!newComment.trim() || comments.submitting"
        class="submit-btn"
      >
        {{ comments.submitting ? 'Posting...' : 'Post Comment' }}
      </button>
    </div>
    <p v-else class="login-prompt">
      <a href="/login">Log in</a> to leave a comment.
    </p>

    <!-- Error message -->
    <div v-if="comments.error" class="error-message">
      {{ comments.error }}
      <button @click="comments.clearError()" class="dismiss-btn">Dismiss</button>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="loading"><LoadingSpinner size="small" /> Loading comments...</div>

    <!-- Comments list -->
    <div v-else-if="postComments.length > 0" class="comments-list">
      <div
        v-for="comment in postComments"
        :key="comment.id"
        class="comment-thread"
      >
        <!-- Top-level comment -->
        <div class="comment">
          <div class="comment-avatar">
            <img
              v-if="getAuthorPhotoUrl(comment.author)"
              :src="getAuthorPhotoUrl(comment.author)"
              :alt="getAuthorDisplayName(comment.author)"
            />
            <div v-else class="avatar-placeholder">
              {{ getAuthorInitial(comment.author) }}
            </div>
          </div>
          <div class="comment-body">
            <div class="comment-header">
              <span class="author-name">{{ getAuthorDisplayName(comment.author) }}</span>
              <span class="author-handle">@{{ comment.author?.handle }}</span>
              <span class="comment-date">{{ formatDate(comment.createdAt) }}</span>
              <span v-if="comment.updatedAt !== comment.createdAt" class="edited-label">(edited)</span>
            </div>

            <!-- Edit mode -->
            <div v-if="editingId === comment.id" class="edit-form">
              <textarea v-model="editContent" rows="3"></textarea>
              <div class="edit-actions">
                <button @click="saveEdit" :disabled="!editContent.trim()" class="save-btn">Save</button>
                <button @click="cancelEdit" class="cancel-btn">Cancel</button>
              </div>
            </div>

            <!-- Display mode -->
            <template v-else>
              <p class="comment-content">{{ comment.content }}</p>
              <div class="comment-actions">
                <button v-if="isAuthenticated" @click="startReply(comment.id)" class="action-btn">Reply</button>
                <button v-if="isOwnComment(comment)" @click="startEdit(comment)" class="action-btn">Edit</button>
                <button v-if="isOwnComment(comment)" @click="deleteComment(comment.id)" class="action-btn delete-btn">Delete</button>
              </div>
            </template>

            <!-- Reply form -->
            <div v-if="replyingTo === comment.id" class="reply-form">
              <textarea
                v-model="replyContent"
                placeholder="Write a reply..."
                rows="2"
              ></textarea>
              <div class="reply-actions">
                <button @click="submitReply" :disabled="!replyContent.trim()" class="submit-btn">Reply</button>
                <button @click="cancelReply" class="cancel-btn">Cancel</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Replies -->
        <div v-if="comment.replies && comment.replies.length > 0" class="replies">
          <div
            v-for="reply in comment.replies"
            :key="reply.id"
            class="comment reply"
          >
            <div class="comment-avatar">
              <img
                v-if="getAuthorPhotoUrl(reply.author)"
                :src="getAuthorPhotoUrl(reply.author)"
                :alt="getAuthorDisplayName(reply.author)"
              />
              <div v-else class="avatar-placeholder">
                {{ getAuthorInitial(reply.author) }}
              </div>
            </div>
            <div class="comment-body">
              <div class="comment-header">
                <span class="author-name">{{ getAuthorDisplayName(reply.author) }}</span>
                <span class="author-handle">@{{ reply.author?.handle }}</span>
                <span class="comment-date">{{ formatDate(reply.createdAt) }}</span>
                <span v-if="reply.updatedAt !== reply.createdAt" class="edited-label">(edited)</span>
              </div>

              <!-- Edit mode -->
              <div v-if="editingId === reply.id" class="edit-form">
                <textarea v-model="editContent" rows="3"></textarea>
                <div class="edit-actions">
                  <button @click="saveEdit" :disabled="!editContent.trim()" class="save-btn">Save</button>
                  <button @click="cancelEdit" class="cancel-btn">Cancel</button>
                </div>
              </div>

              <!-- Display mode -->
              <template v-else>
                <p class="comment-content">{{ reply.content }}</p>
                <div class="comment-actions">
                  <button v-if="isOwnComment(reply)" @click="startEdit(reply)" class="action-btn">Edit</button>
                  <button v-if="isOwnComment(reply)" @click="deleteComment(reply.id)" class="action-btn delete-btn">Delete</button>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="no-comments">
      No comments yet. Be the first to comment!
    </div>
  </div>
</template>

<style scoped>
.blog-comments {
  margin-top: 30px;
  padding-top: 25px;
  border-top: 1px solid var(--color-border-light);
}

.comments-header {
  margin: 0 0 20px;
  font-size: 1.2rem;
  color: var(--color-text);
}

.comments-header span {
  color: var(--color-text-light);
  font-weight: normal;
}

.add-comment-form {
  margin-bottom: 25px;
}

.add-comment-form textarea,
.reply-form textarea,
.edit-form textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--color-border-medium);
  border-radius: 8px;
  resize: vertical;
  font-family: inherit;
  font-size: 0.95rem;
  box-sizing: border-box;
  background: var(--color-background-input);
  color: var(--color-text);
}

.add-comment-form textarea:focus,
.reply-form textarea:focus,
.edit-form textarea:focus {
  outline: none;
  border-color: var(--color-accent);
}

.submit-btn {
  margin-top: 10px;
  padding: 10px 20px;
  background: var(--color-accent);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
  transition: background 0.2s;
}

.submit-btn:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.submit-btn:disabled {
  background: var(--color-button-disabled);
  cursor: not-allowed;
}

.login-prompt {
  color: var(--color-text-muted);
  font-size: 0.95rem;
  margin-bottom: 20px;
}

.login-prompt a {
  color: var(--color-accent);
  text-decoration: none;
}

.login-prompt a:hover {
  text-decoration: underline;
}

.error-message {
  background: var(--color-error-bg);
  color: var(--color-error);
  padding: 12px 15px;
  border-radius: 6px;
  margin-bottom: 15px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dismiss-btn {
  background: none;
  border: none;
  color: var(--color-error);
  cursor: pointer;
  font-size: 0.85rem;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--color-text-light);
  padding: 20px 0;
}

.comments-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.comment-thread {
  border-bottom: 1px solid var(--color-border-light);
  padding-bottom: 20px;
}

.comment-thread:last-child {
  border-bottom: none;
}

.comment {
  display: flex;
  gap: 12px;
}

.comment-avatar {
  flex-shrink: 0;
}

.comment-avatar img {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
}

.avatar-placeholder {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--color-accent);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 1rem;
}

.comment-body {
  flex: 1;
  min-width: 0;
}

.comment-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.author-name {
  font-weight: 600;
  color: var(--color-text);
  font-size: 0.9rem;
}

.author-handle {
  color: var(--color-accent);
  font-size: 0.85rem;
}

.comment-date {
  color: var(--color-text-placeholder);
  font-size: 0.8rem;
}

.edited-label {
  color: var(--color-text-placeholder);
  font-size: 0.8rem;
  font-style: italic;
}

.comment-content {
  margin: 0 0 8px;
  color: var(--color-text-secondary);
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.comment-actions {
  display: flex;
  gap: 12px;
}

.action-btn {
  background: none;
  border: none;
  color: var(--color-text-light);
  font-size: 0.8rem;
  cursor: pointer;
  padding: 0;
}

.action-btn:hover {
  color: var(--color-accent);
}

.action-btn.delete-btn:hover {
  color: var(--color-error);
}

.reply-form,
.edit-form {
  margin-top: 12px;
}

.reply-actions,
.edit-actions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}

.save-btn {
  padding: 6px 14px;
  background: var(--color-accent);
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 0.85rem;
  cursor: pointer;
}

.save-btn:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.save-btn:disabled {
  background: var(--color-button-disabled);
}

.cancel-btn {
  padding: 6px 14px;
  background: var(--color-button-secondary-bg);
  color: var(--color-button-secondary-text);
  border: none;
  border-radius: 4px;
  font-size: 0.85rem;
  cursor: pointer;
}

.cancel-btn:hover {
  background: var(--color-background-hover);
}

.replies {
  margin-left: 52px;
  margin-top: 15px;
  padding-left: 15px;
  border-left: 2px solid var(--color-accent-light);
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.reply .avatar-placeholder,
.reply .comment-avatar img {
  width: 32px;
  height: 32px;
  font-size: 0.85rem;
}

.no-comments {
  color: var(--color-text-light);
  font-size: 0.95rem;
  padding: 20px 0;
}

/* Responsive */
@media (max-width: 600px) {
  .replies {
    margin-left: 20px;
  }

  .comment-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }
}
</style>
