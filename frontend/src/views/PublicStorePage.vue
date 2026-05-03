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
            <div v-if="storefront.collections && storefront.collections.length" class="collections-grid">
              <RouterLink
                v-for="col in storefront.collections"
                :key="col.id"
                :to="`/store/${route.params.storeUrl}/c/${col.id}`"
                class="collection-card"
                :style="{ backgroundColor: col.settings?.background_color || '#f5f5f5' }"
              >
                <span class="collection-name">{{ col.name }}</span>
                <span class="collection-arrow">→</span>
              </RouterLink>
            </div>
            <p v-else class="collections-empty">No collections yet.</p>
          </div>

        </template>
      </template>
    </main>

  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

const route = useRoute()
const loading = ref(true)
const notFound = ref(false)
const storefront = ref(null)

const pageStyle = computed(() => {
  const bg = storefront.value?.settings?.background_color
  return bg ? { backgroundColor: bg } : {}
})

async function fetchStore() {
  loading.value = true
  try {
    const res = await fetch(`/api/storefront/public/${route.params.storeUrl}`)
    if (res.status === 404) {
      notFound.value = true
    } else if (res.ok) {
      storefront.value = await res.json()
      if (storefront.value?.page_title) {
        document.title = storefront.value.page_title
      }
    }
  } catch (err) {
    notFound.value = true
  } finally {
    loading.value = false
  }
}

onMounted(fetchStore)
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

.store-content {
  max-width: 820px;
  margin: 0 auto;
  padding: 60px 32px 80px;
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
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}

.collection-card {
  border-radius: 10px;
  padding: 28px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 100px;
  text-decoration: none;
  color: inherit;
  transition: filter 0.15s, box-shadow 0.15s;
  cursor: pointer;
}

.collection-card:hover {
  filter: brightness(0.95);
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
}

.collection-name {
  font-size: 1rem;
  font-weight: 600;
  color: inherit;
}

.collection-arrow {
  font-size: 1.1rem;
  opacity: 0.6;
  flex-shrink: 0;
}

.collections-empty {
  color: #888;
  font-size: 0.95rem;
}

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
}
</style>
