<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { authFetch } from '@/utilities/authFetch'

const router = useRouter()
const addingShortcut = ref(null)
const shortcutAdded = ref({})

// Tool categories
const categories = ref([
  {
    id: 'musician',
    name: 'Musician Tools',
    description: 'Tools for musicians, composers, and audio enthusiasts',
    icon: 'music',
    tools: [
      {
        id: 'lyric-lab',
        name: 'Lyric Lab',
        description: 'Capture lyric ideas, organize them into songs, and collaborate with other songwriters.',
        route: '/lyrics',
        shortcutName: 'Lyric Lab'
      }
    ]
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

function openTool(tool) {
  router.push(tool.route)
}

async function addToShortcuts(tool) {
  addingShortcut.value = tool.id
  try {
    const res = await authFetch('/api/shortcuts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: tool.shortcutName,
        url: tool.route
      })
    })

    if (res.ok) {
      shortcutAdded.value[tool.id] = true
    }
  } catch (err) {
    console.error('Failed to add shortcut:', err)
  } finally {
    addingShortcut.value = null
  }
}

async function checkShortcuts() {
  // Check which tools already have shortcuts
  for (const category of categories.value) {
    for (const tool of category.tools) {
      try {
        const res = await authFetch(`/api/shortcuts/check?url=${encodeURIComponent(tool.route)}`)
        if (res.ok) {
          const data = await res.json()
          if (data.exists) {
            shortcutAdded.value[tool.id] = true
          }
        }
      } catch (err) {
        // Ignore errors
      }
    }
  }
}

// Check shortcuts on mount
checkShortcuts()
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
      <div class="categories-list">
        <div
          v-for="category in categories"
          :key="category.id"
          class="category-block"
        >
          <div class="category-header">
            <div class="category-icon">
              <span v-if="category.icon === 'music'">&#9835;</span>
              <span v-else-if="category.icon === 'palette'">&#127912;</span>
              <span v-else-if="category.icon === 'pen'">&#9998;</span>
              <span v-else-if="category.icon === 'code'">&lt;/&gt;</span>
            </div>
            <div class="category-info">
              <h3>{{ category.name }}</h3>
              <p>{{ category.description }}</p>
            </div>
          </div>

          <!-- Tools in this category -->
          <div v-if="category.tools.length > 0" class="tools-list">
            <div
              v-for="tool in category.tools"
              :key="tool.id"
              class="tool-card"
            >
              <div class="tool-info" @click="openTool(tool)">
                <h4>{{ tool.name }}</h4>
                <p>{{ tool.description }}</p>
              </div>
              <div class="tool-actions">
                <button
                  v-if="!shortcutAdded[tool.id]"
                  class="btn-shortcut"
                  :disabled="addingShortcut === tool.id"
                  @click.stop="addToShortcuts(tool)"
                >
                  {{ addingShortcut === tool.id ? 'Adding...' : '+ Add to Shortcuts' }}
                </button>
                <span v-else class="shortcut-added">Added to shortcuts</span>
                <button class="btn-open" @click="openTool(tool)">
                  Open &rarr;
                </button>
              </div>
            </div>
          </div>

          <!-- No tools yet -->
          <div v-else class="no-tools">
            <span class="coming-soon">Coming Soon</span>
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

.categories-list {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.category-block {
  background: var(--color-background-card);
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-sm);
}

.category-header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 20px;
}

.category-icon {
  font-size: 2rem;
  width: 50px;
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-background-soft);
  border-radius: 10px;
  flex-shrink: 0;
}

.category-info h3 {
  margin: 0 0 4px;
  color: var(--color-text);
  font-size: 1.2rem;
}

.category-info p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.tools-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tool-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  background: var(--color-background-soft);
  border-radius: 8px;
  transition: background 0.2s;
}

.tool-card:hover {
  background: var(--color-background-hover);
}

.tool-info {
  flex: 1;
  cursor: pointer;
}

.tool-info h4 {
  margin: 0 0 4px;
  color: var(--color-text);
  font-size: 1.05rem;
}

.tool-info p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  line-height: 1.4;
}

.tool-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-left: 20px;
  flex-shrink: 0;
}

.btn-shortcut {
  padding: 8px 14px;
  background: var(--color-button-secondary);
  border: none;
  border-radius: 6px;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 0.85rem;
  transition: background 0.2s;
}

.btn-shortcut:hover:not(:disabled) {
  background: var(--color-button-secondary-hover);
}

.btn-shortcut:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.shortcut-added {
  font-size: 0.85rem;
  color: var(--color-success);
  padding: 8px 14px;
}

.btn-open {
  padding: 8px 16px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  border-radius: 6px;
  color: white;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: transform 0.15s, box-shadow 0.15s;
}

.btn-open:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.no-tools {
  padding: 20px;
  text-align: center;
}

.coming-soon {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 6px 14px;
  border-radius: 20px;
  font-weight: 500;
  font-size: 0.85rem;
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
  .tool-card {
    flex-direction: column;
    align-items: flex-start;
    gap: 15px;
  }

  .tool-actions {
    margin-left: 0;
    width: 100%;
  }

  .tool-actions button,
  .tool-actions span {
    flex: 1;
    text-align: center;
  }

  .category-header {
    flex-direction: column;
    text-align: center;
  }

  .category-icon {
    margin: 0 auto;
  }
}
</style>
