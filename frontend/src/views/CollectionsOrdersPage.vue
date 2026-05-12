<template>
  <main class="orders-page page-container">
    <div class="page-header">
      <h1>Orders</h1>
    </div>

    <div v-if="loading" class="state-msg">Loading orders…</div>
    <div v-else-if="error" class="state-msg error">{{ error }}</div>

    <template v-else-if="orders.length === 0">
      <div class="empty-state">
        <div class="empty-icon">📦</div>
        <h2>No orders yet</h2>
        <p>When someone purchases from your storefront, their order will appear here.</p>
      </div>
    </template>

    <template v-else>
      <!-- Status filter -->
      <div class="filter-bar">
        <button
          v-for="f in filters"
          :key="f.value"
          class="filter-btn"
          :class="{ active: activeFilter === f.value }"
          @click="activeFilter = f.value"
        >
          {{ f.label }}
          <span class="filter-count">{{ countByStatus(f.value) }}</span>
        </button>
      </div>

      <div class="orders-list">
        <div
          v-for="order in filteredOrders"
          :key="order.id"
          class="order-card"
          :class="`status-${order.status}`"
        >
          <div class="order-header" @click="toggleExpand(order.id)">
            <div class="order-thumb-wrap">
              <img
                v-if="order.item_image"
                :src="`/api/uploads/${order.item_image}`"
                :alt="order.item_name"
                class="order-thumb"
              />
              <div v-else class="order-thumb-placeholder">🖼️</div>
            </div>
            <div class="order-summary">
              <div class="order-item-name">{{ order.item_name }}</div>
              <div class="order-meta">
                {{ order.buyer_name }} · {{ formatDate(order.created_at) }}
              </div>
            </div>
            <div class="order-right">
              <span class="order-total">${{ (order.total_cents / 100).toFixed(2) }}</span>
              <span class="status-badge" :class="`badge-${order.status}`">{{ statusLabel(order.status) }}</span>
              <span class="expand-arrow">{{ expanded.has(order.id) ? '▲' : '▼' }}</span>
            </div>
          </div>

          <!-- Expanded details -->
          <div v-if="expanded.has(order.id)" class="order-detail">
            <div class="detail-grid">
              <div class="detail-section">
                <div class="detail-label">Buyer</div>
                <div>{{ order.buyer_name }}</div>
                <div class="detail-sub">{{ order.buyer_email }}</div>
              </div>
              <div class="detail-section">
                <div class="detail-label">Ship to</div>
                <div>{{ order.ship_to_name }}</div>
                <div class="detail-sub">{{ order.ship_to_address1 }}<span v-if="order.ship_to_address2">, {{ order.ship_to_address2 }}</span></div>
                <div class="detail-sub">{{ order.ship_to_city }}, {{ order.ship_to_state }} {{ order.ship_to_zip }}, {{ order.ship_to_country }}</div>
              </div>
              <div class="detail-section">
                <div class="detail-label">Payment</div>
                <div>${{ (order.item_price_cents / 100).toFixed(2) }} item</div>
                <div class="detail-sub">${{ (order.shipping_cost_cents / 100).toFixed(2) }} shipping</div>
                <div class="detail-sub">Total: ${{ (order.total_cents / 100).toFixed(2) }}</div>
              </div>
              <div v-if="order.tracking_number" class="detail-section">
                <div class="detail-label">Tracking</div>
                <div>{{ order.tracking_carrier || '' }} {{ order.tracking_number }}</div>
                <div v-if="order.shipped_at" class="detail-sub">Shipped {{ formatDate(order.shipped_at) }}</div>
              </div>
            </div>

            <!-- Mark as shipped form -->
            <div v-if="order.status === 'paid' || order.status === 'processing'" class="ship-form">
              <h4>Mark as shipped</h4>
              <div class="ship-inputs">
                <select v-model="shipForms[order.id].carrier">
                  <option value="">Carrier (optional)</option>
                  <option>USPS</option>
                  <option>UPS</option>
                  <option>FedEx</option>
                  <option>DHL</option>
                  <option>Other</option>
                </select>
                <input
                  v-model="shipForms[order.id].tracking"
                  type="text"
                  placeholder="Tracking number (optional)"
                />
                <button
                  class="btn-ship"
                  :disabled="shipForms[order.id].loading"
                  @click="markShipped(order)"
                >
                  {{ shipForms[order.id].loading ? 'Saving…' : 'Mark as Shipped' }}
                </button>
              </div>
              <p v-if="shipForms[order.id].error" class="ship-error">{{ shipForms[order.id].error }}</p>
            </div>
          </div>

        </div>
      </div>
    </template>
  </main>
</template>

<script setup>
import { ref, computed, reactive, onMounted } from 'vue'

const orders = ref([])
const loading = ref(true)
const error = ref(null)
const activeFilter = ref('all')
const expanded = ref(new Set())
const shipForms = reactive({})

const filters = [
  { label: 'All', value: 'all' },
  { label: 'Awaiting payment', value: 'pending_payment' },
  { label: 'Paid', value: 'paid' },
  { label: 'Shipped', value: 'shipped' },
  { label: 'Delivered', value: 'delivered' },
  { label: 'Cancelled', value: 'cancelled' },
]

const filteredOrders = computed(() => {
  if (activeFilter.value === 'all') return orders.value
  return orders.value.filter(o => o.status === activeFilter.value)
})

function countByStatus(status) {
  if (status === 'all') return orders.value.length
  return orders.value.filter(o => o.status === status).length
}

function statusLabel(status) {
  const map = {
    pending_payment: 'Pending payment',
    paid: 'Paid',
    processing: 'Processing',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    refunded: 'Refunded',
  }
  return map[status] || status
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function toggleExpand(id) {
  if (expanded.value.has(id)) {
    expanded.value.delete(id)
  } else {
    expanded.value.add(id)
    if (!shipForms[id]) {
      shipForms[id] = { carrier: '', tracking: '', loading: false, error: null }
    }
  }
  expanded.value = new Set(expanded.value) // trigger reactivity
}

async function markShipped(order) {
  const form = shipForms[order.id]
  form.loading = true
  form.error = null
  try {
    const res = await fetch(`/api/storefront/orders/${order.id}/ship`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracking_number: form.tracking, tracking_carrier: form.carrier }),
    })
    if (!res.ok) {
      const body = await res.json()
      form.error = body.message || 'Failed to update order.'
      return
    }
    order.status = 'shipped'
    order.tracking_number = form.tracking
    order.tracking_carrier = form.carrier
    order.shipped_at = new Date().toISOString()
  } catch {
    form.error = 'Network error. Please try again.'
  } finally {
    form.loading = false
  }
}

async function fetchOrders() {
  loading.value = true
  try {
    const res = await fetch('/api/storefront/orders', { credentials: 'include' })
    if (!res.ok) throw new Error('Failed to load orders')
    orders.value = await res.json()
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

onMounted(fetchOrders)
</script>

<style scoped>
.orders-page {
  max-width: 860px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 28px;
}

.page-header h1 { margin: 0; }

.state-msg {
  color: var(--color-text-secondary);
  padding: 40px 0;
  text-align: center;
}
.state-msg.error { color: var(--color-error, #e53935); }

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--color-text-secondary);
}
.empty-icon { font-size: 2.5rem; margin-bottom: 16px; }
.empty-state h2 { margin: 0 0 10px; color: var(--color-text); font-size: 1.2rem; }
.empty-state p { margin: 0; font-size: 0.9rem; }

/* Filter bar */
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}

.filter-btn {
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: 20px;
  padding: 5px 14px;
  font-size: 0.82rem;
  cursor: pointer;
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s;
}
.filter-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }
.filter-btn.active { background: var(--color-accent); border-color: var(--color-accent); color: #fff; }

.filter-count {
  background: rgba(0,0,0,0.12);
  border-radius: 10px;
  padding: 1px 7px;
  font-size: 0.75rem;
}
.filter-btn.active .filter-count { background: rgba(255,255,255,0.25); }

/* Order cards */
.orders-list { display: flex; flex-direction: column; gap: 10px; }

.order-card {
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
}

.order-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  cursor: pointer;
  transition: background 0.12s;
}
.order-header:hover { background: var(--color-background-soft); }

.order-thumb-wrap { flex-shrink: 0; }
.order-thumb { width: 52px; height: 52px; object-fit: cover; border-radius: 6px; display: block; }
.order-thumb-placeholder { width: 52px; height: 52px; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; background: var(--color-background-soft); border-radius: 6px; }

.order-summary { flex: 1; min-width: 0; }
.order-item-name { font-weight: 600; font-size: 0.95rem; color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.order-meta { font-size: 0.8rem; color: var(--color-text-secondary); margin-top: 3px; }

.order-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.order-total { font-weight: 700; font-size: 0.95rem; color: var(--color-text); }

.status-badge {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 3px 9px;
  border-radius: 12px;
}
.badge-pending_payment { background: #fff3e0; color: #e65100; }
.badge-paid           { background: #e8f5e9; color: #2e7d32; }
.badge-processing     { background: #e3f2fd; color: #1565c0; }
.badge-shipped        { background: #ede7f6; color: #4527a0; }
.badge-delivered      { background: #e8f5e9; color: #1b5e20; }
.badge-cancelled      { background: #fce4ec; color: #b71c1c; }
.badge-refunded       { background: #f3e5f5; color: #6a1b9a; }

.expand-arrow { font-size: 0.7rem; color: var(--color-text-muted); }

/* Expanded detail */
.order-detail {
  border-top: 1px solid var(--color-border);
  padding: 16px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}

.detail-label {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  margin-bottom: 4px;
}

.detail-section { font-size: 0.88rem; color: var(--color-text); }
.detail-sub { color: var(--color-text-secondary); margin-top: 2px; }

/* Ship form */
.ship-form {
  background: var(--color-background-soft);
  border-radius: 8px;
  padding: 14px 16px;
}

.ship-form h4 { margin: 0 0 12px; font-size: 0.88rem; color: var(--color-text); }

.ship-inputs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.ship-inputs select,
.ship-inputs input {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 0.88rem;
  background: var(--color-background-card);
  color: var(--color-text);
  outline: none;
}
.ship-inputs select { min-width: 140px; }
.ship-inputs input { flex: 1; min-width: 160px; }

.btn-ship {
  background: var(--color-accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 8px 18px;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.15s;
}
.btn-ship:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-ship:not(:disabled):hover { opacity: 0.85; }

.ship-error { color: var(--color-error, #e53935); font-size: 0.82rem; margin: 8px 0 0; }
</style>
