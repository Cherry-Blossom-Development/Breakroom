import { reactive } from 'vue'
import { authFetch } from '../utilities/authFetch'

const state = reactive({
  songs: [],
  standaloneLyrics: [],
  currentSong: null,
  currentLyrics: [],
  collaborators: [],
  loading: false,
  saving: false,
  error: null
})

export const lyrics = reactive({
  get songs() { return state.songs },
  get standaloneLyrics() { return state.standaloneLyrics },
  get currentSong() { return state.currentSong },
  get currentLyrics() { return state.currentLyrics },
  get collaborators() { return state.collaborators },
  get loading() { return state.loading },
  get saving() { return state.saving },
  get error() { return state.error },

  // Fetch all songs for current user
  async fetchSongs() {
    state.loading = true
    state.error = null

    try {
      const res = await authFetch('/api/lyrics/songs')
      if (!res.ok) throw new Error('Failed to fetch songs')

      const data = await res.json()
      state.songs = data.songs
    } catch (err) {
      console.error('Error fetching songs:', err)
      state.error = err.message
    } finally {
      state.loading = false
    }
  },

  // Fetch standalone lyrics (not in any song)
  async fetchStandaloneLyrics() {
    try {
      const res = await authFetch('/api/lyrics/standalone')
      if (!res.ok) throw new Error('Failed to fetch standalone lyrics')

      const data = await res.json()
      state.standaloneLyrics = data.lyrics
    } catch (err) {
      console.error('Error fetching standalone lyrics:', err)
      state.error = err.message
    }
  },

  // Fetch a single song with its lyrics and collaborators
  async fetchSong(id) {
    state.loading = true
    state.error = null

    try {
      const res = await authFetch(`/api/lyrics/songs/${id}`)
      if (!res.ok) throw new Error('Failed to fetch song')

      const data = await res.json()
      state.currentSong = data.song
      state.currentLyrics = data.lyrics
      state.collaborators = data.collaborators
      return data
    } catch (err) {
      console.error('Error fetching song:', err)
      state.error = err.message
      return null
    } finally {
      state.loading = false
    }
  },

  // Create a new song
  async createSong(songData) {
    state.saving = true
    state.error = null

    try {
      const res = await authFetch('/api/lyrics/songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(songData)
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || 'Failed to create song')
      }

      const data = await res.json()
      state.songs.unshift(data.song)
      return data.song
    } catch (err) {
      console.error('Error creating song:', err)
      state.error = err.message
      throw err
    } finally {
      state.saving = false
    }
  },

  // Update a song
  async updateSong(id, songData) {
    state.saving = true
    state.error = null

    try {
      const res = await authFetch(`/api/lyrics/songs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(songData)
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || 'Failed to update song')
      }

      const data = await res.json()

      // Update in songs list
      const index = state.songs.findIndex(s => s.id === id)
      if (index !== -1) {
        state.songs[index] = { ...state.songs[index], ...data.song }
      }

      if (state.currentSong && state.currentSong.id === id) {
        state.currentSong = { ...state.currentSong, ...data.song }
      }

      return data.song
    } catch (err) {
      console.error('Error updating song:', err)
      state.error = err.message
      throw err
    } finally {
      state.saving = false
    }
  },

  // Delete a song
  async deleteSong(id) {
    state.error = null

    try {
      const res = await authFetch(`/api/lyrics/songs/${id}`, {
        method: 'DELETE'
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || 'Failed to delete song')
      }

      state.songs = state.songs.filter(s => s.id !== id)

      if (state.currentSong && state.currentSong.id === id) {
        state.currentSong = null
        state.currentLyrics = []
      }
    } catch (err) {
      console.error('Error deleting song:', err)
      state.error = err.message
      throw err
    }
  },

  // Create a new lyric
  async createLyric(lyricData) {
    state.saving = true
    state.error = null

    try {
      const res = await authFetch('/api/lyrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lyricData)
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || 'Failed to create lyric')
      }

      const data = await res.json()

      // Add to appropriate list
      if (data.lyric.song_id) {
        state.currentLyrics.push(data.lyric)
      } else {
        state.standaloneLyrics.unshift(data.lyric)
      }

      return data.lyric
    } catch (err) {
      console.error('Error creating lyric:', err)
      state.error = err.message
      throw err
    } finally {
      state.saving = false
    }
  },

  // Update a lyric
  async updateLyric(id, lyricData) {
    state.saving = true
    state.error = null

    try {
      const res = await authFetch(`/api/lyrics/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lyricData)
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || 'Failed to update lyric')
      }

      const data = await res.json()

      // Update in current lyrics
      const index = state.currentLyrics.findIndex(l => l.id === id)
      if (index !== -1) {
        state.currentLyrics[index] = data.lyric
      }

      // Update in standalone lyrics
      const standaloneIndex = state.standaloneLyrics.findIndex(l => l.id === id)
      if (standaloneIndex !== -1) {
        if (data.lyric.song_id) {
          // Moved to a song, remove from standalone
          state.standaloneLyrics.splice(standaloneIndex, 1)
        } else {
          state.standaloneLyrics[standaloneIndex] = data.lyric
        }
      }

      return data.lyric
    } catch (err) {
      console.error('Error updating lyric:', err)
      state.error = err.message
      throw err
    } finally {
      state.saving = false
    }
  },

  // Delete a lyric
  async deleteLyric(id) {
    state.error = null

    try {
      const res = await authFetch(`/api/lyrics/${id}`, {
        method: 'DELETE'
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || 'Failed to delete lyric')
      }

      state.currentLyrics = state.currentLyrics.filter(l => l.id !== id)
      state.standaloneLyrics = state.standaloneLyrics.filter(l => l.id !== id)
    } catch (err) {
      console.error('Error deleting lyric:', err)
      state.error = err.message
      throw err
    }
  },

  // Add collaborator
  async addCollaborator(songId, handle, role = 'editor') {
    state.error = null

    try {
      const res = await authFetch(`/api/lyrics/songs/${songId}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, role })
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || 'Failed to add collaborator')
      }

      const data = await res.json()
      state.collaborators.push(data.collaborator)
      return data.collaborator
    } catch (err) {
      console.error('Error adding collaborator:', err)
      state.error = err.message
      throw err
    }
  },

  // Remove collaborator
  async removeCollaborator(songId, userId) {
    state.error = null

    try {
      const res = await authFetch(`/api/lyrics/songs/${songId}/collaborators/${userId}`, {
        method: 'DELETE'
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || 'Failed to remove collaborator')
      }

      state.collaborators = state.collaborators.filter(c => c.user_id !== userId)
    } catch (err) {
      console.error('Error removing collaborator:', err)
      state.error = err.message
      throw err
    }
  },

  // Clear current song
  clearCurrentSong() {
    state.currentSong = null
    state.currentLyrics = []
    state.collaborators = []
  },

  // Clear error
  clearError() {
    state.error = null
  }
})
