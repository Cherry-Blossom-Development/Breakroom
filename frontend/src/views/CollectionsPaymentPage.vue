<template>
  <main class="payment-page page-container">

    <div class="page-header">
      <div class="header-left">
        <RouterLink to="/collections" class="back-link">← Collections</RouterLink>
        <h1>Payment Setup</h1>
        <p class="page-desc">
          Connect a Stripe account to receive payments from your store sales.
          Stripe handles all payment processing, security, and payouts.
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
              Upgrade to Pro to keep 100% of your sale price (minus Stripe's processing fee)
            </template>
          </div>
        </div>
        <div class="plan-right">
          <!-- Web subscriber: manage via Stripe portal -->
          <button
            v-if="plan.subscribed && plan.platform === 'stripe'"
            class="btn-outline"
            :disabled="portaling"
            @click="openPortal"
          >
            {{ portaling ? 'Opening…' : 'Manage Subscription' }}
          </button>
          <!-- Not subscribed: upgrade via web -->
          <button
            v-else-if="!plan.subscribed"
            class="btn-pro"
            :disabled="subscribing"
            @click="startSubscribe"
          >
            {{ subscribing ? 'Redirecting…' : 'Upgrade to Pro — $3.99/mo' }}
          </button>
        </div>
      </section>

      <p v-if="subscribeSuccess" class="success-msg">
        You're now on Prosaurus Pro. Your 0% fee rate is active.
      </p>

      <!-- ── Stripe Connect ── -->
      <h2 class="section-heading">Payout Account</h2>

      <!-- Not connected -->
      <div v-if="status === 'not_connected'" class="status-card">
        <div class="status-icon status-icon--inactive">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
            <line x1="1" y1="10" x2="23" y2="10"/>
          </svg>
        </div>
        <div class="status-body">
          <div class="status-title">No payout account connected</div>
          <div class="status-desc">
            Connect a Stripe account to receive payouts. You'll be taken to Stripe
            to create or link an account — it only takes a few minutes.
          </div>
        </div>
        <button class="btn-stripe" :disabled="starting" @click="startConnect">
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" style="flex-shrink:0">
            <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
          </svg>
          {{ starting ? 'Redirecting…' : 'Connect with Stripe' }}
        </button>
      </div>

      <!-- Connected but onboarding not complete -->
      <div v-else-if="status === 'pending'" class="status-card">
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
            Your Stripe account has been created but you haven't finished the onboarding steps yet.
            Complete setup to start accepting payments.
          </div>
        </div>
        <button class="btn-stripe" :disabled="starting" @click="startConnect">
          {{ starting ? 'Redirecting…' : 'Continue Stripe Setup' }}
        </button>
      </div>

      <!-- Fully connected -->
      <div v-else-if="status === 'active'" class="status-card status-card--active">
        <div class="status-icon status-icon--active">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="28" height="28">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <div class="status-body">
          <div class="status-title">Stripe account connected</div>
          <div class="status-desc">
            Your account is set up and ready to accept payments. Payouts will go directly
            to your bank account on Stripe's schedule.
          </div>
        </div>
        <a
          href="https://dashboard.stripe.com/express"
          target="_blank"
          rel="noopener"
          class="btn-outline"
        >Open Stripe Dashboard ↗</a>
      </div>

      <!-- ── How it works ── -->
      <div class="info-section">
        <h2 class="info-heading">How it works</h2>
        <div class="info-steps">
          <div class="info-step">
            <div class="step-num">1</div>
            <div class="step-body">
              <div class="step-title">Connect your Stripe payout account</div>
              <div class="step-desc">Create a new Stripe account or link an existing one. Stripe collects your business details and bank info for payouts.</div>
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
              <div class="step-desc">Stripe processes payments securely. Pro members keep 100% of their sale price (minus Stripe's ~2.9% + $0.30 processing fee). Free members also have a 5% platform fee deducted.</div>
            </div>
          </div>
        </div>
      </div>

    </template>

  </main>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { authFetch } from '@/utilities/authFetch'

const route = useRoute()
const loading = ref(true)
const status = ref('not_connected')
const starting = ref(false)

const plan = ref({ subscribed: false, platform: null, fee_percent: 5 })
const subscribing = ref(false)
const portaling = ref(false)
const subscribeSuccess = ref(false)

async function fetchStatus() {
  try {
    const res = await authFetch('/api/billing/connect/status')
    if (res.ok) {
      const data = await res.json()
      status.value = data.status
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
  try {
    const res = await authFetch('/api/billing/connect/start', { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      if (data.status === 'active') {
        status.value = 'active'
      } else if (data.url) {
        window.location.href = data.url
        return
      }
    }
  } catch (err) {
    console.error('Failed to start connect:', err)
  } finally {
    starting.value = false
  }
}

async function startSubscribe() {
  if (subscribing.value) return
  subscribing.value = true
  try {
    const res = await authFetch('/api/billing/subscribe', { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      if (data.already_subscribed) {
        await fetchPlan()
      } else if (data.url) {
        window.location.href = data.url
        return
      }
    }
  } catch (err) {
    console.error('Failed to start subscribe:', err)
  } finally {
    subscribing.value = false
  }
}

async function openPortal() {
  if (portaling.value) return
  portaling.value = true
  try {
    const res = await authFetch('/api/billing/portal', { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
        return
      }
    }
  } catch (err) {
    console.error('Failed to open portal:', err)
  } finally {
    portaling.value = false
  }
}

onMounted(async () => {
  await Promise.all([fetchStatus(), fetchPlan()])
  loading.value = false

  // Returning from Stripe subscription checkout
  if (route.query.stripe === 'subscribed') {
    subscribeSuccess.value = true
    await fetchPlan()
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

/* ── Buttons ── */
.btn-stripe {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #635bff;
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

.btn-stripe:hover:not(:disabled) { opacity: 0.88; }
.btn-stripe:disabled { opacity: 0.55; cursor: not-allowed; }

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
</style>
