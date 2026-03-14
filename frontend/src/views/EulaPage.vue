<template>
  <section class="eula-page page-container">

    <!-- Accept banner for logged-in users who haven't accepted yet -->
    <div v-if="showAcceptBanner" class="accept-banner">
      <div v-if="!accepted">
        <p>You must accept these terms to use Prosaurus.</p>
        <button class="accept-button" :disabled="accepting" @click="acceptTerms">
          {{ accepting ? 'Saving…' : 'Accept These Terms' }}
        </button>
      </div>
      <div v-else class="accepted-confirmation">
        Terms accepted. Thank you.
      </div>
    </div>
    <h1>End User License Agreement</h1>
    <p class="app-subtitle">Prosaurus — prosaurus.com</p>
    <p class="effective-date">Effective Date: March 14, 2026</p>

    <p class="intro">
      This End User License Agreement ("EULA" or "Agreement") is a legal agreement between you
      ("User," "you," or "your") and Cherry Blossom Development LLC ("Company," "we," "us," or "our"),
      governing your use of the Prosaurus platform and associated services (collectively, the "Service").
      By creating an account or using the Service in any way, you acknowledge that you have read,
      understood, and agree to be bound by this Agreement. If you do not agree, do not use the Service.
    </p>

    <div class="section">
      <h2>1. Acceptance and Eligibility</h2>
      <p>
        You must be at least <strong>18 years of age</strong> to use the Service. By using the Service,
        you represent and warrant that you meet this requirement. We reserve the right to terminate any
        account found to belong to a minor.
      </p>
      <p>
        Your use of the Service is also subject to our
        <RouterLink to="/privacy">Privacy Policy</RouterLink>, which is incorporated into this Agreement
        by reference.
      </p>
    </div>

    <div class="section">
      <h2>2. License Grant</h2>
      <p>
        Subject to your compliance with this Agreement, Cherry Blossom Development LLC grants you a
        limited, non-exclusive, non-transferable, revocable license to access and use the Service for
        your personal, non-commercial purposes. This license does not include the right to sublicense,
        sell, resell, transfer, assign, or otherwise exploit the Service or any of its content.
      </p>
    </div>

    <div class="section">
      <h2>3. Prohibited Content — Zero Tolerance Policy</h2>
      <p>
        We maintain a <strong>zero-tolerance policy</strong> for objectionable content. The following
        types of content are strictly prohibited and will result in immediate account termination
        without warning or refund:
      </p>
      <ul>
        <li>
          <strong>Sexually explicit or pornographic content</strong> of any kind, including nudity
          presented in a sexual context.
        </li>
        <li>
          <strong>Content that exploits, endangers, or sexualizes minors</strong> in any way.
          Such content will be reported to the National Center for Missing &amp; Exploited Children
          (NCMEC) and relevant law enforcement.
        </li>
        <li>
          <strong>Hate speech or discriminatory content</strong> targeting individuals or groups
          based on race, ethnicity, religion, gender, sexual orientation, disability, national origin,
          or any other protected characteristic.
        </li>
        <li>
          <strong>Content that promotes, glorifies, or incites violence</strong>, self-harm, terrorism,
          or illegal activity.
        </li>
        <li>
          <strong>Harassment, threats, or intimidation</strong> directed at any person or group.
        </li>
        <li>
          <strong>Spam, misinformation, or deliberately false content</strong> intended to deceive
          or mislead other users.
        </li>
        <li>
          <strong>Content that violates any applicable law</strong>, including copyright, defamation,
          privacy, or consumer protection laws.
        </li>
        <li>
          <strong>Malware, phishing links, or any content</strong> designed to compromise the security
          of other users or systems.
        </li>
      </ul>
      <p>
        We reserve the right — but not the obligation — to review, flag, remove, or decline to display
        any content at our sole discretion. Removal of content does not constitute a waiver of our right
        to terminate the associated account.
      </p>
    </div>

    <div class="section">
      <h2>4. Prohibited Conduct — Zero Tolerance for Abusive Users</h2>
      <p>
        We maintain a <strong>zero-tolerance policy</strong> for abusive behavior. The following conduct
        is strictly prohibited and will result in immediate and permanent account termination:
      </p>
      <ul>
        <li>
          <strong>Harassment or bullying</strong> of other users, including repeated unwanted contact,
          public humiliation, or coordinated attacks.
        </li>
        <li>
          <strong>Threatening or intimidating</strong> any user, employee, or person associated with
          the Service.
        </li>
        <li>
          <strong>Impersonating</strong> another person, company, or entity in a misleading or
          harmful way.
        </li>
        <li>
          <strong>Unauthorized access or hacking</strong> — attempting to access accounts, systems,
          or data that are not your own.
        </li>
        <li>
          <strong>Circumventing or undermining security measures</strong>, including sharing login
          credentials or attempting to bypass account verification.
        </li>
        <li>
          <strong>Deliberately disrupting the Service</strong>, including distributed denial-of-service
          attacks, flooding, or other technically abusive behavior.
        </li>
        <li>
          <strong>Creating multiple accounts to evade a ban</strong> or circumvent any restriction
          placed on your access.
        </li>
        <li>
          <strong>Collecting or scraping user data</strong> without authorization.
        </li>
      </ul>
      <p>
        Users who engage in any of the above conduct will be permanently banned. We cooperate fully
        with law enforcement when conduct may constitute a criminal offense.
      </p>
    </div>

    <div class="section">
      <h2>5. Content Ownership and Responsibility</h2>
      <p>
        You retain ownership of content you create and post on the Service. By posting content, you
        grant Cherry Blossom Development LLC a worldwide, royalty-free, non-exclusive license to
        host, store, transmit, display, and distribute that content solely for the purpose of
        operating and improving the Service.
      </p>
      <p>
        You are solely responsible for all content you post. We do not endorse any user-submitted
        content and expressly disclaim all liability arising from it. If your content violates this
        Agreement, we will remove it and may terminate your account.
      </p>
    </div>

    <div class="section">
      <h2>6. Reporting Violations</h2>
      <p>
        If you encounter content or behavior that violates this Agreement, please report it immediately.
        We take all reports seriously and investigate promptly. You can reach us at:
      </p>
      <address>
        <a href="mailto:abuse@cherryblossomdevelopment.com">abuse@cherryblossomdevelopment.com</a>
      </address>
      <p>
        Reports submitted in good faith will be treated confidentially. We do not tolerate retaliation
        against users who report violations.
      </p>
    </div>

    <div class="section">
      <h2>7. Enforcement and Account Termination</h2>
      <p>
        Cherry Blossom Development LLC reserves the right to suspend or permanently terminate any account,
        at any time and without prior notice, for any violation of this Agreement or for any conduct we
        determine to be harmful to users, the Service, or the Company — at our sole discretion.
      </p>
      <p>
        Upon termination:
      </p>
      <ul>
        <li>Your license to use the Service is immediately revoked.</li>
        <li>Access to your account and all associated content will be disabled.</li>
        <li>Active subscription fees are non-refundable in cases of policy violation.</li>
        <li>We may retain records of your account and activity as required by law or for abuse prevention.</li>
      </ul>
      <p>
        Termination of your account does not limit any other remedies available to the Company,
        including legal action.
      </p>
    </div>

    <div class="section">
      <h2>8. Disclaimer of Warranties</h2>
      <p>
        The Service is provided "as is" and "as available," without warranties of any kind, express or
        implied. To the fullest extent permitted by law, Cherry Blossom Development LLC disclaims all
        warranties, including but not limited to merchantability, fitness for a particular purpose,
        and non-infringement. We do not warrant that the Service will be uninterrupted, error-free,
        or free of viruses or other harmful components.
      </p>
    </div>

    <div class="section">
      <h2>9. Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by applicable law, Cherry Blossom Development LLC and its
        officers, directors, employees, and agents shall not be liable for any indirect, incidental,
        special, consequential, or punitive damages arising out of or related to your use of the
        Service, even if advised of the possibility of such damages. Our total aggregate liability
        to you for any claims arising under this Agreement shall not exceed the amount you paid us
        in the twelve (12) months preceding the claim.
      </p>
    </div>

    <div class="section">
      <h2>10. Governing Law</h2>
      <p>
        This Agreement is governed by and construed in accordance with the laws of the State of
        Washington, United States, without regard to its conflict-of-law provisions. Any disputes
        arising under this Agreement shall be resolved exclusively in the state or federal courts
        located in Spokane County, Washington, and you consent to personal jurisdiction in those courts.
      </p>
    </div>

    <div class="section">
      <h2>11. Changes to This Agreement</h2>
      <p>
        We may update this EULA at any time. When we make material changes, we will update the
        effective date at the top of this page. Your continued use of the Service after any changes
        constitutes your acceptance of the updated Agreement. We encourage you to review this page
        periodically.
      </p>
    </div>

    <div class="section">
      <h2>12. Contact Us</h2>
      <p>
        If you have questions or concerns about this Agreement, please contact us:
      </p>
      <address>
        <strong>Cherry Blossom Development LLC</strong><br />
        Spokane, Washington<br />
        United States<br />
        <a href="mailto:legal@cherryblossomdevelopment.com">legal@cherryblossomdevelopment.com</a>
      </address>
    </div>
  </section>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { user } from '@/stores/user.js'
import { notificationStore } from '@/stores/notification.js'

const showAcceptBanner = ref(false)
const accepted = ref(false)
const accepting = ref(false)
const notificationId = ref(null)

onMounted(async () => {
  if (!user.username) return
  try {
    const res = await fetch('/api/eula/status', { credentials: 'include' })
    if (!res.ok) return
    const data = await res.json()
    accepted.value = data.accepted
    notificationId.value = data.notificationId
    showAcceptBanner.value = true
  } catch (err) {
    console.error('Failed to fetch EULA status:', err)
  }
})

async function acceptTerms() {
  if (!notificationId.value) return
  accepting.value = true
  try {
    await notificationStore.dismissNotification(notificationId.value)
    accepted.value = true
  } catch (err) {
    console.error('Failed to accept EULA:', err)
  } finally {
    accepting.value = false
  }
}
</script>

<style scoped>
.accept-banner {
  background: var(--color-background-soft, rgba(0,0,0,0.04));
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 1.25rem 1.5rem;
  margin-bottom: 2rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.accept-banner p {
  margin: 0;
  color: var(--color-text);
  font-weight: 500;
}

.accept-button {
  background: var(--color-link);
  color: #fff;
  border: none;
  padding: 0.6rem 1.5rem;
  font-size: 1rem;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.2s;
}

.accept-button:hover:not(:disabled) {
  opacity: 0.85;
}

.accept-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.accepted-confirmation {
  color: var(--color-link);
  font-weight: 600;
  font-size: 1rem;
}

.eula-page {
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

.section a {
  color: var(--color-link);
  text-decoration: none;
}

.section a:hover {
  text-decoration: underline;
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
