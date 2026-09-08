<script setup>
import { computed } from 'vue'

// One resource in the Haulonaut HUD strip (Tokens / Rations / Fuel /
// Health / Cycles / Drift Variance). Clicking the chip selects it and
// reveals a single +/- control; that control toggles the chip's label
// between its full word and its abbreviation. The parent owns both the
// selection and the per-stat mode (and persists the mode); this component
// is purely presentational.
const props = defineProps({
  statKey: { type: String, required: true },
  icon: { type: String, required: true },
  label: { type: String, required: true },
  // Pre-formatted value string, e.g. "1,000" or "55/120".
  value: { type: [String, Number], required: true },
  mode: { type: String, default: 'full' }, // 'full' | 'short'
  selected: { type: Boolean, default: false },
  empty: { type: Boolean, default: false },
  // Extra class carried through to the root (e.g. 'health-stat' for the
  // inline health bar layout, 'drift-stat' for the warning blink).
  toneClass: { type: String, default: '' },
})
const emit = defineEmits(['select', 'toggle'])

// "Cycles" -> "C", "Drift Variance" -> "DV": single-word labels collapse to
// their first letter, multi-word ones to their initials.
const abbrev = computed(() =>
  props.label.trim().split(/\s+/).map(w => w[0] || '').join('').toUpperCase()
)
const shownLabel = computed(() => (props.mode === 'short' ? abbrev.value : props.label))
</script>

<template>
  <span
    class="resource-stat stat-chip"
    :class="[toneClass, { 'resource-empty': empty, 'stat-chip-selected': selected }]"
    role="button"
    tabindex="0"
    :aria-label="`${label}: ${value}`"
    @click.stop="emit('select', statKey)"
    @keydown.enter.stop.prevent="emit('select', statKey)"
    @keydown.space.stop.prevent="emit('select', statKey)"
  >
    <span class="resource-icon" aria-hidden="true">{{ icon }}</span>{{ value }} <span class="resource-unit">{{ shownLabel }}</span><slot />
    <button
      v-if="selected"
      type="button"
      class="stat-toggle"
      :aria-label="mode === 'full' ? `Abbreviate ${label} to ${abbrev}` : `Show full label for ${label}`"
      @click.stop="emit('toggle', statKey)"
      @keydown.enter.stop.prevent="emit('toggle', statKey)"
      @keydown.space.stop.prevent="emit('toggle', statKey)"
    >{{ mode === 'full' ? '−' : '+' }}</button>
  </span>
</template>

<style scoped>
.stat-chip {
  cursor: pointer;
  border-radius: 3px;
  padding: 1px 4px;
  margin: -1px -4px;
  transition: background 0.12s ease, box-shadow 0.12s ease;
}
.stat-chip:hover {
  background: rgba(143, 230, 171, 0.08);
}
.stat-chip:focus-visible {
  outline: 1px solid #8fe6ab;
  outline-offset: 1px;
}
.stat-chip-selected,
.stat-chip-selected:hover {
  background: rgba(143, 230, 171, 0.16);
  box-shadow: inset 0 0 0 1px rgba(143, 230, 171, 0.5);
}
.stat-toggle {
  margin-left: 6px;
  min-width: 18px;
  height: 16px;
  padding: 0;
  font: inherit;
  font-size: 0.8rem;
  line-height: 14px;
  color: #061a0e;
  background: #8fe6ab;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  vertical-align: middle;
}
.stat-toggle:hover { background: #baffcf; }
.stat-toggle:focus-visible { outline: 1px solid #baffcf; outline-offset: 1px; }
</style>
