<script setup>
import { useRouter } from 'vue-router'

const router = useRouter()

const goToChat = () => {
  router.push('/chat')
}
</script>

<template>
  <main class="welcome page-container">
    <h1>Welcome to Breakroom</h1>
    <p>
      There's going to be a lot of stuff here someday, but for now let's just
      get you going to the chat section because that's the main part of Breakroom.
    </p>
    <button @click="goToChat">Go to Chat</button>
  </main>
</template>

<style scoped>
.welcome {
  max-width: 600px;
  margin: 60px auto;
  background: var(--color-background-card);
  text-align: center;
  padding: 40px;
  border-radius: 10px;
  box-shadow: var(--shadow-md);
}

h1 {
  color: var(--color-text);
  margin-bottom: 20px;
}

p {
  color: var(--color-text-muted);
  line-height: 1.6;
  margin-bottom: 30px;
}

button {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 5px;
  font-size: 1em;
  cursor: pointer;
}

button:hover {
  background: var(--color-accent-hover);
}
</style>
