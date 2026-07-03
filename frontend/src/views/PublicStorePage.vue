<template>
  <div class="store-shell" :style="pageStyle">

    <div v-if="loading" class="store-loading">Loading…</div>

    <div v-else-if="notFound" class="store-not-found">
      <h1>Store not found</h1>
      <p>This store doesn't exist or hasn't been set up yet.</p>
    </div>

    <main v-else class="store-content">
      <h1 v-if="storefront.page_title" class="store-title">{{ storefront.page_title }}</h1>

      <template v-for="section in storefront.sections" :key="section.id">
        <template v-if="section.visible">

          <!-- Content section -->
          <div
            v-if="section.type === 'content' && storefront.content"
            class="store-body"
            v-html="storefront.content"
          />

          <!-- Collections section -->
          <div v-else-if="section.type === 'collections'" class="collections-section">
            <h2 v-if="section.title" class="collections-heading">{{ section.title }}</h2>

            <!-- Single collection: render items inline -->
            <template v-if="storefront.collections?.length === 1">
              <div v-if="loadingItems" class="store-loading-inline">Loading…</div>
              <div v-else-if="collectionItems.length === 0" class="collections-empty">No items in this collection yet.</div>
              <div v-else class="items-grid">
                <div
                  v-for="item in collectionItems"
                  :key="item.id"
                  class="item-card"
                  @click="openItem(item)"
                >
                  <div class="item-image-wrap">
                    <img
                      v-if="item.image_path"
                      :src="`/api/uploads/${item.image_path}`"
                      :alt="item.name"
                      class="item-image"
                    />
                    <div v-else class="item-image-placeholder">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="36" height="36">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                      </svg>
                    </div>
                    <div v-if="!item.is_available" class="sold-badge">Sold</div>
                    <div class="buy-overlay">{{ item.is_available ? 'View & Buy' : 'View' }}</div>
                  </div>
                  <div class="item-body">
                    <div class="item-name">{{ item.name }}</div>
                    <div v-if="item.description" class="item-desc">{{ item.description }}</div>
                    <div v-if="item.is_available" class="item-price-row">
                      <span v-if="item.price_cents != null" class="item-price">${{ (item.price_cents / 100).toFixed(2) }}</span>
                      <span v-if="item.shipping_cost_cents != null" class="item-shipping">
                        + ${{ (item.shipping_cost_cents / 100).toFixed(2) }} shipping
                      </span>
                      <span v-else-if="item.price_cents != null" class="item-shipping">Free shipping</span>
                    </div>
                    <button class="contact-seller-btn" @click.stop="openContact(item)">Contact Seller</button>
                  </div>
                </div>
              </div>
            </template>

            <!-- Multiple collections: original grid -->
            <template v-else>
              <div v-if="storefront.collections?.length" class="collections-grid" :style="collectionGridVars">
                <RouterLink
                  v-for="col in storefront.collections"
                  :key="col.id"
                  :to="collectionLink(col.id)"
                  class="collection-card"
                >
                  <div class="collection-image" :style="collectionCardStyle(col)"></div>
                  <div class="collection-body">
                    <span class="collection-name">{{ col.name }}</span>
                    <span class="collection-arrow">→</span>
                  </div>
                </RouterLink>
              </div>
              <p v-else class="collections-empty">No collections yet.</p>
            </template>

          </div>

        </template>
      </template>
    </main>

    <!-- ── View-only lightbox ── -->
    <Teleport to="body">
      <div v-if="viewModal.open" class="modal-backdrop" @click.self="viewModal.open = false">
        <div class="modal modal-lightbox">
          <button class="modal-close lightbox-close" @click="viewModal.open = false">✕</button>
          <div class="lightbox-scroll">
            <img
              v-if="viewModal.item?.image_path"
              :src="`/api/uploads/${viewModal.item.image_path}`"
              :alt="viewModal.item?.name"
              class="lightbox-image"
            />
            <div class="lightbox-info">
              <div class="lightbox-name">{{ viewModal.item?.name }}</div>
              <div v-if="viewModal.item?.description" class="lightbox-desc">{{ viewModal.item?.description }}</div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ── Purchase modal ── -->
    <Teleport to="body">
      <div v-if="modal.open" class="modal-backdrop">
        <div class="modal" :class="{ 'modal-lightbox': modal.step === 0 }">

          <!-- Step 0: Preview -->
          <template v-if="modal.step === 0">
            <button class="modal-close lightbox-close" @click="closeModal">✕</button>
            <div class="lightbox-scroll">
              <img
                v-if="modal.item?.image_path"
                :src="`/api/uploads/${modal.item.image_path}`"
                :alt="modal.item?.name"
                class="lightbox-image"
              />
              <div class="lightbox-info">
                <div class="lightbox-name">{{ modal.item?.name }}</div>
                <div v-if="modal.item?.description" class="lightbox-desc">{{ modal.item?.description }}</div>
                <div class="lightbox-price-row">
                  <span class="lightbox-price">${{ (modal.item?.price_cents / 100).toFixed(2) }}</span>
                  <span v-if="modal.item?.shipping_cost_cents" class="lightbox-shipping"> + ${{ (modal.item.shipping_cost_cents / 100).toFixed(2) }} shipping</span>
                  <span v-else class="lightbox-shipping"> · Free shipping</span>
                </div>
              </div>
            </div>
            <div class="modal-footer lightbox-footer">
              <button class="btn-primary btn-buy-now" @click="modal.step = 1">Buy Now</button>
            </div>
          </template>

          <!-- Step 1: Shipping info -->
          <template v-else-if="modal.step === 1">
            <div class="modal-header">
              <div class="modal-item-preview">
                <img v-if="modal.item?.image_path" :src="`/api/uploads/${modal.item.image_path}`" :alt="modal.item.name" class="modal-thumb" />
                <div class="modal-item-info">
                  <div class="modal-item-name">{{ modal.item?.name }}</div>
                  <div class="modal-item-price">
                    ${{ (modal.item?.price_cents / 100).toFixed(2) }}
                    <span v-if="modal.item?.shipping_cost_cents"> + ${{ (modal.item.shipping_cost_cents / 100).toFixed(2) }} shipping</span>
                    <span v-else> · Free shipping</span>
                  </div>
                </div>
              </div>
              <button class="modal-close" @click="closeModal">✕</button>
            </div>

            <div class="modal-body">
              <h3 class="modal-section-title">Your information</h3>
              <div class="form-row">
                <label>Full name *
                  <input v-model="form.buyer_name" type="text" placeholder="Jane Smith" @blur="syncShipName" />
                </label>
                <label>Email *
                  <input v-model="form.buyer_email" type="email" placeholder="jane@example.com" />
                </label>
              </div>

              <h3 class="modal-section-title">Ship to</h3>
              <div class="form-row">
                <label class="full">Name on package *
                  <input v-model="form.ship_to_name" type="text" placeholder="Jane Smith" />
                </label>
              </div>
              <div class="form-row">
                <label class="full">Address *
                  <input v-model="form.ship_to_address1" type="text" placeholder="123 Main St" />
                </label>
              </div>
              <div class="form-row">
                <label class="full">Apt / Suite / Unit
                  <input v-model="form.ship_to_address2" type="text" placeholder="Apt 4B (optional)" />
                </label>
              </div>
              <div class="form-row">
                <label>City *
                  <input v-model="form.ship_to_city" type="text" placeholder="New York" />
                </label>
                <label>State / Province *
                  <input v-model="form.ship_to_state" type="text" placeholder="NY" />
                </label>
              </div>
              <div class="form-row">
                <label>ZIP / Postal code *
                  <input v-model="form.ship_to_zip" type="text" placeholder="10001" />
                </label>
                <label>Country
                  <input v-model="form.ship_to_country" type="text" placeholder="US" />
                </label>
              </div>

              <p v-if="modal.error" class="form-error">{{ modal.error }}</p>
            </div>

            <div class="modal-footer">
              <button class="btn-secondary" @click="closeModal">Cancel</button>
              <button class="btn-primary" :disabled="modal.loading" @click="proceedToPayment">
                {{ modal.loading ? 'Please wait…' : 'Continue to Payment →' }}
              </button>
            </div>
          </template>

          <!-- Step 2: Payment -->
          <template v-else-if="modal.step === 2">
            <div class="modal-header">
              <h2 class="modal-title">Payment</h2>
              <button class="modal-close" @click="closeModal">✕</button>
            </div>

            <div class="modal-body">
              <div class="order-summary">
                <div class="summary-row"><span>{{ modal.item?.name }}</span><span>${{ (modal.intentData.item_price_cents / 100).toFixed(2) }}</span></div>
                <div class="summary-row"><span>Shipping</span><span>${{ (modal.intentData.shipping_cost_cents / 100).toFixed(2) }}</span></div>
                <div class="summary-row total"><span>Total</span><span>${{ (modal.intentData.total_cents / 100).toFixed(2) }}</span></div>
              </div>

              <div class="ship-summary">
                <strong>Ships to:</strong> {{ form.ship_to_name }}, {{ form.ship_to_address1 }}{{ form.ship_to_address2 ? ', ' + form.ship_to_address2 : '' }}, {{ form.ship_to_city }}, {{ form.ship_to_state }} {{ form.ship_to_zip }}
              </div>

              <div class="stripe-card-label">Card details</div>
              <div id="stripe-card-element" class="stripe-card-mount"></div>
              <div v-if="stripeError" class="form-error">{{ stripeError }}</div>
              <p v-if="modal.error" class="form-error">{{ modal.error }}</p>

              <p class="stripe-notice">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
                Payments processed securely by Stripe
              </p>
            </div>

            <div class="modal-footer">
              <button class="btn-secondary" @click="modal.step = 1">← Back</button>
              <button class="btn-primary" :disabled="modal.loading" @click="submitPayment">
                {{ modal.loading ? 'Processing…' : `Pay $${(modal.intentData.total_cents / 100).toFixed(2)}` }}
              </button>
            </div>
          </template>

          <!-- Step 3: Confirmation -->
          <template v-else-if="modal.step === 3">
            <div class="modal-header">
              <h2 class="modal-title">Order confirmed!</h2>
              <button class="modal-close" @click="closeModal">✕</button>
            </div>
            <div class="modal-body confirmation">
              <div class="confirm-icon">✓</div>
              <p>Thank you, <strong>{{ form.buyer_name }}</strong>!</p>
              <p>Your order of <strong>{{ modal.item?.name }}</strong> has been placed. A confirmation has been sent to <strong>{{ form.buyer_email }}</strong>.</p>
              <p>The seller will ship your item and email you a tracking number.</p>
            </div>
            <div class="modal-footer">
              <button class="btn-primary" @click="closeModal">Done</button>
            </div>
          </template>

        </div>
      </div>
    </Teleport>

    <!-- ── Contact Seller modal ── -->
    <Teleport to="body">
      <div v-if="contactModal.open" class="modal-backdrop">
        <div class="modal contact-modal">
          <div class="modal-header">
            <h2 class="modal-title">Contact Seller</h2>
            <button class="modal-close" @click="closeContact">✕</button>
          </div>

          <div v-if="contactModal.sent" class="modal-body confirmation">
            <div class="confirm-icon">✓</div>
            <p>Your message has been sent! The seller will reply to your email.</p>
          </div>

          <template v-else>
            <div class="modal-body">
              <p v-if="contactModal.item" class="contact-item-ref">About: <strong>{{ contactModal.item.name }}</strong></p>
              <div class="form-row">
                <label>Your name *<input v-model="contactForm.buyer_name" type="text" placeholder="Jane Smith" /></label>
                <label>Your email *<input v-model="contactForm.buyer_email" type="email" placeholder="jane@example.com" /></label>
              </div>
              <div class="form-row">
                <label class="full">Message *
                  <textarea v-model="contactForm.message" rows="5" placeholder="What would you like to know?"></textarea>
                </label>
              </div>
              <p v-if="contactModal.error" class="form-error">{{ contactModal.error }}</p>
            </div>
            <div class="modal-footer">
              <button class="btn-secondary" @click="closeContact">Cancel</button>
              <button class="btn-primary" :disabled="contactModal.loading" @click="submitContact">
                {{ contactModal.loading ? 'Sending…' : 'Send Message' }}
              </button>
            </div>
          </template>

        </div>
      </div>
    </Teleport>

  </div>
</template>

<script setup>
import { ref, computed, reactive, nextTick, onMounted } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

const props = defineProps({
  resolvedStoreUrl: { type: String, default: null },
})

const route = useRoute()
const loading = ref(true)
const notFound = ref(false)
const storefront = ref(null)

// On a connected custom domain, storeUrl isn't in the route params — the CustomDomainHome
// dispatcher resolves it via hostname lookup and passes it down as a prop instead.
const storeUrl = computed(() => props.resolvedStoreUrl || route.params.storeUrl)

function collectionLink(collectionId) {
  return route.meta.customDomain ? `/c/${collectionId}` : `/store/${route.params.storeUrl}/c/${collectionId}`
}

const pageStyle = computed(() => {
  const collections = storefront.value?.collections
  if (collections?.length === 1) {
    const s = collections[0].settings || {}
    if (s.background_image) {
      return { backgroundImage: `url(/api/uploads/${s.background_image})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    }
    if (s.background_color) return { backgroundColor: s.background_color }
  }
  const bg = storefront.value?.settings?.background_color
  return bg ? { backgroundColor: bg } : {}
})

const collectionGridVars = computed(() => {
  const s = storefront.value?.settings || {}
  const minWidths = { small: '200px', medium: '300px', large: '460px' }
  const aspects = { portrait: '1 / 1.618', square: '1 / 1', landscape: '1.618 / 1' }
  return {
    '--card-min-width': minWidths[s.collections_display_size] || '200px',
    '--card-aspect': aspects[s.collections_aspect_ratio] || '1.618 / 1'
  }
})

function collectionCardStyle(col) {
  const s = col.settings || {}
  if (s.background_image) {
    return { backgroundImage: `url(/api/uploads/${s.background_image})`, backgroundSize: 'cover', backgroundPosition: 'center' }
  }
  return { backgroundColor: s.background_color || '#f5f5f5' }
}

// ── Single-collection inline items ───────────────────────────────────────────
const collectionItems = ref([])
const loadingItems = ref(false)

async function fetchCollectionItems(storeUrl, collectionId) {
  loadingItems.value = true
  try {
    const res = await fetch(`/api/storefront/public/${storeUrl}/collection/${collectionId}`)
    if (res.ok) {
      const data = await res.json()
      collectionItems.value = data.items
    }
  } catch {}
  finally { loadingItems.value = false }
}

async function fetchStore() {
  loading.value = true
  try {
    const res = await fetch(`/api/storefront/public/${storeUrl.value}`)
    if (res.status === 404) {
      notFound.value = true
    } else if (res.ok) {
      storefront.value = await res.json()
      if (storefront.value?.page_title) {
        document.title = storefront.value.page_title
      }
      if (storefront.value?.collections?.length === 1) {
        fetchCollectionItems(storeUrl.value, storefront.value.collections[0].id)
      }
    }
  } catch (err) {
    notFound.value = true
  } finally {
    loading.value = false
  }
}

onMounted(fetchStore)

// ── View-only lightbox ───────────────────────────────────────────────────────
const viewModal = reactive({ open: false, item: null })

function openItem(item) {
  if (item.is_available) {
    openPurchase(item)
  } else {
    viewModal.item = item
    viewModal.open = true
  }
}

// ── Purchase modal ────────────────────────────────────────────────────────────
const modal = reactive({
  open: false,
  step: 0,
  item: null,
  loading: false,
  error: null,
  intentData: null,
})

const form = reactive({
  buyer_name: '',
  buyer_email: '',
  ship_to_name: '',
  ship_to_address1: '',
  ship_to_address2: '',
  ship_to_city: '',
  ship_to_state: '',
  ship_to_zip: '',
  ship_to_country: 'US',
})

const stripeError = ref(null)
let stripe = null
let cardElement = null

function openPurchase(item) {
  modal.item = item
  modal.step = 0
  modal.error = null
  modal.loading = false
  modal.intentData = null
  modal.open = true
}

function closeModal() {
  modal.open = false
  stripeError.value = null
  if (cardElement) {
    cardElement.destroy()
    cardElement = null
  }
}

function syncShipName() {
  if (!form.ship_to_name) form.ship_to_name = form.buyer_name
}

async function proceedToPayment() {
  modal.error = null
  if (!form.buyer_name || !form.buyer_email || !form.ship_to_name ||
      !form.ship_to_address1 || !form.ship_to_city || !form.ship_to_state || !form.ship_to_zip) {
    modal.error = 'Please fill in all required fields.'
    return
  }

  modal.loading = true
  try {
    const res = await fetch(
      `/api/storefront/public/${storeUrl.value}/items/${modal.item.id}/checkout/intent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form }),
      }
    )
    const body = await res.json()
    if (!res.ok) {
      modal.error = body.message || 'Could not start checkout.'
      return
    }

    modal.intentData = body
    modal.step = 2
    await nextTick()
    await mountStripeCard(body.client_secret)
  } catch {
    modal.error = 'Network error. Please try again.'
  } finally {
    modal.loading = false
  }
}

async function mountStripeCard() {
  const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  if (!key) {
    modal.error = 'Payment is not configured.'
    return
  }
  const { loadStripe } = await import('@stripe/stripe-js')
  stripe = await loadStripe(key)
  const elements = stripe.elements()
  cardElement = elements.create('card', {
    style: {
      base: { fontSize: '15px', color: '#222', '::placeholder': { color: '#aaa' } },
      invalid: { color: '#e53935' },
    },
  })
  cardElement.mount('#stripe-card-element')
  cardElement.on('change', (e) => {
    stripeError.value = e.error ? e.error.message : null
  })
}

async function submitPayment() {
  if (!stripe || !cardElement) return
  modal.error = null
  stripeError.value = null
  modal.loading = true
  try {
    const { error } = await stripe.confirmCardPayment(modal.intentData.client_secret, {
      payment_method: {
        card: cardElement,
        billing_details: { name: form.buyer_name, email: form.buyer_email },
      },
    })
    if (error) {
      stripeError.value = error.message
    } else {
      cardElement.destroy()
      cardElement = null
      modal.step = 3
      const soldIdx = collectionItems.value.findIndex(i => i.id === modal.item.id)
      if (soldIdx !== -1) collectionItems.value[soldIdx] = { ...collectionItems.value[soldIdx], is_available: 0 }
    }
  } catch {
    modal.error = 'Payment failed. Please try again.'
  } finally {
    modal.loading = false
  }
}

// ── Contact Seller ────────────────────────────────────────────────────────────
const contactModal = reactive({ open: false, item: null, loading: false, error: null, sent: false })
const contactForm = reactive({ buyer_name: '', buyer_email: '', message: '' })

function openContact(item) {
  contactModal.item = item
  contactModal.sent = false
  contactModal.error = null
  contactModal.loading = false
  contactModal.open = true
}

function closeContact() {
  contactModal.open = false
}

async function submitContact() {
  contactModal.error = null
  if (!contactForm.buyer_name || !contactForm.buyer_email || !contactForm.message) {
    contactModal.error = 'Please fill in all fields.'
    return
  }
  contactModal.loading = true
  try {
    const res = await fetch(`/api/storefront/public/${storeUrl.value}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        buyer_name: contactForm.buyer_name,
        buyer_email: contactForm.buyer_email,
        message: contactForm.message,
        item_name: contactModal.item?.name || null,
      }),
    })
    const body = await res.json()
    if (!res.ok) {
      contactModal.error = body.message || 'Failed to send message.'
      return
    }
    contactModal.sent = true
  } catch {
    contactModal.error = 'Network error. Please try again.'
  } finally {
    contactModal.loading = false
  }
}
</script>

<style scoped>
.store-shell {
  min-height: 100vh;
  background: #fff;
}

.store-loading,
.store-not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 40px;
  text-align: center;
  color: #555;
}

.store-not-found h1 {
  font-size: 2rem;
  margin-bottom: 12px;
  color: #222;
}

.store-loading-inline {
  color: #888;
  padding: 20px 0;
}

.store-content {
  width: 100%;
  max-width: max(960px, 90vw);
  margin: 0 auto;
  padding: 60px 32px 80px;
  box-sizing: border-box;
}

.store-title {
  font-size: 2.6rem;
  font-weight: 700;
  line-height: 1.2;
  margin: 0 0 32px;
  color: inherit;
}

/* Rich text content section */
.store-body {
  font-size: 1.05rem;
  line-height: 1.75;
  color: inherit;
  margin-bottom: 48px;
}

.store-body :deep(p) { margin: 0 0 1em; }

.store-body :deep(h1) {
  font-size: 2rem;
  font-weight: 700;
  margin: 0.5em 0 0.4em;
  line-height: 1.2;
}

.store-body :deep(h2) {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0.7em 0 0.4em;
  line-height: 1.3;
}

.store-body :deep(h3) {
  font-size: 1.15rem;
  font-weight: 600;
  margin: 0.8em 0 0.35em;
}

.store-body :deep(ul),
.store-body :deep(ol) {
  padding-left: 1.6em;
  margin: 0.5em 0;
}

.store-body :deep(li) { margin-bottom: 0.25em; }

.store-body :deep(blockquote) {
  border-left: 3px solid #aaa;
  margin: 1em 0;
  padding: 0.4em 0 0.4em 1em;
  color: #666;
  font-style: italic;
}

.store-body :deep(hr) {
  border: none;
  border-top: 1px solid #ddd;
  margin: 1.5em 0;
}

.store-body :deep(strong) { font-weight: 700; }
.store-body :deep(em) { font-style: italic; }
.store-body :deep(s) { text-decoration: line-through; }

/* Collections section */
.collections-section {
  margin-bottom: 48px;
}

.collections-heading {
  font-size: 1.6rem;
  font-weight: 700;
  margin: 0 0 24px;
  color: inherit;
}

.collections-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(var(--card-min-width, 200px), 1fr));
  gap: 16px;
}

.collection-card {
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.08);
  text-decoration: none;
  color: inherit;
  display: flex;
  flex-direction: column;
  transition: box-shadow 0.15s, transform 0.15s;
  cursor: pointer;
}

.collection-card:hover {
  box-shadow: 0 0 0 1px rgba(0,0,0,0.08), 0 6px 24px rgba(0,0,0,0.1);
  transform: translateY(-2px);
}

.collection-image {
  width: 100%;
  aspect-ratio: var(--card-aspect, 1.618 / 1);
  background-size: cover;
  background-position: center;
}

.collection-body {
  padding: 14px 16px 16px;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.collection-name {
  font-size: 1rem;
  font-weight: 600;
  color: #222;
}

.collection-arrow {
  font-size: 1.1rem;
  color: #888;
  flex-shrink: 0;
}

.collections-empty {
  color: #888;
  font-size: 0.95rem;
}

/* ── Inline items grid ── */
.items-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 24px;
}

.item-card {
  border-radius: 10px;
  overflow: hidden;
  background: rgba(255,255,255,0.85);
  border: 1px solid rgba(0,0,0,0.08);
  cursor: pointer;
  transition: box-shadow 0.15s, transform 0.15s;
}

.item-card:hover {
  box-shadow: 0 6px 24px rgba(0,0,0,0.1);
  transform: translateY(-2px);
}

.item-image-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 4/3;
  overflow: hidden;
  background: rgba(0,0,0,0.04);
}

.item-image { width: 100%; height: 100%; object-fit: cover; display: block; }

.item-image-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(0,0,0,0.2);
}

.sold-badge {
  position: absolute;
  top: 10px;
  left: 10px;
  background: rgba(0,0,0,0.65);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 3px 9px;
  border-radius: 4px;
  pointer-events: none;
}

.buy-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.45);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  opacity: 0;
  transition: opacity 0.18s;
}
.item-card:hover .buy-overlay { opacity: 1; }

.item-body { padding: 14px 16px 14px; }

.contact-seller-btn {
  margin-top: 10px;
  background: none;
  border: 1px solid #ccc;
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 0.8rem;
  color: #555;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
  width: 100%;
}
.contact-seller-btn:hover { border-color: #6366f1; color: #6366f1; }
.item-name { font-size: 1rem; font-weight: 600; color: inherit; margin-bottom: 6px; }
.item-desc { font-size: 0.88rem; color: inherit; opacity: 0.7; line-height: 1.5; margin-bottom: 8px; }
.item-price-row { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.item-price { font-size: 1rem; font-weight: 700; color: inherit; }
.item-shipping { font-size: 0.8rem; color: inherit; opacity: 0.65; }

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
  background: #fff;
  border-radius: 14px;
  width: 100%;
  max-width: 540px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,0.25);
}

.modal-lightbox {
  max-width: 720px;
  padding: 0;
  background: #111;
}

.lightbox-close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1;
  background: rgba(0,0,0,0.55);
  color: #fff;
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
}
.lightbox-close:hover { background: rgba(0,0,0,0.8); color: #fff; }

.lightbox-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.lightbox-image {
  width: 100%;
  max-height: 65vh;
  object-fit: contain;
  display: block;
  background: #111;
}

.lightbox-info {
  padding: 18px 20px;
  background: #fff;
}

.lightbox-name {
  font-size: 1.1rem;
  font-weight: 700;
  color: #222;
  margin-bottom: 6px;
}

.lightbox-desc {
  font-size: 0.9rem;
  color: #555;
  line-height: 1.6;
  margin-bottom: 8px;
}

.lightbox-price-row {
  margin-top: 8px;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px;
}

.lightbox-price {
  font-size: 1.05rem;
  font-weight: 700;
  color: #222;
}

.lightbox-shipping {
  font-size: 0.82rem;
  color: #777;
}

.lightbox-footer {
  border-top: none;
  padding: 12px 20px 20px;
  background: #fff;
}

.btn-buy-now {
  width: 100%;
  padding: 13px;
  font-size: 1rem;
  border-radius: 10px;
}

.modal-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 20px 20px 16px;
  border-bottom: 1px solid #eee;
  flex-shrink: 0;
}

.modal-item-preview { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; }

.modal-thumb {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 8px;
  flex-shrink: 0;
}

.modal-item-info { min-width: 0; }
.modal-item-name { font-size: 1rem; font-weight: 700; color: #222; }
.modal-item-price { font-size: 0.88rem; color: #555; margin-top: 3px; }

.modal-title { font-size: 1.15rem; font-weight: 700; color: #222; margin: 0; flex: 1; line-height: 1.3; }

.modal-close {
  background: none;
  border: none;
  font-size: 1.1rem;
  color: #999;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  flex-shrink: 0;
}
.modal-close:hover { color: #333; }

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.modal-section-title {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #888;
  margin: 0 0 12px;
}
.modal-section-title + .form-row { margin-top: 0; }

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}
.form-row .full { grid-column: 1 / -1; }

.form-row label {
  display: flex;
  flex-direction: column;
  font-size: 0.82rem;
  font-weight: 600;
  color: #555;
  gap: 5px;
}

.form-row input {
  padding: 9px 11px;
  border: 1px solid #ddd;
  border-radius: 7px;
  font-size: 0.92rem;
  color: #222;
  outline: none;
  transition: border-color 0.15s;
}
.form-row input:focus { border-color: #6366f1; }

.modal-section-title:not(:first-child) { margin-top: 20px; }

.order-summary {
  background: #f8f8f8;
  border-radius: 8px;
  padding: 14px 16px;
  margin-bottom: 16px;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
  color: #555;
  padding: 4px 0;
}
.summary-row.total {
  border-top: 1px solid #e0e0e0;
  margin-top: 6px;
  padding-top: 8px;
  font-weight: 700;
  color: #222;
}

.ship-summary {
  font-size: 0.82rem;
  color: #666;
  margin-bottom: 18px;
  line-height: 1.5;
}

.stripe-card-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: #555;
  margin-bottom: 8px;
}

.stripe-card-mount {
  border: 1px solid #ddd;
  border-radius: 7px;
  padding: 12px;
  background: #fff;
}

.stripe-notice {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.75rem;
  color: #999;
  margin: 12px 0 0;
}

.form-error {
  color: #e53935;
  font-size: 0.85rem;
  margin: 10px 0 0;
}

.confirmation {
  text-align: center;
  padding: 32px 20px;
}

.confirm-icon {
  width: 56px;
  height: 56px;
  background: #e8f5e9;
  color: #2e7d32;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.6rem;
  margin: 0 auto 20px;
}

.confirmation p { color: #444; line-height: 1.6; margin: 0 0 10px; font-size: 0.95rem; }

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid #eee;
  flex-shrink: 0;
}

.btn-primary {
  background: #6366f1;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 10px 22px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-primary:not(:disabled):hover { opacity: 0.88; }

.btn-secondary {
  background: #f3f3f3;
  color: #444;
  border: none;
  border-radius: 8px;
  padding: 10px 18px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-secondary:hover { background: #e8e8e8; }

.contact-modal { max-width: 480px; }

.contact-item-ref {
  font-size: 0.88rem;
  color: #555;
  margin: 0 0 16px;
  padding: 8px 12px;
  background: #f5f5f5;
  border-radius: 6px;
}

.form-row textarea {
  padding: 9px 11px;
  border: 1px solid #ddd;
  border-radius: 7px;
  font-size: 0.92rem;
  color: #222;
  outline: none;
  resize: vertical;
  font-family: inherit;
  width: 100%;
  box-sizing: border-box;
  transition: border-color 0.15s;
}
.form-row textarea:focus { border-color: #6366f1; }

@media (max-width: 600px) {
  .store-content {
    padding: 40px 20px 60px;
  }

  .store-title {
    font-size: 1.8rem;
  }

  .collections-grid {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  }

  .items-grid { grid-template-columns: 1fr 1fr; gap: 14px; }
  .form-row { grid-template-columns: 1fr; }
  .form-row .full { grid-column: 1; }
}

@media (max-width: 380px) {
  .items-grid { grid-template-columns: 1fr; }
}
</style>
