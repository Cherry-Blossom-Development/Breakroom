<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const error = ref('')
const character = ref(null)

async function loadCharacter() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch(`/api/games/haulonaut/characters/${route.params.characterId}`, { credentials: 'include' })
    if (!res.ok) throw new Error(res.status === 404 ? 'Character not found' : 'Failed to load')
    const data = await res.json()
    character.value = data.character
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

function backToGames() {
  router.push('/games')
}

onMounted(loadCharacter)
</script>

<template>
  <div class="page-container play-page">
    <div v-if="loading" class="loading">Loading...</div>
    <div v-else-if="error" class="error-message">
      <p>{{ error }}</p>
      <button class="back-btn" @click="backToGames">Back to Games</button>
    </div>

    <div v-else class="haulonaut-terminal">
      <div class="terminal-scanlines" aria-hidden="true"></div>
      <p class="terminal-line">&gt;&gt;&gt; DOCKING CONFIRMED<span class="terminal-cursor" aria-hidden="true">_</span></p>
      <h1 class="terminal-name">{{ character.display_name }}</h1>
      <p class="terminal-line">Status: <span class="status-active">{{ character.status }}</span></p>
      <p class="terminal-message">Your ship is fueled and ready. The universe awaits — gameplay coming soon.</p>
      <button class="back-btn" @click="backToGames">&larr; Back to Games</button>
    </div>
  </div>
</template>

<style scoped>
.play-page {
  max-width: 700px;
}

.loading,
.error-message {
  color: var(--color-text-muted);
  padding: 40px 0;
  text-align: center;
}

.haulonaut-terminal {
  position: relative;
  background: #05130a;
  color: #4dff88;
  border: 2px solid #1f8a4c;
  border-radius: 6px;
  padding: 28px 24px;
  font-family: 'Courier New', Courier, monospace;
  overflow: hidden;
  box-shadow: 0 0 24px rgba(77, 255, 136, 0.15);
}

.terminal-scanlines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0) 0px,
    rgba(0, 0, 0, 0) 2px,
    rgba(0, 0, 0, 0.15) 3px
  );
}

.terminal-line {
  margin: 0 0 10px;
  color: #baffcf;
}

.terminal-cursor {
  animation: terminal-blink 1s step-end infinite;
}

@media (prefers-reduced-motion: reduce) {
  .terminal-cursor { animation: none; }
}

@keyframes terminal-blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}

.terminal-name {
  margin: 0 0 14px;
  font-size: 2rem;
  letter-spacing: 0.05em;
  text-shadow: 0 0 8px rgba(77, 255, 136, 0.6);
}

.status-active {
  color: #2fd66e;
  font-weight: 700;
  text-transform: capitalize;
}

.terminal-message {
  margin: 14px 0 22px;
  color: #8fe6ab;
  line-height: 1.6;
}

.back-btn {
  background: none;
  border: 1px solid #4dff88;
  color: #baffcf;
  border-radius: 4px;
  padding: 8px 16px;
  font-family: inherit;
  cursor: pointer;
}

.back-btn:hover {
  background: #0d3a1e;
}
</style>
