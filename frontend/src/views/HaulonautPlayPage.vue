<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
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

function onKeydown(e) {
  if (e.key === 'Escape') backToGames()
}

onMounted(() => {
  loadCharacter()
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="crt-fullscreen">
    <div v-if="loading" class="crt-status">Loading...</div>
    <div v-else-if="error" class="crt-status">
      <p>{{ error }}</p>
      <button class="exit-link" @click="backToGames">Back to Games</button>
    </div>

    <div v-else class="crt-monitor">
      <div class="crt-bezel">
        <div class="crt-brand" aria-hidden="true">PROSAURUS <span class="crt-brand-model">MODEL H-88</span></div>

        <div class="crt-screen-frame">
          <div class="crt-screen">
            <div class="crt-scanlines" aria-hidden="true"></div>
            <div class="crt-glow" aria-hidden="true"></div>
            <div class="crt-content">
              <p class="terminal-line">&gt;&gt;&gt; DOCKING CONFIRMED<span class="terminal-cursor" aria-hidden="true">_</span></p>
              <h1 class="terminal-name">{{ character.display_name }}</h1>
              <p class="terminal-line">Status: <span class="status-active">{{ character.status }}</span></p>
              <p class="terminal-message">Your ship is fueled and ready. The universe awaits — gameplay coming soon.</p>
            </div>
          </div>
        </div>

        <div class="crt-controls">
          <span class="crt-led" aria-hidden="true"></span>
          <span class="crt-knob" aria-hidden="true"></span>
          <span class="crt-knob" aria-hidden="true"></span>
          <button class="crt-exit-btn" @click="backToGames">&#9211; EXIT</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.crt-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(ellipse at center, #2a2a2e 0%, #101012 70%, #050506 100%);
  padding: 20px;
  box-sizing: border-box;
}

.crt-status {
  color: #cfcfd4;
  text-align: center;
  font-family: 'Courier New', Courier, monospace;
}

.exit-link {
  margin-top: 14px;
  background: none;
  border: 1px solid #8f8f96;
  color: #cfcfd4;
  border-radius: 4px;
  padding: 8px 16px;
  font-family: inherit;
  cursor: pointer;
}

.exit-link:hover { background: rgba(255, 255, 255, 0.08); }

/* ---- Monitor ---- */
.crt-monitor {
  width: min(90vw, calc(88vh * 4 / 3));
  max-width: 1100px;
  aspect-ratio: 4 / 3;
}

.crt-bezel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: linear-gradient(160deg, #d8cdb8 0%, #c3b79f 45%, #a89b82 100%);
  border-radius: 22px;
  padding: 22px 28px 16px;
  box-sizing: border-box;
  box-shadow:
    0 30px 60px rgba(0, 0, 0, 0.55),
    inset 0 2px 3px rgba(255, 255, 255, 0.4),
    inset 0 -6px 10px rgba(0, 0, 0, 0.25);
}

.crt-brand {
  flex-shrink: 0;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #6b6153;
  margin-bottom: 10px;
}

.crt-brand-model {
  font-weight: 400;
  color: #8a8071;
}

/* ---- Screen ---- */
.crt-screen-frame {
  flex: 1;
  min-height: 0;
  background: #1a1712;
  border-radius: 14px;
  padding: 3%;
  box-sizing: border-box;
  box-shadow:
    inset 0 0 0 2px #0c0a08,
    inset 0 10px 30px rgba(0, 0, 0, 0.8);
}

.crt-screen {
  position: relative;
  height: 100%;
  background: radial-gradient(ellipse at center, #06170c 0%, #030b06 80%, #020602 100%);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: inset 0 0 40px rgba(0, 0, 0, 0.9);
}

.crt-scanlines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0) 0px,
    rgba(0, 0, 0, 0) 2px,
    rgba(0, 0, 0, 0.25) 3px
  );
}

.crt-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at center, rgba(77, 255, 136, 0.08) 0%, rgba(0, 0, 0, 0) 65%);
}

.crt-content {
  position: relative;
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
  padding: clamp(14px, 4%, 40px);
  color: #4dff88;
  font-family: 'Courier New', Courier, monospace;
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
  font-size: clamp(1.3rem, 4vw, 2rem);
  letter-spacing: 0.05em;
  text-shadow: 0 0 8px rgba(77, 255, 136, 0.6);
}

.status-active {
  color: #2fd66e;
  font-weight: 700;
  text-transform: capitalize;
}

.terminal-message {
  margin: 14px 0 0;
  color: #8fe6ab;
  line-height: 1.6;
}

/* ---- Controls ---- */
.crt-controls {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 14px;
}

.crt-led {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #4dff88;
  box-shadow: 0 0 6px 2px rgba(77, 255, 136, 0.8);
}

.crt-knob {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: linear-gradient(160deg, #efe6d4, #a89b82);
  box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.6), inset 0 -1px 2px rgba(0, 0, 0, 0.3);
}

.crt-exit-btn {
  margin-left: auto;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  background: linear-gradient(160deg, #efe6d4, #a89b82);
  color: #4a4335;
  border: none;
  border-radius: 4px;
  padding: 6px 12px;
  cursor: pointer;
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.6), 0 2px 3px rgba(0, 0, 0, 0.3);
}

.crt-exit-btn:hover {
  background: linear-gradient(160deg, #f7f0e2, #b3a58b);
}

.crt-exit-btn:focus-visible {
  outline: 2px solid #05130a;
  outline-offset: 2px;
}

/* Narrow viewports: let the bezel shrink further rather than clip */
@media (max-width: 480px), (max-height: 480px) {
  .crt-fullscreen { padding: 8px; }
  .crt-bezel { padding: 14px 16px 10px; border-radius: 14px; }
  .crt-brand { font-size: 0.6rem; }
}
</style>
