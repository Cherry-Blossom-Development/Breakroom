<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { user } from '@/stores/user.js'
import { getVisitorId } from '@/utilities/visitorId.js'

const router = useRouter()

const captainName = ref('')
const agreedEula = ref(false)
const launching = ref(false)
const error = ref('')

async function launch() {
  const displayName = captainName.value.trim()
  if (!displayName || !agreedEula.value || launching.value) return

  launching.value = true
  error.value = ''
  try {
    // 1. Create (or resume) the guest account — sets the jwtToken cookie.
    const guestRes = await fetch('/api/auth/guest', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName,
        visitorId: getVisitorId(),
        acceptedEula: true,
      }),
    })
    const guestData = await guestRes.json()
    if (!guestRes.ok) throw new Error(guestData.message || 'Could not start a guest session.')

    await user.fetchUser()

    // 2. Find this guest's captain, or create one in the newest active universe.
    const gameRes = await fetch('/api/games/haulonaut', { credentials: 'include' })
    if (!gameRes.ok) throw new Error('Could not reach Haulonaut.')
    const gameData = await gameRes.json()

    // Resume a living captain in a still-running universe if there is one.
    const resumable = (gameData.characters || []).find(
      c => c.status === 'active' && c.instance_status === 'active'
    )
    if (resumable) {
      router.push(`/games/haulonaut/play/${resumable.id}`)
      return
    }

    const instance = (gameData.instances || [])[0]
    if (!instance) {
      error.value = 'No universes are online right now. Check back soon.'
      return
    }

    const charRes = await fetch('/api/games/haulonaut/characters', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: displayName, instance_id: instance.id }),
    })
    const charData = await charRes.json()
    if (!charRes.ok) throw new Error(charData.message || 'Could not launch your captain.')

    router.push(`/games/haulonaut/play/${charData.character.id}`)
  } catch (err) {
    error.value = err.message || 'Something went wrong. Try again.'
  } finally {
    launching.value = false
  }
}
</script>

<template>
  <main class="guest-play page-container">
    <div class="guest-ad">
      <div class="ad-scanlines" aria-hidden="true"></div>
      <p class="ad-eyebrow">&gt;&gt;&gt; INCOMING TRANSMISSION<span class="ad-cursor" aria-hidden="true">_</span></p>
      <h1 class="ad-title">HAULONAUT</h1>
      <p class="ad-tagline">Haul cargo. Chart the void. Make your fortune — or lose everything.</p>
      <p class="ad-description">
        A text-based space trading and exploration game in the Trade Wars / BBS
        door-game tradition. No Prosaurus account required — pick a captain name
        and launch.
      </p>
      <p class="ad-stat">1000-sector universes · text-based · permadeath</p>

      <form class="guest-form" @submit.prevent="launch">
        <label class="field-label" for="guest-captain">Captain name</label>
        <input
          id="guest-captain"
          v-model="captainName"
          class="guest-input"
          placeholder="e.g. Captain Vex"
          maxlength="64"
          autofocus
        />

        <label class="eula-check">
          <input type="checkbox" v-model="agreedEula" />
          <span>
            I have read and agree to the
            <a href="/eula" target="_blank" rel="noopener">EULA</a>.
          </span>
        </label>

        <p v-if="error" class="guest-error">{{ error }}</p>

        <button
          type="submit"
          class="guest-launch-btn"
          :disabled="!captainName.trim() || !agreedEula || launching"
        >
          {{ launching ? 'LAUNCHING…' : 'LAUNCH ▶' }}
        </button>
      </form>

      <p class="ad-footer">
        Want the full Prosaurus experience later?
        <RouterLink to="/signup">Create an account</RouterLink>.
      </p>
    </div>
  </main>
</template>

<style scoped>
.guest-play {
  max-width: 640px;
  padding-block: 32px;
}

.guest-ad {
  position: relative;
  background: #05130a;
  color: #4dff88;
  border: 2px solid #1f8a4c;
  border-radius: 6px;
  padding: 28px 24px;
  font-family: 'Courier New', Courier, monospace;
  overflow: hidden;
  box-shadow: 0 0 24px rgba(77, 255, 136, 0.15);
}

.ad-scanlines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0) 0px,
    rgba(0, 0, 0, 0) 2px,
    rgba(0, 0, 0, 0.15) 3px
  );
}

.ad-eyebrow {
  margin: 0 0 8px;
  font-size: 0.85rem;
  letter-spacing: 0.05em;
  color: #2fd66e;
}

.ad-cursor {
  animation: ad-blink 1s step-end infinite;
}

@media (prefers-reduced-motion: reduce) {
  .ad-cursor { animation: none; }
}

@keyframes ad-blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}

.ad-title {
  margin: 0 0 10px;
  font-size: 2.4rem;
  letter-spacing: 0.08em;
  text-shadow: 0 0 8px rgba(77, 255, 136, 0.6);
}

.ad-tagline {
  margin: 0 0 14px;
  font-size: 1rem;
  color: #baffcf;
}

.ad-description {
  margin: 0 0 14px;
  color: #8fe6ab;
  line-height: 1.6;
}

.ad-stat {
  margin: 0 0 20px;
  font-size: 0.8rem;
  color: #2fd66e;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.guest-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-top: 1px solid #1f8a4c;
  padding-top: 20px;
}

.field-label {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #2fd66e;
}

.guest-input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  background: #0a2413;
  border: 1px solid #1f8a4c;
  border-radius: 4px;
  color: #baffcf;
  font-family: inherit;
  font-size: 1rem;
}

.guest-input:focus-visible {
  outline: 2px solid #4dff88;
  outline-offset: 1px;
}

.eula-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 0.9rem;
  color: #8fe6ab;
  line-height: 1.5;
}

.eula-check input {
  margin-top: 3px;
  accent-color: #4dff88;
}

.eula-check a {
  color: #baffcf;
  text-decoration: underline;
}

.guest-error {
  margin: 0;
  color: #ff9d9d;
  font-size: 0.9rem;
}

.guest-launch-btn {
  align-self: flex-start;
  margin-top: 4px;
  background: #0d3a1e;
  color: #baffcf;
  border: 2px solid #4dff88;
  border-radius: 4px;
  padding: 12px 28px;
  font-family: inherit;
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  cursor: pointer;
}

.guest-launch-btn:hover:not(:disabled) {
  background: #4dff88;
  color: #05130a;
}

.guest-launch-btn:focus-visible {
  outline: 2px solid #baffcf;
  outline-offset: 3px;
}

.guest-launch-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ad-footer {
  margin: 20px 0 0;
  font-size: 0.85rem;
  color: #6bbf8b;
}

.ad-footer a {
  color: #baffcf;
  text-decoration: underline;
}
</style>
