<template>
  <div v-for="s in surveys" :key="s.slug" class="panel">
    <div class="survey-head">
      <div>
        <h2>Survey: {{ s.title }}</h2>
        <p class="counts">
          {{ s.valid }} valid of {{ s.total }} submitted
          <span v-if="s.total > s.valid">({{ s.total - s.valid }} replaced by a later submission from the same connection and browser)</span>
        </p>
      </div>
      <div class="head-actions">
        <button class="btn-sm btn-secondary" @click="toggle(s)">{{ openSlug === s.slug ? 'Hide results' : 'Show results' }}</button>
        <button class="btn-sm btn-secondary" :disabled="!s.total" @click="downloadCsv(s)">Download CSV</button>
      </div>
    </div>

    <div v-if="openSlug === s.slug">
      <div v-if="loading" class="status-msg">Loading...</div>
      <div v-else-if="!valid.length" class="status-msg">No valid responses yet.</div>
      <template v-else>
        <p class="note">Counts use valid responses only. Percentages are of all {{ valid.length }} valid responses.</p>
        <div v-for="q in s.questions" :key="q.id" class="question">
          <h3>{{ q.label }} <span v-if="q.type === 'multi'" class="sub">(tick all)</span></h3>
          <ul v-if="q.type === 'text'" class="comments">
            <li v-for="r in valid.filter(r => r.answers[q.id])" :key="r.id">
              <span class="sub">{{ formatDate(r.createdAt) }}</span> {{ r.answers[q.id] }}
            </li>
            <li v-if="!valid.some(r => r.answers[q.id])" class="sub">No comments.</li>
          </ul>
          <table v-else class="tally">
            <tr v-for="[value, label] in q.options" :key="value">
              <td class="label">{{ label }}</td>
              <td class="bar-cell"><span class="bar" :style="{ width: percent(count(q, value)) + '%' }"></span></td>
              <td class="num">{{ count(q, value) }}</td>
              <td class="num sub">{{ percent(count(q, value)) }}%</td>
            </tr>
            <tr>
              <td class="label sub">No answer</td>
              <td></td>
              <td class="num sub">{{ valid.filter(r => r.answers[q.id] === undefined).length }}</td>
              <td></td>
            </tr>
          </table>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

// Results of the anonymous greywirestudio.com surveys (backend/utilities/surveys.js)
const surveys = ref([])
const openSlug = ref(null)
const responses = ref([])
const loading = ref(false)

const valid = computed(() => responses.value.filter(r => r.isValid))

async function loadSurveys() {
  const res = await fetch('/api/admin/greywire/surveys', { credentials: 'include' })
  const data = await res.json()
  surveys.value = data.surveys || []
}

async function fetchResponses(s) {
  const res = await fetch(`/api/admin/greywire/surveys/${s.slug}/responses`, { credentials: 'include' })
  const data = await res.json()
  return data.responses || []
}

async function toggle(s) {
  if (openSlug.value === s.slug) {
    openSlug.value = null
    return
  }
  openSlug.value = s.slug
  loading.value = true
  try {
    responses.value = await fetchResponses(s)
  } finally {
    loading.value = false
  }
}

function count(q, value) {
  return valid.value.filter(r => {
    const a = r.answers[q.id]
    return Array.isArray(a) ? a.includes(value) : a === value
  }).length
}

function percent(n) {
  return valid.value.length ? Math.round((n / valid.value.length) * 100) : 0
}

// Every submission, invalid ones included, one column per question
async function downloadCsv(s) {
  const rows = await fetchResponses(s)
  const labelOf = q => value => (q.options?.find(([v]) => v === value) || [value, value])[1]
  const header = ['id', 'submitted', 'valid', 'replaced_by', ...s.questions.map(q => q.label)]
  const lines = rows.map(r => [
    r.id,
    new Date(r.createdAt).toISOString(),
    r.isValid ? 'true' : 'false',
    r.supersededBy || '',
    ...s.questions.map(q => {
      const a = r.answers[q.id]
      if (a === undefined) return ''
      if (q.type === 'text') return a
      return (Array.isArray(a) ? a : [a]).map(labelOf(q)).join('; ')
    })
  ])
  const csv = [header, ...lines]
    .map(cols => cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `survey-${s.slug}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function formatDate(str) {
  return str ? new Date(str).toLocaleDateString() : ''
}

loadSurveys()
</script>

<style scoped>
.panel {
  background: var(--color-background-card);
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
}
h2 { color: var(--color-text); font-size: 1rem; margin: 0 0 4px; }
h3 { color: var(--color-text); font-size: 0.9rem; margin: 0 0 6px; }
.survey-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px 16px; align-items: flex-start; }
.head-actions { display: flex; gap: 6px; }
.counts, .note { color: var(--color-text-muted); font-size: 0.85rem; margin: 0; }
.note { margin: 12px 0 4px; }
.sub { font-size: 0.8rem; color: var(--color-text-light); font-weight: normal; }

.question { margin-top: 18px; }
.tally { width: 100%; max-width: 640px; table-layout: fixed; border-collapse: collapse; font-size: 0.85rem; }
.tally td { padding: 3px 8px 3px 0; color: var(--color-text); }
.tally .label { width: 190px; }
.tally .num { width: 3.5em; text-align: right; white-space: nowrap; }
.bar-cell { position: relative; }
.bar-cell::before { content: ''; position: absolute; left: 0; right: 8px; top: 50%; height: 10px; margin-top: -5px; border-radius: 3px; background: var(--color-background-soft); }
.bar { position: relative; display: block; height: 10px; border-radius: 3px; background: var(--color-accent); }

.comments { margin: 0; padding-left: 18px; font-size: 0.85rem; color: var(--color-text); }
.comments li { margin-bottom: 6px; white-space: pre-wrap; }

.status-msg { color: var(--color-text-muted, #888); font-style: italic; padding: 12px 0; }

button {
  padding: 8px 14px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
}
button:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary { background: var(--color-background-soft); color: var(--color-text); border: 1px solid var(--color-border); }
.btn-secondary:hover { background: var(--color-border); }
.btn-sm { padding: 4px 10px; font-size: 0.8rem; }
</style>
