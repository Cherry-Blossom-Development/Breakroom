<script setup>
import { ref, onMounted, watch } from 'vue'
import { blog } from '@/stores/blog.js'

const props = defineProps({
  post: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['close', 'saved'])

const title = ref('')
const isPublished = ref(false)
const editorRef = ref(null)
const imageInput = ref(null)
const uploadingImage = ref(false)
const saving = ref(false)
const error = ref('')

// Font options
const fonts = [
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Times New Roman, serif', label: 'Times' },
  { value: 'Courier New, monospace', label: 'Courier' },
  { value: 'Verdana, sans-serif', label: 'Verdana' }
]

// Font sizes
const fontSizes = [
  { value: '2', label: 'Small' },
  { value: '3', label: 'Normal' },
  { value: '4', label: 'Large' },
  { value: '5', label: 'X-Large' }
]

const selectedFont = ref(fonts[0].value)
const selectedSize = ref('3')

// Initialize editor with existing content
onMounted(() => {
  if (props.post) {
    title.value = props.post.title || ''
    isPublished.value = props.post.is_published || false
    if (editorRef.value) {
      editorRef.value.innerHTML = props.post.content || ''
    }
  }
})

// Watch for post changes
watch(() => props.post, (newPost) => {
  if (newPost) {
    title.value = newPost.title || ''
    isPublished.value = newPost.is_published || false
    if (editorRef.value) {
      editorRef.value.innerHTML = newPost.content || ''
    }
  }
})

// Format commands
const execCommand = (command, value = null) => {
  document.execCommand(command, false, value)
  editorRef.value?.focus()
}

const formatBold = () => execCommand('bold')
const formatItalic = () => execCommand('italic')
const formatUnderline = () => execCommand('underline')

const changeFont = () => {
  execCommand('fontName', selectedFont.value)
}

const changeSize = () => {
  execCommand('fontSize', selectedSize.value)
}

// Insert link
const insertLink = () => {
  const url = prompt('Enter URL:')
  if (url) {
    execCommand('createLink', url)
  }
}

// Trigger image upload
const triggerImageUpload = () => {
  imageInput.value?.click()
}

// Handle image upload
const onImageSelected = async (event) => {
  const file = event.target.files[0]
  if (!file) return

  uploadingImage.value = true
  error.value = ''

  try {
    const url = await blog.uploadImage(file)
    execCommand('insertImage', url)
  } catch (err) {
    error.value = err.message
  } finally {
    uploadingImage.value = false
    event.target.value = ''
  }
}

// Save post
const savePost = async (publish = null) => {
  if (!title.value.trim()) {
    error.value = 'Title is required'
    return
  }

  saving.value = true
  error.value = ''

  const content = editorRef.value?.innerHTML || ''
  const publishStatus = publish !== null ? publish : isPublished.value

  try {
    if (props.post?.id) {
      await blog.updatePost(props.post.id, title.value, content, publishStatus)
    } else {
      await blog.createPost(title.value, content, publishStatus)
    }
    emit('saved')
  } catch (err) {
    error.value = err.message
  } finally {
    saving.value = false
  }
}

const saveDraft = () => savePost(false)
const saveAndPublish = () => savePost(true)
</script>

<template>
  <div class="editor-overlay">
    <div class="editor-container">
      <!-- Header -->
      <div class="editor-header">
        <input
          v-model="title"
          type="text"
          class="title-input"
          placeholder="Post title..."
          maxlength="255"
        />
        <button class="close-btn" @click="emit('close')" title="Close">
          &times;
        </button>
      </div>

      <!-- Toolbar -->
      <div class="toolbar">
        <div class="toolbar-group">
          <select v-model="selectedFont" @change="changeFont" class="font-select">
            <option v-for="font in fonts" :key="font.value" :value="font.value">
              {{ font.label }}
            </option>
          </select>

          <select v-model="selectedSize" @change="changeSize" class="size-select">
            <option v-for="size in fontSizes" :key="size.value" :value="size.value">
              {{ size.label }}
            </option>
          </select>
        </div>

        <div class="toolbar-divider"></div>

        <div class="toolbar-group">
          <button type="button" @click="formatBold" class="toolbar-btn" title="Bold">
            <strong>B</strong>
          </button>
          <button type="button" @click="formatItalic" class="toolbar-btn" title="Italic">
            <em>I</em>
          </button>
          <button type="button" @click="formatUnderline" class="toolbar-btn" title="Underline">
            <u>U</u>
          </button>
        </div>

        <div class="toolbar-divider"></div>

        <div class="toolbar-group">
          <button type="button" @click="insertLink" class="toolbar-btn" title="Insert Link">
            Link
          </button>
          <input
            ref="imageInput"
            type="file"
            accept="image/*"
            class="hidden-input"
            @change="onImageSelected"
          />
          <button
            type="button"
            @click="triggerImageUpload"
            class="toolbar-btn"
            :disabled="uploadingImage"
            title="Insert Image"
          >
            {{ uploadingImage ? '...' : 'Image' }}
          </button>
        </div>
      </div>

      <!-- Editor Area -->
      <div
        ref="editorRef"
        class="editor-content"
        contenteditable="true"
        @paste="onPaste"
      ></div>

      <!-- Error message -->
      <p v-if="error" class="error-message">{{ error }}</p>

      <!-- Footer with actions -->
      <div class="editor-footer">
        <div class="publish-status">
          <label>
            <input type="checkbox" v-model="isPublished" />
            Published
          </label>
        </div>
        <div class="footer-actions">
          <button class="btn-secondary" @click="emit('close')" :disabled="saving">
            Cancel
          </button>
          <button class="btn-draft" @click="saveDraft" :disabled="saving">
            {{ saving ? 'Saving...' : 'Save Draft' }}
          </button>
          <button class="btn-primary" @click="saveAndPublish" :disabled="saving">
            {{ saving ? 'Saving...' : 'Save & Publish' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-overlay {
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

.editor-container {
  background: var(--color-background-card);
  border-radius: 10px;
  width: 100%;
  max-width: 1000px;
  height: calc(100vh - 80px);
  max-height: 800px;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
}

.editor-header {
  display: flex;
  align-items: center;
  padding: 15px 20px;
  border-bottom: 1px solid var(--color-border);
  gap: 15px;
}

.title-input {
  flex: 1;
  font-size: 1.4rem;
  font-weight: 600;
  border: none;
  outline: none;
  color: var(--color-text);
  background: transparent;
}

.title-input::placeholder {
  color: var(--color-text-light);
}

.close-btn {
  background: none;
  border: none;
  font-size: 2rem;
  color: var(--color-text-light);
  cursor: pointer;
  line-height: 1;
  padding: 0 8px;
}

.close-btn:hover {
  color: var(--color-text);
}

.toolbar {
  display: flex;
  align-items: center;
  padding: 10px 15px;
  background: var(--color-background-soft);
  border-bottom: 1px solid var(--color-border);
  flex-wrap: wrap;
  gap: 8px;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-divider {
  width: 1px;
  height: 24px;
  background: var(--color-border);
  margin: 0 8px;
}

.font-select,
.size-select {
  padding: 6px 10px;
  border: 1px solid var(--color-border-medium);
  border-radius: 4px;
  background: var(--color-background-input);
  color: var(--color-text);
  font-size: 0.9rem;
  cursor: pointer;
}

.font-select {
  min-width: 100px;
}

.size-select {
  min-width: 80px;
}

.toolbar-btn {
  padding: 6px 12px;
  background: var(--color-background-input);
  border: 1px solid var(--color-border-medium);
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  min-width: 36px;
  color: var(--color-text);
}

.toolbar-btn:hover:not(:disabled) {
  background: var(--color-background-hover);
}

.toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.hidden-input {
  display: none;
}

.editor-content {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
  font-size: 1rem;
  line-height: 1.6;
  color: var(--color-text);
  background: var(--color-background-card);
  outline: none;
}

.editor-content:empty::before {
  content: 'Start writing your post...';
  color: var(--color-text-light);
}

.editor-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  margin: 10px 0;
}

.editor-content :deep(a) {
  color: var(--color-link);
  text-decoration: underline;
}

.error-message {
  margin: 0;
  padding: 10px 20px;
  background: var(--color-error-bg);
  color: var(--color-error);
  font-size: 0.9rem;
}

.editor-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 20px;
  border-top: 1px solid var(--color-border);
  background: var(--color-background-soft);
  border-radius: 0 0 10px 10px;
}

.publish-status label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.publish-status input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.footer-actions {
  display: flex;
  gap: 10px;
}

.btn-secondary,
.btn-draft,
.btn-primary {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.95rem;
  font-weight: 500;
}

.btn-secondary {
  background: var(--color-button-secondary);
  color: var(--color-text-secondary);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--color-button-secondary-hover);
}

.btn-draft {
  background: var(--color-warning-bg);
  color: var(--color-warning);
}

.btn-draft:hover:not(:disabled) {
  background: var(--color-warning-bg-hover);
}

.btn-primary {
  background: var(--color-accent);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.btn-secondary:disabled,
.btn-draft:disabled,
.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Mobile responsive styles */
@media (max-width: 768px) {
  .editor-overlay {
    padding: 10px;
  }

  .editor-container {
    height: calc(100vh - 20px);
    max-height: none;
  }

  .editor-header {
    padding: 10px 15px;
  }

  .title-input {
    font-size: 1.1rem;
  }

  .editor-footer {
    flex-direction: column;
    gap: 12px;
    padding: 12px 15px;
  }

  .publish-status {
    width: 100%;
  }

  .footer-actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .footer-actions .btn-secondary {
    flex: 1;
    min-width: auto;
  }

  .footer-actions .btn-draft,
  .footer-actions .btn-primary {
    flex: 1;
    min-width: 0;
    padding: 10px 12px;
  }
}
</style>
