<template>
  <main class="payment-page page-container">

    <div class="page-header">
      <div class="header-left">
        <RouterLink :to="backLink.to" class="back-link">← {{ backLink.label }}</RouterLink>
        <h1>Payment Setup</h1>
        <p class="page-desc">
          Connect a payout account to receive payments from your store sales.
          Choose a payment processor below to get started.
        </p>
      </div>
    </div>

    <div v-if="loading" class="loading-state">Loading…</div>

    <template v-else>

      <!-- ── Plan & Fees ── -->
      <section class="plan-card" :class="plan.subscribed ? 'plan-card--pro' : 'plan-card--free'">
        <div class="plan-left">
          <div class="plan-badge" :class="plan.subscribed ? 'badge--pro' : 'badge--free'">
            {{ plan.subscribed ? 'Prosaurus Pro' : 'Free Plan' }}
          </div>
          <div class="plan-fee">
            <template v-if="plan.subscribed">
              <span class="fee-highlight">0% application fee</span> on all artwork sales
            </template>
            <template v-else>
              <span class="fee-highlight">5% application fee</span> applied to each sale
            </template>
          </div>
          <div class="plan-sub-note">
            <template v-if="plan.subscribed && plan.platform === 'apple'">
              Subscribed via iOS — manage in the App Store
            </template>
            <template v-else-if="plan.subscribed && plan.platform === 'google'">
              Subscribed via Android — manage in Google Play
            </template>
            <template v-else-if="plan.subscribed && plan.platform === 'promo'">
              Complimentary Pro account
            </template>
            <template v-else-if="!plan.subscribed">
              Upgrade to Pro to keep 100% of your sale price (minus Square's processing fee)
            </template>
          </div>
        </div>
        <div class="plan-right">
          <!-- Web subscriber: manage via custom Cancel/Update endpoints -->
          <button
            v-if="plan.subscribed && plan.platform === 'square'"
            class="btn-outline"
            @click="openManageModal"
          >
            Manage Subscription
          </button>
          <!-- Not subscribed: upgrade via web -->
          <button
            v-else-if="!plan.subscribed"
            class="btn-pro"
            @click="openSubscribeModal"
          >
            Upgrade to Pro — $3.99/mo
          </button>
        </div>
      </section>

      <p v-if="subscribeSuccess" class="success-msg">
        You're now on Prosaurus Pro. Your 0% fee rate is active.
      </p>

      <!-- ── Payment method chooser ── -->
      <template v-if="viewMode === 'chooser'">
        <h2 class="section-heading">Choose a Payment Method</h2>
        <p class="chooser-intro">
          Pick a processor to handle your payouts. You can come back here to switch
          or add another processor later.
        </p>

        <div class="processor-grid">
          <!-- Square -->
          <div class="processor-card" :class="{ 'processor-card--connected': squareStatus !== 'not_connected' }">
            <div class="processor-card-header">
              <div class="processor-icon processor-icon--square">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="22" height="22">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                  <line x1="1" y1="10" x2="23" y2="10"/>
                </svg>
              </div>
              <div class="processor-name">Square</div>
              <span v-if="squareStatus === 'active'" class="processor-badge processor-badge--active">Connected</span>
              <span v-else-if="squareStatus === 'pending'" class="processor-badge processor-badge--pending">Setup incomplete</span>
            </div>
            <p class="processor-desc">
              Instant self-serve setup — create or link a Square account and start
              accepting payments within a few minutes.
            </p>
            <ul class="processor-points">
              <li>Payouts go straight to your bank on Square's schedule</li>
              <li>Square's standard processing fee applies (~2.9% + $0.30)</li>
              <li>Manage your account anytime from the Square Dashboard</li>
            </ul>
            <button class="btn-square" @click="chooseProcessor('square')">
              {{ squareStatus === 'not_connected' ? 'Choose Square' : 'Manage Square' }}
            </button>
          </div>

          <!-- PayPal -->
          <div class="processor-card processor-card--disabled">
            <div class="processor-card-header">
              <div class="processor-icon processor-icon--paypal">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="22" height="22">
                  <path d="M7 15h4.5c3 0 5.5-2 5.5-5 0-2.5-2-4-4.5-4H8L6 18"/>
                  <path d="M9.5 15H13c2.5 0 4.5-1.5 4.5-4"/>
                </svg>
              </div>
              <div class="processor-name">PayPal</div>
              <span class="processor-badge processor-badge--soon">Coming Soon</span>
            </div>
            <p class="processor-desc">
              Connect a PayPal Business account to receive payouts instead of — or
              alongside — Square.
            </p>
            <ul class="processor-points">
              <li>Payouts go to your PayPal balance, transferable to your bank</li>
              <li>PayPal's standard processing fee applies</li>
              <li>We're finalizing PayPal's marketplace approval — check back soon</li>
            </ul>
            <button class="btn-outline" disabled>Coming Soon</button>
          </div>
        </div>
      </template>

      <!-- ── Managing the chosen processor (Square, today's only option) ── -->
      <template v-else>
        <div class="manage-header">
          <h2 class="section-heading">Payout Account — Square</h2>
          <button class="link-btn" @click="viewMode = 'chooser'">Change payment method</button>
        </div>

        <!-- Not connected -->
        <div v-if="squareStatus === 'not_connected'" class="status-card">
          <div class="status-icon status-icon--inactive">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
              <line x1="1" y1="10" x2="23" y2="10"/>
            </svg>
          </div>
          <div class="status-body">
            <div class="status-title">No payout account connected</div>
            <div class="status-desc">
              Connect a Square account to receive payouts. You'll be taken to Square
              to create or link an account — it only takes a few minutes.
            </div>
            <div v-if="connectError" class="connect-error">{{ connectError }}</div>
          </div>
          <button class="btn-square" :disabled="starting" @click="startConnect">
            {{ starting ? 'Redirecting…' : 'Connect with Square' }}
          </button>
        </div>

        <!-- Connected but onboarding not complete -->
        <div v-else-if="squareStatus === 'pending'" class="status-card">
          <div class="status-icon status-icon--pending">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <div class="status-body">
            <div class="status-title">Setup incomplete</div>
            <div class="status-desc">
              Your Square account has been created but you haven't finished the onboarding steps yet.
              Complete setup to start accepting payments.
            </div>
            <div v-if="connectError" class="connect-error">{{ connectError }}</div>
          </div>
          <button class="btn-square" :disabled="starting" @click="startConnect">
            {{ starting ? 'Redirecting…' : 'Continue Square Setup' }}
          </button>
        </div>

        <!-- Fully connected -->
        <div v-else-if="squareStatus === 'active'" class="status-card status-card--active">
          <div class="status-icon status-icon--active">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="28" height="28">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <div class="status-body">
            <div class="status-title">Square account connected</div>
            <div class="status-desc">
              Your account is set up and ready to accept payments. Payouts will go directly
              to your bank account on Square's schedule.
            </div>
          </div>
          <a
            href="https://squareup.com/dashboard"
            target="_blank"
            rel="noopener"
            class="btn-outline"
          >Open Square Dashboard ↗</a>
        </div>

        <!-- ── How it works ── -->
        <div class="info-section">
          <h2 class="info-heading">How it works</h2>
          <div class="info-steps">
            <div class="info-step">
              <div class="step-num">1</div>
              <div class="step-body">
                <div class="step-title">Connect your Square payout account</div>
                <div class="step-desc">Create a new Square account or link an existing one. Square collects your business details and bank info for payouts.</div>
              </div>
            </div>
            <div class="info-step">
              <div class="step-num">2</div>
              <div class="step-body">
                <div class="step-title">Set prices on your products</div>
                <div class="step-desc">Add pricing to items in your collections. Each piece can have its own price and shipping cost.</div>
              </div>
            </div>
            <div class="info-step">
              <div class="step-num">3</div>
              <div class="step-body">
                <div class="step-title">Customers buy from your store</div>
                <div class="step-desc">Square processes payments securely. Pro members keep 100% of their sale price (minus Square's ~2.9% + $0.30 processing fee). Free members also have a 5% platform fee deducted.</div>
              </div>
            </div>
          </div>
        </div>
      </template>

    </template>

    <!-- ── Subscribe modal ── -->
    <Teleport to="body">
      <div v-if="subscribeModal.open" class="modal-backdrop" @click.self="closeSubscribeModal">
        <div class="modal">
          <div class="modal-header">
            <h2 class="modal-title">Upgrade to Pro</h2>
            <button class="modal-close" @click="closeSubscribeModal">✕</button>
          </div>
          <div class="modal-body">
            <p class="modal-sub">$3.99/mo, cancel anytime.</p>
            <div id="subscribe-card-element" class="card-mount"></div>
            <p v-if="subscribeModal.error" class="form-error">{{ subscribeModal.error }}</p>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" @click="closeSubscribeModal">Cancel</button>
            <button class="btn-pro" :disabled="subscribeModal.loading" @click="submitSubscribe">
              {{ subscribeModal.loading ? 'Subscribing…' : 'Subscribe' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ── Manage subscription modal ── -->
    <Teleport to="body">
      <div v-if="manageModal.open" class="modal-backdrop" @click.self="closeManageModal">
        <div class="modal">
          <div class="modal-header">
            <h2 class="modal-title">Manage Subscription</h2>
            <button class="modal-close" @click="closeManageModal">✕</button>
          </div>

          <template v-if="manageModal.mode === 'menu'">
            <div class="modal-body">
              <p v-if="manageModal.error" class="form-error">{{ manageModal.error }}</p>
              <div class="manage-options">
                <button class="btn-outline" @click="startUpdateMode">Update payment method</button>
                <button class="btn-danger-outline" @click="manageModal.mode = 'cancel'">Cancel subscription</button>
              </div>
            </div>
          </template>

          <template v-else-if="manageModal.mode === 'update'">
            <div class="modal-body">
              <p class="modal-sub">Enter a new card to charge for future renewals.</p>
              <div id="manage-card-element" class="card-mount"></div>
              <p v-if="manageModal.error" class="form-error">{{ manageModal.error }}</p>
            </div>
            <div class="modal-footer">
              <button class="btn-secondary" @click="backToMenu">← Back</button>
              <button class="btn-pro" :disabled="manageModal.loading" @click="submitUpdateCard">
                {{ manageModal.loading ? 'Saving…' : 'Save Card' }}
              </button>
            </div>
          </template>

          <template v-else-if="manageModal.mode === 'cancel'">
            <div class="modal-body">
              <p>Your Pro benefits stay active until the end of the current billing period. You won't be charged again after that.</p>
              <p v-if="manageModal.error" class="form-error">{{ manageModal.error }}</p>
            </div>
            <div class="modal-footer">
              <button class="btn-secondary" @click="manageModal.mode = 'menu'; manageModal.error = ''">← Back</button>
              <button class="btn-danger" :disabled="manageModal.loading" @click="submitCancel">
                {{ manageModal.loading ? 'Cancelling…' : 'Confirm Cancellation' }}
              </button>
            </div>
          </template>

          <template v-else-if="manageModal.mode === 'cancelled'">
            <div class="modal-body confirmation">
              <div class="confirm-icon">✓</div>
              <p v-if="manageModal.expiresAt">
                Your subscription is cancelled. Pro access continues until
                <strong>{{ new Date(manageModal.expiresAt).toLocaleDateString() }}</strong>.
              </p>
              <p v-else>Your subscription has been cancelled.</p>
            </div>
            <div class="modal-footer">
              <button class="btn-primary" @click="closeManageModal">Done</button>
            </div>
          </template>
        </div>
      </div>
    </Teleport>

  </main>
</template>

<script setup>
import { ref, computed, nextTick, onMounted } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { authFetch } from '@/utilities/authFetch'
import { mountSquareCard, tokenizeCard } from '@/utilities/squarePayments'

// Referrer map: where "r" query param values point back to
const REFERRERS = {
  1: { to: '/collections', label: 'Artist Showcase' },
  2: { to: '/profile/billing', label: 'Billing' },
}

const route = useRoute()
const backLink = computed(() => REFERRERS[route.query.r] || REFERRERS[2])
const loading = ref(true)
const squareStatus = ref('not_connected')
const starting = ref(false)

// 'chooser' shows the pick-a-processor screen; 'manage' shows the status/setup UI
// for whichever processor is active (Square only, for now — PayPal Connect isn't
// available yet, see docs/paypal-integration-plan.md).
const viewMode = ref('chooser')

function chooseProcessor(name) {
  if (name !== 'square') return // PayPal isn't connectable yet
  viewMode.value = 'manage'
}

const plan = ref({ subscribed: false, platform: null, fee_percent: 5 })
const subscribeSuccess = ref(false)
const connectError = ref('')

const subscribeModal = ref({ open: false, loading: false, error: '' })
const manageModal = ref({ open: false, mode: 'menu', loading: false, error: '', expiresAt: null })
let subscribeCardHandle = null
let manageCardHandle = null

async function fetchStatus() {
  try {
    const res = await authFetch('/api/billing/connect/status?processor=square')
    if (res.ok) {
      const data = await res.json()
      squareStatus.value = data.status
    }
  } catch (err) {
    console.error('Failed to fetch connect status:', err)
  }
}

async function fetchPlan() {
  try {
    const res = await authFetch('/api/billing/plan')
    if (res.ok) plan.value = await res.json()
  } catch (err) {
    console.error('Failed to fetch plan:', err)
  }
}

async function startConnect() {
  if (starting.value) return
  starting.value = true
  connectError.value = ''
  try {
    const res = await authFetch('/api/billing/connect/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ processor: 'square' }),
    })
    if (res.ok) {
      const data = await res.json()
      if (data.status === 'active') {
        squareStatus.value = 'active'
      } else if (data.url) {
        window.location.href = data.url
        return
      }
    } else {
      connectError.value = 'Something went wrong. Please try again or contact support if the problem persists.'
    }
  } catch (err) {
    console.error('Failed to start connect:', err)
    connectError.value = 'Something went wrong. Please try again or contact support if the problem persists.'
  } finally {
    starting.value = false
  }
}

// ── Subscribe modal ──────────────────────────────────────────────────────────
async function openSubscribeModal() {
  subscribeModal.value = { open: true, loading: false, error: '' }
  await nextTick()
  try {
    subscribeCardHandle = await mountSquareCard('subscribe-card-element')
  } catch (err) {
    subscribeModal.value.error = err.message || 'Payment is not configured.'
  }
}

function closeSubscribeModal() {
  subscribeModal.value.open = false
  if (subscribeCardHandle) {
    subscribeCardHandle.destroy()
    subscribeCardHandle = null
  }
}

async function submitSubscribe() {
  if (subscribeModal.value.loading || !subscribeCardHandle) return
  subscribeModal.value.loading = true
  subscribeModal.value.error = ''
  try {
    const sourceId = await tokenizeCard(subscribeCardHandle.card)
    const res = await authFetch('/api/billing/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId }),
    })
    if (res.ok) {
      closeSubscribeModal()
      subscribeSuccess.value = true
      await fetchPlan()
    } else {
      const data = await res.json().catch(() => ({}))
      subscribeModal.value.error = data.message || 'Something went wrong. Please try again.'
    }
  } catch (err) {
    subscribeModal.value.error = err.message || 'Network error. Please try again.'
  } finally {
    subscribeModal.value.loading = false
  }
}

// ── Manage subscription modal (Square has no hosted portal) ──────────────────
function openManageModal() {
  manageModal.value = { open: true, mode: 'menu', loading: false, error: '', expiresAt: null }
}

function closeManageModal() {
  manageModal.value.open = false
  if (manageCardHandle) {
    manageCardHandle.destroy()
    manageCardHandle = null
  }
}

async function submitCancel() {
  if (manageModal.value.loading) return
  manageModal.value.loading = true
  manageModal.value.error = ''
  try {
    const res = await authFetch('/api/billing/cancel', { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      manageModal.value.expiresAt = data.expires_at
      manageModal.value.mode = 'cancelled'
      await fetchPlan()
    } else {
      const data = await res.json().catch(() => ({}))
      manageModal.value.error = data.message || 'Something went wrong. Please try again.'
    }
  } catch {
    manageModal.value.error = 'Network error. Please try again.'
  } finally {
    manageModal.value.loading = false
  }
}

function backToMenu() {
  if (manageCardHandle) {
    manageCardHandle.destroy()
    manageCardHandle = null
  }
  manageModal.value.mode = 'menu'
  manageModal.value.error = ''
}

async function startUpdateMode() {
  manageModal.value.mode = 'update'
  manageModal.value.error = ''
  await nextTick()
  try {
    manageCardHandle = await mountSquareCard('manage-card-element')
  } catch (err) {
    manageModal.value.error = err.message || 'Payment is not configured.'
  }
}

async function submitUpdateCard() {
  if (manageModal.value.loading || !manageCardHandle) return

  manageModal.value.loading = true
  manageModal.value.error = ''
  try {
    const sourceId = await tokenizeCard(manageCardHandle.card)
    const res = await authFetch('/api/billing/update-payment-method', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId }),
    })
    if (res.ok) {
      closeManageModal()
    } else {
      const data = await res.json().catch(() => ({}))
      manageModal.value.error = data.message || 'Something went wrong. Please try again.'
    }
  } catch (err) {
    manageModal.value.error = err.message || 'Network error. Please try again.'
  } finally {
    manageModal.value.loading = false
  }
}

onMounted(async () => {
  await Promise.all([fetchStatus(), fetchPlan()])
  loading.value = false

  // Land on the manage screen (rather than the chooser) if Square is already set
  // up, or if we're returning from the Square OAuth Connect redirect.
  if (squareStatus.value !== 'not_connected' || route.query.square) {
    viewMode.value = 'manage'
  }

  if (route.query.square === 'denied') {
    connectError.value = 'Connection was cancelled.'
  } else if (route.query.square === 'error') {
    connectError.value = 'Something went wrong connecting to Square. Please try again.'
  }
})
</script>

<style scoped>
.payment-page {
  padding: 32px 20px;
  max-width: 760px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 32px;
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
  line-height: 1.5;
  max-width: 520px;
}

.loading-state {
  color: var(--color-text-secondary);
  padding: 60px 0;
  text-align: center;
}

/* ── Plan card ── */
.plan-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 20px 24px;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  margin-bottom: 32px;
  flex-wrap: wrap;
}

.plan-card--pro {
  border-color: #6b46c1;
  background: rgba(107, 70, 193, 0.05);
}

.plan-card--free {
  background: var(--color-background-soft, rgba(0,0,0,0.02));
}

.plan-left { flex: 1; min-width: 0; }
.plan-right { flex-shrink: 0; }

.plan-badge {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 3px 10px;
  border-radius: 20px;
  margin-bottom: 8px;
}

.badge--pro {
  background: rgba(107, 70, 193, 0.12);
  color: #553c9a;
}

.badge--free {
  background: rgba(0,0,0,0.07);
  color: var(--color-text-secondary);
}

.plan-fee {
  font-size: 0.95rem;
  color: var(--color-text);
  margin-bottom: 4px;
}

.fee-highlight {
  font-weight: 700;
}

.plan-sub-note {
  font-size: 0.82rem;
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.success-msg {
  font-size: 0.88rem;
  color: #276749;
  margin: -16px 0 24px;
  padding: 10px 14px;
  background: rgba(47, 133, 90, 0.08);
  border-radius: 6px;
  border: 1px solid rgba(47, 133, 90, 0.2);
}

/* ── Section heading ── */
.section-heading {
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text);
  margin: 0 0 16px;
}

/* ── Manage header (with "Change payment method" link) ── */
.manage-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.manage-header .section-heading { margin-bottom: 16px; }

.link-btn {
  background: none;
  border: none;
  padding: 0;
  color: var(--color-link);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  margin-bottom: 16px;
}

.link-btn:hover { text-decoration: underline; }

/* ── Processor chooser ── */
.chooser-intro {
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  margin: -8px 0 24px;
  line-height: 1.5;
}

.processor-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 40px;
}

@media (max-width: 640px) {
  .processor-grid { grid-template-columns: 1fr; }
}

.processor-card {
  display: flex;
  flex-direction: column;
  padding: 22px 24px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft, rgba(0,0,0,0.02));
}

.processor-card--connected {
  border-color: #2f855a;
  background: rgba(47, 133, 90, 0.05);
}

.processor-card--disabled {
  opacity: 0.72;
}

.processor-card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.processor-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.processor-icon--square { background: #000; color: #fff; }
.processor-icon--paypal { background: #003087; color: #fff; }

.processor-name {
  font-weight: 700;
  font-size: 1.05rem;
  color: var(--color-text);
}

.processor-badge {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  padding: 3px 9px;
  border-radius: 20px;
  margin-left: auto;
}

.processor-badge--active { background: rgba(47, 133, 90, 0.15); color: #2f855a; }
.processor-badge--pending { background: rgba(214, 158, 46, 0.15); color: #b7791f; }
.processor-badge--soon { background: rgba(0,0,0,0.08); color: var(--color-text-secondary); }

.processor-desc {
  font-size: 0.88rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin: 0 0 12px;
}

.processor-points {
  list-style: none;
  padding: 0;
  margin: 0 0 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.processor-points li {
  font-size: 0.82rem;
  color: var(--color-text-secondary);
  line-height: 1.4;
  padding-left: 16px;
  position: relative;
}

.processor-points li::before {
  content: '•';
  position: absolute;
  left: 2px;
  color: var(--color-text-secondary);
}

.processor-card button { align-self: flex-start; }

/* ── Status cards ── */
.status-card {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 24px 28px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft, rgba(0,0,0,0.02));
  margin-bottom: 40px;
  flex-wrap: wrap;
}

.status-card--active {
  border-color: #2f855a;
  background: rgba(47, 133, 90, 0.05);
}

.status-icon {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.status-icon--inactive { background: rgba(0,0,0,0.06); color: var(--color-text-secondary); }
.status-icon--pending  { background: rgba(214, 158, 46, 0.15); color: #b7791f; }
.status-icon--active   { background: rgba(47, 133, 90, 0.15); color: #2f855a; }

.status-body { flex: 1; min-width: 180px; }

.status-title {
  font-weight: 700;
  font-size: 1rem;
  color: var(--color-text);
  margin-bottom: 4px;
}

.status-desc {
  font-size: 0.88rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.connect-error {
  margin-top: 8px;
  font-size: 0.85rem;
  color: var(--color-error, #e53e3e);
}

/* ── Buttons ── */
.btn-square {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #000;
  color: #fff;
  border: none;
  padding: 11px 22px;
  border-radius: 7px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
  white-space: nowrap;
  flex-shrink: 0;
}

.btn-square:hover:not(:disabled) { opacity: 0.88; }
.btn-square:disabled { opacity: 0.55; cursor: not-allowed; }

.btn-pro {
  background: #6b46c1;
  color: #fff;
  border: none;
  padding: 10px 20px;
  border-radius: 7px;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
  white-space: nowrap;
}

.btn-pro:hover:not(:disabled) { opacity: 0.88; }
.btn-pro:disabled { opacity: 0.55; cursor: not-allowed; }

.btn-outline {
  background: transparent;
  color: var(--color-link);
  border: 1px solid var(--color-link);
  padding: 10px 18px;
  border-radius: 7px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
  white-space: nowrap;
  transition: background 0.15s;
  display: inline-block;
}

.btn-outline:hover:not(:disabled) { background: rgba(0,0,0,0.04); }
.btn-outline:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── Info section ── */
.info-section {
  border-top: 1px solid var(--color-border);
  padding-top: 32px;
}

.info-heading {
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text);
  margin: 0 0 24px;
}

.info-steps {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.info-step {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.step-num {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--color-link);
  color: #fff;
  font-size: 0.85rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
}

.step-title {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--color-text);
  margin-bottom: 3px;
}

.step-desc {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

@media (max-width: 600px) {
  .status-card, .plan-card { flex-direction: column; align-items: flex-start; }
}

/* ── Modals ── */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.55);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.modal {
  background: var(--color-background-card, #fff);
  border-radius: 14px;
  width: 100%;
  max-width: 440px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,0.25);
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 20px 16px;
  border-bottom: 1px solid var(--color-border);
}

.modal-title { font-size: 1.1rem; font-weight: 700; color: var(--color-text); margin: 0; }

.modal-close {
  background: none;
  border: none;
  font-size: 1.1rem;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
}
.modal-close:hover { color: var(--color-text); }

.modal-body { padding: 20px; }

.modal-sub {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin: 0 0 14px;
}

.card-mount {
  border: 1px solid var(--color-border);
  border-radius: 7px;
  padding: 12px;
  background: var(--color-background);
  min-height: 40px;
}

.form-error {
  color: var(--color-error, #e53935);
  font-size: 0.85rem;
  margin: 10px 0 0;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--color-border);
}

.manage-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.manage-options button { width: 100%; text-align: center; }

.btn-primary {
  background: var(--color-link);
  color: #fff;
  border: none;
  border-radius: 7px;
  padding: 10px 20px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.btn-primary:hover:not(:disabled) { opacity: 0.88; }

.btn-secondary {
  background: var(--color-background-soft, rgba(0,0,0,0.04));
  color: var(--color-text);
  border: none;
  border-radius: 7px;
  padding: 10px 18px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-secondary:hover:not(:disabled) { background: var(--color-background-soft-hover, rgba(0,0,0,0.08)); }
.btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-danger {
  background: #e53935;
  color: #fff;
  border: none;
  border-radius: 7px;
  padding: 10px 18px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.btn-danger:hover:not(:disabled) { opacity: 0.88; }
.btn-danger:disabled { opacity: 0.55; cursor: not-allowed; }

.btn-danger-outline {
  background: transparent;
  color: #e53935;
  border: 1px solid #e53935;
  border-radius: 7px;
  padding: 10px 18px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-danger-outline:hover { background: rgba(229, 57, 53, 0.08); }

.confirmation {
  text-align: center;
  padding: 20px 10px;
}

.confirm-icon {
  width: 48px;
  height: 48px;
  background: rgba(47, 133, 90, 0.15);
  color: #2f855a;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.4rem;
  margin: 0 auto 16px;
}

.confirmation p { color: var(--color-text); line-height: 1.6; margin: 0; font-size: 0.92rem; }
</style>
