<script setup>
import { ref, computed, onMounted } from 'vue'
import { lyrics } from '@/stores/lyrics.js'

const props = defineProps({
  song: Object
})

const emit = defineEmits(['close', 'saved'])

const title = ref('')
const description = ref('')
const genre = ref('')
const status = ref('idea')
const visibility = ref('private')
const newCollaborator = ref('')
const collaboratorRole = ref('editor')
const saving = ref(false)
const error = ref(null)

const isEditing = computed(() => props.song && props.song.id)

const statusOptions = [
  { value: 'idea', label: 'Idea' },
  { value: 'writing', label: 'Writing' },
  { value: 'complete', label: 'Complete' },
  { value: 'recorded', label: 'Recorded' },
  { value: 'released', label: 'Released' }
]

const visibilityOptions = [
  { value: 'private', label: 'Private - Only you' },
  { value: 'collaborators', label: 'Collaborators - You and invited users' },
  { value: 'public', label: 'Public - Anyone can view' }
]

const genreSuggestions = [
  'Rock', 'Pop', 'Country', 'Hip-Hop', 'R&B', 'Jazz', 'Blues', 'Folk',
  'Electronic', 'Indie', 'Alternative', 'Metal', 'Punk', 'Soul', 'Gospel'
]

onMounted(() => {
  if (props.song) {
    title.value = props.song.title || ''
    description.value = props.song.description || ''
    genre.value = props.song.genre || ''
    status.value = props.song.status || 'idea'
    visibility.value = props.song.visibility || 'private'
  }
})

async function save() {
  if (!title.value.trim()) {
    error.value = 'Song title is required'
    return
  }

  saving.value = true
  error.value = null

  try {
    const songData = {
      title: title.value.trim(),
      description: description.value.trim() || null,
      genre: genre.value.trim() || null,
      status: status.value,
      visibility: visibility.value
    }

    if (isEditing.value) {
      await lyrics.updateSong(props.song.id, songData)
    } else {
      await lyrics.createSong(songData)
    }

    emit('saved')
  } catch (err) {
    error.value = err.message
  } finally {
    saving.value = false
  }
}

async function addCollaborator() {
  if (!newCollaborator.value.trim()) return

  try {
    await lyrics.addCollaborator(props.song.id, newCollaborator.value.trim(), collaboratorRole.value)
    newCollaborator.value = ''
  } catch (err) {
    error.value = err.message
  }
}

async function removeCollaborator(userId) {
  if (confirm('Remove this collaborator?')) {
    try {
      await lyrics.removeCollaborator(props.song.id, userId)
    } catch (err) {
      error.value = err.message
    }
  }
}

function selectGenre(g) {
  genre.value = g
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-content">
      <div class="modal-header">
        <h2>{{ isEditing ? 'Edit Song' : 'New Song' }}</h2>
        <button class="close-btn" @click="emit('close')">&times;</button>
      </div>

      <div class="modal-body">
        <div v-if="error" class="error-message">{{ error }}</div>

        <!-- Title -->
        <div class="form-group">
          <label for="title">Title *</label>
          <input
            id="title"
            v-model="title"
            type="text"
            placeholder="Song title"
          />
        </div>

        <!-- Description -->
        <div class="form-group">
          <label for="description">Description</label>
          <textarea
            id="description"
            v-model="description"
            rows="3"
            placeholder="What's this song about? Theme, inspiration, etc."
          ></textarea>
        </div>

        <!-- Genre -->
        <div class="form-group">
          <label for="genre">Genre</label>
          <input
            id="genre"
            v-model="genre"
            type="text"
            placeholder="e.g., Rock, Pop, Country"
          />
          <div class="genre-suggestions">
            <button
              v-for="g in genreSuggestions"
              :key="g"
              type="button"
              :class="['genre-chip', { active: genre === g }]"
              @click="selectGenre(g)"
            >
              {{ g }}
            </button>
          </div>
        </div>

        <!-- Status and Visibility -->
        <div class="form-row">
          <div class="form-group">
            <label for="status">Status</label>
            <select id="status" v-model="status">
              <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>

          <div class="form-group">
            <label for="visibility">Visibility</label>
            <select id="visibility" v-model="visibility">
              <option v-for="opt in visibilityOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>
        </div>

        <!-- Collaborators (only when editing) -->
        <div v-if="isEditing && props.song.role === 'owner'" class="collaborators-section">
          <h3>Collaborators</h3>

          <div v-if="lyrics.collaborators.length > 0" class="collaborator-list">
            <div v-for="collab in lyrics.collaborators" :key="collab.user_id" class="collaborator-item">
              <span class="collaborator-name">{{ collab.first_name || collab.handle }}</span>
              <span class="collaborator-role">{{ collab.role }}</span>
              <button class="remove-btn" @click="removeCollaborator(collab.user_id)">&times;</button>
            </div>
          </div>

          <div class="add-collaborator">
            <input
              v-model="newCollaborator"
              type="text"
              placeholder="Username (handle)"
              @keyup.enter="addCollaborator"
            />
            <select v-model="collaboratorRole">
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
            <button class="btn-add" @click="addCollaborator">Add</button>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" @click="emit('close')">Cancel</button>
        <button class="btn-primary" @click="save" :disabled="saving">
          {{ saving ? 'Saving...' : (isEditing ? 'Update' : 'Create') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
  width: 100%;
  max-width: 550px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid var(--color-border);
}

.modal-header h2 {
  margin: 0;
  color: var(--color-text);
  font-size: 1.3rem;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.close-btn:hover {
  background: var(--color-background-soft);
  color: var(--color-text);
}

.modal-body {
  padding: 24px;
}

.error-message {
  background: var(--color-error-bg);
  color: var(--color-error);
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 20px;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  color: var(--color-text);
  font-weight: 500;
  font-size: 0.9rem;
}

.form-group input,
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 10px 12px;
  border: 2px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-input);
  color: var(--color-text);
  font-size: 0.95rem;
  box-sizing: border-box;
}

.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus {
  outline: none;
  border-color: var(--color-accent);
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
}

.genre-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.genre-chip {
  padding: 4px 10px;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 15px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.genre-chip:hover {
  background: var(--color-background-hover);
}

.genre-chip.active {
  background: var(--color-accent);
  color: white;
  border-color: var(--color-accent);
}

/* Collaborators */
.collaborators-section {
  margin-top: 25px;
  padding-top: 20px;
  border-top: 1px solid var(--color-border);
}

.collaborators-section h3 {
  margin: 0 0 15px;
  font-size: 1rem;
  color: var(--color-text);
}

.collaborator-list {
  margin-bottom: 15px;
}

.collaborator-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--color-background-soft);
  border-radius: 6px;
  margin-bottom: 8px;
}

.collaborator-name {
  flex: 1;
  color: var(--color-text);
}

.collaborator-role {
  font-size: 0.8rem;
  padding: 2px 8px;
  background: var(--color-background-card);
  border-radius: 4px;
  color: var(--color-text-secondary);
}

.remove-btn {
  background: none;
  border: none;
  color: var(--color-error);
  cursor: pointer;
  font-size: 1.2rem;
  padding: 0 4px;
}

.add-collaborator {
  display: flex;
  gap: 10px;
}

.add-collaborator input {
  flex: 1;
  padding: 8px 12px;
  border: 2px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-input);
  color: var(--color-text);
}

.add-collaborator select {
  padding: 8px;
  border: 2px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-input);
  color: var(--color-text);
}

.btn-add {
  padding: 8px 16px;
  background: var(--color-accent);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
}

.btn-add:hover {
  background: var(--color-accent-hover);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px;
  border-top: 1px solid var(--color-border);
}

.btn-primary {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: 10px 24px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.95rem;
  font-weight: 500;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--color-button-secondary);
  color: var(--color-text);
  border: none;
  padding: 10px 24px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.95rem;
  font-weight: 500;
}

.btn-secondary:hover {
  background: var(--color-button-secondary-hover);
}

@media (max-width: 500px) {
  .form-row {
    grid-template-columns: 1fr;
  }

  .add-collaborator {
    flex-wrap: wrap;
  }

  .add-collaborator input {
    width: 100%;
  }
}
</style>
