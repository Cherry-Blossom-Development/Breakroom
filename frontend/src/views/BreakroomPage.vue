<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { RouterLink } from 'vue-router'
import { GridLayout, GridItem } from 'grid-layout-plus'
import { breakroom } from '@/stores/breakroom.js'
import { user } from '@/stores/user.js'
import { authFetch } from '@/utilities/authFetch'
import BreakroomBlock from '@/components/BreakroomBlock.vue'
import AddBlockModal from '@/components/AddBlockModal.vue'
import LoadingSpinner from '@/components/LoadingSpinner.vue'

const showAddModal = ref(false)
const shortcuts = ref([])
const layoutKey = ref(0)
const mobileMenuOpen = ref(false)

const toggleMobileMenu = () => {
  mobileMenuOpen.value = !mobileMenuOpen.value
}

const closeMobileMenu = () => {
  mobileMenuOpen.value = false
}

// Mobile detection
const isMobile = ref(false)
const MOBILE_BREAKPOINT = 480

const checkMobile = () => {
  isMobile.value = window.innerWidth <= MOBILE_BREAKPOINT &&
    (window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= MOBILE_BREAKPOINT)
}

// Track which block is expanded (for mobile accordion - only one at a time)
const expandedBlockId = ref(null)

// Responsive breakpoints and column counts
const breakpoints = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }
const cols = { lg: 5, md: 4, sm: 3, xs: 2, xxs: 1 }
const rowHeight = ref(150)

// Derive the column count for the current viewport width so layoutItems can be
// seeded with the right positions before the grid fires @breakpoint-changed.
// The grid uses its container's offsetWidth for breakpoint detection, not
// window.innerWidth.  On desktop (≥ 769px) .app-content has margin-left: 220px
// for the sidebar, so we subtract that to match the grid's measurement.
const getCurrentColCount = () => {
  const sidebarWidth = window.innerWidth >= 769 ? 220 : 0
  const w = window.innerWidth - sidebarWidth
  if (w >= 1200) return 5
  if (w >= 996) return 4
  if (w >= 768) return 3
  if (w >= 480) return 2
  return 1
}

// Debounce timer for saving layout
let saveTimeout = null

// Layout items for grid (mutable ref for two-way binding)
const layoutItems = ref([])

// Responsive layout tracking
const currentColCount = ref(5)
const responsiveLayouts = ref({})

// While true, grid item transitions are suppressed so the initial correction
// from seed positions → responsive positions is invisible (no sliding animation).
const initializing = ref(true)
let initializingTimer = null

// Initialize layout from store (only once after fetch)
const initializeLayout = () => {
  // Seed layoutItems with positions for the *current* viewport breakpoint so
  // the grid renders correctly on first paint without a flash of 5-col layout.
  const colCount = getCurrentColCount()
  currentColCount.value = colCount
  const currentLayout = breakroom.getLayoutForColCount(colCount)
  layoutItems.value = currentLayout.map(item => ({
    ...item,
    block: breakroom.blocks.find(b => b.i === item.i)
  }))
  responsiveLayouts.value = breakroom.buildResponsiveLayouts()
  // Set first block as expanded by default on mobile
  if (layoutItems.value.length > 0 && expandedBlockId.value === null) {
    expandedBlockId.value = layoutItems.value[0].block.id
  }
}

// Handle breakpoint change from grid library
let ignoreNextMoves = false
const onBreakpointChanged = (newBreakpoint) => {
  currentColCount.value = cols[newBreakpoint]
  // Grid has settled on the correct breakpoint — safe to show transitions now
  if (initializing.value) {
    initializing.value = false
    if (initializingTimer) clearTimeout(initializingTimer)
  }
  // Ignore move/resize events triggered by the breakpoint reflow
  ignoreNextMoves = true
  setTimeout(() => { ignoreNextMoves = false }, 100)
}

// Look up block data from store by layout item id
const getBlock = (itemId) => {
  return breakroom.blocks.find(b => b.i === String(itemId)) || {}
}

// Toggle block expansion (only one at a time)
const toggleBlock = (blockId) => {
  if (expandedBlockId.value === blockId) {
    expandedBlockId.value = null
  } else {
    expandedBlockId.value = blockId
  }
}

// Handle user-initiated move/resize (not triggered by responsive changes)
const onItemMoved = () => {
  if (!ignoreNextMoves) saveLayoutDebounced()
}

const onItemResized = () => {
  if (!ignoreNextMoves) saveLayoutDebounced()
}

// Debounced save - saves per active column count
const saveLayoutDebounced = () => {
  if (saveTimeout) {
    clearTimeout(saveTimeout)
  }
  const colCount = currentColCount.value
  saveTimeout = setTimeout(() => {
    breakroom.saveLayoutForColCount(colCount, layoutItems.value)
  }, 500)
}

// Handle block removal
const onRemoveBlock = async (blockId) => {
  if (confirm('Remove this block from your layout?')) {
    await breakroom.removeBlock(blockId)
    // Immediately remove from layoutItems for instant UI update
    layoutItems.value = layoutItems.value.filter(item => parseInt(item.i) !== blockId)
    responsiveLayouts.value = breakroom.buildResponsiveLayouts()
  }
}

// Handle new block added
const onBlockAdded = () => {
  showAddModal.value = false
  // Reinitialize layout with new block
  initializeLayout()
  // Force re-render of grid
  layoutKey.value++
}

// Fetch user shortcuts
async function fetchShortcuts() {
  try {
    const res = await authFetch('/api/shortcuts')
    if (res.ok) {
      const data = await res.json()
      shortcuts.value = data.shortcuts
    }
  } catch (err) {
    console.error('Error fetching shortcuts:', err)
  }
}

onMounted(async () => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
  await Promise.all([
    breakroom.fetchLayout(),
    fetchShortcuts()
  ])
  initializeLayout()
  // Fallback: clear the initializing flag after 500ms in case @breakpoint-changed
  // fires before the watcher is ready or doesn't fire at all (already correct bp).
  initializingTimer = setTimeout(() => { initializing.value = false }, 500)
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
})
</script>

<template>
  <section class="breakroom-page">
    <header class="breakroom-header page-container">
      <h1>Breakroom</h1>

      <!-- Desktop: shortcuts and add button -->
      <div class="header-right desktop-only">
        <div class="shortcuts-list">
          <RouterLink to="/tool-shed" class="shortcut-link">
            Tool Shed
          </RouterLink>
          <RouterLink
            v-for="shortcut in shortcuts"
            :key="shortcut.id"
            :to="shortcut.url"
            class="shortcut-link"
          >
            {{ shortcut.name }}
          </RouterLink>
        </div>
        <button class="add-block-btn" @click="showAddModal = true">
          + Add Block
        </button>
      </div>

      <!-- Mobile: dropdown menu -->
      <div class="mobile-menu-container mobile-only">
        <button class="mobile-menu-toggle" @click="toggleMobileMenu" :class="{ open: mobileMenuOpen }">
          <span class="hamburger-line"></span>
          <span class="hamburger-line"></span>
          <span class="hamburger-line"></span>
        </button>
        <div v-if="mobileMenuOpen" class="mobile-dropdown" @click="closeMobileMenu">
          <button class="mobile-menu-item add-block-item" @click.stop="showAddModal = true; closeMobileMenu()">
            + Add Block
          </button>
          <RouterLink to="/tool-shed" class="mobile-menu-item">
            Tool Shed
          </RouterLink>
          <RouterLink
            v-for="shortcut in shortcuts"
            :key="shortcut.id"
            :to="shortcut.url"
            class="mobile-menu-item"
          >
            {{ shortcut.name }}
          </RouterLink>
        </div>
      </div>
    </header>

    <div v-if="breakroom.loading" class="loading">
      <LoadingSpinner size="small" />
      Loading your layout...
    </div>

    <div v-else-if="breakroom.blocks.length === 0" class="empty-state">
      <p>Your breakroom is empty!</p>
      <p class="hint">Click "Add Block" to add chat rooms and other content.</p>
    </div>

    <!-- Mobile: Simple accordion list -->
    <div v-else-if="isMobile" class="mobile-blocks">
      <div
        v-for="item in layoutItems"
        :key="item.i"
        class="mobile-block-wrapper"
        :class="{ expanded: expandedBlockId === item.block.id }"
      >
        <BreakroomBlock
          :block="item.block"
          :expanded="expandedBlockId === item.block.id"
          @remove="onRemoveBlock(item.block.id)"
          @toggle="toggleBlock(item.block.id)"
        />
      </div>
    </div>

    <!-- Desktop: Grid layout -->
    <div v-else class="grid-container" :class="{ initializing }">
      <GridLayout
        :key="layoutKey"
        v-model:layout="layoutItems"
        :col-num="5"
        :row-height="rowHeight"
        :is-draggable="true"
        :is-resizable="true"
        :responsive="true"
        :responsive-layouts="responsiveLayouts"
        :breakpoints="breakpoints"
        :cols="cols"
        :vertical-compact="true"
        :use-css-transforms="true"
        :margin="[10, 10]"
        @breakpoint-changed="onBreakpointChanged"
      >
        <GridItem
          v-for="item in layoutItems"
          :key="item.i"
          :i="item.i"
          :x="item.x"
          :y="item.y"
          :w="item.w"
          :h="item.h"
          :min-w="1"
          :min-h="1"
          :max-w="5"
          :max-h="4"
          drag-allow-from=".block-header"
          drag-ignore-from=".block-content"
          @moved="onItemMoved"
          @resized="onItemResized"
        >
          <BreakroomBlock
            :block="getBlock(item.i)"
            :expanded="expandedBlockId === parseInt(item.i)"
            @remove="onRemoveBlock(parseInt(item.i))"
            @toggle="toggleBlock(parseInt(item.i))"
          />
        </GridItem>
      </GridLayout>
    </div>

    <div v-if="breakroom.error" class="error-message">
      {{ breakroom.error }}
      <button @click="breakroom.clearError" class="dismiss-btn">Dismiss</button>
    </div>

    <AddBlockModal
      v-if="showAddModal"
      @close="showAddModal = false"
      @added="onBlockAdded"
    />

  </section>
</template>

<style scoped>
.breakroom-page {
  padding: 0;
  font-family: system-ui, sans-serif;
}

.breakroom-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.25rem 0 !important;
  margin-bottom: 0.5rem;
}

.breakroom-header h1 {
  margin: 0;
  font-size: 1.7rem;
  font-weight: 700;
  color: var(--color-accent);
  letter-spacing: -0.5px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.shortcuts-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.shortcut-link {
  display: inline-flex;
  align-items: center;
  padding: 8px 14px;
  background: var(--color-accent);
  color: white;
  text-decoration: none;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 500;
  transition: background 0.2s ease;
}

.shortcut-link:hover {
  background: var(--color-accent-hover);
}

.add-block-btn {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
  font-weight: 500;
  flex-shrink: 0;
}

.add-block-btn:hover {
  background: var(--color-accent-hover);
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 60px 20px;
  color: var(--color-text-muted);
  font-size: 1.1rem;
}

.empty-state {
  text-align: center;
  padding: 80px 20px;
  background: var(--color-background-soft);
  border-radius: 10px;
  color: var(--color-text-muted);
}

.empty-state p {
  margin: 0 0 10px;
  font-size: 1.2rem;
}

.empty-state .hint {
  font-size: 1rem;
  color: var(--color-text-light);
}

.grid-container {
  min-height: 300px;
}

.error-message {
  margin-top: 20px;
  padding: 10px 20px;
  background: var(--color-error-bg);
  color: var(--color-error);
  border-radius: 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dismiss-btn {
  background: none;
  border: none;
  color: var(--color-error);
  cursor: pointer;
  text-decoration: underline;
}

/* Vue Grid Layout overrides */
:deep(.vue-grid-item) {
  transition: all 200ms ease;
  touch-action: none;
}

/* Suppress transitions while the grid is correcting seed positions to the
   actual responsive layout, so users never see a sliding animation on load. */
.grid-container.initializing :deep(.vue-grid-item) {
  transition: none !important;
}

:deep(.vue-grid-item.vue-grid-placeholder) {
  background: var(--color-accent);
  opacity: 0.2;
  border-radius: 8px;
}

/* Mobile accordion layout */
.mobile-blocks {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 8px;
}

.mobile-block-wrapper {
  border-radius: 8px;
  overflow: hidden;
}

.mobile-block-wrapper :deep(.breakroom-block) {
  height: auto;
}

.mobile-block-wrapper :deep(.block-content) {
  display: none;
}

.mobile-block-wrapper.expanded {
  height: calc(100vh - 180px);
}

.mobile-block-wrapper.expanded :deep(.breakroom-block) {
  height: 100%;
}

.mobile-block-wrapper.expanded :deep(.block-content) {
  display: flex !important;
  flex: 1 !important;
  overflow-y: auto !important;
}

/* Mobile menu styles */
.mobile-only {
  display: none;
}

.mobile-menu-container {
  position: relative;
}

.mobile-menu-toggle {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 4px;
  width: 36px;
  height: 36px;
  background: var(--color-accent);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  padding: 8px;
}

.hamburger-line {
  display: block;
  width: 18px;
  height: 2px;
  background: white;
  border-radius: 1px;
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.mobile-menu-toggle.open .hamburger-line:nth-child(1) {
  transform: rotate(45deg) translate(4px, 4px);
}

.mobile-menu-toggle.open .hamburger-line:nth-child(2) {
  opacity: 0;
}

.mobile-menu-toggle.open .hamburger-line:nth-child(3) {
  transform: rotate(-45deg) translate(4px, -4px);
}

.mobile-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 8px;
  min-width: 180px;
  background: var(--color-background-card);
  border-radius: 8px;
  box-shadow: var(--shadow-lg, 0 10px 25px rgba(0, 0, 0, 0.15));
  overflow: hidden;
  z-index: 100;
}

.mobile-menu-item {
  display: block;
  width: 100%;
  padding: 12px 16px;
  text-align: left;
  text-decoration: none;
  color: var(--color-text);
  background: none;
  border: none;
  font-size: 0.95rem;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.mobile-menu-item:hover {
  background: var(--color-background-soft);
}

.mobile-menu-item.add-block-item {
  color: var(--color-accent);
  font-weight: 600;
  border-bottom: 1px solid var(--color-border-light);
}

/* Responsive breakpoints */
@media (max-width: 768px) {
  .desktop-only {
    display: none;
  }

  .mobile-only {
    display: block;
  }

  .breakroom-header {
    padding: 0.5rem 1rem !important;
  }
}
</style>
