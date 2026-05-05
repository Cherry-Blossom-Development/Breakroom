<template>
  <main class="shipping-page page-container">

    <div class="page-header">
      <RouterLink to="/collections" class="back-link">← Collections</RouterLink>
      <h1>Shipping Setup</h1>
      <p class="page-desc">
        Configure where you ship from, which destinations you support, and how long orders take to process.
        This information will be used when buyers check out and when carrier rates are calculated.
      </p>
    </div>

    <div v-if="loading" class="loading-state">Loading…</div>

    <template v-else>

      <!-- Ship-from address -->
      <section class="settings-section">
        <h2 class="section-title">Ship-from address</h2>
        <p class="section-desc">The address your packages originate from. Required for carrier rate calculation.</p>

        <div class="form-group">
          <label class="form-label">Address line 1</label>
          <input v-model="form.address_line1" type="text" class="form-input" placeholder="123 Main St" maxlength="255" />
        </div>

        <div class="form-group">
          <label class="form-label">Address line 2 <span class="optional">(optional)</span></label>
          <input v-model="form.address_line2" type="text" class="form-input" placeholder="Apt, suite, unit, etc." maxlength="255" />
        </div>

        <div class="form-row">
          <div class="form-group form-group--grow">
            <label class="form-label">City</label>
            <input v-model="form.city" type="text" class="form-input" placeholder="City" maxlength="100" />
          </div>
          <div class="form-group form-group--sm">
            <label class="form-label">State / Region</label>
            <input v-model="form.state_region" type="text" class="form-input" placeholder="e.g. CA" maxlength="100" />
          </div>
          <div class="form-group form-group--sm">
            <label class="form-label">ZIP / Postal code</label>
            <input v-model="form.zip" type="text" class="form-input" placeholder="e.g. 90210" maxlength="20" />
          </div>
        </div>

        <div class="form-group form-group--half">
          <label class="form-label">Country</label>
          <select v-model="form.country" class="form-select">
            <option value="US">United States</option>
            <option value="CA">Canada</option>
            <option value="GB">United Kingdom</option>
            <option value="AU">Australia</option>
            <option value="DE">Germany</option>
            <option value="FR">France</option>
            <option value="NL">Netherlands</option>
            <option value="JP">Japan</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
      </section>

      <!-- Shipping destinations -->
      <section class="settings-section">
        <h2 class="section-title">Shipping destinations</h2>
        <p class="section-desc">Where are you willing to ship? Buyers outside your allowed destinations won't be able to check out.</p>

        <div class="radio-group">
          <label class="radio-option" :class="{ selected: form.ship_destinations === 'us_only' }">
            <input type="radio" v-model="form.ship_destinations" value="us_only" />
            <div class="radio-content">
              <div class="radio-title">United States only</div>
              <div class="radio-desc">Domestic shipping only</div>
            </div>
          </label>
          <label class="radio-option" :class="{ selected: form.ship_destinations === 'us_canada' }">
            <input type="radio" v-model="form.ship_destinations" value="us_canada" />
            <div class="radio-content">
              <div class="radio-title">United States & Canada</div>
              <div class="radio-desc">North American shipping</div>
            </div>
          </label>
          <label class="radio-option" :class="{ selected: form.ship_destinations === 'worldwide' }">
            <input type="radio" v-model="form.ship_destinations" value="worldwide" />
            <div class="radio-content">
              <div class="radio-title">Worldwide</div>
              <div class="radio-desc">Ship to any country</div>
            </div>
          </label>
        </div>
      </section>

      <!-- Processing time -->
      <section class="settings-section">
        <h2 class="section-title">Processing time</h2>
        <p class="section-desc">How long after an order is placed before you ship it. This is shown to buyers on your public store.</p>

        <div class="form-group form-group--half">
          <select v-model="form.processing_time" class="form-select">
            <option value="same_day">Same day</option>
            <option value="1_2_days">1–2 business days</option>
            <option value="3_5_days">3–5 business days</option>
            <option value="1_2_weeks">1–2 weeks</option>
            <option value="2_4_weeks">2–4 weeks</option>
          </select>
        </div>
      </section>

      <p v-if="error" class="error-msg">{{ error }}</p>
      <p v-if="saved" class="success-msg">Settings saved.</p>

      <div class="page-actions">
        <button class="btn-primary" :disabled="saving" @click="save">
          {{ saving ? 'Saving…' : 'Save Settings' }}
        </button>
      </div>

    </template>
  </main>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { authFetch } from '@/utilities/authFetch'

const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const error = ref('')

const defaultForm = () => ({
  address_line1: '',
  address_line2: '',
  city: '',
  state_region: '',
  zip: '',
  country: 'US',
  ship_destinations: 'us_only',
  processing_time: '1_2_days'
})

const form = ref(defaultForm())

async function fetchSettings() {
  loading.value = true
  try {
    const res = await authFetch('/api/shipping/settings')
    if (res.ok) {
      const data = await res.json()
      if (data) {
        form.value = {
          address_line1:    data.address_line1    || '',
          address_line2:    data.address_line2    || '',
          city:             data.city             || '',
          state_region:     data.state_region     || '',
          zip:              data.zip              || '',
          country:          data.country          || 'US',
          ship_destinations: data.ship_destinations || 'us_only',
          processing_time:  data.processing_time  || '1_2_days'
        }
      }
    }
  } catch (err) {
    console.error('Failed to load shipping settings:', err)
  } finally {
    loading.value = false
  }
}

async function save() {
  error.value = ''
  saved.value = false
  saving.value = true
  try {
    const res = await authFetch('/api/shipping/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form.value)
    })
    if (res.ok) {
      saved.value = true
      setTimeout(() => { saved.value = false }, 3000)
    } else {
      const data = await res.json()
      error.value = data.message || 'Failed to save settings.'
    }
  } catch (err) {
    error.value = 'Could not save settings. Please try again.'
  } finally {
    saving.value = false
  }
}

onMounted(fetchSettings)
</script>

<style scoped>
.shipping-page {
  padding: 32px 20px;
  max-width: 680px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 40px;
}

.back-link {
  display: inline-block;
  color: var(--color-link);
  text-decoration: none;
  font-size: 0.88rem;
  margin-bottom: 8px;
}

.back-link:hover { text-decoration: underline; }

.page-header h1 {
  font-size: 1.8rem;
  color: var(--color-text);
  margin: 0 0 8px;
}

.page-desc {
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  margin: 0;
  line-height: 1.6;
}

.loading-state {
  color: var(--color-text-secondary);
  padding: 60px 0;
  text-align: center;
}

/* ---- Sections ---- */
.settings-section {
  margin-bottom: 40px;
  padding-bottom: 40px;
  border-bottom: 1px solid var(--color-border);
}

.settings-section:last-of-type {
  border-bottom: none;
}

.section-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--color-text);
  margin: 0 0 4px;
}

.section-desc {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  margin: 0 0 20px;
  line-height: 1.5;
}

/* ---- Form ---- */
.form-group { margin-bottom: 14px; }
.form-group--grow { flex: 1; min-width: 0; }
.form-group--sm { flex: 0 0 120px; }
.form-group--half { max-width: 300px; }

.form-row {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}

.form-label {
  display: block;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 5px;
}

.optional {
  font-weight: 400;
  color: var(--color-text-secondary);
}

.form-input,
.form-select {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 0.95rem;
  color: var(--color-text);
  background: var(--color-background, #fff);
  box-sizing: border-box;
  font-family: inherit;
  transition: border-color 0.15s;
}

.form-input:focus,
.form-select:focus { outline: none; border-color: var(--color-link); }

/* ---- Radio options ---- */
.radio-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.radio-option {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.radio-option input[type="radio"] { display: none; }

.radio-option.selected {
  border-color: var(--color-link);
  background: rgba(var(--color-link-rgb, 66, 133, 244), 0.05);
}

.radio-option:not(.selected):hover {
  border-color: var(--color-text-secondary);
}

/* Custom radio dot */
.radio-option::before {
  content: '';
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--color-border);
  flex-shrink: 0;
  transition: border-color 0.15s, background 0.15s;
}

.radio-option.selected::before {
  border-color: var(--color-link);
  background: var(--color-link);
  box-shadow: inset 0 0 0 3px var(--color-background, #fff);
}

.radio-content { flex: 1; }

.radio-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text);
}

.radio-desc {
  font-size: 0.82rem;
  color: var(--color-text-secondary);
  margin-top: 2px;
}

/* ---- Messages ---- */
.error-msg {
  font-size: 0.875rem;
  color: #e53e3e;
  margin: 0 0 16px;
}

.success-msg {
  font-size: 0.875rem;
  color: #276749;
  margin: 0 0 16px;
}

/* ---- Actions ---- */
.page-actions {
  padding-top: 8px;
}

.btn-primary {
  background: var(--color-link);
  color: #fff;
  border: none;
  padding: 10px 24px;
  border-radius: 7px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-primary:hover:not(:disabled) { opacity: 0.87; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

@media (max-width: 500px) {
  .form-row { flex-direction: column; }
  .form-group--sm { flex: none; }
}
</style>
