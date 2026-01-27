<script setup>
import { ref } from 'vue'

// Tool categories - will be expanded in the future
const categories = ref([
  {
    id: 'musician',
    name: 'Musician Tools',
    description: 'Tools for musicians, composers, and audio enthusiasts',
    icon: 'music',
    tools: [] // Coming soon
  },
  {
    id: 'artist',
    name: 'Artist Tools',
    description: 'Creative tools for visual artists and designers',
    icon: 'palette',
    tools: [] // Coming soon
  },
  {
    id: 'writer',
    name: 'Writer Tools',
    description: 'Utilities for writers, bloggers, and content creators',
    icon: 'pen',
    tools: [] // Coming soon
  },
  {
    id: 'developer',
    name: 'Developer Tools',
    description: 'Productivity tools for programmers and developers',
    icon: 'code',
    tools: [] // Coming soon
  }
])
</script>

<template>
  <div class="page-container tool-shed-page">
    <header class="page-header">
      <h1>Tool Shed</h1>
      <p class="subtitle">Your collection of productivity tools</p>
    </header>

    <section class="intro-section">
      <div class="intro-card">
        <h2>Welcome to the Tool Shed</h2>
        <p>
          The Tool Shed is where we're building a collection of helpful productivity tools
          that you can choose to use based on your interests and needs. Whether you're a
          musician, artist, writer, or developer, you'll find utilities here designed to
          make your creative and professional work easier.
        </p>
        <p class="note">
          Tools are completely optional - browse the categories below and enable only
          the ones that are useful to you. More tools will be added over time based on
          community feedback and requests.
        </p>
      </div>
    </section>

    <section class="categories-section">
      <h2>Tool Categories</h2>
      <div class="categories-grid">
        <div
          v-for="category in categories"
          :key="category.id"
          class="category-card"
        >
          <div class="category-icon">
            <span v-if="category.icon === 'music'">&#9835;</span>
            <span v-else-if="category.icon === 'palette'">&#127912;</span>
            <span v-else-if="category.icon === 'pen'">&#9998;</span>
            <span v-else-if="category.icon === 'code'">&lt;/&gt;</span>
          </div>
          <h3>{{ category.name }}</h3>
          <p>{{ category.description }}</p>
          <div class="tool-count">
            <span v-if="category.tools.length === 0" class="coming-soon">
              Coming Soon
            </span>
            <span v-else>
              {{ category.tools.length }} tool{{ category.tools.length !== 1 ? 's' : '' }} available
            </span>
          </div>
        </div>
      </div>
    </section>

    <section class="feedback-section">
      <div class="feedback-card">
        <h3>Have a Tool Suggestion?</h3>
        <p>
          We're always looking for ideas! If there's a productivity tool you'd like to
          see added to the Tool Shed, let us know through the Help Desk.
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tool-shed-page {
  max-width: 1000px;
}

.page-header {
  margin-bottom: 24px;
}

.page-header h1 {
  font-size: 2.2rem;
  font-weight: 700;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin: 0 0 8px;
}

.subtitle {
  color: var(--color-text-muted);
  margin: 0;
  font-size: 1.1rem;
}

/* Intro Section */
.intro-section {
  margin-bottom: 32px;
}

.intro-card {
  background: var(--color-background-card);
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-sm);
}

.intro-card h2 {
  margin: 0 0 16px;
  color: var(--color-text);
  font-size: 1.4rem;
}

.intro-card p {
  margin: 0 0 12px;
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.intro-card p:last-child {
  margin-bottom: 0;
}

.intro-card .note {
  color: var(--color-text-muted);
  font-size: 0.95rem;
  font-style: italic;
}

/* Categories Section */
.categories-section {
  margin-bottom: 32px;
}

.categories-section h2 {
  margin: 0 0 20px;
  color: var(--color-text);
  font-size: 1.3rem;
}

.categories-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 20px;
}

.category-card {
  background: var(--color-background-card);
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-sm);
  text-align: center;
  transition: transform 0.2s, box-shadow 0.2s;
}

.category-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.category-icon {
  font-size: 2.5rem;
  margin-bottom: 12px;
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.category-card h3 {
  margin: 0 0 8px;
  color: var(--color-text);
  font-size: 1.1rem;
}

.category-card p {
  margin: 0 0 16px;
  color: var(--color-text-muted);
  font-size: 0.9rem;
  line-height: 1.5;
}

.tool-count {
  font-size: 0.85rem;
}

.coming-soon {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 6px 12px;
  border-radius: 20px;
  font-weight: 500;
}

/* Feedback Section */
.feedback-section {
  margin-bottom: 24px;
}

.feedback-card {
  background: var(--color-background-soft);
  border-radius: 12px;
  padding: 20px 24px;
  border-left: 4px solid var(--color-accent);
}

.feedback-card h3 {
  margin: 0 0 8px;
  color: var(--color-text);
  font-size: 1.1rem;
}

.feedback-card p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 0.95rem;
  line-height: 1.5;
}

@media (max-width: 600px) {
  .categories-grid {
    grid-template-columns: 1fr;
  }
}
</style>
