<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authFetch } from '@/utilities/authFetch'
import { user } from '@/stores/user'

const route = useRoute()
const router = useRouter()

const token = route.params.token
const loading = ref(true)
const loadError = ref(null)
const inviteInfo = ref(null)
const accepting = ref(false)
const accepted = ref(false)
const acceptError = ref(null)

onMounted(async () => {
  try {
    const res = await fetch(`/api/bands/invite/${token}`)
    const data = await res.json()
    if (!res.ok) {
      loadError.value = data.message || 'Invalid or expired invite'
      return
    }
    inviteInfo.value = data
  } catch {
    loadError.value = 'Failed to load invite'
  } finally {
    loading.value = false
  }
})

async function acceptInvite() {
  accepting.value = true
  acceptError.value = null
  try {
    const res = await authFetch(`/api/bands/invite/${token}/accept`, { method: 'POST' })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message)
    accepted.value = true
    setTimeout(() => router.push('/sessions'), 2000)
  } catch (err) {
    acceptError.value = err.message
  } finally {
    accepting.value = false
  }
}
</script>

<template>
  <main class="page-container">
    <div class="invite-page-card">
      <div v-if="loading" class="invite-loading">Loading invite…</div>

      <div v-else-if="loadError" class="invite-error-state">
        <h2>Invite Not Found</h2>
        <p>{{ loadError }}</p>
        <RouterLink to="/" class="btn-primary">Go to Prosaurus</RouterLink>
      </div>

      <div v-else-if="inviteInfo?.status === 'accepted'" class="invite-already-accepted">
        <h2>Already Accepted</h2>
        <p>This invite has already been used.</p>
        <RouterLink to="/sessions" class="btn-primary">Go to Sessions</RouterLink>
      </div>

      <div v-else-if="accepted" class="invite-success">
        <h2>You're in!</h2>
        <p>You've joined <strong>{{ inviteInfo.band_name }}</strong>. Redirecting to Sessions…</p>
      </div>

      <template v-else>
        <h2 class="invite-heading">Band Invite</h2>
        <p class="invite-body">
          <strong>@{{ inviteInfo.inviter_handle }}</strong> has invited you to join
          <strong>{{ inviteInfo.band_name }}</strong> on Prosaurus.
        </p>

        <div v-if="user.username" class="invite-actions">
          <div v-if="acceptError" class="error-msg">{{ acceptError }}</div>
          <button class="btn-primary" :disabled="accepting" @click="acceptInvite">
            {{ accepting ? 'Joining…' : `Join ${inviteInfo.band_name}` }}
          </button>
        </div>

        <div v-else class="invite-auth-options">
          <p>You need a Prosaurus account to join the band.</p>
          <RouterLink :to="`/signup?bandInvite=${token}`" class="btn-primary">Create Account &amp; Join</RouterLink>
          <RouterLink :to="`/login?bandInvite=${token}`" class="btn-secondary">Log In &amp; Join</RouterLink>
        </div>
      </template>
    </div>
  </main>
</template>

<style scoped>
.invite-page-card {
  max-width: 480px;
  margin: 60px auto;
  padding: 40px;
  background: var(--color-background-card);
  border-radius: 12px;
  box-shadow: var(--shadow-md);
  text-align: center;
}
.invite-heading {
  font-size: 1.4em;
  margin-bottom: 16px;
}
.invite-body {
  color: var(--color-text-light);
  margin-bottom: 28px;
  line-height: 1.6;
}
.invite-loading,
.invite-error-state,
.invite-already-accepted,
.invite-success {
  padding: 20px 0;
}
.invite-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}
.invite-auth-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}
.invite-auth-options p {
  color: var(--color-text-light);
  margin-bottom: 8px;
}
.btn-secondary {
  display: inline-block;
  padding: 10px 24px;
  border: 2px solid var(--color-accent);
  border-radius: 6px;
  color: var(--color-accent);
  font-weight: bold;
  text-decoration: none;
  transition: background 0.2s, color 0.2s;
}
.btn-secondary:hover {
  background: var(--color-accent);
  color: #fff;
}
</style>
