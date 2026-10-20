import { reactive } from 'vue'
import { sessions } from './sessions'

const state = reactive({
  username: null,
  timezone: null,
  isGuest: false,
  greywireMember: false,
})

export const user = reactive({
  get username() {
    return state.username
  },
  get timezone() {
    return state.timezone
  },
  get isGuest() {
    return state.isGuest
  },
  // Holds a claimed Greywire pedal or a hand grant (backend/utilities/greywire.js)
  get greywireMember() {
    return state.greywireMember
  },
  async fetchUser() {
    try {
      const res = await fetch('/api/auth/me', {
        credentials: 'include'
      });

      if (!res.ok) throw new Error('Not logged in');

      const data = await res.json();
      state.username = data.username;
      state.timezone = data.timezone ?? null;
      state.isGuest = data.isGuest ?? false;
      state.greywireMember = data.greywireMember ?? false;

      // Auto-detect and save timezone on first login (when DB value is null)
      if (!state.timezone) {
        const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
        try {
          await fetch('/api/profile/timezone', {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timezone: detected })
          });
          state.timezone = detected;
        } catch {
          // Non-critical — proceed without saved timezone
        }
      }
    } catch (err) {
      console.log(err);
      state.username = null;
      state.timezone = null;
      state.isGuest = false;
      state.greywireMember = false;
    }
  },

  async logout() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (err) {
      console.error('Logout failed:', err);
    }
    sessions.reset();
    state.username = null;
    state.timezone = null;
    state.isGuest = false;
    state.greywireMember = false;
  }
});
