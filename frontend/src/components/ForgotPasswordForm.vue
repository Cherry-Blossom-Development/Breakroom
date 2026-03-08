<template>
  <form @submit.prevent="handleSubmit">
    <div class="login-logo-wrap">
      <img src="/logo-192x192-no-text.png" alt="Prosaurus" class="login-logo" />
    </div>
    <span>Forgot Password</span>
    <p class="description">Enter your email address and we'll send you a link to reset your password.</p>
    <div>
      <label>Email Address: </label>
      <input type="email" required v-model="email" :disabled="submitted">
    </div>
    <div v-if="errorMessage" class="error">{{ errorMessage }}</div>
    <div v-if="successMessage" class="success">{{ successMessage }}</div>
    <button type="submit" :disabled="submitting || submitted">
      {{ submitting ? 'Sending...' : 'Send Reset Link' }}
    </button>
    <p class="back-prompt">
      <RouterLink to="/login">Back to Login</RouterLink>
    </p>
  </form>
</template>

<script>
import axios from 'axios'

export default {
  data() {
    return {
      email: '',
      submitting: false,
      submitted: false,
      errorMessage: '',
      successMessage: ''
    }
  },
  methods: {
    async handleSubmit() {
      this.submitting = true
      this.errorMessage = ''
      this.successMessage = ''
      try {
        await axios.post(`${import.meta.env.VITE_API_BASE_URL || ''}/api/auth/forgot-password`, {
          email: this.email
        })
        this.successMessage = 'If that email is registered, a reset link has been sent. Please check your inbox.'
        this.submitted = true
      } catch (err) {
        this.errorMessage = 'Something went wrong. Please try again.'
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
  .description {
    color: var(--color-text-light);
    font-size: 0.9em;
    margin-top: 10px;
    margin-bottom: 0;
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
  .success {
    color: var(--color-success, #28a745);
    margin-top: 10px;
    font-size: 0.9em;
    font-weight: bold;
  }
  .back-prompt {
    margin-top: 20px;
    text-align: center;
    color: var(--color-text-light);
    font-size: 0.9em;
  }
  .back-prompt a {
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
  .back-prompt a:hover {
    background: var(--color-accent);
    color: white;
  }
</style>
