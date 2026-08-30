<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const error = ref('')
const character = ref(null)
const currentSector = ref(null)
const connectedSectors = ref([])
const sectorFeatures = ref([])
const playersHere = ref([])
const credits = ref(0)
const rations = ref(0)
const inventory = ref([])
const itemsCatalog = ref([])
const knownLocations = ref([])
const viewportMode = ref('space') // 'space', 'outpost' (browsing what's for sale), 'cargo' (owned inventory), or 'charts' (known planets/outposts)
const purchasing = ref(false)
const purchaseError = ref('')
const chartsError = ref('')
const traveling = ref(false) // true while an autopilot course is being flown hop-by-hop
const navigating = ref(false)
const navError = ref('')
const logLines = ref([])
const selectedIndex = ref(-1) // -1 = nothing highlighted; Left/Right move this, Enter confirms it
const logEl = ref(null)
const stars = ref([])
const terminalInput = ref('')
const terminalInputEl = ref(null)

// Three-level keyboard hierarchy: 'inside' a box (typing/interacting with
// its contents) -> 'box' (a box is highlighted, arrows/Tab move between
// boxes) -> 'chrome' (the monitor bezel itself -- only the EXIT button
// lives here). Escape always climbs one level; Enter descends one (or
// activates EXIT at the chrome level). Starts 'inside' the terminal.
const level = ref('inside')
const activeBox = ref('terminal')
const BOX_ORDER = ['viewport', 'scan', 'actions', 'terminal', 'nav']

const FEATURE_LABELS = { planet: 'PLANET', trading_outpost: 'OUTPOST' }

const planetFeature = computed(() => sectorFeatures.value.find(f => f.feature_type === 'planet') || null)
const outpostFeature = computed(() => sectorFeatures.value.find(f => f.feature_type === 'trading_outpost') || null)

// What's available to do -- some entries are sector-dependent (grows as
// more sector content types get real interactions), but Cargo and Star
// Charts are always available since they're about the player's own ship
// and knowledge, not the current sector.
const actionItems = computed(() => {
  const items = []
  if (outpostFeature.value) items.push({ key: 'visit_outpost', label: 'Visit Outpost' })
  if (planetFeature.value) items.push({ key: 'planet_overview', label: 'Planet Overview' })
  items.push({ key: 'view_cargo', label: 'Cargo' })
  items.push({ key: 'view_charts', label: 'Star Charts' })
  return items
})

// The catalog plus a trailing "leave" entry, so the outpost view's list
// uses the same 1-based hotkey/arrow-cycle convention as the nav and
// actions boxes without a separate special case for leaving. __leave is a
// plain marker (not an item_key) shared across every overlay's "close/leave"
// row -- see activateViewportMenuItem.
const outpostMenuItems = computed(() => [
  ...itemsCatalog.value,
  { __leave: true, name: 'Leave Outpost', base_price: null }
])

// Known locations reachable from here (distance > 0) plus the trailing
// close row. Sectors the character is already standing in (distance 0)
// are shown separately in the template as static "(here)" rows -- nothing
// to plot a course to when you've already arrived.
const chartsMenuItems = computed(() => [
  ...knownLocations.value.filter(l => l.distance > 0),
  { __leave: true, name: 'Close Star Charts' }
])

// What the viewport box's keyboard handling should treat as "the current
// list" -- depends on which overlay (if any) is showing. Cargo's own view
// is otherwise static (just a read-only list), so its only interactive
// entry is the one that closes it.
const viewportMenuItems = computed(() => {
  if (viewportMode.value === 'outpost') return outpostMenuItems.value
  if (viewportMode.value === 'cargo') return [{ __leave: true, name: 'Close Cargo' }]
  if (viewportMode.value === 'charts') return chartsMenuItems.value
  return []
})

function inventoryQuantity(itemKey) {
  return inventory.value.find(i => i.item_key === itemKey)?.quantity || 0
}

// Deterministic-per-name hue so the same planet always renders the same
// color when revisited, without needing to store a color anywhere.
function hashHue(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) % 360
  return hash
}

function regenerateStarfield() {
  const count = 22 + Math.floor(Math.random() * 14)
  stars.value = Array.from({ length: count }, () => ({
    top: Math.random() * 100,
    left: Math.random() * 100,
    big: Math.random() < 0.15
  }))
}

function scrollLogToBottom() {
  nextTick(() => {
    if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
  })
}

// One roughly-line-height nudge per arrow press, for keyboard scrolling.
function scrollLog(direction) {
  if (logEl.value) logEl.value.scrollTop += direction * 24
}

// Real DOM focus follows the logical level/box so the terminal <input>
// only actually captures keystrokes while the player is "inside" it --
// otherwise Left/Right (elsewhere) or plain letters would land in the box
// unexpectedly.
function syncTerminalFocus() {
  nextTick(() => {
    if (level.value === 'inside' && activeBox.value === 'terminal') {
      terminalInputEl.value?.focus()
    } else {
      terminalInputEl.value?.blur()
    }
  })
}

// Mouse-driven: clicking anywhere in a box makes it the active one for
// keyboard purposes too, so switching between mouse and keyboard stays
// coherent instead of the two tracking separate state.
function focusBox(box) {
  if (box !== activeBox.value) selectedIndex.value = -1
  activeBox.value = box
  level.value = 'inside'
  syncTerminalFocus()
}

function cycleBox(direction) {
  const idx = BOX_ORDER.indexOf(activeBox.value)
  activeBox.value = BOX_ORDER[(idx + direction + BOX_ORDER.length) % BOX_ORDER.length]
  selectedIndex.value = -1
}

// CSS class for a box's border/title depending on where it sits relative
// to the current level -- 'box-selected' (level 2, highlighted but not
// entered) vs 'box-active' (level 3, currently inside it).
function boxStateClass(box) {
  if (activeBox.value !== box) return {}
  if (level.value === 'box') return { 'box-selected': true }
  if (level.value === 'inside') return { 'box-active': true }
  return {}
}

// "Visit Outpost", "Cargo", and "Star Charts" all switch the viewport into
// an overlay mode (everything else on screen stays the same); "Planet
// Overview" has no real system behind it yet, so it just logs a stub
// notice.
function performAction(item) {
  if (item.key === 'visit_outpost') {
    viewportMode.value = 'outpost'
    purchaseError.value = ''
    selectedIndex.value = -1
    logLines.value.push(`Docking at ${outpostFeature.value ? outpostFeature.value.name : 'the outpost'}.`)
  } else if (item.key === 'planet_overview') {
    logLines.value.push('Planetary survey systems are not available yet.')
  } else if (item.key === 'view_cargo') {
    viewportMode.value = 'cargo'
    selectedIndex.value = -1
    logLines.value.push('Pulling up the cargo manifest.')
  } else if (item.key === 'view_charts') {
    viewportMode.value = 'charts'
    selectedIndex.value = -1
    chartsError.value = ''
    logLines.value.push('Pulling up star charts.')
    loadKnownLocations()
  }
  scrollLogToBottom()
}

const OVERLAY_CLOSE_MESSAGES = {
  outpost: 'Departing the outpost.',
  cargo: 'Closing the cargo manifest.',
  charts: 'Closing star charts.'
}

function exitViewportOverlay() {
  const message = OVERLAY_CLOSE_MESSAGES[viewportMode.value] || 'Closing.'
  viewportMode.value = 'space'
  selectedIndex.value = -1
  purchaseError.value = ''
  chartsError.value = ''
  logLines.value.push(message)
  scrollLogToBottom()
}

async function purchaseItem(entry) {
  if (purchasing.value) return
  purchasing.value = true
  purchaseError.value = ''
  try {
    const res = await fetch(`/api/games/haulonaut/characters/${route.params.characterId}/purchase`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_key: entry.item_key, quantity: 1 })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message || 'Purchase failed')
    credits.value = data.credits
    rations.value = data.rations
    inventory.value = data.inventory || []
    logLines.value.push(`Purchased 1 ${entry.name}. (-${entry.base_price} Credits)`)
    scrollLogToBottom()
  } catch (err) {
    purchaseError.value = err.message
  } finally {
    purchasing.value = false
  }
}

function activateViewportMenuItem(entry) {
  if (entry.__leave) {
    exitViewportOverlay()
  } else if (viewportMode.value === 'outpost') {
    purchaseItem(entry)
  } else if (viewportMode.value === 'charts') {
    setCourse(entry)
  }
}

function submitTerminalCommand() {
  const text = terminalInput.value.trim()
  if (!text) return
  logLines.value.push(text)
  logLines.value.push('Command not recognized.')
  terminalInput.value = ''
  scrollLogToBottom()
}

async function loadCharacter() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch(`/api/games/haulonaut/characters/${route.params.characterId}`, { credentials: 'include' })
    if (!res.ok) throw new Error(res.status === 404 ? 'Character not found' : 'Failed to load')
    const data = await res.json()
    character.value = data.character
    currentSector.value = data.currentSector
    connectedSectors.value = data.connectedSectors || []
    sectorFeatures.value = data.features || []
    playersHere.value = data.playersHere || []
    credits.value = data.credits || 0
    rations.value = data.rations || 0
    inventory.value = data.inventory || []
    regenerateStarfield()
    logLines.value = [
      'Docking confirmed.',
      data.currentSector ? `Arrived in Sector ${data.currentSector.sector_number}.` : null
    ].filter(Boolean)
    scrollLogToBottom()
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

async function loadItemsCatalog() {
  try {
    const res = await fetch('/api/games/haulonaut/items', { credentials: 'include' })
    if (!res.ok) return
    const data = await res.json()
    itemsCatalog.value = data.items || []
  } catch {
    // Non-fatal -- the outpost view just shows nothing for sale if this fails.
  }
}

async function loadKnownLocations() {
  try {
    const res = await fetch(`/api/games/haulonaut/characters/${route.params.characterId}/known-locations`, { credentials: 'include' })
    if (!res.ok) return
    const data = await res.json()
    knownLocations.value = data.locations || []
  } catch {
    knownLocations.value = []
  }
}

// Returns true/false rather than throwing, so travelAlongPath can tell a
// failed hop apart from a successful one and stop the course instead of
// blindly continuing.
async function navigateTo(sector) {
  if (navigating.value) return false
  navigating.value = true
  navError.value = ''
  try {
    const res = await fetch(`/api/games/haulonaut/characters/${route.params.characterId}/navigate`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to_sector_id: sector.id })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message || 'Navigation failed')
    logLines.value.push(`Warping to Sector ${sector.sector_number}...`)
    currentSector.value = data.currentSector
    connectedSectors.value = data.connectedSectors || []
    sectorFeatures.value = data.features || []
    playersHere.value = data.playersHere || []
    credits.value = data.credits || 0
    rations.value = data.rations || 0
    viewportMode.value = 'space'
    regenerateStarfield()
    logLines.value.push(`Arrived in Sector ${data.currentSector.sector_number}.`)
    selectedIndex.value = -1
    scrollLogToBottom()
    return true
  } catch (err) {
    navError.value = err.message
    return false
  } finally {
    navigating.value = false
  }
}

// A direct player-initiated warp (click or keyboard on the nav box) always
// takes precedence over an in-progress autopilot course -- cancels it
// before the manual warp goes through.
function manualNavigateTo(sector) {
  if (traveling.value) traveling.value = false
  navigateTo(sector)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Flies the character along a precomputed path (path[0] is the current
// sector, skipped) one hop at a time via the same navigateTo() a manual
// warp uses -- rations still drain and each link is still re-validated
// server-side, exactly like clicking each warp button in sequence. Runs in
// the background (not awaited by its caller); traveling.value is both the
// "is it running" flag and the cancellation switch -- setting it false
// from anywhere (Escape, a manual warp) stops the loop before its next hop.
async function travelAlongPath(path) {
  traveling.value = true
  let completed = true
  for (let i = 1; i < path.length; i++) {
    if (!traveling.value) { completed = false; break }
    const ok = await navigateTo(path[i])
    if (!ok) { completed = false; break }
    if (traveling.value && i < path.length - 1) await sleep(600)
  }
  if (completed && traveling.value) {
    logLines.value.push('Course complete.')
    scrollLogToBottom()
  }
  traveling.value = false
}

async function setCourse(location) {
  if (traveling.value) return
  chartsError.value = ''
  try {
    const res = await fetch(`/api/games/haulonaut/characters/${route.params.characterId}/route/${location.sector_id}`, { credentials: 'include' })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message || 'Failed to plot course')
    const path = data.path || []
    if (path.length <= 1) return
    const hops = path.length - 1
    logLines.value.push(`Course plotted to ${location.name} (${hops} hop${hops === 1 ? '' : 's'}).`)
    logLines.value.push('Autopilot engaged.')
    scrollLogToBottom()
    travelAlongPath(path)
  } catch (err) {
    chartsError.value = err.message
  }
}

function backToGames() {
  router.push('/games')
}

function onKeydown(e) {
  // Escape always stops an in-progress autopilot course first, in addition
  // to (not instead of) its usual level-climbing below.
  if (e.key === 'Escape' && traveling.value) {
    traveling.value = false
    logLines.value.push('Autopilot disengaged.')
    scrollLogToBottom()
  }

  // Escape always climbs one level, from wherever the player currently is.
  if (e.key === 'Escape') {
    e.preventDefault()
    if (level.value === 'inside') {
      level.value = 'box'
      selectedIndex.value = -1
      syncTerminalFocus()
    } else if (level.value === 'box') {
      level.value = 'chrome'
    } else {
      // Already at the outermost level -- back down to box level rather
      // than a dead end; only Enter on EXIT from here actually leaves.
      level.value = 'box'
    }
    return
  }

  // Chrome level: the only reachable thing is the EXIT button.
  if (level.value === 'chrome') {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      backToGames()
    }
    return
  }

  // Box level: arrows (any direction) or Tab cycle between boxes; Enter
  // descends into the highlighted one.
  if (level.value === 'box') {
    if (e.key === 'Tab') {
      e.preventDefault()
      cycleBox(e.shiftKey ? -1 : 1)
      return
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      cycleBox(1)
      return
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      cycleBox(-1)
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      level.value = 'inside'
      syncTerminalFocus()
    }
    return
  }

  // level === 'inside' -- behavior depends on which box.
  if (activeBox.value === 'terminal') {
    if (e.key === 'ArrowUp') { e.preventDefault(); scrollLog(-1); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); scrollLog(1); return }
    if (e.key === 'Enter') { e.preventDefault(); submitTerminalCommand(); return }
    return
  }

  if (activeBox.value === 'nav') {
    if (navigating.value || connectedSectors.value.length === 0) return
    const count = connectedSectors.value.length

    if (e.key === 'ArrowRight' || e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      selectedIndex.value = selectedIndex.value === -1 ? 0 : (selectedIndex.value + 1) % count
      return
    }
    if (e.key === 'ArrowLeft' || e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      selectedIndex.value = selectedIndex.value === -1 ? 0 : (selectedIndex.value - 1 + count) % count
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (selectedIndex.value !== -1) {
        e.preventDefault()
        manualNavigateTo(connectedSectors.value[selectedIndex.value])
      }
      return
    }

    // Number keys 1-6 are a direct fast path (jump straight to that button
    // without needing to arrow over to it first) -- sectors can have at
    // most 6 connections, so this always covers every option.
    const hotkeyIndex = parseInt(e.key, 10) - 1
    if (Number.isInteger(hotkeyIndex) && hotkeyIndex >= 0 && connectedSectors.value[hotkeyIndex]) {
      selectedIndex.value = hotkeyIndex
      manualNavigateTo(connectedSectors.value[hotkeyIndex])
    }
    return
  }

  if (activeBox.value === 'actions') {
    if (traveling.value || actionItems.value.length === 0) return
    const count = actionItems.value.length

    if (e.key === 'ArrowDown' || e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      selectedIndex.value = selectedIndex.value === -1 ? 0 : (selectedIndex.value + 1) % count
      return
    }
    if (e.key === 'ArrowUp' || e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      selectedIndex.value = selectedIndex.value === -1 ? 0 : (selectedIndex.value - 1 + count) % count
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (selectedIndex.value !== -1) {
        e.preventDefault()
        performAction(actionItems.value[selectedIndex.value])
      }
      return
    }

    // Number-key fast path, same idea as the nav box's 1-6 hotkeys.
    const hotkeyIndex = parseInt(e.key, 10) - 1
    if (Number.isInteger(hotkeyIndex) && hotkeyIndex >= 0 && actionItems.value[hotkeyIndex]) {
      selectedIndex.value = hotkeyIndex
      performAction(actionItems.value[hotkeyIndex])
    }
    return
  }

  if (activeBox.value === 'viewport') {
    // Space view is passive/read-only; outpost, cargo, and charts overlays
    // all have something to navigate, mirroring the actions/nav boxes' own
    // arrow+hotkey pattern. Blocked entirely mid-autopilot.
    if (traveling.value || viewportMode.value === 'space') return
    const items = viewportMenuItems.value
    if (items.length === 0) return
    const count = items.length

    if (e.key === 'ArrowDown' || e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      selectedIndex.value = selectedIndex.value === -1 ? 0 : (selectedIndex.value + 1) % count
      return
    }
    if (e.key === 'ArrowUp' || e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      selectedIndex.value = selectedIndex.value === -1 ? 0 : (selectedIndex.value - 1 + count) % count
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (selectedIndex.value !== -1) {
        e.preventDefault()
        activateViewportMenuItem(items[selectedIndex.value])
      }
      return
    }

    const hotkeyIndex = parseInt(e.key, 10) - 1
    if (Number.isInteger(hotkeyIndex) && hotkeyIndex >= 0 && items[hotkeyIndex]) {
      selectedIndex.value = hotkeyIndex
      activateViewportMenuItem(items[hotkeyIndex])
    }
    return
  }

  // scan: a passive read-only box, nothing to do while inside it beyond
  // Escape (handled above).
}

onMounted(async () => {
  await Promise.all([loadCharacter(), loadItemsCatalog()])
  syncTerminalFocus()
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="crt-fullscreen">
    <div v-if="loading" class="crt-status">Loading...</div>
    <div v-else-if="error" class="crt-status">
      <p>{{ error }}</p>
      <button class="exit-link" @click="backToGames">Back to Games</button>
    </div>

    <div v-else class="crt-monitor">
      <div class="crt-bezel">
        <div class="crt-brand" aria-hidden="true">PROSAURUS <span class="crt-brand-model">MODEL H-88</span></div>

        <div class="crt-screen-frame">
          <div class="crt-screen">
            <div class="crt-scanlines" aria-hidden="true"></div>
            <div class="crt-glow" aria-hidden="true"></div>
            <div class="crt-content">
              <div class="crt-header">
                <span class="header-name">{{ character.display_name }}</span>
                <div class="header-resources">
                  <span class="resource-stat" :class="{ 'resource-empty': credits <= 0 }">
                    <span class="resource-icon" aria-hidden="true">&#164;</span>{{ credits.toLocaleString() }} <span class="resource-unit">Credits</span>
                  </span>
                  <span class="resource-stat" :class="{ 'resource-empty': rations <= 0 }">
                    <span class="resource-icon" aria-hidden="true">&#8801;</span>{{ rations.toLocaleString() }} <span class="resource-unit">Rations</span>
                  </span>
                </div>
                <span class="header-status">STATUS: <span class="status-active">{{ character.status.toUpperCase() }}</span></span>
              </div>

              <div class="crt-grid">
                <!-- Viewport: what you'd see out the window -->
                <div class="tui-panel panel-viewport" :class="boxStateClass('viewport')" @click="focusBox('viewport')">
                  <span class="tui-panel-title">
                    <span v-if="activeBox === 'viewport' && level === 'inside'" aria-hidden="true">&#9658; </span><span v-if="activeBox === 'viewport' && level === 'box'" aria-hidden="true">[ </span>VIEWPORT<span v-if="activeBox === 'viewport' && level === 'box'" aria-hidden="true"> ]</span>
                  </span>
                  <div v-if="viewportMode === 'outpost'" class="tui-panel-body outpost-body">
                    <p class="outpost-heading">{{ outpostFeature ? outpostFeature.name.toUpperCase() : 'TRADING OUTPOST' }}</p>
                    <div class="outpost-items">
                      <button
                        v-for="(entry, i) in outpostMenuItems"
                        :key="entry.__leave ? '__leave' : entry.item_key"
                        class="outpost-item-btn"
                        :class="{ selected: selectedIndex === i, 'outpost-leave-btn': entry.__leave }"
                        :disabled="purchasing"
                        :aria-pressed="selectedIndex === i"
                        @click="activateViewportMenuItem(entry)"
                      >
                        <span class="outpost-item-hotkey" aria-hidden="true">{{ i + 1 }}</span>
                        <span class="outpost-item-name">{{ entry.name }}</span>
                        <span v-if="!entry.__leave && inventoryQuantity(entry.item_key) > 0" class="outpost-item-owned">owned {{ inventoryQuantity(entry.item_key) }}</span>
                        <span v-if="entry.base_price !== null && entry.base_price !== undefined" class="outpost-item-price" aria-hidden="true">&#164;{{ entry.base_price }}</span>
                      </button>
                    </div>
                    <p v-if="purchaseError" class="outpost-error">{{ purchaseError }}</p>
                  </div>

                  <div v-else-if="viewportMode === 'cargo'" class="tui-panel-body outpost-body">
                    <p class="outpost-heading">CARGO MANIFEST</p>
                    <div v-if="inventory.length > 0" class="cargo-list">
                      <p v-for="entry in inventory" :key="entry.item_key" class="cargo-list-row">
                        {{ entry.name }} <span class="cargo-list-qty">&times;{{ entry.quantity }}</span>
                      </p>
                    </div>
                    <p v-else class="cargo-empty">Cargo hold is empty.</p>
                    <div class="outpost-items">
                      <button
                        class="outpost-item-btn outpost-leave-btn"
                        :class="{ selected: selectedIndex === 0 }"
                        :aria-pressed="selectedIndex === 0"
                        @click="exitViewportOverlay()"
                      >
                        <span class="outpost-item-hotkey" aria-hidden="true">1</span>
                        <span class="outpost-item-name">Close Cargo</span>
                      </button>
                    </div>
                  </div>

                  <div v-else-if="viewportMode === 'charts'" class="tui-panel-body outpost-body">
                    <p class="outpost-heading">STAR CHARTS</p>
                    <div v-if="knownLocations.length === 0" class="cargo-empty">No known locations yet -- explore more sectors.</div>
                    <template v-else>
                      <div v-if="knownLocations.some(l => l.distance === 0)" class="cargo-list">
                        <p v-for="loc in knownLocations.filter(l => l.distance === 0)" :key="loc.id" class="cargo-list-row">
                          {{ loc.name }} <span class="chart-type-tag">({{ FEATURE_LABELS[loc.feature_type] || loc.feature_type }})</span> <span class="chart-here-tag">HERE</span>
                        </p>
                      </div>
                      <div class="outpost-items">
                        <button
                          v-for="(entry, i) in chartsMenuItems"
                          :key="entry.__leave ? '__leave' : entry.id"
                          class="outpost-item-btn"
                          :class="{ selected: selectedIndex === i, 'outpost-leave-btn': entry.__leave }"
                          :disabled="traveling"
                          :aria-pressed="selectedIndex === i"
                          @click="activateViewportMenuItem(entry)"
                        >
                          <span class="outpost-item-hotkey" aria-hidden="true">{{ i + 1 }}</span>
                          <span class="outpost-item-name">
                            <template v-if="!entry.__leave">{{ entry.name }} <span class="chart-type-tag">({{ FEATURE_LABELS[entry.feature_type] || entry.feature_type }})</span></template>
                            <template v-else>{{ entry.name }}</template>
                          </span>
                          <span v-if="!entry.__leave" class="chart-distance" aria-hidden="true">Sector {{ entry.sector_number }} &middot; {{ entry.distance }} hop{{ entry.distance === 1 ? '' : 's' }}</span>
                        </button>
                      </div>
                    </template>
                    <p v-if="chartsError" class="outpost-error">{{ chartsError }}</p>
                  </div>

                  <div v-else class="tui-panel-body viewport-body">
                    <div class="starfield" aria-hidden="true">
                      <span
                        v-for="(star, i) in stars"
                        :key="i"
                        class="star"
                        :class="{ big: star.big }"
                        :style="{ top: star.top + '%', left: star.left + '%' }"
                      ></span>
                    </div>
                    <div class="viewport-scene">
                      <div v-if="planetFeature" class="viewport-object planet-object">
                        <div class="planet-sphere" :style="{ background: `radial-gradient(circle at 35% 32%, hsl(${hashHue(planetFeature.name)},75%,68%), hsl(${hashHue(planetFeature.name)},60%,38%) 65%, hsl(${hashHue(planetFeature.name)},55%,18%) 100%)` }"></div>
                        <span class="viewport-label">{{ planetFeature.name }}</span>
                      </div>
                      <div v-if="outpostFeature" class="viewport-object outpost-object">
                        <div class="outpost-glyph" aria-hidden="true">&#9670;</div>
                        <span class="viewport-label">{{ outpostFeature.name }}</span>
                      </div>
                    </div>
                    <p v-if="currentSector?.description" class="viewport-caption">{{ currentSector.description }}</p>
                  </div>
                </div>

                <!-- Sector scan: structured "what's here" readout -->
                <div class="tui-panel panel-scan" :class="boxStateClass('scan')" @click="focusBox('scan')">
                  <span class="tui-panel-title">
                    <span v-if="activeBox === 'scan' && level === 'inside'" aria-hidden="true">&#9658; </span><span v-if="activeBox === 'scan' && level === 'box'" aria-hidden="true">[ </span>SECTOR SCAN<span v-if="activeBox === 'scan' && level === 'box'" aria-hidden="true"> ]</span>
                  </span>
                  <div class="tui-panel-body scan-body">
                    <p class="scan-row">SECTOR <strong>{{ currentSector ? currentSector.sector_number : '—' }}</strong></p>
                    <template v-if="sectorFeatures.length > 0">
                      <p v-for="f in sectorFeatures" :key="f.id" class="scan-row">{{ FEATURE_LABELS[f.feature_type] || f.feature_type }}: {{ f.name }}</p>
                    </template>
                    <p v-else class="scan-row scan-empty">No contacts.</p>
                    <template v-if="playersHere.length > 0">
                      <p class="scan-row scan-divider">PILOTS:</p>
                      <p v-for="p in playersHere" :key="p.id" class="scan-row">{{ p.display_name }}</p>
                    </template>
                  </div>
                </div>

                <!-- Actions: context-sensitive things to do in this sector -->
                <div class="tui-panel panel-actions" :class="boxStateClass('actions')" @click="focusBox('actions')">
                  <span class="tui-panel-title">
                    <span v-if="activeBox === 'actions' && level === 'inside'" aria-hidden="true">&#9658; </span><span v-if="activeBox === 'actions' && level === 'box'" aria-hidden="true">[ </span>ACTIONS<span v-if="activeBox === 'actions' && level === 'box'" aria-hidden="true"> ]</span>
                  </span>
                  <div class="tui-panel-body actions-body">
                    <template v-if="actionItems.length > 0">
                      <button
                        v-for="(item, i) in actionItems"
                        :key="item.key"
                        class="action-btn"
                        :class="{ selected: selectedIndex === i }"
                        :disabled="traveling"
                        :aria-label="`${item.label} (key ${i + 1})`"
                        :aria-pressed="selectedIndex === i"
                        @click="performAction(item)"
                      >
                        <span class="action-hotkey" aria-hidden="true">{{ i + 1 }}</span>{{ item.label }}
                      </button>
                    </template>
                    <p v-else class="actions-empty">No actions available.</p>
                  </div>
                </div>

                <!-- Terminal: chronological action history + command input -->
                <div class="tui-panel panel-log" :class="boxStateClass('terminal')" @click="focusBox('terminal')">
                  <span class="tui-panel-title">
                    <span v-if="activeBox === 'terminal' && level === 'inside'" aria-hidden="true">&#9658; </span><span v-if="activeBox === 'terminal' && level === 'box'" aria-hidden="true">[ </span>TERMINAL<span v-if="activeBox === 'terminal' && level === 'box'" aria-hidden="true"> ]</span>
                  </span>
                  <div class="tui-panel-body log-body" ref="logEl">
                    <p v-for="(line, i) in logLines" :key="i" class="log-line">&gt; {{ line }}</p>
                    <p v-if="navError" class="log-line log-error">&gt; {{ navError }}</p>
                    <p class="log-line log-prompt">
                      &gt;
                      <input
                        ref="terminalInputEl"
                        v-model="terminalInput"
                        class="terminal-input"
                        type="text"
                        maxlength="200"
                        autocomplete="off"
                        spellcheck="false"
                        aria-label="Terminal command input"
                        @keydown.enter.prevent="submitTerminalCommand"
                      />
                      <span class="terminal-cursor" aria-hidden="true">_</span>
                    </p>
                  </div>
                </div>

                <!-- Navigation: current location + warp targets -->
                <div class="tui-panel panel-nav" :class="boxStateClass('nav')" @click="focusBox('nav')">
                  <span class="tui-panel-title">
                    <span v-if="activeBox === 'nav' && level === 'inside'" aria-hidden="true">&#9658; </span><span v-if="activeBox === 'nav' && level === 'box'" aria-hidden="true">[ </span>NAVIGATION<span v-if="activeBox === 'nav' && level === 'box'" aria-hidden="true"> ]</span>
                  </span>
                  <div class="tui-panel-body nav-body">
                    <div class="navbar-location">
                      SECTOR <span class="navbar-location-num">{{ currentSector ? currentSector.sector_number : '—' }}</span>
                    </div>
                    <div class="navbar-warps">
                      <span class="navbar-label">WARP TO:</span>
                      <template v-if="connectedSectors.length > 0">
                        <button
                          v-for="(s, i) in connectedSectors"
                          :key="s.id"
                          class="warp-btn"
                          :class="{ selected: selectedIndex === i, visited: s.visited }"
                          :disabled="navigating"
                          :aria-label="`Warp to Sector ${s.sector_number} (key ${i + 1})${s.visited ? ', visited' : ', unexplored'}`"
                          :aria-pressed="selectedIndex === i"
                          @click="manualNavigateTo(s)"
                        >
                          <span class="warp-cursor" aria-hidden="true">{{ selectedIndex === i ? '▶' : '' }}</span><span class="warp-hotkey" aria-hidden="true">{{ i + 1 }}</span>{{ s.sector_number }}<span v-if="s.visited" class="warp-visited-mark" aria-hidden="true">&middot;</span>
                        </button>
                      </template>
                      <span v-else class="navbar-none">no warps available</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="crt-controls">
          <span class="crt-led" aria-hidden="true"></span>
          <span class="crt-knob" aria-hidden="true"></span>
          <span class="crt-knob" aria-hidden="true"></span>
          <button class="crt-exit-btn" :class="{ 'chrome-selected': level === 'chrome' }" @click="backToGames">&#9211; EXIT</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.crt-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(ellipse at center, #2a2a2e 0%, #101012 70%, #050506 100%);
  padding: 20px;
  box-sizing: border-box;
}

.crt-status {
  color: #cfcfd4;
  text-align: center;
  font-family: 'Courier New', Courier, monospace;
}

.exit-link {
  margin-top: 14px;
  background: none;
  border: 1px solid #8f8f96;
  color: #cfcfd4;
  border-radius: 4px;
  padding: 8px 16px;
  font-family: inherit;
  cursor: pointer;
}

.exit-link:hover { background: rgba(255, 255, 255, 0.08); }

/* ---- Monitor ---- */
.crt-monitor {
  width: min(90vw, calc(88vh * 4 / 3));
  max-width: 1100px;
  aspect-ratio: 4 / 3;
}

.crt-bezel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: linear-gradient(160deg, #d8cdb8 0%, #c3b79f 45%, #a89b82 100%);
  border-radius: 22px;
  padding: 22px 28px 16px;
  box-sizing: border-box;
  box-shadow:
    0 30px 60px rgba(0, 0, 0, 0.55),
    inset 0 2px 3px rgba(255, 255, 255, 0.4),
    inset 0 -6px 10px rgba(0, 0, 0, 0.25);
}

.crt-brand {
  flex-shrink: 0;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #6b6153;
  margin-bottom: 10px;
}

.crt-brand-model {
  font-weight: 400;
  color: #8a8071;
}

/* ---- Screen ---- */
.crt-screen-frame {
  flex: 1;
  min-height: 0;
  background: #1a1712;
  border-radius: 14px;
  padding: 3%;
  box-sizing: border-box;
  box-shadow:
    inset 0 0 0 2px #0c0a08,
    inset 0 10px 30px rgba(0, 0, 0, 0.8);
}

.crt-screen {
  position: relative;
  height: 100%;
  background: radial-gradient(ellipse at center, #06170c 0%, #030b06 80%, #020602 100%);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: inset 0 0 40px rgba(0, 0, 0, 0.9);
}

.crt-scanlines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0) 0px,
    rgba(0, 0, 0, 0) 2px,
    rgba(0, 0, 0, 0.25) 3px
  );
}

.crt-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at center, rgba(77, 255, 136, 0.08) 0%, rgba(0, 0, 0, 0) 65%);
}

.crt-content {
  position: relative;
  height: 100%;
  box-sizing: border-box;
  padding: clamp(8px, 2%, 16px);
  display: flex;
  flex-direction: column;
  gap: clamp(6px, 1.5%, 12px);
  color: #4dff88;
  font-family: 'Courier New', Courier, monospace;
}

.terminal-cursor {
  animation: terminal-blink 1s step-end infinite;
}

@media (prefers-reduced-motion: reduce) {
  .terminal-cursor { animation: none; }
}

@keyframes terminal-blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}

.status-active {
  color: #2fd66e;
  font-weight: 700;
}

/* ---- Header strip ---- */
.crt-header {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  padding: 0 2px;
}

.header-name {
  font-size: clamp(0.9rem, 2.4vw, 1.2rem);
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #baffcf;
  text-shadow: 0 0 6px rgba(77, 255, 136, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-status {
  flex-shrink: 0;
  font-size: 0.7rem;
  letter-spacing: 0.05em;
  color: #5fae7c;
}

.header-resources {
  display: flex;
  align-items: baseline;
  gap: clamp(8px, 2vw, 18px);
  font-size: 0.75rem;
  color: #baffcf;
}

.resource-stat {
  white-space: nowrap;
}

.resource-icon {
  margin-right: 2px;
  color: #8fe6ab;
}

.resource-unit {
  font-size: 0.65rem;
  color: #5fae7c;
  letter-spacing: 0.05em;
}

/* Depleted: the number itself already says "0" -- this is a supplementary
   cue, not the only signal, so it's safe to lean on color here. */
.resource-stat.resource-empty {
  color: #ff8a8a;
}

.resource-stat.resource-empty .resource-icon,
.resource-stat.resource-empty .resource-unit {
  color: #ff8a8a;
}

/* ---- Panel grid ---- */
.crt-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 190px;
  grid-template-rows: minmax(0, 1fr) minmax(0, 148px) minmax(0, 120px) auto;
  grid-template-areas:
    "viewport scan"
    "viewport actions"
    "log      log"
    "nav      nav";
  gap: clamp(6px, 1.5%, 12px);
}

.panel-viewport { grid-area: viewport; }
.panel-scan { grid-area: scan; }
.panel-actions { grid-area: actions; }
.panel-log { grid-area: log; }
.panel-nav { grid-area: nav; }

@media (max-width: 560px) {
  .crt-grid {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(80px, 1fr) auto auto minmax(0, 80px) auto;
    grid-template-areas:
      "viewport"
      "scan"
      "actions"
      "log"
      "nav";
  }
}

/* ---- TUI panel chrome: a bordered box with its title cut into the
   top edge, like text-mode "windows" from late-80s software ---- */
.tui-panel {
  position: relative;
  min-width: 0;
  min-height: 0;
  border: 1px solid #2fd66e;
  display: flex;
  flex-direction: column;
  cursor: pointer;
}

.tui-panel-title {
  position: absolute;
  top: -8px;
  left: 10px;
  background: #05130a;
  padding: 0 6px;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #4dff88;
}

/* Box-level: this box is highlighted but not yet entered (keyboard
   navigation between boxes). Amber, distinct from the "inside" green so
   the two levels don't rely on brightness alone to tell apart. */
.tui-panel.box-selected {
  border-color: #ffcc55;
  box-shadow: 0 0 8px 1px rgba(255, 204, 85, 0.5);
}

.tui-panel.box-selected .tui-panel-title {
  color: #ffcc55;
}

/* Inside: keyboard input is currently routed to this box's own controls. */
.tui-panel.box-active {
  border-color: #baffcf;
  box-shadow: 0 0 12px 2px rgba(77, 255, 136, 0.8);
  animation: box-pulse 1.2s ease-in-out infinite;
}

.tui-panel.box-active .tui-panel-title {
  color: #baffcf;
}

@keyframes box-pulse {
  0%, 100% { box-shadow: 0 0 12px 2px rgba(77, 255, 136, 0.8); }
  50% { box-shadow: 0 0 6px 1px rgba(77, 255, 136, 0.4); }
}

@media (prefers-reduced-motion: reduce) {
  .tui-panel.box-active { animation: none; }
}

.tui-panel-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 10px 8px;
  /* Scroll wheel and keyboard scrolling still work -- only the visible
     scrollbar track/thumb is hidden, since scrollbars didn't exist on the
     computers this is meant to evoke. */
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* legacy Edge/IE */
}

.tui-panel-body::-webkit-scrollbar {
  display: none; /* Chrome, Safari, modern Edge */
}

/* ---- Viewport panel ---- */
.viewport-body {
  position: relative;
  padding: 10px;
}

.starfield {
  position: absolute;
  inset: 0;
}

.star {
  position: absolute;
  width: 1px;
  height: 1px;
  background: #baffcf;
  box-shadow: 0 0 2px 0.5px rgba(186, 255, 207, 0.8);
}

.star.big {
  width: 2px;
  height: 2px;
  box-shadow: 0 0 3px 1px rgba(186, 255, 207, 0.9);
}

.viewport-scene {
  position: relative;
  height: calc(100% - 30px);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10%;
}

.viewport-object {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.planet-sphere {
  width: clamp(46px, 14vw, 90px);
  height: clamp(46px, 14vw, 90px);
  border-radius: 50%;
  box-shadow: 0 0 18px 2px rgba(255, 255, 255, 0.15), inset -6px -6px 14px rgba(0, 0, 0, 0.5);
}

.outpost-glyph {
  font-size: clamp(22px, 6vw, 34px);
  color: #baffcf;
  text-shadow: 0 0 8px rgba(77, 255, 136, 0.7);
}

.viewport-label {
  font-size: 0.65rem;
  letter-spacing: 0.04em;
  color: #8fe6ab;
  text-align: center;
}

.viewport-caption {
  position: relative;
  margin: 4px 0 0;
  font-size: 0.72rem;
  font-style: italic;
  color: #6fbd8c;
  text-align: center;
}

/* ---- Viewport panel: outpost mode -- replaces the starfield/planet
   scene entirely while browsing what an outpost has for sale ---- */
.outpost-body {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.outpost-heading {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #baffcf;
  text-shadow: 0 0 6px rgba(77, 255, 136, 0.5);
}

.outpost-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.outpost-item-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(77, 255, 136, 0.08);
  border: 1px solid #2fd66e;
  color: #baffcf;
  border-radius: 4px;
  padding: 6px 10px;
  font-family: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}

.outpost-item-hotkey {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  border-radius: 3px;
  background: rgba(186, 255, 207, 0.15);
  color: #8fe6ab;
  font-size: 0.65rem;
  font-weight: 700;
}

.outpost-item-name {
  flex: 1;
  min-width: 0;
}

.outpost-item-owned {
  flex-shrink: 0;
  font-size: 0.65rem;
  font-weight: 400;
  font-style: italic;
  color: #8fe6ab;
}

.outpost-item-price {
  flex-shrink: 0;
}

.outpost-item-btn:hover:not(:disabled) {
  background: #4dff88;
  color: #05130a;
}

.outpost-item-btn:hover:not(:disabled) .outpost-item-hotkey {
  background: rgba(5, 19, 10, 0.25);
  color: #05130a;
}

.outpost-item-btn:focus-visible {
  outline: 2px solid #baffcf;
  outline-offset: 2px;
}

.outpost-item-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.outpost-item-btn.selected {
  background: #4dff88;
  color: #05130a;
  border-color: #baffcf;
  box-shadow: 0 0 10px 2px rgba(77, 255, 136, 0.7);
  animation: warp-pulse 1s ease-in-out infinite;
}

.outpost-item-btn.selected .outpost-item-hotkey {
  background: rgba(5, 19, 10, 0.25);
  color: #05130a;
}

@media (prefers-reduced-motion: reduce) {
  .outpost-item-btn.selected { animation: none; }
}

.outpost-item-btn.outpost-leave-btn {
  border-style: dashed;
  color: #8fe6ab;
}

/* Higher specificity than either single-class rule above, so a selected
   leave/close button keeps the readable dark-on-bright-green text instead
   of source order deciding it (which left it nearly invisible). */
.outpost-item-btn.outpost-leave-btn.selected {
  color: #05130a;
}

.outpost-error {
  font-size: 0.75rem;
  color: #ff8a8a;
}

/* ---- Sector scan panel ---- */
.scan-body {
  font-size: 0.75rem;
  line-height: 1.5;
}

.scan-row {
  margin: 0 0 4px;
  color: #8fe6ab;
}

.scan-row strong {
  color: #4dff88;
}

.scan-empty {
  font-style: italic;
  color: #5fae7c;
}

.scan-divider {
  margin-top: 8px;
  color: #5fae7c;
  font-size: 0.65rem;
  letter-spacing: 0.08em;
}

/* ---- Actions panel ---- */
.actions-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.actions-empty {
  font-size: 0.75rem;
  font-style: italic;
  color: #5fae7c;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(77, 255, 136, 0.08);
  border: 1px solid #2fd66e;
  color: #baffcf;
  border-radius: 4px;
  padding: 5px 8px;
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}

.action-hotkey {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  border-radius: 3px;
  background: rgba(186, 255, 207, 0.15);
  color: #8fe6ab;
  font-size: 0.65rem;
  font-weight: 700;
}

.action-btn:hover .action-hotkey {
  background: rgba(5, 19, 10, 0.25);
  color: #05130a;
}

.action-btn:hover {
  background: #4dff88;
  color: #05130a;
}

.action-btn:focus-visible {
  outline: 2px solid #baffcf;
  outline-offset: 2px;
}

.action-btn.selected {
  background: #4dff88;
  color: #05130a;
  border-color: #baffcf;
  box-shadow: 0 0 10px 2px rgba(77, 255, 136, 0.7);
  animation: warp-pulse 1s ease-in-out infinite;
}

.action-btn.selected .action-hotkey {
  background: rgba(5, 19, 10, 0.25);
  color: #05130a;
}

@media (prefers-reduced-motion: reduce) {
  .action-btn.selected { animation: none; }
}

/* ---- Log panel ---- */
.log-body {
  font-size: 0.72rem;
}

.log-line {
  margin: 0 0 6px;
  color: #8fe6ab;
  line-height: 1.5;
}

.log-error {
  color: #ff8a8a;
}

.log-prompt {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
}

.terminal-input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  outline: none;
  padding: 0;
  color: #baffcf;
  font-family: inherit;
  font-size: inherit;
  cursor: text;
}

/* ---- Navigation panel ---- */
.nav-body {
  display: flex;
  align-items: center;
  gap: clamp(10px, 3%, 24px);
  flex-wrap: wrap;
}

.navbar-location {
  flex-shrink: 0;
  font-size: 0.8rem;
  letter-spacing: 0.05em;
  color: #8fe6ab;
}

.navbar-location-num {
  color: #4dff88;
  font-weight: 700;
  font-size: 1rem;
  text-shadow: 0 0 6px rgba(77, 255, 136, 0.6);
}

.navbar-warps {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.navbar-label {
  font-size: 0.75rem;
  color: #5fae7c;
  letter-spacing: 0.05em;
  margin-right: 2px;
}

.navbar-none {
  font-size: 0.8rem;
  color: #5fae7c;
  font-style: italic;
}

.warp-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 34px;
  background: rgba(77, 255, 136, 0.08);
  border: 1px solid #2fd66e;
  color: #baffcf;
  border-radius: 4px;
  padding: 5px 10px;
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
}

.warp-cursor {
  display: inline-block;
  width: 9px;
  text-align: center;
  color: #05130a;
}

.warp-btn.visited {
  background: rgba(77, 255, 136, 0.22);
}

.warp-visited-mark {
  color: #8fe6ab;
  font-weight: 900;
  margin-left: 1px;
}

.warp-btn.selected .warp-visited-mark {
  color: #05130a;
}

.warp-btn.selected {
  background: #4dff88;
  color: #05130a;
  border-color: #baffcf;
  box-shadow: 0 0 10px 2px rgba(77, 255, 136, 0.7);
  animation: warp-pulse 1s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .warp-btn.selected { animation: none; }
}

@keyframes warp-pulse {
  0%, 100% { box-shadow: 0 0 10px 2px rgba(77, 255, 136, 0.7); }
  50% { box-shadow: 0 0 4px 1px rgba(77, 255, 136, 0.4); }
}

.warp-btn.selected .warp-hotkey {
  background: rgba(5, 19, 10, 0.25);
  color: #05130a;
}

.warp-hotkey {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: 3px;
  background: rgba(186, 255, 207, 0.15);
  color: #8fe6ab;
  font-size: 0.65rem;
  font-weight: 700;
}

.warp-btn:hover:not(:disabled) .warp-hotkey {
  background: rgba(5, 19, 10, 0.25);
  color: #05130a;
}

.warp-btn:hover:not(:disabled) {
  background: #4dff88;
  color: #05130a;
}

.warp-btn:focus-visible {
  outline: 2px solid #baffcf;
  outline-offset: 2px;
}

.warp-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ---- Viewport panel: cargo mode -- a read-only inventory listing plus
   the one interactive "Close Cargo" row (styled via .outpost-item-btn,
   shared with the outpost overlay). ---- */
.cargo-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cargo-list-row {
  font-size: 0.8rem;
  color: #baffcf;
}

.cargo-list-qty {
  color: #8fe6ab;
  font-weight: 700;
}

.cargo-empty {
  font-size: 0.8rem;
  color: #5fae7c;
  font-style: italic;
}

/* ---- Viewport panel: charts mode -- known locations (styled with
   .outpost-item-btn, shared with the outpost overlay) plus the read-only
   "already here" rows (.cargo-list, shared with the cargo overlay). ---- */
.chart-type-tag {
  color: #5fae7c;
  font-weight: 400;
}

.chart-here-tag {
  color: #4dff88;
  font-weight: 700;
  letter-spacing: 0.05em;
}

.chart-distance {
  flex-shrink: 0;
  font-size: 0.7rem;
  font-weight: 400;
  color: inherit;
  opacity: 0.85;
}

/* ---- Controls ---- */
.crt-controls {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 14px;
}

.crt-led {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #4dff88;
  box-shadow: 0 0 6px 2px rgba(77, 255, 136, 0.8);
}

.crt-knob {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: linear-gradient(160deg, #efe6d4, #a89b82);
  box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.6), inset 0 -1px 2px rgba(0, 0, 0, 0.3);
}

.crt-exit-btn {
  margin-left: auto;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  background: linear-gradient(160deg, #efe6d4, #a89b82);
  color: #4a4335;
  border: none;
  border-radius: 4px;
  padding: 6px 12px;
  cursor: pointer;
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.6), 0 2px 3px rgba(0, 0, 0, 0.3);
}

.crt-exit-btn:hover {
  background: linear-gradient(160deg, #f7f0e2, #b3a58b);
}

.crt-exit-btn:focus-visible {
  outline: 2px solid #05130a;
  outline-offset: 2px;
}

/* Chrome level: keyboard navigation has climbed all the way out to the
   bezel -- EXIT is the only thing reachable here, and Enter activates it. */
.crt-exit-btn.chrome-selected {
  box-shadow: 0 0 0 2px #05130a, 0 0 10px 3px rgba(77, 255, 136, 0.8);
  animation: warp-pulse 1s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .crt-exit-btn.chrome-selected { animation: none; }
}

/* Narrow viewports: let the bezel shrink further rather than clip */
@media (max-width: 480px), (max-height: 480px) {
  .crt-fullscreen { padding: 8px; }
  .crt-bezel { padding: 14px 16px 10px; border-radius: 14px; }
  .crt-brand { font-size: 0.6rem; }
  .crt-header { flex-wrap: wrap; row-gap: 2px; }
}
</style>
