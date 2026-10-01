<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { authFetch } from '../utilities/authFetch'
import { buildBurndown, sprintAnchor, sprintBounds, sprintIndexAt } from '../utilities/burndown'
import LoadingSpinner from '../components/LoadingSpinner.vue'

// Burndown tab of the project workspace. The rules live in
// utilities/burndown.js; this page only fetches and draws.
const route = useRoute()
const projectId = route.params.id

const project = ref(null)
const tickets = ref([])
const history = ref([])
const loading = ref(true)
const error = ref(null)

const measure = ref('work') // 'work' (working days) | 'tickets'
// Category filter: a ticket split into subtasks as a 'category' (migration
// 086) can be charted on its own
const categoryId = ref(null)
const categories = computed(() => tickets.value.filter(t => t.split_mode === 'category'))
const view = ref('chart') // 'chart' | 'table'
const now = new Date()

// ---- Sprints ----
const sprintDays = computed(() => project.value?.sprint_duration_days || 14)
const anchor = computed(() => sprintAnchor(project.value?.created_at || now))
const currentIndex = computed(() => sprintIndexAt(anchor.value, sprintDays.value, now))
const sprintIndex = ref(0)
const sprint = computed(() => sprintBounds(anchor.value, sprintDays.value, sprintIndex.value))

const burndown = computed(() => buildBurndown({
  tickets: tickets.value,
  history: history.value,
  start: sprint.value.start,
  end: sprint.value.end,
  now,
  measure: measure.value,
  categoryId: categoryId.value
}))
const days = computed(() => burndown.value.days)

async function fetchData() {
  try {
    const res = await authFetch(`/api/projects/${projectId}/burndown`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.message || 'Failed to load burndown')
    project.value = data.project
    tickets.value = data.tickets
    history.value = data.history
    sprintIndex.value = currentIndex.value
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

// ---- Formatting ----
const round1 = (n) => Math.round(n * 10) / 10

function formatAmount(n) {
  if (n === null || n === undefined) return '—'
  const v = round1(n)
  if (measure.value === 'tickets') return `${v} ticket${v === 1 ? '' : 's'}`
  return `${v} day${v === 1 ? '' : 's'}`
}

function formatShort(n) {
  return measure.value === 'tickets' ? String(round1(n)) : `${round1(n)}d`
}

function formatDate(date, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return date.toLocaleDateString('en-US', opts)
}

const sprintLabel = computed(() => {
  const last = new Date(sprint.value.end.getTime() - 1)
  return `${formatDate(sprint.value.start, { month: 'short', day: 'numeric' })} – ${formatDate(last, { month: 'short', day: 'numeric', year: 'numeric' })}`
})

// How the actual line compares with the ideal line right now
const pace = computed(() => {
  const b = burndown.value
  if (!b.started) return null
  const diff = round1(b.remaining - b.idealNow)
  if (Math.abs(diff) < 0.1) return { label: 'On track', detail: 'matching the ideal line' }
  return diff > 0
    ? { label: 'Behind', detail: `${formatAmount(diff)} above the ideal line` }
    : { label: 'Ahead', detail: `${formatAmount(-diff)} below the ideal line` }
})

// ---- Chart geometry ----
const chartEl = ref(null)
const width = ref(640)
const HEIGHT = 300
const M = { top: 28, right: 76, bottom: 30, left: 44 }
const plotW = computed(() => Math.max(width.value - M.left - M.right, 120))
const plotH = HEIGHT - M.top - M.bottom

let resizeObserver = null
function observeChart() {
  resizeObserver?.disconnect()
  if (!chartEl.value) return
  resizeObserver = new ResizeObserver(([entry]) => { width.value = entry.contentRect.width })
  resizeObserver.observe(chartEl.value)
}

const spanMs = computed(() => sprint.value.end - sprint.value.start)
const xOf = (date) => M.left + ((date - sprint.value.start) / spanMs.value) * plotW.value

// "Nice" y ticks from 0 to just above the highest value
const yTicks = computed(() => {
  const max = Math.max(burndown.value.startRemaining, ...days.value.map(d => d.remaining ?? 0), 1)
  const rough = max / 4
  const mag = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= rough)
  const top = Math.ceil(max / step) * step
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => round1(i * step))
})
const yMax = computed(() => yTicks.value[yTicks.value.length - 1])
const yOf = (v) => M.top + plotH - (v / yMax.value) * plotH

// Actual: from the sprint start through each day that has begun (today as of now)
const actualPoints = computed(() => {
  if (!burndown.value.started) return []
  return [
    { x: xOf(sprint.value.start), y: yOf(burndown.value.startRemaining) },
    ...days.value.filter(d => d.remaining !== null).map(d => ({ x: xOf(d.at), y: yOf(d.remaining) }))
  ]
})
const actualPath = computed(() => actualPoints.value.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' '))
const actualArea = computed(() => {
  const pts = actualPoints.value
  if (pts.length < 2) return ''
  const base = yOf(0)
  return `${actualPath.value} L${pts[pts.length - 1].x},${base} L${pts[0].x},${base} Z`
})

// Ideal: flat across weekends, so draw it through every day boundary
const idealPath = computed(() => [
  `M${xOf(sprint.value.start)},${yOf(burndown.value.startRemaining)}`,
  ...days.value.map(d => `L${xOf(d.end)},${yOf(d.ideal)}`)
].join(' '))

const lastActual = computed(() => actualPoints.value[actualPoints.value.length - 1] || null)
const todayX = computed(() => (now >= sprint.value.start && now < sprint.value.end ? xOf(now) : null))

// Label every day when there's room, else every Monday
const dayWidth = computed(() => plotW.value / days.value.length)
const xLabels = computed(() => days.value
  .filter(d => dayWidth.value >= 30 || d.date.getDay() === 1)
  .map(d => ({
    key: d.date.getTime(),
    x: xOf(d.date) + (dayWidth.value >= 30 ? dayWidth.value / 2 : 0),
    text: dayWidth.value >= 30 ? d.date.getDate() : formatDate(d.date, { month: 'short', day: 'numeric' }),
    anchor: dayWidth.value >= 30 ? 'middle' : 'start'
  })))

// ---- Hover / keyboard focus: one day at a time ----
const activeIndex = ref(null)
const activeDay = computed(() => (activeIndex.value === null ? null : days.value[activeIndex.value]))

function onPointerMove(e) {
  const rect = e.currentTarget.getBoundingClientRect()
  const x = e.clientX - rect.left - M.left
  const i = Math.floor((x / plotW.value) * days.value.length)
  activeIndex.value = i >= 0 && i < days.value.length ? i : null
}

function onKeydown(e) {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
  e.preventDefault()
  const last = days.value.length - 1
  const start = activeIndex.value ?? (e.key === 'ArrowRight' ? -1 : last + 1)
  activeIndex.value = Math.min(Math.max(start + (e.key === 'ArrowRight' ? 1 : -1), 0), last)
}

const tooltip = computed(() => {
  const d = activeDay.value
  if (!d) return null
  const x = xOf(d.date) + dayWidth.value / 2
  // Beside the crosshair, on whichever side has room, so it never covers
  // the point it describes
  const flip = x > width.value / 2
  return {
    day: d,
    left: flip ? x - 14 : x + 14,
    flip,
    crosshairX: x,
    y: d.remaining === null ? null : yOf(d.remaining)
  }
})

watch([sprintIndex, measure, categoryId], () => { activeIndex.value = null })
watch(view, async (v) => {
  if (v === 'chart') {
    await nextTick()
    observeChart()
  }
})

onMounted(async () => {
  await fetchData()
  await nextTick()
  observeChart()
})
onUnmounted(() => resizeObserver?.disconnect())
</script>

<template>
  <div class="page-container burndown-page burndown-root">
    <div v-if="loading" class="loading"><LoadingSpinner size="small" /> Loading burndown...</div>
    <div v-else-if="error" class="error-box">{{ error }}</div>

    <template v-else>
      <!-- Sprint picker + controls -->
      <div class="burndown-toolbar">
        <div class="sprint-nav" role="group" aria-label="Sprint">
          <button class="nav-btn" :disabled="sprintIndex === 0" aria-label="Previous sprint" @click="sprintIndex--">‹</button>
          <div class="sprint-label">
            <strong>Sprint {{ sprintIndex + 1 }}</strong>
            <span>{{ sprintLabel }}</span>
          </div>
          <button class="nav-btn" :disabled="sprintIndex >= currentIndex" aria-label="Next sprint" @click="sprintIndex++">›</button>
          <button v-if="sprintIndex !== currentIndex" class="link-btn" @click="sprintIndex = currentIndex">Current sprint</button>
        </div>

        <div class="burndown-controls">
          <select v-if="categories.length" v-model="categoryId" class="category-filter" aria-label="Category">
            <option :value="null">All work</option>
            <option v-for="c in categories" :key="c.id" :value="c.id">#{{ c.id }} {{ c.title }}</option>
          </select>
          <div class="segmented" role="group" aria-label="Measure">
            <button :class="{ active: measure === 'work' }" :aria-pressed="measure === 'work'" @click="measure = 'work'">Work</button>
            <button :class="{ active: measure === 'tickets' }" :aria-pressed="measure === 'tickets'" @click="measure = 'tickets'">Tickets</button>
          </div>
          <div class="segmented" role="group" aria-label="View">
            <button :class="{ active: view === 'chart' }" :aria-pressed="view === 'chart'" @click="view = 'chart'">Chart</button>
            <button :class="{ active: view === 'table' }" :aria-pressed="view === 'table'" @click="view = 'table'">Table</button>
          </div>
        </div>
      </div>

      <!-- Headline numbers -->
      <dl class="burndown-summary">
        <div>
          <dt>{{ burndown.finished ? 'Left at sprint end' : 'Remaining' }}</dt>
          <dd>{{ formatAmount(burndown.remaining) }} <span class="summary-sub">of {{ formatAmount(burndown.startRemaining) }} at start</span></dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd>{{ formatAmount(burndown.completed) }}</dd>
        </div>
        <div>
          <dt>Added</dt>
          <dd>{{ formatAmount(burndown.added) }} <span class="summary-sub">new or reopened</span></dd>
        </div>
        <div v-if="pace">
          <dt>Pace</dt>
          <dd>{{ pace.label }} <span class="summary-sub">{{ pace.detail }}</span></dd>
        </div>
      </dl>

      <p v-if="!tickets.length" class="empty-state">This project has no tickets yet.</p>

      <template v-else-if="view === 'chart'">
        <ul class="burndown-legend" aria-label="Legend">
          <li><span class="key-line key-actual"></span>Actual remaining</li>
          <li><span class="key-line key-ideal"></span>Ideal</li>
          <li v-if="todayX !== null"><span class="key-line key-today"></span>Today</li>
        </ul>

        <div ref="chartEl" class="chart-wrap">
          <svg
            class="burndown-chart"
            :width="width"
            :height="HEIGHT"
            role="img"
            :aria-label="`Burndown for sprint ${sprintIndex + 1}: ${formatAmount(burndown.remaining)} remaining of ${formatAmount(burndown.startRemaining)}. Use the arrow keys to step through days.`"
            tabindex="0"
            @pointermove="onPointerMove"
            @pointerleave="activeIndex = null"
            @keydown="onKeydown"
            @blur="activeIndex = null"
          >
            <!-- Weekends -->
            <rect
              v-for="d in days.filter(d => d.weekend)"
              :key="`w${d.date.getTime()}`"
              class="weekend"
              :x="xOf(d.date)"
              :y="M.top"
              :width="dayWidth"
              :height="plotH"
            />

            <!-- Grid + y axis -->
            <g v-for="t in yTicks" :key="`y${t}`">
              <line class="grid" :x1="M.left" :x2="M.left + plotW" :y1="yOf(t)" :y2="yOf(t)" />
              <text class="axis-label" :x="M.left - 8" :y="yOf(t)" text-anchor="end" dominant-baseline="middle">{{ t }}</text>
            </g>
            <text class="axis-title" :x="M.left - 8" :y="M.top - 14" text-anchor="end">{{ measure === 'tickets' ? 'tickets' : 'days' }}</text>

            <!-- x axis -->
            <text
              v-for="l in xLabels"
              :key="`x${l.key}`"
              class="axis-label"
              :x="l.x"
              :y="M.top + plotH + 18"
              :text-anchor="l.anchor"
            >{{ l.text }}</text>

            <!-- Ideal -->
            <path class="ideal-line" :d="idealPath" />
            <text class="direct-label" :x="M.left + plotW + 6" :y="yOf(0)" dominant-baseline="middle">Ideal</text>

            <!-- Today -->
            <line v-if="todayX !== null" class="today-line" :x1="todayX" :x2="todayX" :y1="M.top" :y2="M.top + plotH" />

            <!-- Actual -->
            <path v-if="actualArea" class="actual-area" :d="actualArea" />
            <path v-if="actualPoints.length" class="actual-line" :d="actualPath" />
            <template v-if="lastActual">
              <circle class="actual-end" :cx="lastActual.x" :cy="lastActual.y" r="4.5" />
              <text class="direct-label" :x="lastActual.x + 9" :y="lastActual.y" dominant-baseline="middle">{{ formatShort(burndown.remaining) }}</text>
            </template>

            <!-- Crosshair -->
            <g v-if="tooltip">
              <line class="crosshair" :x1="tooltip.crosshairX" :x2="tooltip.crosshairX" :y1="M.top" :y2="M.top + plotH" />
              <circle v-if="tooltip.y !== null" class="actual-end" :cx="xOf(tooltip.day.at)" :cy="tooltip.y" r="4.5" />
            </g>
          </svg>

          <div v-if="tooltip" class="burndown-tooltip" :class="{ flip: tooltip.flip }" role="status" :style="{ left: `${tooltip.left}px` }">
            <p class="tip-title">{{ formatDate(tooltip.day.date) }}<span v-if="tooltip.day.isToday"> · today</span></p>
            <dl>
              <dt>Remaining</dt>
              <dd>{{ tooltip.day.remaining === null ? 'Not yet' : formatAmount(tooltip.day.remaining) }}</dd>
              <dt>Ideal</dt>
              <dd>{{ formatAmount(tooltip.day.ideal) }}</dd>
              <template v-if="tooltip.day.remaining !== null">
                <dt>Completed</dt>
                <dd>{{ formatAmount(tooltip.day.completed) }}</dd>
                <dt>Added</dt>
                <dd>{{ formatAmount(tooltip.day.added) }}</dd>
              </template>
            </dl>
          </div>
        </div>
      </template>

      <table v-else class="burndown-table">
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col" class="num">Remaining</th>
            <th scope="col" class="num">Ideal</th>
            <th scope="col" class="num">Completed</th>
            <th scope="col" class="num">Added</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in days" :key="d.date.getTime()" :class="{ future: d.remaining === null, today: d.isToday }">
            <td>{{ formatDate(d.date) }}<span v-if="d.isToday" class="approx"> (today)</span></td>
            <td class="num">{{ d.remaining === null ? '—' : formatShort(d.remaining) }}</td>
            <td class="num">{{ formatShort(d.ideal) }}</td>
            <td class="num">{{ d.remaining === null ? '—' : formatShort(d.completed) }}</td>
            <td class="num">{{ d.remaining === null ? '—' : formatShort(d.added) }}</td>
          </tr>
        </tbody>
      </table>

      <ul v-if="tickets.length" class="burndown-notes">
        <li>
          {{ sprintDays / 7 }}-week sprints, starting {{ formatDate(anchor, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }) }}.
          <RouterLink :to="{ name: 'projectSettings', params: { id: projectId } }">Change sprint length</RouterLink>
        </li>
        <li v-if="measure === 'work'">
          Work uses each ticket's current estimate, in 8-hour working days.
          <template v-if="burndown.unestimatedCount">
            {{ burndown.unestimatedCount }} unestimated ticket{{ burndown.unestimatedCount === 1 ? '' : 's' }} counted as 1 day each.
          </template>
        </li>
        <li v-if="burndown.approximate">
          Status history is only recorded from Sep 28, 2026; earlier days are reconstructed from resolved dates.
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
/* Emphasis form: actual remaining is the one accent series (the GANTT
   chart's validated blue); the ideal line is recessive gray context,
   direct-labeled so it's never identified by color alone. */
.burndown-root {
  --bd-actual: #2a78d6;
  --bd-ideal: #8a8984;
  --bd-grid: var(--color-border);
  --bd-weekend: rgba(0, 0, 0, 0.035);
  max-width: none;
}

@media (prefers-color-scheme: dark) {
  .burndown-root {
    --bd-actual: #3987e5;
    --bd-ideal: #8f8e87;
    --bd-weekend: rgba(255, 255, 255, 0.04);
  }
}

.loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-muted);
}

.error-box {
  padding: 16px;
  border-radius: var(--card-radius-sm);
  background: var(--color-error-bg);
  color: var(--color-error);
}

/* Toolbar */
.burndown-toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 12px 16px;
  margin-bottom: 16px;
}

.sprint-nav {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sprint-label {
  display: flex;
  flex-direction: column;
  min-width: 170px;
  text-align: center;
  color: var(--color-text);
}

.sprint-label span {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.nav-btn {
  width: 32px;
  height: 32px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-card);
  color: var(--color-text);
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
}

.nav-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.link-btn {
  padding: 0;
  border: none;
  background: none;
  color: var(--color-accent);
  font-size: 0.85rem;
  cursor: pointer;
}

.link-btn:hover {
  text-decoration: underline;
}

.burndown-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.category-filter {
  max-width: 260px;
  padding: 5px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-card);
  color: var(--color-text);
  font-size: 0.85rem;
}

.segmented {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}

.segmented button {
  padding: 5px 12px;
  border: none;
  background: var(--color-background-card);
  color: var(--color-text-muted);
  font-size: 0.85rem;
  cursor: pointer;
}

.segmented button + button {
  border-left: 1px solid var(--color-border);
}

.segmented button.active {
  background: var(--color-accent);
  color: #fff;
}

/* Summary */
.burndown-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 32px;
  margin: 0 0 16px;
}

.burndown-summary dt {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.burndown-summary dd {
  margin: 2px 0 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}

.summary-sub {
  font-size: 0.8rem;
  font-weight: 400;
  color: var(--color-text-muted);
}

/* Legend */
.burndown-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.burndown-legend li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.key-line {
  display: inline-block;
  width: 18px;
  height: 0;
  border-top: 2px solid;
}

.key-actual { border-color: var(--bd-actual); }
.key-ideal { border-color: var(--bd-ideal); border-top-width: 1.5px; }
.key-today {
  width: 0;
  height: 12px;
  border-top: none;
  border-left: 1px solid var(--color-text-muted);
}

/* Chart */
.chart-wrap {
  position: relative;
  width: 100%;
  padding: 8px 0;
  background: var(--color-background-card);
  border-radius: var(--card-radius-sm);
}

.burndown-chart {
  display: block;
  overflow: visible;
  touch-action: pan-y;
}

.burndown-chart:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.weekend { fill: var(--bd-weekend); }

.grid {
  stroke: var(--bd-grid);
  stroke-width: 1;
  shape-rendering: crispEdges;
}

.axis-label,
.axis-title {
  font-size: 11px;
  fill: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.direct-label {
  font-size: 12px;
  font-weight: 600;
  fill: var(--color-text-secondary);
  /* surface halo keeps labels legible where they cross a line */
  paint-order: stroke;
  stroke: var(--color-background-card);
  stroke-width: 4px;
  stroke-linejoin: round;
}

.ideal-line {
  fill: none;
  stroke: var(--bd-ideal);
  stroke-width: 1.5;
  stroke-linejoin: round;
}

.actual-area {
  fill: var(--bd-actual);
  opacity: 0.1;
}

.actual-line {
  fill: none;
  stroke: var(--bd-actual);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.actual-end {
  fill: var(--bd-actual);
  stroke: var(--color-background-card);
  stroke-width: 2;
}

.today-line {
  stroke: var(--color-text-muted);
  stroke-width: 1;
}

.crosshair {
  stroke: var(--color-text-muted);
  stroke-width: 1;
  opacity: 0.6;
  pointer-events: none;
}

.burndown-tooltip {
  position: absolute;
  top: 36px;
  min-width: 180px;
  padding: 10px 12px;
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.12));
  font-size: 0.8rem;
  color: var(--color-text);
  pointer-events: none;
  z-index: 5;
}

.burndown-tooltip.flip {
  transform: translateX(-100%);
}

.tip-title {
  margin: 0 0 6px;
  font-weight: 600;
}

.burndown-tooltip dl {
  display: grid;
  grid-template-columns: auto auto;
  gap: 2px 12px;
  margin: 0;
}

.burndown-tooltip dt {
  color: var(--color-text-muted);
}

.burndown-tooltip dd {
  margin: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* Table */
.burndown-table {
  width: 100%;
  max-width: 720px;
  border-collapse: collapse;
  font-size: 0.875rem;
  background: var(--color-background-card);
}

.burndown-table th,
.burndown-table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-border);
  text-align: left;
  color: var(--color-text);
}

.burndown-table th {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
}

.burndown-table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.burndown-table tr.future td {
  color: var(--color-text-muted);
}

.burndown-table tr.today td {
  font-weight: 600;
}

.approx {
  color: var(--color-text-muted);
  font-weight: 400;
}

/* Notes */
.burndown-notes {
  margin: 16px 0 0;
  padding-left: 18px;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.burndown-notes li + li {
  margin-top: 4px;
}

.empty-state {
  padding: 40px 20px;
  text-align: center;
  color: var(--color-text-light);
  background: var(--color-background-card);
  border-radius: var(--card-radius-sm);
}

@media (max-width: 600px) {
  .sprint-label {
    min-width: 0;
  }
}
</style>
