<template>
  <main class="domain-page page-container">

    <div class="page-header">
      <RouterLink to="/collections/storefront" class="back-link">← Storefront</RouterLink>
      <h1>Use Your Own Domain</h1>
      <p class="page-desc">
        Connect a domain you own so it becomes the real address of your store — visitors will see
        <em>your</em> domain in the address bar, not a Prosaurus URL.
      </p>
    </div>

    <div class="content">

      <!-- ── Automatic custom domain ── -->
      <section class="connect-card">
        <h2>Connect a domain</h2>
        <p class="card-hint">
          Enter a domain you own. We'll give you two DNS records to add at your registrar — once they're
          in place we automatically detect it, issue an SSL certificate, and switch your domain live. No
          approval wait, no manual setup on your end beyond the DNS records.
        </p>

        <div class="connect-form">
          <input
            v-model="newDomain"
            type="text"
            class="form-input domain-input"
            placeholder="yourdomain.com"
            maxlength="255"
            spellcheck="false"
            :disabled="submitting"
            @keyup.enter="submitDomain"
          />
          <button class="btn-primary" :disabled="submitting || !newDomain.trim()" @click="submitDomain">
            {{ submitting ? 'Connecting…' : 'Connect Domain' }}
          </button>
        </div>
        <p v-if="submitError" class="form-error">{{ submitError }}</p>

        <div v-if="loadingDomains" class="loading-inline">Loading…</div>

        <div v-else-if="domains.length" class="domain-list">
          <div v-for="d in domains" :key="d.id" class="domain-row">
            <div class="domain-row-main">
              <span class="domain-name">{{ d.domain }}</span>
              <span class="status-badge" :class="statusClass(d.status)">{{ statusLabel(d.status) }}</span>
            </div>

            <p v-if="d.status === 'failed' && d.error_message" class="form-error">{{ d.error_message }}</p>

            <div v-if="d.status === 'pending_dns'" class="dns-records">
              <p class="dns-hint">Add these records at your domain registrar (both are needed for <code>{{ d.domain }}</code> and <code>www.{{ d.domain }}</code>):</p>
              <table class="dns-table">
                <thead>
                  <tr><th>Type</th><th>Host</th><th>Value</th><th></th></tr>
                </thead>
                <tbody>
                  <tr v-for="rec in d.dns_records" :key="rec.host">
                    <td>{{ rec.type }}</td>
                    <td><code>{{ rec.host }}</code></td>
                    <td><code>{{ rec.value }}</code></td>
                    <td>
                      <button class="copy-btn" @click="copyValue(rec.value)">
                        {{ copiedValue === rec.value ? 'Copied!' : 'Copy' }}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p class="dns-note">DNS changes can take anywhere from a few minutes to a few hours to take effect. This page checks automatically — no need to refresh.</p>
            </div>

            <div v-else-if="d.status === 'provisioning'" class="dns-hint">
              DNS looks good — issuing your SSL certificate and switching your domain live now.
            </div>

            <div v-else-if="d.status === 'active'" class="dns-hint">
              <a :href="`https://${d.domain}`" target="_blank" rel="noopener">https://{{ d.domain }} ↗</a>
              is live and serving your store.
            </div>

            <button class="btn-remove" :disabled="removingId === d.id" @click="removeDomain(d)">
              {{ removingId === d.id ? 'Removing…' : 'Remove domain' }}
            </button>
          </div>
        </div>
      </section>

      <!-- ── Manual redirect fallback ── -->
      <section class="explainer-card">
        <h2>Prefer a simple redirect instead?</h2>
        <p>
          If you'd rather not touch DNS A records, you can still set up a quick registrar-side redirect
          that sends visitors from your domain to your Prosaurus store URL. It's faster to set up, but
          the address bar will show the Prosaurus URL after the redirect rather than your own domain.
        </p>
        <button class="link-toggle" @click="showManualGuide = !showManualGuide">
          {{ showManualGuide ? 'Hide manual redirect guide ▲' : 'Show manual redirect guide ▼' }}
        </button>
      </section>

      <template v-if="showManualGuide">
        <section class="steps-card">
          <h2>Step-by-step redirect setup</h2>
          <p class="steps-intro">
            These instructions apply to most domain registrars (GoDaddy, Namecheap, Squarespace Domains, etc.).
            The exact menu names may differ slightly between providers, but the concept is the same.
          </p>

          <ol class="steps-list">
            <li>
              <strong>Find your Prosaurus store URL</strong><br>
              Go to your
              <RouterLink to="/collections/storefront">Storefront settings</RouterLink>
              and copy your store URL — it looks like
              <code>https://www.prosaurus.com/store/your-store</code>.
            </li>
            <li>
              <strong>Log into your domain registrar</strong><br>
              Sign in to wherever you purchased your domain (GoDaddy, Namecheap, etc.).
            </li>
            <li>
              <strong>Find the forwarding settings</strong><br>
              Look for a section called <em>Domain Forwarding</em>, <em>URL Forwarding</em>,
              <em>URL Redirect</em>, or <em>Web Forwarding</em>. It's usually under the domain's
              DNS or settings panel.
            </li>
            <li>
              <strong>Create a forward rule</strong><br>
              <ul class="sub-list">
                <li><strong>From:</strong> your domain (e.g. <code>www.myshop.com</code> or <code>myshop.com</code>)</li>
                <li><strong>To:</strong> your full Prosaurus store URL</li>
                <li><strong>Type:</strong> 301 Permanent Redirect (preferred) or 302 Temporary</li>
              </ul>
              Set up a rule for both the <code>www</code> version and the bare domain if your registrar
              allows it.
            </li>
            <li>
              <strong>Wait for DNS propagation</strong><br>
              Changes can take a few minutes to up to 24 hours to take effect worldwide.
            </li>
            <li>
              <strong>Test it</strong><br>
              Open a browser and type your custom domain. You should be redirected to your Prosaurus store.
            </li>
          </ol>
        </section>

        <section class="registrar-links-card">
          <h2>Forwarding guides by registrar</h2>
          <p>Find the relevant help article for wherever your domain lives:</p>
          <ul class="registrar-list">
            <li>
              <strong>GoDaddy</strong> — search "forward domain GoDaddy" in their help center
            </li>
            <li>
              <strong>Namecheap</strong> — Dashboard → Domain List → Manage → Redirect Domain
            </li>
            <li>
              <strong>Squarespace Domains</strong> — Domains panel → DNS Settings → URL Redirects
            </li>
            <li>
              <strong>Google Domains / Squarespace</strong> — Website tab → Forwarding
            </li>
            <li>
              <strong>Cloudflare</strong> — DNS → Rules → Redirect Rules
            </li>
          </ul>
        </section>
      </template>

    </div>

  </main>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { RouterLink } from 'vue-router'
import { authFetch } from '@/utilities/authFetch'

const domains = ref([])
const loadingDomains = ref(true)
const newDomain = ref('')
const submitting = ref(false)
const submitError = ref('')
const removingId = ref(null)
const copiedValue = ref('')
const showManualGuide = ref(false)

let pollInterval = null

const STATUS_LABELS = {
  pending_dns: 'Pending DNS',
  provisioning: 'Provisioning',
  active: 'Active',
  failed: 'Failed',
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status
}

function statusClass(status) {
  if (status === 'active') return 'active'
  if (status === 'failed') return 'failed'
  return 'pending'
}

async function fetchDomains() {
  try {
    const res = await authFetch('/api/custom-domains')
    if (res.ok) domains.value = await res.json()
  } catch {
    // Leave the previous list in place on a transient fetch error.
  } finally {
    loadingDomains.value = false
  }
}

function maybePoll() {
  const needsPolling = domains.value.some(d => d.status === 'pending_dns' || d.status === 'provisioning')
  if (needsPolling && !pollInterval) {
    pollInterval = setInterval(fetchDomains, 10000)
  } else if (!needsPolling && pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

onMounted(async () => {
  await fetchDomains()
  maybePoll()
})

onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval)
})

async function submitDomain() {
  const domain = newDomain.value.trim()
  if (!domain) return
  submitting.value = true
  submitError.value = ''
  try {
    const res = await authFetch('/api/custom-domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain }),
    })
    const body = await res.json()
    if (!res.ok) {
      submitError.value = body.message || 'Could not connect that domain.'
      return
    }
    newDomain.value = ''
    await fetchDomains()
    maybePoll()
  } catch {
    submitError.value = 'Network error. Please try again.'
  } finally {
    submitting.value = false
  }
}

async function removeDomain(d) {
  removingId.value = d.id
  try {
    await authFetch(`/api/custom-domains/${d.id}`, { method: 'DELETE' })
    await fetchDomains()
    maybePoll()
  } catch {
    // Ignore — the row will still show on next poll if removal failed server-side.
  } finally {
    removingId.value = null
  }
}

async function copyValue(value) {
  try {
    await navigator.clipboard.writeText(value)
    copiedValue.value = value
    setTimeout(() => { if (copiedValue.value === value) copiedValue.value = '' }, 2000)
  } catch {
    // Clipboard API unavailable — silently ignore, the value is still visible to copy manually.
  }
}
</script>

<style scoped>
.domain-page {
  max-width: 760px;
}

.page-header {
  margin-bottom: 32px;
}

.back-link {
  display: inline-block;
  color: var(--color-link);
  text-decoration: none;
  font-size: 0.88rem;
  margin-bottom: 10px;
}

.back-link:hover { text-decoration: underline; }

.page-header h1 {
  font-size: 1.8rem;
  color: var(--color-text);
  margin: 0 0 8px;
}

.page-desc {
  font-size: 0.95rem;
  color: var(--color-text-secondary);
  margin: 0;
  line-height: 1.5;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.connect-card,
.explainer-card,
.steps-card,
.registrar-links-card {
  background: var(--color-background-card, #fff);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 24px 28px;
}

h2 {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-text);
  margin: 0 0 14px;
}

p {
  font-size: 0.93rem;
  color: var(--color-text-secondary);
  line-height: 1.6;
  margin: 0 0 12px;
}

p:last-child { margin-bottom: 0; }

.card-hint {
  margin-bottom: 18px;
}

code {
  background: var(--color-background-soft, #f5f5f5);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 0.88em;
  font-family: monospace;
  color: var(--color-text);
}

/* ── Connect form ── */
.connect-form {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.domain-input {
  flex: 1;
  min-width: 220px;
}

.form-input {
  padding: 10px 13px;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  font-size: 1rem;
  color: var(--color-text);
  background: var(--color-background, #fff);
  transition: border-color 0.15s;
}

.form-input:focus { border-color: var(--color-accent); outline: none; }
.form-input:disabled { opacity: 0.6; }

.btn-primary {
  background: var(--color-accent);
  color: white;
  border: none;
  border-radius: 7px;
  padding: 10px 18px;
  font-size: 0.92rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

.form-error {
  color: #c53030;
  font-size: 0.85rem;
  margin: 10px 0 0;
}

.loading-inline {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  margin-top: 16px;
}

/* ── Domain list ── */
.domain-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 20px;
}

.domain-row {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px 18px;
}

.domain-row-main {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.domain-name {
  font-family: monospace;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text);
}

.status-badge {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 3px 9px;
  border-radius: 12px;
}
.status-badge.active { background: rgba(47, 133, 90, 0.15); color: #2f855a; }
.status-badge.failed { background: rgba(197, 48, 48, 0.15); color: #c53030; }
.status-badge.pending { background: rgba(66, 133, 244, 0.12); color: var(--color-link); }

.dns-hint {
  font-size: 0.87rem;
  color: var(--color-text-secondary);
  margin: 0 0 10px;
}

.dns-note {
  font-size: 0.82rem;
  color: var(--color-text-secondary);
  margin: 10px 0 0;
}

.dns-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
  margin-bottom: 4px;
}

.dns-table th {
  text-align: left;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary);
  padding: 4px 8px;
  border-bottom: 1px solid var(--color-border);
}

.dns-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text);
}

.copy-btn {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  padding: 3px 9px;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  cursor: pointer;
}
.copy-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }

.btn-remove {
  background: none;
  border: none;
  color: #c53030;
  font-size: 0.82rem;
  cursor: pointer;
  padding: 0;
  margin-top: 8px;
}
.btn-remove:hover { text-decoration: underline; }
.btn-remove:disabled { opacity: 0.6; cursor: not-allowed; }

/* ── Manual guide toggle ── */
.link-toggle {
  background: none;
  border: none;
  color: var(--color-link);
  font-size: 0.87rem;
  cursor: pointer;
  padding: 0;
}
.link-toggle:hover { text-decoration: underline; }

.notice {
  background: rgba(66, 133, 244, 0.07);
  border-left: 3px solid var(--color-link);
  border-radius: 0 6px 6px 0;
  padding: 12px 16px;
  font-size: 0.87rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin-top: 14px;
}

.steps-intro {
  margin-bottom: 18px;
}

.steps-list {
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 0;
}

.steps-list li {
  font-size: 0.93rem;
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.steps-list li strong {
  color: var(--color-text);
}

.sub-list {
  margin: 8px 0 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  list-style: disc;
}

.sub-list li {
  font-size: 0.9rem;
}

.registrar-list {
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 12px 0 0;
}

.registrar-list li {
  font-size: 0.93rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.registrar-list li strong {
  color: var(--color-text);
}

a {
  color: var(--color-link);
  text-decoration: none;
}

a:hover { text-decoration: underline; }
</style>
