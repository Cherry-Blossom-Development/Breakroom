<template>
  <main v-if="loading" class="cdh-status">Loading…</main>
  <main v-else-if="notFound" class="cdh-status">
    <h1>Domain not connected</h1>
    <p>This domain isn't connected to a Prosaurus page yet.</p>
  </main>
  <PublicStorePage v-else-if="contentType === 'storefront'" :resolved-store-url="slug" />
  <PublicBandPage v-else-if="contentType === 'band_page'" :resolved-band-url="slug" />
</template>

<script setup>
import { ref, onMounted } from 'vue'
import PublicStorePage from './PublicStorePage.vue'
import PublicBandPage from './PublicBandPage.vue'

const loading = ref(true)
const notFound = ref(false)
const contentType = ref(null)
const slug = ref(null)

onMounted(async () => {
  try {
    const res = await fetch(`/api/custom-domains/public/by-domain/${window.location.hostname}`)
    if (!res.ok) {
      notFound.value = true
      return
    }
    const data = await res.json()
    contentType.value = data.content_type
    slug.value = data.content_type === 'band_page' ? data.band_url : data.store_url
  } catch {
    notFound.value = true
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.cdh-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  text-align: center;
  color: var(--color-text-secondary);
  padding: 24px;
}
</style>
