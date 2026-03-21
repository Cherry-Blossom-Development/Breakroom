import { reactive } from 'vue'

const state = reactive({
  sessions: [],
  loaded: false
})

export const sessions = {
  get list() { return state.sessions },

  async load() {
    if (state.loaded) return
    try {
      const res = await fetch('/api/sessions', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        state.sessions = data.sessions
      }
    } catch (err) {
      console.error('Failed to load sessions:', err)
    } finally {
      state.loaded = true
    }
  },

  async upload(file, name, recordedAt) {
    const formData = new FormData()
    formData.append('audio', file)
    formData.append('name', name)
    if (recordedAt) formData.append('recorded_at', recordedAt)

    const res = await fetch('/api/sessions', {
      method: 'POST',
      credentials: 'include',
      body: formData
    })

    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.message || 'Upload failed')
    }

    const data = await res.json()
    state.sessions.unshift(data.session)
    return data.session
  },

  async update(id, patch) {
    const res = await fetch(`/api/sessions/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    })

    if (!res.ok) throw new Error('Update failed')

    const data = await res.json()
    const idx = state.sessions.findIndex(s => s.id === id)
    if (idx !== -1) state.sessions[idx] = data.session
  },

  async remove(id) {
    const res = await fetch(`/api/sessions/${id}`, {
      method: 'DELETE',
      credentials: 'include'
    })
    if (!res.ok) throw new Error('Delete failed')
    state.sessions = state.sessions.filter(s => s.id !== id)
  },

  reset() {
    state.sessions = []
    state.loaded = false
  }
}
