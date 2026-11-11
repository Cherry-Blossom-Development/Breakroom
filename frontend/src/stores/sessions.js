import { reactive } from 'vue'

// Must match nginx client_max_body_size for the API (nginx/nginx.ec2.conf).
// A little headroom is left for the other multipart form fields.
export const MAX_UPLOAD_MB = 100
const MAX_UPLOAD_BYTES = (MAX_UPLOAD_MB - 1) * 1024 * 1024

function tooLargeMessage(size) {
  const mb = Math.round(size / (1024 * 1024))
  return `This file is ${mb} MB, which is over the ${MAX_UPLOAD_MB} MB upload limit. ` +
    'Try exporting it as an MP3 or another compressed format, or split it into shorter recordings.'
}

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

  async upload(file, name, recordedAt, bandId, sessionType, instrumentId) {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(tooLargeMessage(file.size))
    }

    const formData = new FormData()
    formData.append('audio', file)
    formData.append('name', name)
    if (recordedAt) formData.append('recorded_at', recordedAt)
    if (bandId) formData.append('band_id', bandId)
    if (sessionType) formData.append('session_type', sessionType)
    if (instrumentId) formData.append('instrument_id', instrumentId)

    const res = await fetch('/api/sessions', {
      method: 'POST',
      credentials: 'include',
      body: formData
    })

    if (!res.ok) {
      // Errors can come from nginx as an HTML page (e.g. 413 when the body is
      // over client_max_body_size), so don't assume the body is JSON.
      let err = {}
      try { err = await res.json() } catch { /* non-JSON error page */ }
      let message = err.message
      if (!message) {
        if (res.status === 413) message = tooLargeMessage(file.size)
        else if (res.status === 502 || res.status === 503 || res.status === 504) {
          message = 'The server did not respond in time. Please try again in a moment.'
        } else message = `Upload failed (error ${res.status}).`
      }
      const error = new Error(message)
      if (err.requiresSubscription) error.requiresSubscription = true
      throw error
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

  async rate(id, rating) {
    const res = await fetch(`/api/sessions/${id}/rate`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating })
    })
    if (!res.ok) throw new Error('Rating failed')
    const data = await res.json()
    const idx = state.sessions.findIndex(s => s.id === id)
    if (idx !== -1) {
      state.sessions[idx] = { ...state.sessions[idx], ...data }
    }
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
