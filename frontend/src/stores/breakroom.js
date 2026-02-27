import { reactive } from 'vue'
import { authFetch } from '../utilities/authFetch'

// Breakpoint name → column count mapping
const BREAKPOINT_COLS = { lg: 5, md: 4, sm: 3, xs: 2, xxs: 1 }

const state = reactive({
  blocks: [],
  positions: {}, // { blockId: { colCount: { x, y, w, h } } }
  loading: false,
  error: null
})

export const breakroom = reactive({
  get blocks() {
    return state.blocks
  },
  get positions() {
    return state.positions
  },
  get loading() {
    return state.loading
  },
  get error() {
    return state.error
  },

  // Fetch user's layout
  async fetchLayout() {
    state.loading = true
    state.error = null

    try {
      const res = await authFetch('/api/breakroom/layout')

      if (!res.ok) {
        throw new Error('Failed to fetch layout')
      }

      const data = await res.json()
      state.blocks = data.blocks.map(block => ({
        ...block,
        // vue-grid-layout uses 'i' as the unique identifier
        i: String(block.id)
      }))
      state.positions = data.positions || {}
    } catch (err) {
      console.error('Error fetching layout:', err)
      state.error = err.message
    } finally {
      state.loading = false
    }
  },

  // Get layout array for a specific column count
  getLayoutForColCount(colCount) {
    const savedItems = []
    const unsavedBlocks = []

    for (const block of state.blocks) {
      const saved = state.positions[block.id]?.[colCount]
      if (saved) {
        savedItems.push({ i: block.i, x: saved.x, y: saved.y, w: saved.w, h: saved.h })
      } else {
        unsavedBlocks.push(block)
      }
    }

    if (unsavedBlocks.length === 0) return savedItems

    // Initialize column heights from saved items so unsaved blocks land below them
    const colHeights = new Array(colCount).fill(0)
    for (const item of savedItems) {
      for (let col = item.x; col < item.x + item.w; col++) {
        colHeights[col] = Math.max(colHeights[col], item.y + item.h)
      }
    }

    // Pack unsaved blocks using a greedy column-filling algorithm (sorted by
    // original y then x to preserve the intended visual order). This guarantees
    // no two items share the same grid cell, avoiding the overlap/tall-widget
    // flash that the old naive x-clamping produced.
    unsavedBlocks.sort((a, b) => a.y - b.y || a.x - b.x)

    const unsavedItems = unsavedBlocks.map(block => {
      const w = Math.min(block.w, colCount)
      let bestX = 0
      let bestY = Infinity
      for (let x = 0; x <= colCount - w; x++) {
        const y = Math.max(...colHeights.slice(x, x + w))
        if (y < bestY) {
          bestY = y
          bestX = x
        }
      }
      for (let col = bestX; col < bestX + w; col++) {
        colHeights[col] = bestY + block.h
      }
      return { i: block.i, x: bestX, y: bestY, w, h: block.h }
    })

    return [...savedItems, ...unsavedItems]
  },

  // Build responsive layouts object for grid-layout-plus
  buildResponsiveLayouts() {
    const layouts = {}
    for (const [bp, colCount] of Object.entries(BREAKPOINT_COLS)) {
      layouts[bp] = this.getLayoutForColCount(colCount)
    }
    return layouts
  },

  // Save layout for a specific column count
  async saveLayoutForColCount(colCount, layoutItems) {
    try {
      const items = layoutItems.map(item => ({
        id: parseInt(item.i),
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h
      }))

      const res = await authFetch(`/api/breakroom/layout/${colCount}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      })

      if (!res.ok) {
        throw new Error('Failed to save layout')
      }

      // Update local cache
      for (const item of items) {
        if (!state.positions[item.id]) state.positions[item.id] = {}
        state.positions[item.id][colCount] = { x: item.x, y: item.y, w: item.w, h: item.h }
      }
    } catch (err) {
      console.error('Error saving layout:', err)
      state.error = err.message
      throw err
    }
  },

  // Add a new block
  async addBlock(blockType, contentId = null, options = {}) {
    try {
      const res = await authFetch('/api/breakroom/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          block_type: blockType,
          content_id: contentId,
          x: options.x || 0,
          y: options.y || 0,
          w: options.w || 2,
          h: options.h || 2,
          title: options.title || null,
          settings: options.settings || null
        })
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || 'Failed to create block')
      }

      const data = await res.json()
      const newBlock = {
        ...data.block,
        i: String(data.block.id)
      }
      state.blocks.push(newBlock)
      return newBlock
    } catch (err) {
      console.error('Error creating block:', err)
      state.error = err.message
      throw err
    }
  },

  // Update a single block
  async updateBlock(id, updates) {
    try {
      const res = await authFetch(`/api/breakroom/blocks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || 'Failed to update block')
      }

      const data = await res.json()
      const index = state.blocks.findIndex(b => b.id === id)
      if (index !== -1) {
        state.blocks[index] = {
          ...data.block,
          i: String(data.block.id)
        }
      }
      return data.block
    } catch (err) {
      console.error('Error updating block:', err)
      state.error = err.message
      throw err
    }
  },

  // Batch save layout positions (for drag-drop) - legacy, kept for backward compat
  async saveLayout(blocks) {
    try {
      const layoutData = blocks.map(b => ({
        id: parseInt(b.i),
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h
      }))

      const res = await authFetch('/api/breakroom/layout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks: layoutData })
      })

      if (!res.ok) {
        throw new Error('Failed to save layout')
      }

      // Update local state
      blocks.forEach(b => {
        const index = state.blocks.findIndex(sb => sb.i === b.i)
        if (index !== -1) {
          state.blocks[index].x = b.x
          state.blocks[index].y = b.y
          state.blocks[index].w = b.w
          state.blocks[index].h = b.h
        }
      })
    } catch (err) {
      console.error('Error saving layout:', err)
      state.error = err.message
      throw err
    }
  },

  // Remove a block
  async removeBlock(id) {
    try {
      const res = await authFetch(`/api/breakroom/blocks/${id}`, {
        method: 'DELETE'
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || 'Failed to delete block')
      }

      state.blocks = state.blocks.filter(b => b.id !== id)
      // Clean up positions cache
      delete state.positions[id]
    } catch (err) {
      console.error('Error deleting block:', err)
      state.error = err.message
      throw err
    }
  },

  // Clear error
  clearError() {
    state.error = null
  }
})
