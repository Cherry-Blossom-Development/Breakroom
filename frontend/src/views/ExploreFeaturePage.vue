<script setup>
import { computed, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { user } from '@/stores/user.js'
import { exploreFeatures } from '@/data/exploreFeatures.js'

const route = useRoute()
const router = useRouter()

const feature = computed(() => exploreFeatures[route.params.featureKey])

// Unknown feature key -- bounce back to the hub rather than showing a dead page.
watchEffect(() => {
  if (route.params.featureKey && !feature.value) {
    router.replace('/explore')
  }
})
</script>

<template>
  <section v-if="feature" class="explore-feature page-container">
    <RouterLink to="/explore" class="back-link">← Explore Prosaurus</RouterLink>

    <div class="hero">
      <span class="feature-icon">{{ feature.icon }}</span>
      <h1>
        {{ feature.label }}
        <span v-if="feature.monetized" class="pro-badge">Pro</span>
      </h1>
      <p class="tagline">{{ feature.tagline }}</p>
    </div>

    <p class="description">{{ feature.description }}</p>

    <ul class="highlights">
      <li v-for="h in feature.highlights" :key="h">
        <span class="check">✓</span> {{ h }}
      </li>
    </ul>

    <div class="cta-row">
      <RouterLink v-if="user.username" :to="feature.ctaRoute" class="cta-button">
        Go to {{ feature.label }}
      </RouterLink>
      <RouterLink v-else to="/signup" class="cta-button">
        Sign up to try {{ feature.label }}
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.explore-feature {
  max-width: 700px;
  margin: 50px auto;
  padding: 0 20px 60px;
  color: var(--color-text);
  line-height: 1.6;
}

.back-link {
  display: inline-block;
  color: var(--color-link);
  text-decoration: none;
  font-size: 0.9rem;
  margin-bottom: 24px;
}

.back-link:hover {
  text-decoration: underline;
}

.hero {
  text-align: center;
  margin-bottom: 28px;
}

.feature-icon {
  font-size: 3rem;
  display: block;
  margin-bottom: 8px;
}

.hero h1 {
  font-size: 2.2rem;
  margin: 0 0 8px;
  color: var(--color-text);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.pro-badge {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 3px 10px;
  border-radius: 20px;
  background: rgba(107, 70, 193, 0.12);
  color: #6b46c1;
  vertical-align: middle;
}

.tagline {
  font-size: 1.15rem;
  color: var(--color-text-secondary);
  margin: 0;
}

.description {
  font-size: 1.02rem;
  color: var(--color-text-secondary);
  margin: 0 0 24px;
}

.highlights {
  list-style: none;
  margin: 0 0 36px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.highlights li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  color: var(--color-text-secondary);
}

.check {
  color: #4caf50;
  flex-shrink: 0;
  font-weight: 700;
}

.cta-row {
  text-align: center;
}

.cta-button {
  display: inline-block;
  background-color: var(--color-link);
  color: white;
  padding: 14px 28px;
  font-weight: 600;
  border-radius: 7px;
  text-decoration: none;
  transition: opacity 0.2s;
}

.cta-button:hover {
  opacity: 0.9;
}
</style>
