<template>
  <section class="child-safety-page page-container">
    <h1>Child Safety Standards</h1>
    <p class="app-subtitle">Prosaurus — Cherry Blossom Development LLC</p>
    <p class="effective-date">Effective Date: February 28, 2026</p>

    <p class="intro">
      Cherry Blossom Development LLC is committed to the safety and protection of children.
      We have a zero-tolerance policy toward child sexual abuse and exploitation (CSAE) of any
      kind on the Prosaurus platform. This page describes our standards, enforcement practices,
      and how to report violations.
    </p>

    <div class="section">
      <h2>1. Age Requirement</h2>
      <p>
        The Prosaurus platform is intended exclusively for users who are <strong>18 years of age
        or older</strong>. Users are required to confirm they meet this age requirement at
        registration. We do not knowingly permit minors to create accounts or use our services.
        If we discover that a user is under 18, we will immediately suspend and permanently
        delete that account.
      </p>
    </div>

    <div class="section">
      <h2>2. Zero Tolerance for CSAE Content</h2>
      <p>
        We maintain an absolute zero-tolerance policy for child sexual abuse material (CSAM) and
        any content that sexually exploits, endangers, or harms minors. Prohibited content and
        behavior includes, but is not limited to:
      </p>
      <ul>
        <li>Any imagery, video, text, or other content that sexually depicts or exploits minors.</li>
        <li>Grooming behavior — attempting to build inappropriate relationships with minors for the purpose of exploitation.</li>
        <li>Solicitation of minors for sexual purposes.</li>
        <li>Sharing, distributing, or linking to CSAM in any form.</li>
        <li>Any content that normalizes, glorifies, or promotes the sexual abuse of children.</li>
      </ul>
      <p>
        Violations of this policy will result in immediate and permanent account termination and
        will be reported to the appropriate authorities, including the National Center for Missing
        and Exploited Children (NCMEC) and law enforcement as required by law.
      </p>
    </div>

    <div class="section">
      <h2>3. Reporting Violations</h2>
      <p>
        If you encounter any content or behavior on the Prosaurus platform that you believe
        violates this child safety policy, please report it immediately using one of the
        following methods:
      </p>
      <ul>
        <li>
          <strong>In-App Reporting:</strong> Use the report function available on user profiles,
          posts, and chat messages to flag content for immediate review.
        </li>
        <li>
          <strong>Email:</strong> Send a detailed report to
          <a href="mailto:safety@cherryblossomdevelopment.com">safety@cherryblossomdevelopment.com</a>.
          Include as much detail as possible, such as usernames, content descriptions, and timestamps.
        </li>
        <li>
          <strong>NCMEC CyberTipline:</strong> You may also report directly to the National Center
          for Missing and Exploited Children at
          <a href="https://www.missingkids.org/gethelpnow/cybertipline" target="_blank" rel="noopener">
            www.missingkids.org/gethelpnow/cybertipline
          </a>.
        </li>
      </ul>
      <p>
        All reports are treated with urgency and confidentiality. We review every report and take
        immediate action where violations are confirmed.
      </p>
    </div>

    <div class="section">
      <h2>4. Enforcement and Response</h2>
      <p>When a potential CSAE violation is identified, we take the following steps:</p>
      <ul>
        <li><strong>Immediate removal</strong> of the reported content pending review.</li>
        <li><strong>Account suspension</strong> of the user(s) involved while the report is investigated.</li>
        <li><strong>Permanent termination</strong> of accounts found to have violated this policy.</li>
        <li><strong>Mandatory reporting</strong> to NCMEC and cooperation with law enforcement as required under 18 U.S.C. § 2258A.</li>
        <li><strong>Preservation of evidence</strong> to assist law enforcement investigations.</li>
      </ul>
    </div>

    <div class="section">
      <h2>5. Prevention Measures</h2>
      <p>We take proactive steps to prevent the exploitation of children on our platform:</p>
      <ul>
        <li>Age verification at registration — all users must confirm they are 18 or older.</li>
        <li>User reporting tools available on all user-generated content.</li>
        <li>Regular review of flagged content by our team.</li>
        <li>Cooperation with platform safety initiatives and law enforcement agencies.</li>
      </ul>
    </div>

    <div class="section">
      <h2>6. Contact Information</h2>
      <p>
        For child safety concerns, reports, or questions about this policy, please contact us directly:
      </p>
      <address>
        <strong>Cherry Blossom Development LLC</strong><br />
        Spokane, Washington, United States<br />
        <strong>Child Safety Email:</strong>
        <a href="mailto:safety@cherryblossomdevelopment.com">safety@cherryblossomdevelopment.com</a><br />
        <strong>General Contact:</strong>
        <a href="mailto:privacy@cherryblossomdevelopment.com">privacy@cherryblossomdevelopment.com</a>
      </address>
    </div>
  </section>
</template>

<script setup>
// No additional logic needed
</script>

<style scoped>
.child-safety-page {
  max-width: 760px;
  margin: 50px auto;
  padding: 0 20px 60px;
  font-family: system-ui, sans-serif;
  color: var(--color-text);
  line-height: 1.7;
}

h1 {
  font-size: 2.2rem;
  margin-bottom: 0.2em;
  text-align: center;
  color: var(--color-link);
}

.app-subtitle {
  text-align: center;
  font-size: 1.1rem;
  color: var(--color-text-secondary);
  margin: 0 0 0.25rem;
}

.effective-date {
  text-align: center;
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  margin: 0 0 2rem;
}

.intro {
  font-size: 1rem;
  color: var(--color-text-secondary);
  margin-bottom: 2rem;
  padding: 1rem 1.25rem;
  border-left: 3px solid var(--color-accent, var(--color-link));
  background: var(--color-background-soft, rgba(0,0,0,0.03));
  border-radius: 0 6px 6px 0;
}

.section {
  margin-top: 2.2rem;
}

.section h2 {
  font-size: 1.35rem;
  color: var(--color-text);
  margin-bottom: 0.6rem;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid var(--color-border);
}

.section p {
  color: var(--color-text-secondary);
  margin: 0.5rem 0;
}

.section ul {
  color: var(--color-text-secondary);
  padding-left: 1.5rem;
  margin: 0.5rem 0;
}

.section ul li {
  margin-bottom: 0.45rem;
}

address {
  font-style: normal;
  line-height: 1.9;
  color: var(--color-text-secondary);
  margin-top: 0.75rem;
}

address a {
  color: var(--color-link);
  text-decoration: none;
}

address a:hover {
  text-decoration: underline;
}
</style>
