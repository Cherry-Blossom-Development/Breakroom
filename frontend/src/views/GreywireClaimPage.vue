<script setup>
// Where a signed-in user claims a Greywire pedal's serial to become a member
// (POST /api/greywire/claim). The router sends non-members here from every
// members-only page. Members can come back to claim another pedal. A band
// invite token in ?bandInvite= is accepted once the claim goes through.
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { user } from '@/stores/user.js'

const route = useRoute()
const router = useRouter()

const membership = ref(null)
const serial = ref('')
const claiming = ref(false)
const error = ref('')
const claimed = ref(null)

onMounted(async () => {
  try {
    const res = await fetch('/api/greywire/membership', { credentials: 'include' })
    if (res.ok) membership.value = await res.json()
  } catch {
    // Non-fatal: the claim form still works
  }
})

async function claim() {
  claiming.value = true
  error.value = ''
  try {
    const res = await fetch('/api/greywire/claim', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial: serial.value })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      error.value = data.message || 'Something went wrong. Please try again.'
      return
    }
    membership.value = data.membership
    // Pedals come oldest claim first, so the newest is the one just claimed
    claimed.value = data.membership.pedals[data.membership.pedals.length - 1]
    serial.value = ''

    const bandInviteToken = route.query.bandInvite
    if (bandInviteToken) {
      try {
        await fetch(`/api/bands/invite/${bandInviteToken}/accept`, { method: 'POST', credentials: 'include' })
      } catch { /* non-critical: the invite stays open */ }
      setTimeout(() => enterCommunity('/sessions'), 1500)
    }
  } catch {
    error.value = 'Something went wrong. Please try again.'
  } finally {
    claiming.value = false
  }
}

// The user store learns about the new membership only on the way out: once
// it does, App.vue swaps the public layout for the member one, which remounts
// this page and would wipe the "You're in!" message.
async function enterCommunity(path) {
  await user.fetchUser()
  router.push(path)
}

function formatDate(str) {
  return str ? new Date(str).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : ''
}
</script>

<template>
  <main class="claim-page">
    <div class="claim-card">
      <p class="claim-kicker">Greywire Community</p>

      <!-- Just claimed -->
      <template v-if="claimed">
        <h1>You're in!</h1>
        <p class="claim-lede">
          Your <strong>{{ claimed.model }}</strong> (serial <span class="serial">{{ claimed.serial }}</span>)
          is now registered to you, and membership is free for as long as you own it.
        </p>
        <p v-if="route.query.bandInvite" class="claim-lede">Joining your band…</p>
        <button v-else type="button" class="claim-btn" @click="enterCommunity('/chat')">Go to the community</button>
      </template>

      <!-- Guest accounts are game-only and can't hold pedals -->
      <template v-else-if="user.isGuest">
        <h1>Create a full account first</h1>
        <p class="claim-lede">Guest accounts can't claim pedals. Sign up for a full account, then come back here.</p>
        <RouterLink to="/signup" class="claim-btn">Sign up</RouterLink>
      </template>

      <template v-else>
        <h1 v-if="membership?.member">Claim another pedal</h1>
        <h1 v-else>Access needs a Greywire pedal</h1>

        <p v-if="!membership?.member" class="claim-lede">
          The Greywire community is for people who own a Greywire pedal. Claim yours to get in.
          It's free, with no subscription, for as long as you own the pedal.
        </p>

        <ul v-if="membership?.member" class="claim-pedals">
          <li v-for="p in membership.pedals" :key="p.id">
            <strong>{{ p.model }}</strong> (serial <span class="serial">{{ p.serial }}</span>), claimed {{ formatDate(p.claimedAt) }}
          </li>
          <li v-if="membership.grantedAt">Membership granted by Greywire Studio on {{ formatDate(membership.grantedAt) }}</li>
        </ul>

        <form class="claim-form" @submit.prevent="claim">
          <label for="claim-serial">Pedal serial number</label>
          <input
            id="claim-serial"
            v-model="serial"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="e.g. E4629C1B23456789"
            maxlength="40"
            required
          />
          <p class="claim-hint">16 characters: the digits 0 to 9 and the letters A to F. Spaces and dashes are fine.</p>
          <p v-if="error" class="claim-error" role="alert">{{ error }}</p>
          <button type="submit" class="claim-btn" :disabled="claiming || !serial.trim()">
            {{ claiming ? 'Checking…' : 'Claim my pedal' }}
          </button>
        </form>

        <p class="claim-footnote">
          Bought a pedal second-hand and it's already claimed? Contact support and we'll move it to your account.
        </p>
        <RouterLink v-if="membership?.member" to="/chat" class="claim-back">Back to the community</RouterLink>
      </template>
    </div>
  </main>
</template>

<style scoped>
.claim-page {
  padding: 48px 16px 64px;
}

.claim-card {
  max-width: 520px;
  margin: 0 auto;
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-top: 3px solid var(--color-accent);
  border-radius: 12px;
  padding: 32px;
  color: var(--color-text);
}

.claim-kicker {
  color: var(--color-link);
  text-transform: uppercase;
  letter-spacing: 0.15em;
  font-size: 0.75rem;
  margin: 0 0 8px;
}

.claim-card h1 {
  font-size: 1.6rem;
  font-weight: 700;
  line-height: 1.2;
  margin: 0 0 12px;
  color: var(--color-heading);
}

.claim-lede {
  color: var(--color-text-secondary);
  margin: 0 0 20px;
}

.claim-pedals {
  margin: 0 0 20px;
  padding-left: 20px;
  color: var(--color-text-secondary);
}

.serial {
  font-family: ui-monospace, Consolas, monospace;
  letter-spacing: 0.04em;
}

.claim-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 20px;
}

.claim-form label {
  font-weight: 600;
  font-size: 0.9rem;
}

.claim-form input {
  padding: 10px 12px;
  border: 1px solid var(--color-border-input);
  border-radius: 6px;
  background: var(--color-background-input);
  color: var(--color-text);
  font-family: ui-monospace, Consolas, monospace;
  font-size: 1.05rem;
  letter-spacing: 0.04em;
}

.claim-hint {
  margin: 0 0 8px;
  font-size: 0.85rem;
  color: var(--color-text-light);
}

.claim-error {
  margin: 0 0 8px;
  color: var(--color-error);
  font-size: 0.9rem;
}

.claim-btn {
  display: inline-block;
  align-self: flex-start;
  padding: 11px 24px;
  border: none;
  border-radius: 8px;
  background: var(--color-accent);
  color: #fff !important;
  font-size: 1rem;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}

.claim-btn:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.claim-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.claim-footnote {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-light);
}

.claim-back {
  display: inline-block;
  margin-top: 16px;
  font-size: 0.9rem;
}
</style>
