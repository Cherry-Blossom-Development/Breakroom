<template>
  <div>
    <slot v-if="data" :data="data" />
    <p v-else-if="loading" class="loading"><LoadingSpinner size="small" /> Loading...</p>
    <p v-else-if="error">Error: {{ error }}</p>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import axios from 'axios'
import LoadingSpinner from './LoadingSpinner.vue'

const props = defineProps({
  endpoint: {
    type: String,
    required: true
  }
})

const data = ref(null)
const error = ref(null)
const loading = ref(true)

onMounted(async () => {
  try {
    const res = await axios.get(props.endpoint)
    data.value = res.data
  } catch (e) {
    error.value = e.message || 'Failed to load data'
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
</style>
