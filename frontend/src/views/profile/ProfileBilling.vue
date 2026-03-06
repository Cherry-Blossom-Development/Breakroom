<template>
  <section class="billing-page">
    <h2>Billing</h2>

    <div class="billing-notice">
      <div class="notice-icon">🎉</div>
      <div class="notice-content">
        <h3>Everything is free — for now!</h3>
        <p>
          Currently, all features of Prosaurus are completely free because we're just starting out.
          We do plan to introduce a modest fee at some point, but honestly, it's hard to figure out
          what to charge when we don't have any users yet.
        </p>
        <p>
          Our hope is that the cost will be something very reasonable — maybe around <strong>$2/month</strong>?
          But that's still to be determined. We'll need to work through server costs, data transfer,
          and a few other factors before we can put a real number on it.
        </p>
        <p>
          What we can promise is that we'll give everyone plenty of notice well in advance before
          any pricing takes effect. No surprises.
        </p>
        <p class="sign-off">
          Thanks again for trying out Prosaurus — it really means a lot to us.
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.billing-page {
  max-width: 680px;
}

.billing-notice {
  display: flex;
  gap: 20px;
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-left: 4px solid var(--color-accent);
  border-radius: 10px;
  padding: 28px 24px;
  margin-top: 16px;
}

.notice-icon {
  font-size: 2rem;
  line-height: 1;
  flex-shrink: 0;
}

.notice-content h3 {
  margin: 0 0 16px;
  font-size: 1.15rem;
  color: var(--color-text);
}

.notice-content p {
  margin: 0 0 14px;
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.notice-content p:last-child {
  margin-bottom: 0;
}

.sign-off {
  padding-top: 8px;
  border-top: 1px solid var(--color-border);
  font-style: italic;
  color: var(--color-text-muted) !important;
}
</style>
