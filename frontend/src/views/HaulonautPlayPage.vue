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
const navigating = ref(false)
const navError = ref('')
const logLines = ref([])
const selectedIndex = ref(-1) // -1 = nothing highlighted; arrow keys move this, Enter confirms it
const logEl = ref(null)
const stars = ref([])

const FEATURE_LABELS = { planet: 'PLANET', trading_outpost: 'OUTPOST' }

const planetFeature = computed(() => sectorFeatures.value.find(f => f.feature_type === 'planet') || null)
const outpostFeature = computed(() => sectorFeatures.value.find(f => f.feature_type === 'trading_outpost') || null)

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

async function navigateTo(sector) {
  if (navigating.value) return
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
    regenerateStarfield()
    logLines.value.push(`Arrived in Sector ${data.currentSector.sector_number}.`)
    selectedIndex.value = -1
    scrollLogToBottom()
  } catch (err) {
    navError.value = err.message
  } finally {
    navigating.value = false
  }
}

function backToGames() {
  router.push('/games')
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    backToGames()
    return
  }
  if (navigating.value || connectedSectors.value.length === 0) return
  const count = connectedSectors.value.length

  switch (e.key) {
    // Down (or Right) enters/advances the highlight along the warp row;
    // Up backs it back out to "nothing selected".
    case 'ArrowDown':
    case 'ArrowRight':
      e.preventDefault()
      selectedIndex.value = selectedIndex.value === -1 ? 0 : (selectedIndex.value + 1) % count
      return
    case 'ArrowLeft':
      e.preventDefault()
      selectedIndex.value = selectedIndex.value === -1 ? 0 : (selectedIndex.value - 1 + count) % count
      return
    case 'ArrowUp':
      e.preventDefault()
      selectedIndex.value = -1
      return
    case 'Enter':
    case ' ':
      if (selectedIndex.value !== -1) {
        e.preventDefault()
        navigateTo(connectedSectors.value[selectedIndex.value])
      }
      return
  }

  // Number keys 1-6 are a direct fast path (jump straight to that button
  // without needing to arrow over to it first) -- sectors can have at most
  // 6 connections, so this always covers every option.
  const hotkeyIndex = parseInt(e.key, 10) - 1
  if (Number.isInteger(hotkeyIndex) && hotkeyIndex >= 0 && connectedSectors.value[hotkeyIndex]) {
    selectedIndex.value = hotkeyIndex
    navigateTo(connectedSectors.value[hotkeyIndex])
  }
}

onMounted(() => {
  loadCharacter()
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
                <span class="header-status">STATUS: <span class="status-active">{{ character.status.toUpperCase() }}</span></span>
              </div>

              <div class="crt-grid">
                <!-- Viewport: what you'd see out the window -->
                <div class="tui-panel panel-viewport">
                  <span class="tui-panel-title">VIEWPORT</span>
                  <div class="tui-panel-body viewport-body">
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
                <div class="tui-panel panel-scan">
                  <span class="tui-panel-title">SECTOR SCAN</span>
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

                <!-- Log: chronological action history -->
                <div class="tui-panel panel-log">
                  <span class="tui-panel-title">LOG</span>
                  <div class="tui-panel-body log-body" ref="logEl">
                    <p v-for="(line, i) in logLines" :key="i" class="log-line">&gt; {{ line }}</p>
                    <p v-if="navError" class="log-line log-error">&gt; {{ navError }}</p>
                    <p class="log-line"><span class="terminal-cursor" aria-hidden="true">_</span></p>
                  </div>
                </div>

                <!-- Navigation: current location + warp targets -->
                <div class="tui-panel panel-nav">
                  <span class="tui-panel-title">NAVIGATION</span>
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
                          @click="navigateTo(s)"
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
          <button class="crt-exit-btn" @click="backToGames">&#9211; EXIT</button>
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

/* ---- Panel grid ---- */
.crt-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 190px;
  grid-template-rows: minmax(0, 1fr) minmax(0, 120px) auto;
  grid-template-areas:
    "viewport scan"
    "log      log"
    "nav      nav";
  gap: clamp(6px, 1.5%, 12px);
}

.panel-viewport { grid-area: viewport; }
.panel-scan { grid-area: scan; }
.panel-log { grid-area: log; }
.panel-nav { grid-area: nav; }

@media (max-width: 560px) {
  .crt-grid {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(80px, 1fr) auto minmax(0, 80px) auto;
    grid-template-areas:
      "viewport"
      "scan"
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

.tui-panel-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 10px 8px;
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

/* Narrow viewports: let the bezel shrink further rather than clip */
@media (max-width: 480px), (max-height: 480px) {
  .crt-fullscreen { padding: 8px; }
  .crt-bezel { padding: 14px 16px 10px; border-radius: 14px; }
  .crt-brand { font-size: 0.6rem; }
}
</style>
