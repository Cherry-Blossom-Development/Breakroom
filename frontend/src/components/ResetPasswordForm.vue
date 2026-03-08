<template>
  <form @submit.prevent="handleSubmit">
    <div class="login-logo-wrap">
      <img src="/logo-192x192-no-text.png" alt="Prosaurus" class="login-logo" />
    </div>
    <span>Reset Password</span>

    <div v-if="tokenInvalid" class="error-block">
      <p>This reset link is invalid or has expired.</p>
      <RouterLink to="/forgot-password">Request a new reset link</RouterLink>
    </div>

    <template v-else-if="!successMessage">
      <div>
        <label>New Password: </label>
        <input type="password" required v-model="password" :disabled="submitting">
      </div>
      <div>
        <label>Confirm New Password: </label>
        <input type="password" required v-model="password2" :disabled="submitting">
      </div>
      <div v-if="errorMessage" class="error">{{ errorMessage }}</div>
      <button type="submit" :disabled="submitting">
        {{ submitting ? 'Resetting...' : 'Reset Password' }}
      </button>
    </template>

    <div v-if="successMessage" class="success">
      <p>{{ successMessage }}</p>
    </div>

    <p class="back-prompt">
      <RouterLink to="/login">Back to Login</RouterLink>
    </p>
  </form>
</template>

<script>
import axios from 'axios'
import { useRoute } from 'vue-router'

function generateSalt(length = 16) {
  const array = new Uint8Array(length)
  window.crypto.getRandomValues(array)
  return Array.from(array).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function hashPasswordWithSalt(password, salt) {
  return new Promise((resolve, reject) => {
    const encoder = new TextEncoder()
    const passwordSalt = encoder.encode(password + salt)
    crypto.subtle.digest('SHA-256', passwordSalt).then(function(hashBuffer) {
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      const hashHex = hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('')
      resolve(hashHex)
    }).catch(reject)
  })
}

export default {
  data() {
    return {
      password: '',
      password2: '',
      token: '',
      submitting: false,
      tokenInvalid: false,
      errorMessage: '',
      successMessage: ''
    }
  },
  setup() {
    const route = useRoute()
    return { route }
  },
  mounted() {
    this.token = this.route.query.token || ''
    if (!this.token) {
      this.tokenInvalid = true
    }
  },
  methods: {
    async handleSubmit() {
      this.errorMessage = ''

      if (this.password.length < 5) {
        this.errorMessage = 'Password must be at least 5 characters.'
        return
      }
      if (this.password !== this.password2) {
        this.errorMessage = 'Passwords do not match.'
        return
      }

      this.submitting = true
      try {
        const salt = generateSalt()
        const hash = await hashPasswordWithSalt(this.password, salt)

        await axios.post(`${import.meta.env.VITE_API_BASE_URL || ''}/api/auth/reset-password`, {
          token: this.token,
          password: this.password,
          salt,
          hash
        })

        this.successMessage = 'Your password has been reset. You can now log in with your new password.'
      } catch (err) {
        if (err.response && err.response.status === 400) {
          this.tokenInvalid = true
        } else {
          this.errorMessage = 'Something went wrong. Please try again.'
        }
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
  .error-block {
    margin-top: 16px;
    color: var(--color-error);
    font-size: 0.9em;
  }
  .error-block a {
    color: var(--color-accent);
    text-decoration: underline;
  }
  .success {
    margin-top: 16px;
    color: var(--color-success, #28a745);
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
