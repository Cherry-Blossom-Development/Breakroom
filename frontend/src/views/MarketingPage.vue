<script setup>
import { ref, computed, onMounted, watch } from 'vue'

const initialLoading = ref(true)
const refreshing = ref(false)
const error = ref('')
const summary = ref(null)
const daily = ref([])

const rangeDefs = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 Days' },
  { key: '30d', label: 'Last 30 Days' },
  { key: 'year', label: 'Last Year' },
]
const selectedRange = ref('30d')
const selectedRangeLabel = computed(() => rangeDefs.find(r => r.key === selectedRange.value)?.label || '')

const metricDefs = [
  { key: 'visits', label: 'Visitors', hasUnique: true },
  { key: 'logins', label: 'Logins', hasUnique: false },
  { key: 'signups', label: 'New Signups', hasUnique: false },
]

const platformLabels = { web: 'Web', android: 'Android', ios: 'iOS' }

function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const dailyDescending = ref([])

async function loadAnalytics() {
  const isFirstLoad = !summary.value
  if (isFirstLoad) initialLoading.value = true
  else refreshing.value = true
  error.value = ''
  try {
    const range = selectedRange.value
    const [summaryRes, dailyRes] = await Promise.all([
      fetch(`/api/analytics/summary?range=${range}`, { credentials: 'include' }),
      fetch(`/api/analytics/daily?range=${range}`, { credentials: 'include' }),
    ])
    if (!summaryRes.ok || !dailyRes.ok) throw new Error('Failed to load analytics')
    summary.value = await summaryRes.json()
    const dailyData = await dailyRes.json()
    daily.value = dailyData.days || []
    dailyDescending.value = [...daily.value].reverse()
  } catch (err) {
    error.value = 'Failed to load analytics data.'
  } finally {
    initialLoading.value = false
    refreshing.value = false
  }
}

onMounted(loadAnalytics)
watch(selectedRange, loadAnalytics)

// --- Last 30 Days line chart ---------------------------------------------

const seriesDefs = [
  { key: 'uniqueVisitors', label: 'Visitors', varName: '--series-visitors' },
  { key: 'logins', label: 'Logins', varName: '--series-logins' },
  { key: 'signups', label: 'Signups', varName: '--series-signups' },
]

const visibleSeries = ref({ uniqueVisitors: true, logins: true, signups: true })
const showTable = ref(false)

function toggleSeries(key) {
  visibleSeries.value[key] = !visibleSeries.value[key]
}

const chartW = 760
const chartH = 320
const margin = { top: 16, right: 16, bottom: 32, left: 48 }
const innerW = chartW - margin.left - margin.right
const innerH = chartH - margin.top - margin.bottom

// Analytics counts are always whole numbers, so the axis step is snapped to
// a whole number too -- otherwise a small max (e.g. 1) produces fractional
// ticks that collapse to duplicate rounded labels ("1, 1, 1, 0").
function computeYAxis(dataMax) {
  if (dataMax <= 0) return { max: 4, step: 1 }
  const roughStep = dataMax / 4
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)))
  const norm = roughStep / mag
  let step
  if (norm < 1.5) step = 1
  else if (norm < 3) step = 2
  else if (norm < 7) step = 5
  else step = 10
  step = Math.max(1, Math.round(step * mag))
  const max = Math.ceil(dataMax / step) * step
  return { max, step }
}

const yAxis = computed(() => {
  const activeKeys = seriesDefs.filter(s => visibleSeries.value[s.key]).map(s => s.key)
  if (!activeKeys.length || !daily.value.length) return { max: 4, step: 1 }
  const max = Math.max(0, ...daily.value.flatMap(d => activeKeys.map(k => d[k] || 0)))
  return computeYAxis(max)
})

const yMax = computed(() => yAxis.value.max)

const yTicks = computed(() => {
  const { max, step } = yAxis.value
  const ticks = []
  for (let v = 0; v <= max; v += step) ticks.push(v)
  return ticks
})

function xForIndex(i) {
  const n = daily.value.length
  if (n <= 1) return margin.left
  return margin.left + (i / (n - 1)) * innerW
}

function yForValue(v) {
  return margin.top + innerH - (v / yMax.value) * innerH
}

const seriesPaths = computed(() => {
  return seriesDefs.map(s => {
    const points = daily.value.map((d, i) => [xForIndex(i), yForValue(d[s.key] || 0)])
    return {
      ...s,
      visible: visibleSeries.value[s.key],
      points,
      d: points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' '),
      lastValue: daily.value.length ? daily.value[daily.value.length - 1][s.key] || 0 : 0,
    }
  })
})

// End-of-line direct labels, nudged apart if they'd collide vertically.
// Two-pass declutter: push down for min spacing, then push back up so the
// stack stays inside the plot area instead of drifting into the x-axis labels.
const endLabels = computed(() => {
  const visible = seriesPaths.value.filter(s => s.visible)
  const withY = visible.map(s => ({
    key: s.key,
    label: s.label,
    varName: s.varName,
    value: s.lastValue,
    y: s.points.length ? s.points[s.points.length - 1][1] : margin.top + innerH,
  })).sort((a, b) => a.y - b.y)

  const minGap = 14
  const upperBound = margin.top + 4
  const lowerBound = margin.top + innerH - 4

  for (let i = 1; i < withY.length; i++) {
    if (withY[i].y - withY[i - 1].y < minGap) {
      withY[i].y = withY[i - 1].y + minGap
    }
  }

  const overflow = withY.length ? withY[withY.length - 1].y - lowerBound : 0
  if (overflow > 0) {
    for (let i = withY.length - 1; i >= 0; i--) {
      withY[i].y -= overflow
    }
  }
  for (let i = 0; i < withY.length; i++) {
    if (withY[i].y < upperBound) withY[i].y = upperBound
  }

  return withY
})

const xAxisTicks = computed(() => {
  const n = daily.value.length
  if (!n) return []
  const step = Math.max(1, Math.ceil(n / 6))
  const ticks = []
  for (let i = 0; i < n; i += step) {
    ticks.push({ i, date: daily.value[i].date, x: xForIndex(i) })
  }
  const lastIdx = n - 1
  if (ticks[ticks.length - 1]?.i !== lastIdx) {
    ticks.push({ i: lastIdx, date: daily.value[lastIdx].date, x: xForIndex(lastIdx) })
  }
  return ticks
})

const svgEl = ref(null)
const hoverIndex = ref(null)

function onPointerMove(evt) {
  if (!svgEl.value || !daily.value.length) return
  const rect = svgEl.value.getBoundingClientRect()
  const svgX = ((evt.clientX - rect.left) / rect.width) * chartW
  const n = daily.value.length
  const ratio = n <= 1 ? 0 : (svgX - margin.left) / innerW
  const idx = Math.round(ratio * (n - 1))
  hoverIndex.value = Math.min(n - 1, Math.max(0, idx))
}

function onPointerLeave() {
  hoverIndex.value = null
}

const hoverDay = computed(() => hoverIndex.value === null ? null : daily.value[hoverIndex.value])
const hoverX = computed(() => hoverIndex.value === null ? 0 : xForIndex(hoverIndex.value))

const tooltipStyle = computed(() => {
  if (hoverIndex.value === null) return {}
  const leftPct = (hoverX.value / chartW) * 100
  const onRightHalf = leftPct > 60
  return onRightHalf
    ? { right: `${100 - leftPct}%`, marginRight: '10px', left: 'auto' }
    : { left: `${leftPct}%`, marginLeft: '10px' }
})
</script>

<template>
  <section class="page-container">
    <h1>Marketing</h1>

    <div v-if="initialLoading" class="status-msg">Loading...</div>
    <div v-else-if="error" class="status-msg error">{{ error }}</div>

    <template v-else-if="summary">
      <section class="basic-stats-card" :class="{ refreshing }">
        <div class="basic-stats-header">
          <h2 class="basic-stats-title">Basic Stats</h2>
          <div class="range-control">
            <label for="range-select">Time range</label>
            <select id="range-select" v-model="selectedRange">
              <option v-for="r in rangeDefs" :key="r.key" :value="r.key">{{ r.label }}</option>
            </select>
          </div>
        </div>

        <div class="stat-grid">
          <div v-for="metric in metricDefs" :key="metric.key" class="stat-card">
            <h3>{{ metric.label }}</h3>
            <div class="stat-value">
              {{ metric.hasUnique ? summary[metric.key].unique : summary[metric.key].total }}
            </div>
            <div v-if="metric.hasUnique" class="stat-subvalue">
              {{ summary[metric.key].total }} total visits
            </div>
            <div class="stat-platforms">
              <span v-for="(label, platform) in platformLabels" :key="platform">
                {{ label }}: {{ metric.hasUnique
                  ? summary[metric.key].byPlatform[platform].unique
                  : summary[metric.key].byPlatform[platform].total }}
              </span>
            </div>
          </div>
        </div>

        <div class="chart-section-header">
          <h3 class="chart-section-title">{{ selectedRangeLabel }} Trend</h3>
          <button type="button" class="table-toggle" @click="showTable = !showTable">
            {{ showTable ? 'View as chart' : 'View as table' }}
          </button>
        </div>

        <div v-if="!showTable" class="viz-root chart-card">
          <div class="legend" role="group" aria-label="Toggle series">
            <label v-for="s in seriesDefs" :key="s.key" class="legend-item">
              <input
                type="checkbox"
                :checked="visibleSeries[s.key]"
                @change="toggleSeries(s.key)"
              />
              <span class="legend-swatch" :class="{ dim: !visibleSeries[s.key] }" :style="{ background: `var(${s.varName})` }"></span>
              <span class="legend-label" :class="{ dim: !visibleSeries[s.key] }">{{ s.label }}</span>
            </label>
          </div>

          <div class="chart-wrap">
            <svg
              ref="svgEl"
              :viewBox="`0 0 ${chartW} ${chartH}`"
              class="chart-svg"
              @pointermove="onPointerMove"
              @pointerleave="onPointerLeave"
            >
              <!-- gridlines + y ticks -->
              <g class="gridlines">
                <line
                  v-for="(t, idx) in yTicks"
                  :key="idx"
                  :x1="margin.left"
                  :x2="chartW - margin.right"
                  :y1="yForValue(t)"
                  :y2="yForValue(t)"
                />
                <text
                  v-for="(t, idx) in yTicks"
                  :key="'lbl' + idx"
                  :x="margin.left - 8"
                  :y="yForValue(t)"
                  class="axis-label y-label"
                >{{ Math.round(t).toLocaleString() }}</text>
              </g>

              <!-- x axis date labels -->
              <g class="x-axis">
                <text
                  v-for="t in xAxisTicks"
                  :key="t.i"
                  :x="t.x"
                  :y="chartH - margin.bottom + 18"
                  class="axis-label x-label"
                >{{ formatDate(t.date) }}</text>
              </g>

              <!-- crosshair -->
              <line
                v-if="hoverDay"
                class="crosshair"
                :x1="hoverX"
                :x2="hoverX"
                :y1="margin.top"
                :y2="chartH - margin.bottom"
              />

              <!-- series lines -->
              <g v-for="s in seriesPaths" :key="s.key">
                <path
                  v-if="s.visible"
                  :d="s.d"
                  fill="none"
                  :stroke="`var(${s.varName})`"
                  stroke-width="2"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                />
                <template v-if="s.visible && hoverDay">
                  <circle
                    :cx="xForIndex(hoverIndex)"
                    :cy="yForValue(hoverDay[s.key] || 0)"
                    r="4"
                    :fill="`var(${s.varName})`"
                    stroke="var(--color-background-soft)"
                    stroke-width="2"
                  />
                </template>
              </g>

              <!-- direct end labels -->
              <g v-for="lbl in endLabels" :key="'end' + lbl.key">
                <circle
                  :cx="chartW - margin.right"
                  :cy="lbl.y"
                  r="4"
                  :fill="`var(${lbl.varName})`"
                  stroke="var(--color-background-soft)"
                  stroke-width="2"
                />
                <text
                  :x="chartW - margin.right + 8"
                  :y="lbl.y"
                  class="end-label"
                >{{ lbl.value.toLocaleString() }}</text>
              </g>
            </svg>

            <div v-if="hoverDay" class="chart-tooltip" :style="tooltipStyle">
              <div class="tooltip-date">{{ formatDate(hoverDay.date) }}</div>
              <div v-for="s in seriesDefs" :key="s.key" v-show="visibleSeries[s.key]" class="tooltip-row">
                <span class="tooltip-key" :style="{ background: `var(${s.varName})` }"></span>
                <span class="tooltip-label">{{ s.label }}</span>
                <span class="tooltip-value">{{ (hoverDay[s.key] || 0).toLocaleString() }}</span>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Visitors</th>
                <th>Logins</th>
                <th>Signups</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="day in dailyDescending" :key="day.date">
                <td>{{ formatDate(day.date) }}</td>
                <td>{{ day.uniqueVisitors }}</td>
                <td>{{ day.logins }}</td>
                <td>{{ day.signups }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.page-container {
  padding: 24px;
}

.status-msg {
  color: var(--color-text-muted);
  padding: 20px 0;
}

.status-msg.error {
  color: var(--color-error, #e53e3e);
}

.basic-stats-card {
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 20px;
  margin-top: 16px;
  transition: opacity 0.15s;
}

.basic-stats-card.refreshing {
  opacity: 0.6;
}

.basic-stats-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.basic-stats-title {
  margin: 0;
}

.range-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.range-control label {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.range-control select {
  background: var(--color-background-input);
  color: var(--color-text);
  border: 1px solid var(--color-border-input);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 0.85rem;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.stat-card {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 16px;
}

.stat-card h3 {
  margin: 0 0 8px;
  font-size: 0.95rem;
  color: var(--color-text-secondary);
}

.stat-value {
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--color-text);
}

.stat-subvalue {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.stat-platforms {
  display: flex;
  gap: 12px;
  font-size: 0.78rem;
  color: var(--color-text-muted);
  margin-top: 4px;
  flex-wrap: wrap;
}

.chart-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 24px;
  gap: 12px;
  flex-wrap: wrap;
}

.chart-section-title {
  margin: 0;
  font-size: 1rem;
  color: var(--color-text-secondary);
}

.table-toggle {
  background: var(--color-button-secondary-bg);
  color: var(--color-button-secondary-text);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 0.82rem;
  cursor: pointer;
}

.table-toggle:hover {
  background: var(--color-button-secondary-hover);
}

.table-wrap {
  overflow-x: auto;
}

/* --- Last 30 Days chart -------------------------------------------- */

.viz-root {
  --series-visitors: #2a78d6;
  --series-logins: #008300;
  --series-signups: #e87ba4;
}
@media (prefers-color-scheme: dark) {
  .viz-root {
    --series-visitors: #3987e5;
    --series-logins: #008300;
    --series-signups: #d55181;
  }
}

.chart-card {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 16px;
  margin-top: 10px;
}

.legend {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  border-radius: 4px;
}

.legend-item:focus-within {
  outline: 2px solid var(--color-link);
  outline-offset: 2px;
}

.legend-item input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.legend-swatch {
  width: 14px;
  height: 3px;
  border-radius: 2px;
  transition: opacity 0.15s;
}

.legend-swatch.dim {
  opacity: 0.25;
}

.legend-label {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.legend-label.dim {
  color: var(--color-text-placeholder);
}

.chart-wrap {
  position: relative;
}

.chart-svg {
  width: 100%;
  height: auto;
  display: block;
  touch-action: none;
}

.gridlines line {
  stroke: var(--color-border);
  stroke-width: 1;
}

.axis-label {
  fill: var(--color-text-muted);
  font-size: 10px;
}

.y-label {
  text-anchor: end;
  dominant-baseline: middle;
}

.x-label {
  text-anchor: middle;
}

.end-label {
  fill: var(--color-text-secondary);
  font-size: 11px;
  dominant-baseline: middle;
}

.crosshair {
  stroke: var(--color-text-placeholder);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}

.chart-tooltip {
  position: absolute;
  top: 8px;
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 8px 10px;
  box-shadow: var(--shadow-md);
  font-size: 0.8rem;
  pointer-events: none;
  min-width: 130px;
}

.tooltip-date {
  color: var(--color-text-muted);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 4px;
}

.tooltip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
}

.tooltip-key {
  width: 10px;
  height: 3px;
  border-radius: 2px;
  flex-shrink: 0;
}

.tooltip-label {
  color: var(--color-text-secondary);
  flex: 1;
}

.tooltip-value {
  color: var(--color-text);
  font-weight: 600;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 10px;
}

th, td {
  text-align: left;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
}

th {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
}
</style>
