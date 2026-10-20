<script setup>
// Front door of the Greywire community for signed-out visitors. Signed-in
// users never see it: the router sends members to Chat and everyone else to
// the claim page.
</script>

<template>
  <main class="gw-home">
    <section class="gw-hero">
      <p class="gw-kicker">Greywire Studio</p>
      <h1>The Greywire Community</h1>
      <p class="gw-lede">
        Chat, share recordings and practice with your band, alongside other Greywire players.
        Membership is free with every Greywire pedal.
      </p>
      <div class="gw-actions">
        <RouterLink to="/signup" class="gw-btn gw-btn-primary">Create an account</RouterLink>
        <RouterLink to="/login" class="gw-btn gw-btn-secondary">Sign in</RouterLink>
      </div>
    </section>

    <section class="gw-features">
      <div class="gw-feature">
        <h2>Chat</h2>
        <p>Rooms for talking tone, gear and gigs, plus direct messages with other players.</p>
      </div>
      <div class="gw-feature">
        <h2>Sessions</h2>
        <p>Upload your recordings, rate and comment on each other's takes, and keep shortlists of the best ones.</p>
      </div>
      <div class="gw-feature">
        <h2>Band practice</h2>
        <p>Set up your band, share practice recordings and setlists, and send public links to anyone.</p>
      </div>
    </section>

    <section class="gw-join">
      <h2>How to join</h2>
      <ol>
        <li>Create an account.</li>
        <li>Find your pedal's serial number: a 16-character code of digits and the letters A to F.</li>
        <li>Claim it here. Each pedal can be claimed once, and it gets you in for as long as you own it.</li>
      </ol>
      <p class="gw-note">
        Greywire pedals are still in development. Follow along at
        <a href="https://greywirestudio.com">greywirestudio.com</a>.
      </p>
    </section>
  </main>
</template>

<style scoped>
.gw-home {
  max-width: 960px;
  margin: 0 auto;
  padding: 48px 16px 64px;
  color: var(--color-text);
}

.gw-hero {
  text-align: center;
  padding: 32px 0 48px;
}

.gw-kicker {
  color: var(--color-link);
  text-transform: uppercase;
  letter-spacing: 0.15em;
  font-size: 0.8rem;
  margin: 0 0 12px;
}

.gw-hero h1 {
  font-size: clamp(2rem, 6vw, 3.2rem);
  font-weight: 700;
  line-height: 1.15;
  margin: 0 0 16px;
  color: var(--color-heading);
}

.gw-lede {
  max-width: 600px;
  margin: 0 auto 28px;
  font-size: 1.1rem;
  color: var(--color-text-secondary);
}

.gw-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}

.gw-btn {
  display: inline-block;
  padding: 12px 26px;
  border-radius: 8px;
  font-weight: 600;
  text-decoration: none;
}

.gw-btn-primary {
  background: var(--color-accent);
  color: #fff !important;
}

.gw-btn-primary:hover {
  background: var(--color-accent-hover);
}

.gw-btn-secondary {
  border: 1px solid var(--color-border-hover);
  color: var(--color-text) !important;
}

.gw-btn-secondary:hover {
  background: var(--color-background-hover);
}

.gw-features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
  margin-bottom: 40px;
}

.gw-feature {
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-top: 3px solid var(--color-accent);
  border-radius: 10px;
  padding: 20px;
}

.gw-feature h2 {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0 0 8px;
  color: var(--color-heading);
}

.gw-feature p {
  margin: 0;
  color: var(--color-text-secondary);
}

.gw-join {
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 24px;
}

.gw-join h2 {
  font-size: 1.2rem;
  font-weight: 600;
  margin: 0 0 12px;
  color: var(--color-heading);
}

.gw-join ol {
  margin: 0 0 16px;
  padding-left: 20px;
  color: var(--color-text-secondary);
}

.gw-join li {
  margin-bottom: 6px;
}

.gw-note {
  margin: 0;
  color: var(--color-text-light);
  font-size: 0.95rem;
}
</style>
