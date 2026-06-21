import { reactive } from 'vue'
import { sessions } from './sessions'

const state = reactive({
  username: null,
  timezone: null,
})

export const user = reactive({
  get username() {
    return state.username
  },
  get timezone() {
    return state.timezone
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
  }
});
