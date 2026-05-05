<template>
  <div class="collection-shell" :style="pageStyle">

    <div v-if="loading" class="state-center">Loading…</div>

    <div v-else-if="notFound" class="state-center">
      <h1>Collection not found</h1>
      <p>This collection doesn't exist or isn't available.</p>
    </div>

    <main v-else class="collection-content">
      <nav class="breadcrumb">
        <RouterLink :to="`/store/${route.params.storeUrl}`" class="breadcrumb-link">
          ← {{ data.store_title || 'Store' }}
        </RouterLink>
      </nav>

      <h1 class="collection-title">{{ data.collection.name }}</h1>

      <div v-if="data.items.length === 0" class="empty-state">
        <p>No items in this collection yet.</p>
      </div>

      <div v-else class="items-grid">
        <div v-for="item in data.items" :key="item.id" class="item-card">
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
          </div>
          <div class="item-body">
            <div class="item-name">{{ item.name }}</div>
            <div v-if="item.description" class="item-desc">{{ item.description }}</div>
            <div class="item-price-row">
              <span v-if="item.price_cents != null" class="item-price">${{ (item.price_cents / 100).toFixed(2) }}</span>
              <span v-if="item.shipping_cost_cents != null" class="item-shipping">
                + ${{ (item.shipping_cost_cents / 100).toFixed(2) }} shipping
              </span>
              <span v-else-if="item.price_cents != null" class="item-shipping">Free shipping</span>
            </div>
          </div>
        </div>
      </div>
    </main>

  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

const route = useRoute()
const loading = ref(true)
const notFound = ref(false)
const data = ref(null)

const pageStyle = computed(() => {
  const bg = data.value?.collection?.settings?.background_color
  return bg ? { backgroundColor: bg } : {}
})

async function fetchCollection() {
  loading.value = true
  try {
    const res = await fetch(
      `/api/storefront/public/${route.params.storeUrl}/collection/${route.params.collectionId}`
    )
    if (res.status === 404) {
      notFound.value = true
    } else if (res.ok) {
      data.value = await res.json()
      document.title = data.value.collection.name
    }
  } catch (err) {
    notFound.value = true
  } finally {
    loading.value = false
  }
}

onMounted(fetchCollection)
</script>

<style scoped>
.collection-shell {
  min-height: 100vh;
  background: #fff;
}

.state-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 40px;
  text-align: center;
  color: #555;
}

.state-center h1 {
  font-size: 2rem;
  margin-bottom: 12px;
  color: #222;
}

.collection-content {
  max-width: 960px;
  margin: 0 auto;
  padding: 40px 32px 80px;
}

.breadcrumb {
  margin-bottom: 24px;
}

.breadcrumb-link {
  font-size: 0.9rem;
  color: inherit;
  opacity: 0.7;
  text-decoration: none;
  transition: opacity 0.15s;
}

.breadcrumb-link:hover {
  opacity: 1;
  text-decoration: underline;
}

.collection-title {
  font-size: 2.4rem;
  font-weight: 700;
  line-height: 1.2;
  margin: 0 0 36px;
  color: inherit;
}

.empty-state {
  color: #888;
  font-size: 1rem;
  padding: 40px 0;
}

/* Items grid */
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
  transition: box-shadow 0.15s, transform 0.15s;
}

.item-card:hover {
  box-shadow: 0 6px 24px rgba(0,0,0,0.1);
  transform: translateY(-2px);
}

.item-image-wrap {
  width: 100%;
  aspect-ratio: 4/3;
  overflow: hidden;
  background: rgba(0,0,0,0.04);
}

.item-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.item-image-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(0,0,0,0.2);
}

.item-body {
  padding: 14px 16px 18px;
}

.item-name {
  font-size: 1rem;
  font-weight: 600;
  color: inherit;
  margin-bottom: 6px;
}

.item-desc {
  font-size: 0.88rem;
  color: inherit;
  opacity: 0.7;
  line-height: 1.5;
  margin-bottom: 8px;
}

.item-price-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.item-price {
  font-size: 1rem;
  font-weight: 700;
  color: inherit;
}

.item-shipping {
  font-size: 0.8rem;
  color: inherit;
  opacity: 0.65;
}

@media (max-width: 600px) {
  .collection-content {
    padding: 28px 20px 60px;
  }

  .collection-title {
    font-size: 1.8rem;
  }

  .items-grid {
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
}

@media (max-width: 380px) {
  .items-grid {
    grid-template-columns: 1fr;
  }
}
</style>
