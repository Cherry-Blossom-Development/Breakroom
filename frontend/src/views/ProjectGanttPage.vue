<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { authFetch } from '../utilities/authFetch'
import { buildGanttSchedule, startOfDay, HOURS_PER_DAY, expandSplitDependencies, withCategoryRows } from '../utilities/ganttSchedule'
import LoadingSpinner from '../components/LoadingSpinner.vue'
import { formatEstimate } from '../utilities/ticketEstimates'

// GANTT tab of the project workspace. Scheduling rules live in
// utilities/ganttSchedule.js; this page only fetches and draws.
const route = useRoute()

const tickets = ref([])
// Tickets split into subtasks (migration 086): not scheduled themselves;
// 'category' ones get a summary row over their subtasks
const splitParents = ref([])
const dependencies = ref([])
const timeline = ref([])
const loading = ref(true)
const error = ref(null)

const includeDone = ref(false)
const view = ref('chart') // 'chart' | 'table'
const zoom = ref('day') // 'day' | 'week'

const DAY_MS = 24 * 60 * 60 * 1000
const ROW_H = 36
const BAR_H = 18
const LABEL_W = 280
const dayWidth = computed(() => (zoom.value === 'day' ? 36 : 14))

const STAGE_LABELS = {
  backlog: 'Backlog',
  'on-deck': 'On Deck',
  in_progress: 'In Progress',
  done: 'Done',
  category: 'Category'
}

const now = new Date()

const schedule = computed(() => buildGanttSchedule({
  tickets: tickets.value,
  dependencies: expandSplitDependencies(dependencies.value, tickets.value, splitParents.value),
  timeline: timeline.value,
  now,
  includeDone: includeDone.value
}))
const rows = computed(() => withCategoryRows(schedule.value.rows, splitParents.value, tickets.value))
const hasCategories = computed(() => rows.value.some(r => r.isCategory))
const summary = computed(() => schedule.value.summary)
const today = computed(() => schedule.value.anchor)

// ---- Calendar axis ----
function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function startOfWeek(date) {
  const d = startOfDay(date)
  const offset = (d.getDay() + 6) % 7 // Monday = 0
  return addDays(d, -offset)
}

// Whole calendar days between two midnights (DST-safe)
function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS)
}

const chartStart = computed(() => {
  const earliest = rows.value.reduce((min, r) => (r.start < min ? r.start : min), today.value)
  return startOfWeek(addDays(earliest, -1))
})

// Width of the scroll area, so the timeline always fills it
const containerWidth = ref(0)
let resizeObserver = null

const dayCount = computed(() => {
  const latest = rows.value.reduce((max, r) => (r.end > max ? r.end : max), today.value)
  const toFill = Math.ceil((containerWidth.value - LABEL_W) / dayWidth.value)
  return Math.max(daysBetween(chartStart.value, latest) + 8, 21, toFill)
})

const timelineWidth = computed(() => dayCount.value * dayWidth.value)

function xOf(date) {
  const day = startOfDay(date)
  return (daysBetween(chartStart.value, day) + (date - day) / DAY_MS) * dayWidth.value
}

const days = computed(() => Array.from({ length: dayCount.value }, (_, i) => {
  const date = addDays(chartStart.value, i)
  const dow = date.getDay()
  return {
    key: i,
    date,
    x: i * dayWidth.value,
    weekend: dow === 0 || dow === 6,
    isToday: daysBetween(date, now) === 0,
    isMonday: dow === 1,
    label: date.getDate(),
    weekday: date.toLocaleDateString('en-US', { weekday: 'narrow' })
  }
}))

const months = computed(() => {
  const groups = []
  for (const d of days.value) {
    const key = `${d.date.getFullYear()}-${d.date.getMonth()}`
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.width += dayWidth.value
    else groups.push({ key, x: d.x, width: dayWidth.value, label: d.date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) })
  }
  return groups
})

// ---- Bars & dependency arrows ----
const bars = computed(() => rows.value.map((r, i) => {
  const x = xOf(r.start)
  return {
    row: r,
    index: i,
    x,
    width: Math.max(xOf(r.end) - x, 4),
    y: i * ROW_H + (ROW_H - BAR_H) / 2
  }
}))

const barById = computed(() => new Map(bars.value.map(b => [b.row.ticket.id, b])))

// Finish-to-start connectors: out of the predecessor's end, into the
// dependent's start, with a short elbow so they read even when bars touch.
const arrows = computed(() => {
  const paths = []
  for (const bar of bars.value) {
    for (const predId of bar.row.dependsOn) {
      const pred = barById.value.get(predId)
      if (!pred) continue
      const x1 = pred.x + pred.width
      const y1 = pred.y + BAR_H / 2
      const x2 = bar.x
      const y2 = bar.y + BAR_H / 2
      const midX = Math.max(x1 + 6, Math.min(x2 - 6, x1 + 12))
      const d = x2 - 6 >= x1 + 6
        ? `M${x1},${y1} H${midX} V${y2} H${x2 - 1}`
        : `M${x1},${y1} H${x1 + 6} V${(y1 + y2) / 2} H${x2 - 8} V${y2} H${x2 - 1}` // wraps back when overlapping
      paths.push({ key: `${predId}-${bar.row.ticket.id}`, d })
    }
  }
  return paths
})

// Marks the actual current moment (on a weekend that's before the first
// scheduled bar, which starts on Monday)
const todayX = computed(() => xOf(now))
const bodyHeight = computed(() => Math.max(rows.value.length, 1) * ROW_H)

// ---- Formatting ----
// Scheduled working time: hours under a day, else working days
function formatHours(hours) {
  if (hours < HOURS_PER_DAY) return `${Math.round(hours * 100) / 100}h`
  const days = Math.round((hours / HOURS_PER_DAY) * 10) / 10
  return `${days} working day${days === 1 ? '' : 's'}`
}

function formatDate(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Bars that end exactly at midnight finish at the end of the previous day
function formatEnd(date) {
  const d = date.getHours() === 0 && date.getMinutes() === 0 ? addDays(date, -1) : date
  return formatDate(d)
}

function assigneeName(t) {
  if (t.assignee_first_name || t.assignee_last_name) return `${t.assignee_first_name || ''} ${t.assignee_last_name || ''}`.trim()
  return t.assignee_handle || 'Unassigned'
}

function categoryProgress(row) {
  return `${row.doneCount} of ${row.subtaskCount} subtask${row.subtaskCount === 1 ? '' : 's'} done`
}

function barLabel(row) {
  if (row.isCategory) {
    return `Category #${row.ticket.id} ${row.ticket.title}, ${categoryProgress(row)}, ${formatDate(row.start)} to ${formatEnd(row.end)}`
  }
  const t = row.ticket
  const parts = [
    `#${t.id} ${t.title}`,
    STAGE_LABELS[row.stage],
    assigneeName(t),
    row.unestimated ? 'no estimate (1 day assumed)' : `${formatEstimate(row.ticket)} estimate`,
    `${formatDate(row.start)} to ${formatEnd(row.end)}`
  ]
  if (row.overdue) parts.push('overdue')
  return parts.join(', ')
}

// ---- Tooltip ----
const tooltip = ref(null) // { row, x, y }

function showTooltip(bar, event) {
  let x, y
  if (event?.clientX !== undefined && event.type.startsWith('mouse')) {
    x = event.clientX
    y = event.clientY
  } else {
    const rect = event.target.getBoundingClientRect()
    x = rect.left + rect.width / 2
    y = rect.bottom
  }
  const TIP_W = 280
  tooltip.value = {
    row: bar.row,
    x: Math.min(x + 14, window.innerWidth - TIP_W - 8),
    y: Math.min(y + 14, window.innerHeight - 180)
  }
}

function hideTooltip() {
  tooltip.value = null
}

// ---- Data ----
const scrollEl = ref(null)

async function fetchData() {
  loading.value = true
  error.value = null
  try {
    const res = await authFetch(`/api/projects/${route.params.id}`)
    if (!res.ok) throw new Error(res.status === 404 ? 'Project not found' : 'Failed to load project')
    const data = await res.json()
    tickets.value = data.tickets
    splitParents.value = data.split_parents || []
    dependencies.value = data.dependencies || []
    timeline.value = data.timeline || []
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
  await nextTick()
  observeWidth()
  // Open scrolled to a few days before today
  if (scrollEl.value) scrollEl.value.scrollLeft = Math.max(todayX.value - 3 * dayWidth.value, 0)
}

// The scroll area only exists in chart view, so (re)attach whenever it appears
function observeWidth() {
  resizeObserver?.disconnect()
  if (!scrollEl.value) return
  resizeObserver = new ResizeObserver(([entry]) => {
    containerWidth.value = entry.contentRect.width
  })
  resizeObserver.observe(scrollEl.value)
}

watch([view, () => rows.value.length], async () => {
  await nextTick()
  observeWidth()
})

onMounted(fetchData)
onUnmounted(() => resizeObserver?.disconnect())
</script>

<template>
  <div class="page-container gantt-page gantt-root">
    <div v-if="loading" class="loading"><LoadingSpinner size="small" /> Loading schedule...</div>
    <div v-else-if="error" class="error-box">{{ error }}</div>

    <template v-else>
      <!-- Summary + controls -->
      <div class="gantt-toolbar">
        <dl class="gantt-summary">
          <div>
            <dt>Remaining work</dt>
            <dd>{{ formatHours(summary.remainingHours) }} <span class="summary-sub">across {{ summary.activeCount }} ticket{{ summary.activeCount === 1 ? '' : 's' }}</span></dd>
          </div>
          <div>
            <dt>Projected finish</dt>
            <dd>{{ summary.projectedFinish ? formatEnd(summary.projectedFinish) : '—' }}</dd>
          </div>
          <div v-if="summary.unestimatedCount">
            <dt>Unestimated</dt>
            <dd>{{ summary.unestimatedCount }} <span class="summary-sub">at 1 day each</span></dd>
          </div>
          <div v-if="summary.overdueCount">
            <dt>Overdue</dt>
            <dd class="summary-overdue">{{ summary.overdueCount }}</dd>
          </div>
        </dl>

        <div class="gantt-controls">
          <label class="control-check">
            <input v-model="includeDone" type="checkbox" />
            Show completed
          </label>
          <div class="segmented" role="group" aria-label="Zoom">
            <button :class="{ active: zoom === 'day' }" :aria-pressed="zoom === 'day'" @click="zoom = 'day'">Days</button>
            <button :class="{ active: zoom === 'week' }" :aria-pressed="zoom === 'week'" @click="zoom = 'week'">Weeks</button>
          </div>
          <div class="segmented" role="group" aria-label="View">
            <button :class="{ active: view === 'chart' }" :aria-pressed="view === 'chart'" @click="view = 'chart'">Chart</button>
            <button :class="{ active: view === 'table' }" :aria-pressed="view === 'table'" @click="view = 'table'">Table</button>
          </div>
        </div>
      </div>

      <!-- Legend: identity is never color alone -- each row also names its status -->
      <ul class="gantt-legend" aria-label="Legend">
        <li><span class="swatch stage-backlog"></span>Backlog</li>
        <li><span class="swatch stage-on-deck"></span>On Deck</li>
        <li><span class="swatch stage-in_progress"></span>In Progress</li>
        <li v-if="includeDone"><span class="swatch stage-done"></span>Done</li>
        <li><span class="swatch swatch-unestimated"></span>No estimate (1 day assumed)</li>
        <li><span class="swatch swatch-overdue"></span>Overdue</li>
        <li v-if="hasCategories"><span class="swatch swatch-category"></span>Category (spans its subtasks)</li>
        <li><span class="swatch-line"></span>Depends on</li>
        <li class="legend-note">{{ HOURS_PER_DAY }}h = 1 working day · weekends skipped</li>
      </ul>

      <div v-if="rows.length === 0" class="empty-state">
        {{ tickets.length === 0 ? 'No tickets in this project yet.' : 'Nothing left to schedule — every ticket is done.' }}
        <button v-if="tickets.length > 0 && !includeDone" class="link-btn" @click="includeDone = true">Show completed</button>
      </div>

      <!-- Chart -->
      <div v-else-if="view === 'chart'" ref="scrollEl" class="gantt-scroll" @scroll="hideTooltip">
        <div class="gantt-grid" :style="{ width: `${LABEL_W + timelineWidth}px` }">
          <div class="gantt-header">
            <div class="corner" :style="{ width: `${LABEL_W}px` }">Ticket</div>
            <div class="header-timeline" :style="{ width: `${timelineWidth}px` }">
              <div class="month-row">
                <div v-for="m in months" :key="m.key" class="month-cell" :style="{ left: `${m.x}px`, width: `${m.width}px` }">
                  <span>{{ m.label }}</span>
                </div>
              </div>
              <div class="day-row">
                <div
                  v-for="d in days"
                  :key="d.key"
                  class="day-cell"
                  :class="{ weekend: d.weekend, today: d.isToday }"
                  :style="{ left: `${d.x}px`, width: `${dayWidth}px` }"
                >
                  <template v-if="zoom === 'day'">
                    <span class="day-weekday">{{ d.weekday }}</span>
                    <span class="day-num">{{ d.label }}</span>
                  </template>
                  <span v-else-if="d.isMonday" class="day-num">{{ d.label }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="gantt-body">
            <div class="body-labels" :style="{ width: `${LABEL_W}px` }">
              <div
                v-for="bar in bars"
                :key="bar.row.ticket.id"
                class="label-row"
                :class="{ 'label-category': bar.row.isCategory, 'label-subtask': bar.row.inCategory }"
                :style="{ height: `${ROW_H}px` }"
              >
                <span class="label-id">#{{ bar.row.ticket.id }}</span>
                <span class="label-title" :title="bar.row.ticket.title">{{ bar.row.ticket.title }}</span>
                <span class="label-meta">
                  <span v-if="bar.row.isCategory">{{ bar.row.doneCount }}/{{ bar.row.subtaskCount }} done</span>
                  <span v-else-if="bar.row.overdue" class="label-overdue" title="Overdue">! Overdue</span>
                  <span v-else-if="bar.row.stage === 'done'">✓ Done</span>
                  <span v-else>{{ STAGE_LABELS[bar.row.stage] }}</span>
                </span>
              </div>
            </div>

            <div class="body-timeline" :style="{ width: `${timelineWidth}px`, height: `${bodyHeight}px` }">
              <div
                v-for="d in days"
                v-show="d.weekend"
                :key="`w${d.key}`"
                class="weekend-band"
                :style="{ left: `${d.x}px`, width: `${dayWidth}px` }"
              ></div>
              <div v-for="bar in bars" :key="`r${bar.row.ticket.id}`" class="row-rule" :style="{ top: `${(bar.index + 1) * ROW_H - 1}px` }"></div>

              <svg class="arrows" :width="timelineWidth" :height="bodyHeight" aria-hidden="true">
                <defs>
                  <marker id="gantt-arrowhead" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" class="arrowhead" />
                  </marker>
                </defs>
                <path v-for="a in arrows" :key="a.key" :d="a.d" class="arrow" marker-end="url(#gantt-arrowhead)" />
              </svg>

              <div class="today-line" :style="{ left: `${todayX}px` }"><span>Today</span></div>

              <button
                v-for="bar in bars"
                :key="`b${bar.row.ticket.id}`"
                class="bar-hit"
                :style="{ left: `${bar.x}px`, top: `${bar.index * ROW_H}px`, width: `${bar.width}px`, height: `${ROW_H}px` }"
                :aria-label="barLabel(bar.row)"
                @mouseenter="showTooltip(bar, $event)"
                @mousemove="showTooltip(bar, $event)"
                @mouseleave="hideTooltip"
                @focus="showTooltip(bar, $event)"
                @blur="hideTooltip"
              >
                <span
                  class="bar"
                  :class="[`stage-${bar.row.stage}`, { unestimated: bar.row.unestimated, overdue: bar.row.overdue, 'start-unknown': !bar.row.startKnown }]"
                  :style="{ height: `${BAR_H}px` }"
                ></span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Table view (same schedule, readable without color) -->
      <div v-else class="table-wrap">
        <table class="gantt-table">
          <thead>
            <tr>
              <th scope="col">Ticket</th>
              <th scope="col">Status</th>
              <th scope="col">Assignee</th>
              <th scope="col" class="num">Estimate</th>
              <th scope="col">Start</th>
              <th scope="col">Finish</th>
              <th scope="col">Depends on</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.ticket.id" :class="{ 'row-category': r.isCategory, 'row-subtask': r.inCategory }">
              <td><span class="label-id">#{{ r.ticket.id }}</span> {{ r.ticket.title }}</td>
              <td>
                <template v-if="r.isCategory">Category · {{ categoryProgress(r) }}</template>
                <span v-else-if="r.overdue" class="label-overdue">! Overdue</span>
                <template v-else>{{ STAGE_LABELS[r.stage] }}</template>
              </td>
              <td>{{ r.isCategory ? '—' : assigneeName(r.ticket) }}</td>
              <td class="num">{{ r.isCategory ? '—' : r.unestimated ? '— (1d)' : formatEstimate(r.ticket) }}</td>
              <td>{{ formatDate(r.start) }}<span v-if="!r.startKnown" class="approx" title="Start time wasn't recorded; estimated from the estimate"> (est.)</span></td>
              <td>{{ formatEnd(r.end) }}</td>
              <td>
                {{ r.dependsOn.length ? r.dependsOn.map(id => '#' + id).join(', ') : '—' }}
                <span v-if="r.externalBlockers.length" class="approx"> (other project: {{ r.externalBlockers.map(id => '#' + id).join(', ') }})</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Hover / focus tooltip -->
    <div
      v-if="tooltip"
      class="gantt-tooltip"
      role="tooltip"
      :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
    >
      <p class="tip-title"><span class="label-id">#{{ tooltip.row.ticket.id }}</span> {{ tooltip.row.ticket.title }}</p>
      <dl>
        <dt>Status</dt>
        <dd>
          <span class="swatch" :class="`stage-${tooltip.row.stage}`"></span>{{ STAGE_LABELS[tooltip.row.stage] }}
          <span v-if="tooltip.row.overdue" class="label-overdue"> · overdue</span>
        </dd>
        <template v-if="tooltip.row.isCategory">
          <dt>Subtasks</dt>
          <dd>{{ categoryProgress(tooltip.row) }}</dd>
        </template>
        <template v-else>
          <dt>Assignee</dt>
          <dd>{{ assigneeName(tooltip.row.ticket) }}</dd>
          <dt>Estimate</dt>
          <dd>
            {{ tooltip.row.unestimated ? 'None — 1 day assumed' : formatEstimate(tooltip.row.ticket) }}
            <template v-if="tooltip.row.stage === 'in_progress' && !tooltip.row.overdue"> · {{ formatHours(tooltip.row.remainingHours) }} left</template>
          </dd>
        </template>
        <dt>{{ tooltip.row.stage === 'done' ? 'Worked' : 'Scheduled' }}</dt>
        <dd>{{ formatDate(tooltip.row.start) }}<span v-if="!tooltip.row.startKnown"> (est.)</span> → {{ formatEnd(tooltip.row.end) }}</dd>
        <template v-if="tooltip.row.dependsOn.length">
          <dt>Depends on</dt>
          <dd>{{ tooltip.row.dependsOn.map(id => '#' + id).join(', ') }}</dd>
        </template>
        <template v-if="tooltip.row.externalBlockers.length">
          <dt>Waiting on</dt>
          <dd>{{ tooltip.row.externalBlockers.map(id => '#' + id).join(', ') }} (another project — not scheduled here)</dd>
        </template>
      </dl>
    </div>
  </div>
</template>

<style scoped>
/* Chart palette: reference categorical slots 1-3 (blue / aqua / orange),
   validated as a set in both modes (dataviz validate_palette.js, all-pairs).
   Done is recessive neutral context, not a series. Overdue uses the app's
   reserved critical red, always with a "!" + text label. */
.gantt-root {
  --gantt-backlog: #2a78d6;
  --gantt-on-deck: #1baf7a;
  --gantt-in-progress: #eb6834;
  --gantt-done: #b4b2ab;
  --gantt-critical: var(--badge-red);
  --gantt-grid: var(--color-border);
  --gantt-weekend: rgba(0, 0, 0, 0.035);
  --gantt-arrow: #8a8984;
  max-width: none;
}

@media (prefers-color-scheme: dark) {
  .gantt-root {
    --gantt-backlog: #3987e5;
    --gantt-on-deck: #199e70;
    --gantt-in-progress: #d95926;
    --gantt-done: #5c5b56;
    --gantt-weekend: rgba(255, 255, 255, 0.04);
    --gantt-arrow: #8f8e87;
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
.gantt-toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  margin-bottom: 12px;
}

.gantt-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 28px;
  margin: 0;
}

.gantt-summary dt {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.gantt-summary dd {
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

.summary-overdue {
  color: var(--gantt-critical) !important;
}

.gantt-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.control-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.875rem;
  color: var(--color-text);
  cursor: pointer;
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

/* Legend */
.gantt-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.gantt-legend li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend-note {
  color: var(--color-text-muted);
}

.swatch {
  display: inline-block;
  width: 14px;
  height: 10px;
  border-radius: 3px;
  margin-right: 4px;
  vertical-align: baseline;
}

.gantt-legend .swatch {
  margin-right: 0;
}

.swatch-unestimated {
  border: 1.5px dashed var(--color-text-muted);
  background: repeating-linear-gradient(45deg, transparent 0 3px, var(--gantt-grid) 3px 5px);
}

.swatch-overdue {
  background: var(--color-background-card);
  box-shadow: 0 0 0 2px var(--gantt-critical);
}

.swatch-line {
  display: inline-block;
  width: 18px;
  height: 0;
  border-top: 1.5px solid var(--gantt-arrow);
}

.stage-backlog { background: var(--gantt-backlog); }
.stage-on-deck { background: var(--gantt-on-deck); }
.stage-in_progress { background: var(--gantt-in-progress); }
.stage-done { background: var(--gantt-done); }

/* Category (split ticket): a thin bracket spanning its subtasks -- shape,
   not just color, sets it apart */
.bar.stage-category {
  position: relative;
  height: 6px !important;
  margin-top: 0;
  border-radius: 0;
  background: var(--color-text-secondary);
}

/* end caps hang below the bar, like a bracket over the subtasks */
.bar.stage-category::before,
.bar.stage-category::after {
  content: '';
  position: absolute;
  top: 100%;
  width: 0;
  height: 0;
  border-top: 6px solid var(--color-text-secondary);
}

.bar.stage-category::before {
  left: 0;
  border-right: 6px solid transparent;
}

.bar.stage-category::after {
  right: 0;
  border-left: 6px solid transparent;
}

.swatch-category {
  height: 4px;
  border-radius: 0;
  background: var(--color-text-secondary);
}

.label-category .label-title {
  font-weight: 700;
}

.label-subtask {
  padding-left: 22px !important;
}

.row-category td {
  font-weight: 600;
}

.row-subtask td:first-child {
  padding-left: 24px;
}

.empty-state {
  padding: 40px 20px;
  text-align: center;
  color: var(--color-text-light);
  background: var(--color-background-card);
  border-radius: var(--card-radius-sm);
}

.link-btn {
  margin-left: 8px;
  padding: 0;
  border: none;
  background: none;
  color: var(--color-accent);
  cursor: pointer;
  font-size: inherit;
  text-decoration: underline;
}

/* Chart */
.gantt-scroll {
  overflow: auto;
  max-height: calc(100vh - 240px);
  border: 1px solid var(--color-border);
  border-radius: var(--card-radius-sm);
  background: var(--color-background-card);
}

.gantt-grid {
  position: relative;
}

.gantt-header {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  background: var(--color-background-card);
  border-bottom: 1px solid var(--gantt-grid);
}

.corner {
  position: sticky;
  left: 0;
  z-index: 4;
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  padding: 0 12px 8px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
  background: var(--color-background-card);
  border-right: 1px solid var(--gantt-grid);
}

.header-timeline {
  position: relative;
  height: 48px;
  flex-shrink: 0;
}

.month-row,
.day-row {
  position: relative;
  height: 24px;
}

.month-cell {
  position: absolute;
  top: 0;
  height: 24px;
  border-left: 1px solid var(--gantt-grid);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  overflow: hidden;
}

.month-cell span {
  display: inline-block;
  padding: 4px 6px;
  white-space: nowrap;
}

.day-cell {
  position: absolute;
  top: 0;
  height: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-size: 0.65rem;
  line-height: 1.05;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.day-cell.weekend {
  color: var(--color-text-light);
}

.day-cell.today {
  color: var(--color-text);
  font-weight: 700;
}

.day-weekday {
  font-size: 0.6rem;
}

.gantt-body {
  display: flex;
}

.body-labels {
  position: sticky;
  left: 0;
  z-index: 2;
  flex-shrink: 0;
  background: var(--color-background-card);
  border-right: 1px solid var(--gantt-grid);
}

.label-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border-bottom: 1px solid var(--gantt-grid);
  box-sizing: border-box;
  font-size: 0.85rem;
}

.label-id {
  flex-shrink: 0;
  font-size: 0.75rem;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.label-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text);
}

.label-meta {
  flex-shrink: 0;
  font-size: 0.72rem;
  color: var(--color-text-muted);
}

.label-overdue {
  color: var(--gantt-critical);
  font-weight: 600;
}

.body-timeline {
  position: relative;
  flex-shrink: 0;
}

.weekend-band {
  position: absolute;
  top: 0;
  bottom: 0;
  background: var(--gantt-weekend);
}

.row-rule {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--gantt-grid);
  opacity: 0.6;
}

.arrows {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  overflow: visible;
}

.arrow {
  fill: none;
  stroke: var(--gantt-arrow);
  stroke-width: 1.5;
}

.arrowhead {
  fill: var(--gantt-arrow);
}

/* Neutral ink, not the app accent -- the accent green reads as the On Deck series */
.today-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 2px dashed var(--color-text-secondary);
  pointer-events: none;
  z-index: 1;
}

.today-line span {
  position: absolute;
  top: 2px;
  left: 4px;
  font-size: 0.65rem;
  font-weight: 700;
  color: var(--color-text-secondary);
}

/* Hit target is the full row height; the visible bar sits inside it */
.bar-hit {
  position: absolute;
  display: flex;
  align-items: center;
  padding: 0;
  border: none;
  background: none;
  cursor: default;
  z-index: 2;
}

.bar-hit:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
  border-radius: 4px;
}

.bar {
  display: block;
  width: 100%;
  border-radius: 4px;
  /* 2px surface ring keeps touching bars and arrows separate */
  box-shadow: 0 0 0 2px var(--color-background-card);
}

.bar-hit:hover .bar {
  filter: brightness(1.08);
}

/* Unestimated: dashed outline + hatch over a translucent fill */
.bar.unestimated {
  opacity: 0.75;
  background-image: repeating-linear-gradient(45deg, transparent 0 4px, rgba(255, 255, 255, 0.45) 4px 7px);
  outline: 1.5px dashed var(--color-text-muted);
  outline-offset: -1.5px;
}

.bar.overdue {
  box-shadow: 0 0 0 2px var(--color-background-card), 0 0 0 4px var(--gantt-critical);
}

/* Done bars whose start wasn't recorded fade in from the left */
.bar.stage-done.start-unknown {
  -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 40%);
  mask-image: linear-gradient(90deg, transparent 0, #000 40%);
}

/* Tooltip */
.gantt-tooltip {
  position: fixed;
  z-index: 1000;
  width: 280px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  pointer-events: none;
  font-size: 0.8rem;
}

.tip-title {
  margin: 0 0 8px;
  font-weight: 600;
  color: var(--color-text);
}

.gantt-tooltip dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px 10px;
  margin: 0;
}

.gantt-tooltip dt {
  color: var(--color-text-muted);
}

.gantt-tooltip dd {
  margin: 0;
  color: var(--color-text);
}

/* Table */
.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--card-radius-sm);
  background: var(--color-background-card);
}

.gantt-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.gantt-table th,
.gantt-table td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid var(--gantt-grid);
  color: var(--color-text);
  white-space: nowrap;
}

.gantt-table th {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
}

.gantt-table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.approx {
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

@media (max-width: 768px) {
  .gantt-scroll {
    max-height: none;
  }
}
</style>
