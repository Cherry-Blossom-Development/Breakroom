<template>
  <form @submit.prevent="handleSubmit">
    <span>Log In</span>
    <div>
      <label>Login/Handle: </label>
      <input type="text" required v-model="handle">
    </div>
    <div>
      <label>Password: </label>
      <input type="password" required v-model="password">
      <div v-if="passwordError" class="error">{{ passwordError }}</div>
    </div>
    <button type="submit">Login</button>
    <p class="signup-prompt">
      Don't have an account? <RouterLink to="/signup">Sign up</RouterLink>
    </p>
  </form>
</template>

<script>
import axios from 'axios'
import { useRouter } from 'vue-router'
import { user } from '@/stores/user.js'

export default {
  data() {
    return {
      handle: '',
      password: '',
      passwordError: ''
    }
  },
  setup() {
    const router = useRouter()
    return { router }
  },
  methods: {
    async handleSubmit() {
      try {
        await axios.post(`${import.meta.env.VITE_API_BASE_URL || ''}/api/auth/login`, {
          handle: this.handle,
          password: this.password
        }, {
          withCredentials: true
        })

        await user.fetchUser() // Fetch the username after login

        // If login succeeds, redirect to home
        this.router.push('/')
      } catch (err) {
        // Handle login failure
        this.passwordError = 'Invalid handle or password'
        console.error(err)
      }
    }
  }
}
</script>

<style scoped>
  form {
    max-width: 420px;
    margin: 30px auto;
    background: var(--color-background-card);
    text-align: left;
    padding: 40px;
    border-radius: 10px;
    box-shadow: var(--shadow-md);
  }
  label {
    color: var(--color-text-light);
    display: inline-block;
    margin: 25px 0 15px;
    font-size: 0.6em;
    text-transform: uppercase;
    letter-spacing: 1px;
    font-weight: bold;
  }
  input {
    display: block;
    padding: 10px 6px;
    width: 100%;
    box-sizing: border-box;
    border: none;
    border-bottom: 1px solid var(--color-border-medium);
    color: var(--color-text);
    background: var(--color-background-input);
  }
  button {
    display: block;
    padding: 12px 20px;
    width: 100%;
    box-sizing: border-box;
    border: none;
    border-radius: 6px;
    color: white;
    background: var(--color-accent);
    font-size: 1em;
    font-weight: bold;
    cursor: pointer;
    margin-top: 25px;
    transition: background-color 0.2s ease;
  }
  button:hover {
    background: var(--color-accent-hover, #0056b3);
  }
  button:active {
    transform: translateY(1px);
  }
  .error {
    color: var(--color-error);
    margin-top: 10px;
    font-size: 0.8em;
    font-weight: bold;
  }
  .signup-prompt {
    margin-top: 20px;
    text-align: center;
    color: var(--color-text-light);
    font-size: 0.9em;
  }
  .signup-prompt a {
    display: inline-block;
    padding: 10px 20px;
    margin-top: 8px;
    background: transparent;
    border: 2px solid var(--color-accent);
    border-radius: 6px;
    color: var(--color-accent);
    text-decoration: none;
    font-weight: bold;
    transition: background-color 0.2s ease, color 0.2s ease;
  }
  .signup-prompt a:hover {
    background: var(--color-accent);
    color: white;
  }
</style>