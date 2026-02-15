<template>
  <section class="home-page">
    <div class="hero">
      <img src="/logo-512x512-no-text.png" alt="Prosaurus" class="hero-logo" />
      <h1>Welcome to Prosaurus</h1>
      <p class="tagline">A creative platform for connecting, writing, making music, and building software — without the noise.</p>
      <RouterLink to="/signup" class="cta-button">Join Prosaurus</RouterLink>
    </div>

    <div class="features">
      <div class="feature">
        <h2>🧑‍🤝‍🧑 Real Connections</h2>
        <p>Everything you see is from people you know — no influencers, no algorithms.</p>
      </div>
      <div class="feature">
        <h2>🚫 No Ads</h2>
        <p>We'll never sell your attention. No promoted posts, ever.</p>
      </div>
      <div class="feature">
        <h2>🤖 No AI-Generated Junk</h2>
        <p>Only human-made posts. No synthetic content. Just real thoughts and updates.</p>
      </div>
      <div class="feature">
        <h2>✍️ For Writers</h2>
        <p>Tools for the writing process — from drafting to sharing your work.</p>
      </div>
      <div class="feature">
        <h2>🎵 For Musicians</h2>
        <p>A space for music creation — compose, collaborate, and share.</p>
      </div>
      <div class="feature">
        <h2>💻 For Developers</h2>
        <p>Utilities for building software — lightweight tools that stay out of your way.</p>
      </div>
    </div>

    <div class="closing">
      <h2>🌐 For Everyone</h2>
      <p>Social, creative, and technical — all in one place. Prosaurus brings it all together so you don't have to jump between a dozen apps.</p>
    </div>
  </section>
</template>

<script setup>
// No logic needed yet
</script>

<style>
.home-page {
  padding: 60px 20px;
  max-width: 900px;
  margin: 0 auto;
  text-align: center;
}

.hero {
  margin-bottom: 40px;
}

.hero-logo {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  margin-bottom: 20px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.hero h1 {
  font-size: 2.5rem;
  margin-bottom: 10px;
  color: var(--color-text);
}

.tagline {
  font-size: 1.2rem;
  color: var(--color-text-muted);
  margin-bottom: 20px;
}

.cta-button {
  background-color: var(--color-link);
  color: white;
  padding: 12px 24px;
  text-decoration: none;
  border-radius: 6px;
  font-weight: bold;
  transition: opacity 0.2s;
}

.cta-button:hover {
  opacity: 0.9;
}

.features {
  display: grid;
  gap: 30px;
  grid-template-columns: 1fr;
}

.feature h2 {
  font-size: 1.4rem;
  color: var(--color-text);
  margin-bottom: 10px;
}

.feature p {
  color: var(--color-text-muted);
}

.closing {
  margin-top: 40px;
}

.closing h2 {
  font-size: 1.4rem;
  color: var(--color-text);
  margin-bottom: 10px;
}

.closing p {
  color: var(--color-text-muted);
  max-width: 500px;
  margin: 0 auto;
}

@media (min-width: 768px) {
  .features {
    grid-template-columns: repeat(3, 1fr);
    text-align: left;
  }

  .feature {
    padding: 0 20px;
  }
}
</style>
