<template>
  <section class="billing-page">
    <h2>Billing &amp; Plans</h2>
    <p class="intro">
      Prosaurus offers two tiers. Most features are completely free — Pro is only needed
      if you want to sell artwork without a platform fee, or need extra session storage.
    </p>

    <div class="tiers">
      <!-- Free Tier -->
      <div class="tier-card">
        <div class="tier-header">
          <span class="tier-badge free">Free</span>
          <div class="tier-price">$0 <span class="per">/&nbsp;month</span></div>
        </div>
        <ul class="feature-list">
          <li><span class="check">✓</span> Chat &amp; messaging</li>
          <li><span class="check">✓</span> Breakroom dashboard</li>
          <li><span class="check">✓</span> Blog</li>
          <li><span class="check">✓</span> Collections &amp; storefront</li>
          <li><span class="check">✓</span> Gallery</li>
          <li><span class="check">✓</span> Friends &amp; social</li>
          <li><span class="check">✓</span> Company profiles</li>
          <li><span class="check">✓</span> Bands &amp; instruments</li>
          <li><span class="check">✓</span> Projects</li>
          <li><span class="check">✓</span> Lyrics</li>
          <li><span class="check">✓</span> Sessions (standard storage)</li>
          <li><span class="check">✓</span> Help desk access</li>
          <li class="divider-item"></li>
          <li><span class="x">✗</span> Art sales incur a 5% Prosaurus fee<br>
              <span class="sub-note">on top of standard Stripe processing fees</span></li>
        </ul>
      </div>

      <!-- Pro Tier -->
      <div class="tier-card pro">
        <div class="tier-header">
          <span class="tier-badge pro">Pro</span>
          <div class="tier-price">$3.99 <span class="per">/&nbsp;month</span></div>
        </div>
        <ul class="feature-list">
          <li><span class="check">✓</span> Everything in Free</li>
          <li class="divider-item"></li>
          <li><span class="check pro-check">✓</span> <strong>No Prosaurus platform fee</strong> on art sales</li>
          <li><span class="check pro-check">✓</span> <strong>Extra storage</strong> on Sessions</li>
        </ul>
        <div class="pro-cta">
          <router-link to="/collections/payment-setup" class="upgrade-btn">Manage subscription</router-link>
        </div>
      </div>
    </div>

    <!-- Art Sales Fee Breakdown -->
    <div class="fee-section">
      <h3>How art sale fees work</h3>
      <p>
        When a buyer purchases artwork through your storefront, payment is processed by
        <strong>Stripe</strong>. Stripe always charges their standard processing fee —
        this is not a Prosaurus fee and cannot be waived.
      </p>

      <div class="fee-examples">
        <div class="fee-example">
          <div class="example-label">Free tier — $10 sale</div>
          <div class="fee-row">
            <span>Stripe processing</span>
            <span class="fee-amt">−$0.59 <span class="fee-note">(2.9% + $0.30)</span></span>
          </div>
          <div class="fee-row">
            <span>Prosaurus platform fee</span>
            <span class="fee-amt negative">−$0.50 <span class="fee-note">(5%)</span></span>
          </div>
          <div class="fee-row total">
            <span>You receive</span>
            <span class="fee-amt">$8.91</span>
          </div>
        </div>

        <div class="fee-example pro-example">
          <div class="example-label">Pro tier — $10 sale</div>
          <div class="fee-row">
            <span>Stripe processing</span>
            <span class="fee-amt">−$0.59 <span class="fee-note">(2.9% + $0.30)</span></span>
          </div>
          <div class="fee-row">
            <span>Prosaurus platform fee</span>
            <span class="fee-amt waived">waived</span>
          </div>
          <div class="fee-row total">
            <span>You receive</span>
            <span class="fee-amt">$9.41</span>
          </div>
        </div>
      </div>

      <p class="fee-note-bottom">
        At roughly 5 sales per month averaging $10, Pro pays for itself. At higher volumes or
        higher prices, the savings are significantly larger.
      </p>
    </div>
  </section>
</template>

<style scoped>
.billing-page {
  max-width: 760px;
}

.intro {
  color: var(--color-text-secondary);
  line-height: 1.7;
  margin: 0 0 28px;
}

/* ── Tier cards ── */
.tiers {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 36px;
}

@media (max-width: 580px) {
  .tiers { grid-template-columns: 1fr; }
}

.tier-card {
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tier-card.pro {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 1px var(--color-accent);
}

.tier-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tier-badge {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 3px 10px;
  border-radius: 20px;
}

.tier-badge.free {
  background: var(--color-background-soft);
  color: var(--color-text-secondary);
}

.tier-badge.pro {
  background: var(--color-accent);
  color: #fff;
}

.tier-price {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--color-text);
}

.tier-price .per {
  font-size: 0.85rem;
  font-weight: 400;
  color: var(--color-text-secondary);
}

.feature-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  font-size: 0.9rem;
  color: var(--color-text-secondary);
}

.feature-list li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  line-height: 1.4;
}

.divider-item {
  border-top: 1px solid var(--color-border);
  padding-top: 4px;
}

.check {
  color: #4caf50;
  font-size: 0.95rem;
  flex-shrink: 0;
  margin-top: 1px;
}

.pro-check {
  color: var(--color-accent);
}

.x {
  color: #e57373;
  flex-shrink: 0;
  margin-top: 1px;
}

.sub-note {
  font-size: 0.8rem;
  display: block;
  margin-top: 2px;
  color: var(--color-text-muted);
}

.pro-cta {
  margin-top: auto;
  padding-top: 16px;
}

.upgrade-btn {
  display: block;
  text-align: center;
  background: var(--color-accent);
  color: #fff;
  padding: 10px 0;
  border-radius: 8px;
  text-decoration: none;
  font-size: 0.9rem;
  font-weight: 600;
  transition: opacity 0.15s;
}

.upgrade-btn:hover {
  opacity: 0.85;
}

/* ── Fee breakdown ── */
.fee-section {
  background: var(--color-background-card);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 24px;
}

.fee-section h3 {
  margin: 0 0 12px;
  font-size: 1.05rem;
  color: var(--color-text);
}

.fee-section > p {
  color: var(--color-text-secondary);
  line-height: 1.7;
  margin: 0 0 20px;
  font-size: 0.9rem;
}

.fee-examples {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 20px;
}

@media (max-width: 480px) {
  .fee-examples { grid-template-columns: 1fr; }
}

.fee-example {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px;
}

.fee-example.pro-example {
  border-color: var(--color-accent);
}

.example-label {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  margin-bottom: 12px;
}

.fee-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 0.88rem;
  color: var(--color-text-secondary);
  padding: 4px 0;
  gap: 8px;
}

.fee-row.total {
  border-top: 1px solid var(--color-border);
  margin-top: 6px;
  padding-top: 8px;
  font-weight: 700;
  color: var(--color-text);
}

.fee-amt {
  white-space: nowrap;
  flex-shrink: 0;
}

.fee-amt .fee-note {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  font-weight: 400;
}

.fee-amt.negative {
  color: #e57373;
}

.fee-amt.waived {
  color: #4caf50;
  font-style: italic;
}

.fee-note-bottom {
  font-size: 0.85rem;
  color: var(--color-text-muted);
  line-height: 1.6;
  margin: 0;
  font-style: italic;
}
</style>
