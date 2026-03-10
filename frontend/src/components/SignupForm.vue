<template>
  <form @submit.prevent="handleSubmit">
    <span>Sign Up</span>
    <div>
      <label>Login/Handle: </label>
      <input type="text" required v-model="handle">
    </div>
    <div>
      <label>First Name: </label>
      <input type="text" required v-model="first_name">
    </div>
    <div>
      <label>Last Name: </label>
      <input type="text" required v-model="last_name">
    </div>
    <div>
      <label>Email: </label>
      <input type="text" required v-model="email">
      <div v-if="emailError" class="error">{{ emailError }}</div>
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
    <div>
      <label>Password Again: </label>
      <div class="password-wrapper">
        <input :type="showPassword2 ? 'text' : 'password'" required v-model="password2">
        <button type="button" class="password-toggle" @click="showPassword2 = !showPassword2" tabindex="-1">
          <svg v-if="!showPassword2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        </button>
      </div>
      <div v-if="passwordError2" class="error">{{ passwordError2 }}</div>
    </div>
    <!-- Display error message if any -->
    <div v-if="errorMessage" class="error">{{ errorMessage }}</div>
    <button type="submit" :disabled="submitting || !isFormValid">{{ submitting ? 'Creating Account...' : 'Create User' }}</button>
  </form>
</template>

<script>
import axios from 'axios';
import { useRouter } from 'vue-router';
import { user } from '@/stores/user.js';

// Function to generate a random salt using the Web Crypto API
function generateSalt(length = 16) {
  const array = new Uint8Array(length); // Create an array of random bytes
  window.crypto.getRandomValues(array); // Fill the array with cryptographically strong random values
  return Array.from(array).map(byte => byte.toString(16).padStart(2, '0')).join(''); // Convert to hex string
}

// Function to hash a password with a salt using the Web Crypto API
function hashPasswordWithSalt(password, salt) {
  return new Promise((resolve, reject) => {
    const encoder = new TextEncoder();
    const passwordSalt = encoder.encode(password + salt); // Combine password and salt into one string

    // Hash the combined password and salt using SHA-256
    crypto.subtle.digest('SHA-256', passwordSalt).then(function(hashBuffer) {
      const hashArray = Array.from(new Uint8Array(hashBuffer)); // Convert buffer to array
      const hashHex = hashArray.map(byte => byte.toString(16).padStart(2, '0')).join(''); // Convert to hex string
      resolve(hashHex); // Resolve the promise with the hashed value
    }).catch(function(error) {
      reject(error); // Reject the promise if there's an error
    });
  });
}

const validateEmail = (email) => {
  return String(email)
    .toLowerCase()
    .match(
      /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|.(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
    );
};

export default {
  data() {
    return {
      handle: '',
      first_name: '',
      last_name: '',
      email: '',
      password: '',
      password2: '',
      passwordError: '',
      passwordError2: '',
      emailError: '',
      errorMessage: '',
      submitting: false,
      showPassword: false,
      showPassword2: false
    }
  },
  setup() {
    const router = useRouter();
    return { router };
  },
  computed: {
    isFormValid() {
      return (
        this.handle.trim().length > 0 &&
        this.first_name.trim().length > 0 &&
        this.last_name.trim().length > 0 &&
        validateEmail(this.email) &&
        this.password.length >= 5 &&
        this.password === this.password2
      );
    }
  },
  methods: {
    async handleSubmit() {
      let errorsExists = false;

      if (this.password.length < 5) {
        this.passwordError = 'Use a longer password dipshit!';
        errorsExists = true;
      } else {
        if (this.password !== this.password2) {
          this.passwordError = 'Passwords must match!';
          this.passwordError2 = 'For fucks sake...'
          errorsExists = true;
        } else {
          this.passwordError = '';
          this.passwordError2 = '';
        }
      }
  
      if (!validateEmail(this.email)) {
        this.emailError = 'Use a god damn email address';
        errorsExists = true;
      } else {
        this.emailError = '';
      }
    
      if (!errorsExists) {
        this.submitting = true;
        const salt = generateSalt();

        try {
          // Await the hash generation
          const hash = await hashPasswordWithSalt(this.password, salt);

          // Once the hash is ready, you can make the API call
          let result = await axios.post(`${import.meta.env.VITE_API_BASE_URL || ''}/api/auth/signup`, {
            handle: this.handle,
            first_name: this.first_name,
            last_name: this.last_name,
            email: this.email,
            hash: hash,
            salt: salt
          }, {
            withCredentials: true
          });

          // Fetch user to update nav with logged-in state
          await user.fetchUser();

          // Redirect to breakroom on success
          this.router.push('/breakroom');

        } catch (error) {
          // Check if the error response is a 409 Conflict
          if (error.response && error.response.status === 409) {
            this.errorMessage = 'The email or handle is already taken. Please choose another one.';
          } else {
            // Handle other errors (e.g., server errors, network issues)
            this.errorMessage = 'An unexpected error occurred. Please try again later.';
          }
        } finally {
          this.submitting = false;
        }

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
  .password-toggle:disabled {
    filter: none;
    opacity: 1;
    background: none;
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
    filter: opacity(0.4);
    cursor: not-allowed;
  }
  .error {
    color: var(--color-error);
    margin-top: 10px;
    font-size: 0.8em;
    font-weight: bold;
  }
</style>