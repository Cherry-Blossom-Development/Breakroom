<script setup>
import { ref, computed, onMounted } from 'vue'
import { lyrics } from '@/stores/lyrics.js'

const props = defineProps({
  lyric: Object,
  songId: Number,
  songs: Array
})

const emit = defineEmits(['close', 'saved'])

const content = ref('')
const title = ref('')
const sectionType = ref('idea')
const sectionOrder = ref(null)
const mood = ref('')
const notes = ref('')
const status = ref('draft')
const selectedSongId = ref(null)
const saving = ref(false)
const error = ref(null)

const isEditing = computed(() => props.lyric && props.lyric.id)

const sectionTypes = [
  { value: 'idea', label: 'Idea' },
  { value: 'verse', label: 'Verse' },
  { value: 'chorus', label: 'Chorus' },
  { value: 'bridge', label: 'Bridge' },
  { value: 'pre-chorus', label: 'Pre-Chorus' },
  { value: 'hook', label: 'Hook' },
  { value: 'intro', label: 'Intro' },
  { value: 'outro', label: 'Outro' },
  { value: 'other', label: 'Other' }
]

const statusOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'complete', label: 'Complete' },
  { value: 'archived', label: 'Archived' }
]

const moodSuggestions = [
  'Happy', 'Sad', 'Angry', 'Melancholy', 'Hopeful', 'Nostalgic',
  'Romantic', 'Energetic', 'Peaceful', 'Defiant', 'Reflective', 'Playful'
]

onMounted(() => {
  if (props.lyric) {
    content.value = props.lyric.content || ''
    title.value = props.lyric.title || ''
    sectionType.value = props.lyric.section_type || 'idea'
    sectionOrder.value = props.lyric.section_order || null
    mood.value = props.lyric.mood || ''
    notes.value = props.lyric.notes || ''
    status.value = props.lyric.status || 'draft'
    selectedSongId.value = props.lyric.song_id || props.songId || null
  } else {
    selectedSongId.value = props.songId || null
  }
})

async function save() {
  if (!content.value.trim()) {
    error.value = 'Lyric content is required'
    return
  }

  saving.value = true
  error.value = null

  try {
    const lyricData = {
      content: content.value.trim(),
      title: title.value.trim() || null,
      section_type: sectionType.value,
      section_order: sectionOrder.value || null,
      mood: mood.value.trim() || null,
      notes: notes.value.trim() || null,
      status: status.value,
      song_id: selectedSongId.value || null
    }

    if (isEditing.value) {
      await lyrics.updateLyric(props.lyric.id, lyricData)
    } else {
      await lyrics.createLyric(lyricData)
    }

    emit('saved')
  } catch (err) {
    error.value = err.message
  } finally {
    saving.value = false
  }
}

function selectMood(m) {
  mood.value = m
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-content">
      <div class="modal-header">
        <h2>{{ isEditing ? 'Edit Lyric' : 'New Lyric' }}</h2>
        <button class="close-btn" @click="emit('close')">&times;</button>
      </div>

      <div class="modal-body">
        <div v-if="error" class="error-message">{{ error }}</div>

        <!-- Content -->
        <div class="form-group">
          <label for="content">Lyrics *</label>
          <textarea
            id="content"
            v-model="content"
            rows="8"
            placeholder="Write your lyrics here..."
            class="lyrics-textarea"
          ></textarea>
        </div>

        <!-- Two column layout for metadata -->
        <div class="form-row">
          <div class="form-group">
            <label for="sectionType">Section Type</label>
            <select id="sectionType" v-model="sectionType">
              <option v-for="type in sectionTypes" :key="type.value" :value="type.value">
                {{ type.label }}
              </option>
            </select>
          </div>

          <div class="form-group">
            <label for="sectionOrder">Order #</label>
            <input
              id="sectionOrder"
              v-model.number="sectionOrder"
              type="number"
              min="1"
              placeholder="e.g., 1, 2, 3"
            />
          </div>
        </div>

        <!-- Song Assignment -->
        <div class="form-group">
          <label for="song">Assign to Song</label>
          <select id="song" v-model="selectedSongId">
            <option :value="null">-- Standalone Idea --</option>
            <option v-for="song in songs" :key="song.id" :value="song.id">
              {{ song.title }}
            </option>
          </select>
        </div>

        <!-- Mood -->
        <div class="form-group">
          <label for="mood">Mood</label>
          <input
            id="mood"
            v-model="mood"
            type="text"
            placeholder="e.g., Melancholy, Hopeful"
          />
          <div class="mood-suggestions">
            <button
              v-for="m in moodSuggestions"
              :key="m"
              type="button"
              :class="['mood-chip', { active: mood === m }]"
              @click="selectMood(m)"
            >
              {{ m }}
            </button>
          </div>
        </div>

        <!-- Status -->
        <div class="form-group">
          <label for="status">Status</label>
          <select id="status" v-model="status">
            <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <!-- Notes -->
        <div class="form-group">
          <label for="notes">Private Notes</label>
          <textarea
            id="notes"
            v-model="notes"
            rows="3"
            placeholder="Notes about inspiration, rhyme ideas, etc."
          ></textarea>
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
  max-width: 600px;
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

.lyrics-textarea {
  font-family: 'Georgia', serif;
  line-height: 1.6;
  resize: vertical;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
}

.mood-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.mood-chip {
  padding: 4px 10px;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 15px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.mood-chip:hover {
  background: var(--color-background-hover);
}

.mood-chip.active {
  background: var(--color-accent);
  color: white;
  border-color: var(--color-accent);
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
}
</style>
