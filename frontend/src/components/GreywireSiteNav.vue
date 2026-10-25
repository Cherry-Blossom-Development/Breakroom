<script setup>
// The greywirestudio.com header, repeated on the community site so members
// can get back to the brand site. Keep the links in step with the website's
// nav (GreywireStudio-Website, every page's .site-header). The default slot
// adds items after Community, e.g. Sign in or Logout.
const SITE = 'https://greywirestudio.com/'
const links = [
  { label: 'Home', href: SITE, class: 'gw-home' },
  { label: 'Linework', href: SITE + 'linework.html' },
  { label: 'Flashover', href: SITE + 'flashover.html' },
  { label: 'Switchyard', href: SITE + 'switchyard.html' },
  { label: 'Ideas', href: SITE + 'ideas.html' },
  { label: 'Your Opinion', href: SITE + 'opinion.html' },
  { label: 'About', href: SITE + 'about.html' },
]
</script>

<template>
  <header class="gw-site-nav">
    <div class="gw-site-nav-inner">
      <a class="gw-brand" :href="SITE">
        <img src="/greywire/logo.svg" alt="" width="32" height="32" />
        <span class="gw-brand-name">Greywire <span>Studio</span></span>
      </a>
      <nav class="gw-links" aria-label="Greywire Studio">
        <a v-for="link in links" :key="link.label" :href="link.href" :class="link.class">{{ link.label }}</a>
        <RouterLink to="/" aria-current="page">Community</RouterLink>
        <slot />
      </nav>
    </div>
  </header>
</template>

<style scoped>
.gw-site-nav {
  background: rgba(20, 22, 25, 0.92);
  backdrop-filter: blur(6px);
  border-bottom: 1px solid #33383e;
  font-family: "Space Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 17px;
  line-height: 1.6;
}

.gw-site-nav-inner {
  max-width: 1080px;
  margin: 0 auto;
  padding: 14px 20px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 24px;
}

.gw-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #e8e6e1;
  text-decoration: none;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.gw-brand img {
  width: 32px;
  height: 32px;
}

.gw-brand-name span {
  font-weight: 400;
  color: #9ba0a6;
}

.gw-links {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 20px;
}

@media (max-width: 720px) {
  .gw-site-nav-inner {
    padding-left: 16px;
    padding-right: 16px;
  }
}

/* :deep so slotted links from the parent get the same look */
.gw-links :deep(a) {
  color: #9ba0a6;
  text-decoration: none;
  font-size: 0.95rem;
  padding: 4px 0;
  border-bottom: 2px solid transparent;
}

.gw-links :deep(a:hover) {
  color: #e8e6e1;
  background-color: transparent;
}

.gw-brand:hover {
  background-color: transparent;
}

.gw-links :deep(a[aria-current="page"]) {
  color: #e8e6e1;
  border-bottom-color: #d07a3e;
}

/* Sign in: copper marks it as the way in, as on the website */
.gw-links :deep(a.gw-signin) {
  color: #e9a46f;
}

.gw-links :deep(a.gw-signin:hover) {
  color: #e8e6e1;
}
</style>
