<template>
  <div class="verify-container">
    <div class="verify-card">
      <!-- Loading State -->
      <div v-if="isLoading" class="verify-content">
        <LoadingSpinner size="large" class="verify-spinner" />
        <h2>Verifying Your Email</h2>
        <p class="subtitle">Please wait a moment...</p>
      </div>

      <!-- Success State -->
      <div v-else-if="message" class="verify-content">
        <div class="icon-circle success">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <h2>Email Verified!</h2>
        <p class="subtitle">Your email address has been successfully verified.</p>
        <p class="message">You now have full access to all Prosaurus features.</p>
        <router-link to="/breakroom" class="btn-primary">Go to Breakroom</router-link>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="verify-content">
        <div class="icon-circle error">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </div>
        <h2>Verification Failed</h2>
        <p class="subtitle">We couldn't verify your email address.</p>
        <p class="error-message">{{ error }}</p>
        <button v-if="token && !resending" @click="resendVerification" class="btn-secondary">Resend Verification Email</button>
        <button v-else-if="resending" class="btn-secondary" disabled>Sending...</button>
        <router-link v-else to="/signup" class="btn-secondary">Back to Signup</router-link>
      </div>

      <!-- Resend Success State -->
      <div v-else-if="resendSuccess" class="verify-content">
        <div class="icon-circle success">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <h2>Email Sent!</h2>
        <p class="subtitle">A new verification email has been sent.</p>
        <p class="message">Please check your inbox and click the verification link.</p>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios';
import LoadingSpinner from './LoadingSpinner.vue';

export default {
  components: { LoadingSpinner },
  data() {
    return {
      isLoading: true,
      message: '',
      error: '',
      token: '',
      resending: false,
      resendSuccess: false,
    };
  },
  created() {
    const urlParams = new URLSearchParams(window.location.search);
    this.token = urlParams.get('token') || '';

    if (this.token) {
      this.verifyEmail(this.token);
    } else {
      this.isLoading = false;
      this.error = 'No verification token provided.';
    }
  },
  methods: {
    async verifyEmail(token) {
      try {
        let result = await axios.post(`${import.meta.env.VITE_API_BASE_URL || ''}/api/auth/verify`, {
          token: token
        });
        this.message = result.data.message;
      } catch (err) {
        if (err.response && err.response.data && err.response.data.message) {
          this.error = err.response.data.message;
        } else {
          this.error = 'The verification link may have expired or is invalid.';
        }
      } finally {
        this.isLoading = false;
      }
    },
    async resendVerification() {
      this.resending = true;
      try {
        await axios.post(`${import.meta.env.VITE_API_BASE_URL || ''}/api/auth/resend-verification`, {
          token: this.token
        });
        this.error = '';
        this.resendSuccess = true;
      } catch (err) {
        if (err.response && err.response.data && err.response.data.message) {
          this.error = err.response.data.message;
        } else {
          this.error = 'Unable to resend verification email. Please try again.';
        }
      } finally {
        this.resending = false;
      }
    },
  },
};
</script>

<style scoped>
.verify-container {
  min-height: 80vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.verify-card {
  max-width: 480px;
  width: 100%;
  background: var(--color-background-card);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.verify-content {
  padding: 60px 40px;
  text-align: center;
}

.icon-circle {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 24px;
}

.icon-circle svg {
  width: 40px;
  height: 40px;
}

.icon-circle.success {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.icon-circle.error {
  background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%);
  color: white;
}

h2 {
  margin: 0 0 12px;
  font-size: 28px;
  font-weight: 600;
  color: var(--color-text);
}

.subtitle {
  font-size: 16px;
  color: var(--color-text-muted);
  margin: 0 0 20px;
}

.message {
  font-size: 15px;
  color: var(--color-text-light);
  margin: 0 0 32px;
}

.error-message {
  font-size: 14px;
  color: var(--color-error);
  background: var(--color-error-bg);
  padding: 12px 16px;
  border-radius: 8px;
  margin: 0 0 32px;
}

.btn-primary {
  display: inline-block;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  text-decoration: none;
  padding: 14px 32px;
  border-radius: 50px;
  font-size: 16px;
  font-weight: 600;
  transition: transform 0.2s, box-shadow 0.2s;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
}

.btn-secondary {
  display: inline-block;
  background: var(--color-button-secondary);
  color: var(--color-text-muted);
  text-decoration: none;
  padding: 14px 32px;
  border-radius: 50px;
  font-size: 16px;
  font-weight: 600;
  transition: background 0.2s;
  border: none;
  cursor: pointer;
}

.btn-secondary:hover {
  background: var(--color-button-secondary-hover);
}

.btn-secondary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.verify-spinner {
  margin: 0 auto 24px;
}
</style>