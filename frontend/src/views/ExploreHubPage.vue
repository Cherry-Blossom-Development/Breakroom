<script setup>
import { exploreFeatures, exploreCategories } from '@/data/exploreFeatures.js'
</script>

<template>
  <section class="explore-hub page-container">
    <div class="hero">
      <h1>Explore Prosaurus</h1>
      <p class="tagline">A look at what you can actually do here — before you sign up for anything.</p>
      <RouterLink to="/signup" class="cta-button">Join Prosaurus</RouterLink>
    </div>

    <div class="categories">
      <div v-for="cat in exploreCategories" :key="cat.label" class="category">
        <h2>{{ cat.label }}</h2>
        <p class="category-desc">{{ cat.description }}</p>
        <div class="feature-cards">
          <RouterLink
            v-for="key in cat.features"
            :key="key"
            :to="`/explore/${key}`"
            class="feature-card"
          >
            <span class="feature-icon">{{ exploreFeatures[key].icon }}</span>
            <span class="feature-name">
              {{ exploreFeatures[key].label }}
              <span v-if="exploreFeatures[key].monetized" class="pro-badge">Pro</span>
            </span>
            <span class="feature-tagline">{{ exploreFeatures[key].tagline }}</span>
          </RouterLink>
        </div>
      </div>
    </div>

    <div class="closing">
      <h2>Ready to try it yourself?</h2>
      <RouterLink to="/signup" class="cta-button">Join Prosaurus</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.explore-hub {
  padding: 60px 20px;
  max-width: 1000px;
  margin: 0 auto;
}

.hero {
  text-align: center;
  margin-bottom: 50px;
}

.hero h1 {
  font-size: 2.4rem;
  margin-bottom: 10px;
  color: var(--color-text);
}

.tagline {
  font-size: 1.15rem;
  color: var(--color-text-muted);
  margin-bottom: 20px;
}

.cta-button {
  display: inline-block;
  background-color: var(--color-link);
  color: white;
  padding: 12px 24px;
  text-decoration: none;
  border-radius: 6px;
  font-weight: bold;
  transition: opacity 0.2s;
}

.cta-button:hover {
  opacity: 0.9;
}

.categories {
  display: flex;
  flex-direction: column;
  gap: 40px;
}

.category h2 {
  font-size: 1.4rem;
  color: var(--color-text);
  margin: 0 0 4px;
}

.category-desc {
  color: var(--color-text-muted);
  margin: 0 0 18px;
}

.feature-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.feature-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 18px;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s, transform 0.15s;
}

.feature-card:hover {
  border-color: var(--color-link);
  transform: translateY(-2px);
}

.feature-icon {
  font-size: 1.8rem;
}

.feature-name {
  font-weight: 700;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 8px;
}

.pro-badge {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 20px;
  background: rgba(107, 70, 193, 0.12);
  color: #6b46c1;
}

.feature-tagline {
  font-size: 0.88rem;
  color: var(--color-text-muted);
}

.closing {
  text-align: center;
  margin-top: 60px;
  padding-top: 40px;
  border-top: 1px solid var(--color-border);
}

.closing h2 {
  font-size: 1.4rem;
  color: var(--color-text);
  margin-bottom: 20px;
}
</style>
