<script setup>
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'

const documents = ref([
  {
    id: 'eula',
    title: 'End User License Agreement (EULA)',
    description: 'Governs your use of the Prosaurus platform.',
    route: '/eula',
    status: 'loading',
    acceptedAt: null
  },
  {
    id: 'privacy',
    title: 'Privacy Policy',
    description: 'Describes how we collect, use, and protect your data.',
    route: '/privacy',
    status: 'acknowledged',
    acceptedAt: null
  }
])

const formatDate = (dateStr) => {
  if (!dateStr) return null
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit'
  })
}

onMounted(async () => {
  try {
    const res = await fetch('/api/eula/status', { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      const eula = documents.value.find(d => d.id === 'eula')
      eula.status = data.accepted ? 'accepted' : 'pending'
      eula.acceptedAt = data.acceptedAt || null
    }
  } catch {
    const eula = documents.value.find(d => d.id === 'eula')
    eula.status = 'unknown'
  }
})
</script>

<template>
  <div class="legal-page">
    <h2>Legal Documents</h2>
    <p class="subtitle">Documents associated with your account on Prosaurus.</p>

    <div class="doc-list">
      <div v-for="doc in documents" :key="doc.id" class="doc-card">
        <div class="doc-info">
          <RouterLink :to="doc.route" class="doc-title">{{ doc.title }}</RouterLink>
          <p class="doc-desc">{{ doc.description }}</p>
          <p v-if="doc.status === 'accepted' && doc.acceptedAt" class="doc-date">
            Accepted on {{ formatDate(doc.acceptedAt) }}
          </p>
          <p v-else-if="doc.status === 'acknowledged'" class="doc-date acknowledged">
            Acknowledged by creating an account
          </p>
        </div>
        <div class="doc-status">
          <span v-if="doc.status === 'loading'" class="badge badge-loading">Loading…</span>
          <span v-else-if="doc.status === 'accepted'" class="badge badge-accepted">✓ Accepted</span>
          <span v-else-if="doc.status === 'acknowledged'" class="badge badge-accepted">✓ Acknowledged</span>
          <span v-else-if="doc.status === 'pending'" class="badge badge-pending">Pending</span>
          <span v-else class="badge badge-unknown">Unknown</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.legal-page h2 {
  margin: 0 0 6px;
  font-size: 1.4rem;
  color: var(--color-text);
}

.subtitle {
  color: var(--color-text-muted);
  margin: 0 0 24px;
  font-size: 0.95rem;
}

.doc-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.doc-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 18px 20px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
}

.doc-info {
  flex: 1;
  min-width: 0;
}

.doc-title {
  font-weight: 600;
  font-size: 1rem;
  color: var(--color-link);
  text-decoration: none;
}

.doc-title:hover {
  text-decoration: underline;
}

.doc-desc {
  margin: 4px 0 0;
  font-size: 0.88rem;
  color: var(--color-text-muted);
}

.doc-date {
  margin: 6px 0 0;
  font-size: 0.82rem;
  color: var(--color-text-light);
}

.doc-date.acknowledged {
  font-style: italic;
}

.doc-status {
  flex-shrink: 0;
}

.badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 0.82rem;
  font-weight: 500;
  white-space: nowrap;
}

.badge-accepted {
  background: var(--badge-green-soft, rgba(52, 199, 89, 0.12));
  color: var(--badge-green-text, #1a7a38);
}

.badge-pending {
  background: rgba(255, 159, 10, 0.12);
  color: #b36200;
}

.badge-loading,
.badge-unknown {
  background: var(--color-background-mute);
  color: var(--color-text-muted);
}
</style>
