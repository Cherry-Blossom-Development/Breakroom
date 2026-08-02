import { reactive } from 'vue'

const state = reactive({
  shortlists: [],
  loaded: false
})

export const shortlists = {
  get list() { return state.shortlists },

  async load() {
    if (state.loaded) return
    try {
      const res = await fetch('/api/shortlists/mine', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        state.shortlists = data.shortlists
      }
    } catch (err) {
      console.error('Failed to load shortlists:', err)
    } finally {
      state.loaded = true
    }
  },

  async refresh() {
    state.loaded = false
    return this.load()
  },

  async create(bandId, name) {
    const res = await fetch('/api/shortlists', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ band_id: bandId, name })
    })
    if (!res.ok) throw new Error('Failed to create shortlist')
    const data = await res.json()
    state.shortlists.push(data.shortlist)
    return data.shortlist
  },

  async rename(id, name) {
    const res = await fetch(`/api/shortlists/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
    if (!res.ok) throw new Error('Failed to rename shortlist')
    const shortlist = state.shortlists.find(s => s.id === id)
    if (shortlist) shortlist.name = name
  },

  async remove(id) {
    const res = await fetch(`/api/shortlists/${id}`, {
      method: 'DELETE',
      credentials: 'include'
    })
    if (!res.ok) throw new Error('Failed to delete shortlist')
    state.shortlists = state.shortlists.filter(s => s.id !== id)
  },

  async loadDetail(id) {
    const res = await fetch(`/api/shortlists/${id}`, { credentials: 'include' })
    if (!res.ok) throw new Error('Failed to load shortlist')
    return res.json()
  },

  async addSession(shortlistId, sessionId) {
    const res = await fetch(`/api/shortlists/${shortlistId}/sessions`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId })
    })
    if (!res.ok) throw new Error('Failed to add to shortlist')
    const shortlist = state.shortlists.find(s => s.id === shortlistId)
    if (shortlist) shortlist.item_count = (shortlist.item_count || 0) + 1
  },

  async removeSession(shortlistId, sessionId) {
    const res = await fetch(`/api/shortlists/${shortlistId}/sessions/${sessionId}`, {
      method: 'DELETE',
      credentials: 'include'
    })
    if (!res.ok) throw new Error('Failed to remove from shortlist')
    const shortlist = state.shortlists.find(s => s.id === shortlistId)
    if (shortlist && shortlist.item_count > 0) shortlist.item_count -= 1
  },

  async sessionShortlistIds(sessionId) {
    const res = await fetch(`/api/sessions/${sessionId}/shortlists`, { credentials: 'include' })
    if (!res.ok) return []
    const data = await res.json()
    return data.shortlistIds
  },

  reset() {
    state.shortlists = []
    state.loaded = false
  }
}
