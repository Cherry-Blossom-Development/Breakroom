import { reactive } from 'vue'

const state = reactive({
  features: [],
  loaded: false
})

export const features = {
  async load() {
    if (state.loaded) return
    try {
      const res = await fetch('/api/features/mine', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        state.features = data.features
      }
    } catch (err) {
      // Silently fail — no features enabled
    } finally {
      state.loaded = true
    }
  },

  has(key) {
    return state.features.includes(key)
  },

  reset() {
    state.features = []
    state.loaded = false
  }
}
