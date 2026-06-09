<template>
  <main class="domain-page page-container">

    <div class="page-header">
      <RouterLink to="/collections/storefront" class="back-link">← Storefront</RouterLink>
      <h1>Use Your Own Domain</h1>
      <p class="page-desc">
        Point a domain you own at your Prosaurus store so customers can find you at your own web address.
      </p>
    </div>

    <div class="content">

      <section class="explainer-card">
        <h2>How it works</h2>
        <p>
          Your store lives at a Prosaurus URL like:<br>
          <code class="url-example">https://www.prosaurus.com/store/<em>your-store</em></code>
        </p>
        <p>
          <strong>Domain forwarding</strong> tells browsers to redirect visitors from your custom domain
          (e.g. <code>www.myshop.com</code>) to that Prosaurus URL automatically.
          The redirect happens in milliseconds — visitors type your domain and land on your store.
        </p>
        <div class="notice">
          <strong>What visitors see:</strong> After the redirect, the browser address bar will show
          the Prosaurus URL. This is how simple domain forwarding works. If you need the URL bar to
          always show your custom domain, you would need your own web hosting configured as a reverse
          proxy — that's a more advanced setup not covered here.
        </div>
      </section>

      <section class="steps-card">
        <h2>Step-by-step setup</h2>
        <p class="steps-intro">
          These instructions apply to most domain registrars (GoDaddy, Namecheap, Squarespace Domains, etc.).
          The exact menu names may differ slightly between providers, but the concept is the same.
        </p>

        <ol class="steps-list">
          <li>
            <strong>Find your Prosaurus store URL</strong><br>
            Go to your
            <RouterLink to="/collections/storefront">Storefront settings</RouterLink>
            and copy your store URL — it looks like
            <code>https://www.prosaurus.com/store/your-store</code>.
          </li>
          <li>
            <strong>Log into your domain registrar</strong><br>
            Sign in to wherever you purchased your domain (GoDaddy, Namecheap, etc.).
          </li>
          <li>
            <strong>Find the forwarding settings</strong><br>
            Look for a section called <em>Domain Forwarding</em>, <em>URL Forwarding</em>,
            <em>URL Redirect</em>, or <em>Web Forwarding</em>. It's usually under the domain's
            DNS or settings panel.
          </li>
          <li>
            <strong>Create a forward rule</strong><br>
            <ul class="sub-list">
              <li><strong>From:</strong> your domain (e.g. <code>www.myshop.com</code> or <code>myshop.com</code>)</li>
              <li><strong>To:</strong> your full Prosaurus store URL</li>
              <li><strong>Type:</strong> 301 Permanent Redirect (preferred) or 302 Temporary</li>
            </ul>
            Set up a rule for both the <code>www</code> version and the bare domain if your registrar
            allows it.
          </li>
          <li>
            <strong>Wait for DNS propagation</strong><br>
            Changes can take a few minutes to up to 24 hours to take effect worldwide.
          </li>
          <li>
            <strong>Test it</strong><br>
            Open a browser and type your custom domain. You should be redirected to your Prosaurus store.
          </li>
          <li>
            <strong>Save it in your storefront settings</strong><br>
            Once it's working, go back to your
            <RouterLink to="/collections/storefront">Storefront settings</RouterLink>
            and enter your custom domain in the <em>Custom Domain</em> field so it's recorded on your account.
          </li>
        </ol>
      </section>

      <section class="registrar-links-card">
        <h2>Forwarding guides by registrar</h2>
        <p>Find the relevant help article for wherever your domain lives:</p>
        <ul class="registrar-list">
          <li>
            <strong>GoDaddy</strong> — search "forward domain GoDaddy" in their help center
          </li>
          <li>
            <strong>Namecheap</strong> — Dashboard → Domain List → Manage → Redirect Domain
          </li>
          <li>
            <strong>Squarespace Domains</strong> — Domains panel → DNS Settings → URL Redirects
          </li>
          <li>
            <strong>Google Domains / Squarespace</strong> — Website tab → Forwarding
          </li>
          <li>
            <strong>Cloudflare</strong> — DNS → Rules → Redirect Rules
          </li>
        </ul>
      </section>

    </div>

  </main>
</template>

<script setup>
import { RouterLink } from 'vue-router'
</script>

<style scoped>
.domain-page {
  max-width: 760px;
}

.page-header {
  margin-bottom: 32px;
}

.back-link {
  display: inline-block;
  color: var(--color-link);
  text-decoration: none;
  font-size: 0.88rem;
  margin-bottom: 10px;
}

.back-link:hover { text-decoration: underline; }

.page-header h1 {
  font-size: 1.8rem;
  color: var(--color-text);
  margin: 0 0 8px;
}

.page-desc {
  font-size: 0.95rem;
  color: var(--color-text-secondary);
  margin: 0;
  line-height: 1.5;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.explainer-card,
.steps-card,
.registrar-links-card {
  background: var(--color-background-card, #fff);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 24px 28px;
}

h2 {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-text);
  margin: 0 0 14px;
}

p {
  font-size: 0.93rem;
  color: var(--color-text-secondary);
  line-height: 1.6;
  margin: 0 0 12px;
}

p:last-child { margin-bottom: 0; }

.url-example {
  display: inline-block;
  background: var(--color-background-soft, #f5f5f5);
  border: 1px solid var(--color-border);
  border-radius: 5px;
  padding: 4px 10px;
  font-size: 0.88rem;
  font-family: monospace;
  color: var(--color-text);
  margin: 6px 0 12px;
}

code {
  background: var(--color-background-soft, #f5f5f5);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 0.88em;
  font-family: monospace;
  color: var(--color-text);
}

.notice {
  background: rgba(66, 133, 244, 0.07);
  border-left: 3px solid var(--color-link);
  border-radius: 0 6px 6px 0;
  padding: 12px 16px;
  font-size: 0.87rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin-top: 14px;
}

.steps-intro {
  margin-bottom: 18px;
}

.steps-list {
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 0;
}

.steps-list li {
  font-size: 0.93rem;
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.steps-list li strong {
  color: var(--color-text);
}

.sub-list {
  margin: 8px 0 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  list-style: disc;
}

.sub-list li {
  font-size: 0.9rem;
}

.registrar-list {
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 12px 0 0;
}

.registrar-list li {
  font-size: 0.93rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.registrar-list li strong {
  color: var(--color-text);
}

a {
  color: var(--color-link);
  text-decoration: none;
}

a:hover { text-decoration: underline; }
</style>
