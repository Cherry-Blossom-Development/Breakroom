<template>
  <form @submit.prevent="handleSubmit">
    <div class="login-logo-wrap">
      <img src="/logo-192x192-no-text.png" alt="Prosaurus" class="login-logo" />
    </div>
    <span>Log In</span>
    <div>
      <label>Login/Handle: </label>
      <input type="text" required v-model="handle">
    </div>
    <div>
      <label>Password: </label>
      <div class="password-wrapper">
        <input :type="showPassword ? 'text' : 'password'" required v-model="password">
        <button type="button" class="password-toggle" @click="showPassword = !showPassword" tabindex="-1">
          <svg v-if="!showPassword" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        </button>
      </div>
      <div v-if="passwordError" class="error">{{ passwordError }}</div>
    </div>
    <button type="submit" :disabled="submitting">{{ submitting ? 'Logging in...' : 'Login' }}</button>
    <p class="forgot-prompt">
      <RouterLink to="/forgot-password">Forgot your password?</RouterLink>
    </p>
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
      passwordError: '',
      submitting: false,
      showPassword: false
    }
  },
  setup() {
    const router = useRouter()
    return { router }
  },
  methods: {
    async handleSubmit() {
      this.submitting = true
      this.passwordError = ''
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
      } finally {
        this.submitting = false
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
  .login-logo-wrap {
    text-align: center;
    margin-bottom: 10px;
  }
  .login-logo {
    width: 64px;
    height: 64px;
    border-radius: 50%;
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
  .password-wrapper {
    position: relative;
  }
  .password-wrapper input {
    padding-right: 36px;
  }
  .password-toggle {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    color: var(--color-text-light);
    margin-top: 0;
    width: auto;
    font-size: inherit;
    font-weight: inherit;
    border-radius: 0;
    transition: none;
  }
  .password-toggle:hover {
    background: none;
    color: var(--color-text);
  }
  .password-toggle:active {
    transform: translateY(-50%);
  }
  .password-toggle svg {
    width: 18px;
    height: 18px;
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
  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .error {
    color: var(--color-error);
    margin-top: 10px;
    font-size: 0.8em;
    font-weight: bold;
  }
  .forgot-prompt {
    margin-top: 12px;
    text-align: center;
    font-size: 0.85em;
  }
  .forgot-prompt a {
    color: var(--color-text-light);
    text-decoration: underline;
  }
  .forgot-prompt a:hover {
    color: var(--color-accent);
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