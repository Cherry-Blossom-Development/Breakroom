<template>
  <section>
    <h1>System Emails</h1>

    <!-- Email List -->
    <div class="email-list">
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Site</th>
            <th>Subject</th>
            <th>From</th>
            <th>Description</th>
            <th>Active</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="email in emails" :key="email.id">
            <td><code>{{ email.email_key }}</code></td>
            <td>{{ SITE_NAMES[email.site] || email.site }}</td>
            <td>{{ email.subject }}</td>
            <td>{{ email.from_address }}</td>
            <td>{{ email.description || '-' }}</td>
            <td>{{ email.is_active ? 'Yes' : 'No' }}</td>
            <td>
              <button @click="openConfigureModal(email)">Configure</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Configure Modal -->
    <div v-if="showConfigureModal" class="modal-overlay" @click.self="closeConfigureModal">
      <div class="modal configure-modal">
        <h2>Configure Email</h2>

        <!-- Editable Fields -->
        <div class="form-row">
          <div class="form-group half">
            <label>Email Key:</label>
            <input v-model="editForm.email_key" type="text" placeholder="e.g., welcome_email" />
          </div>
          <div class="form-group half">
            <label>Site:</label>
            <select v-model="editForm.site">
              <option v-for="(name, key) in SITE_NAMES" :key="key" :value="key">{{ name }}</option>
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group half">
            <label>From Address:</label>
            <input v-model="editForm.from_address" type="text" placeholder="Name <sender@example.com>" />
          </div>
          <div class="form-group half">
            <label>Subject:</label>
            <input v-model="editForm.subject" type="text" placeholder="Email subject" />
          </div>
        </div>

        <div class="form-group">
          <label>Description:</label>
          <input v-model="editForm.description" type="text" placeholder="Brief description of this email" />
        </div>

        <div class="form-group">
          <label>HTML Content:</label>
          <textarea v-model="editForm.html_content" rows="12" placeholder="HTML email content..."></textarea>
        </div>

        <!-- Preview Toggle -->
        <div class="preview-section">
          <button @click="togglePreview" class="preview-toggle-btn">
            {{ showPreview ? 'Hide Preview' : 'Show Preview' }}
          </button>
          <div v-if="showPreview" class="preview-content" v-html="previewContent"></div>
        </div>

        <!-- Save Buttons -->
        <div class="save-section">
          <button @click="saveOverOriginal" :disabled="saving" class="save-btn save-original-btn">
            {{ saving ? 'Saving...' : 'Save Over Original' }}
          </button>
          <button @click="saveAsNew" :disabled="saving" class="save-btn save-new-btn">
            {{ saving ? 'Saving...' : 'Save as New' }}
          </button>
          <p v-if="saveError" class="error">{{ saveError }}</p>
          <p v-if="saveSuccess" class="success">{{ saveSuccess }}</p>
        </div>

        <hr />

        <!-- Send Section -->
        <div class="send-section">
          <h3>Send Email</h3>
          <div class="form-group">
            <label>Recipients (one email per line):</label>
            <textarea
              v-model="recipientText"
              placeholder="email1@example.com&#10;email2@example.com"
              rows="4"
            ></textarea>
          </div>

          <p v-if="sendError" class="error">{{ sendError }}</p>
          <p v-if="sendSuccess" class="success">{{ sendSuccess }}</p>

          <button @click="sendEmail" :disabled="sending" class="send-btn">
            {{ sending ? 'Sending...' : 'Send Email' }}
          </button>

          <!-- Results -->
          <div v-if="sendResults.length > 0" class="send-results">
            <h4>Results:</h4>
            <ul>
              <li v-for="(result, idx) in sendResults" :key="idx" :class="result.success ? 'success' : 'error'">
                {{ result.email }}: {{ result.success ? 'Sent' : result.message }}
              </li>
            </ul>
          </div>
        </div>

        <div class="modal-actions">
          <button @click="closeConfigureModal" class="close-btn">Close</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'

const emails = ref([])
const showConfigureModal = ref(false)
const showPreview = ref(false)
const selectedEmail = ref(null)

// Each email key can have one version per site; a site without its own
// version uses the Prosaurus one
const SITE_NAMES = { prosaurus: 'Prosaurus', greywire: 'Greywire' }

// Edit form
const editForm = ref({
  email_key: '',
  site: 'prosaurus',
  from_address: '',
  subject: '',
  description: '',
  html_content: ''
})

// Save state
const saving = ref(false)
const saveError = ref('')
const saveSuccess = ref('')

// Send state
const recipientText = ref('')
const sending = ref(false)
const sendError = ref('')
const sendSuccess = ref('')
const sendResults = ref([])

// Computed preview with placeholder replacement
const previewContent = computed(() => {
  let content = editForm.value.html_content || ''
  content = content.replace(/\{\{verification_token\}\}/g, 'SAMPLE-TOKEN-12345')
  content = content.replace(/\{\{first_name\}\}/g, 'John')
  content = content.replace(/\{\{last_name\}\}/g, 'Doe')
  content = content.replace(/\{\{handle\}\}/g, 'johndoe')
  return content
})

onMounted(async () => {
  await fetchEmails()
})

async function fetchEmails() {
  try {
    const res = await fetch('/api/system-emails', {
      credentials: 'include'
    })
    if (res.ok) {
      const data = await res.json()
      emails.value = data.emails
    }
  } catch (err) {
    console.error('Failed to fetch system emails:', err)
  }
}

async function openConfigureModal(email) {
  // Fetch full email content
  try {
    const res = await fetch(`/api/system-emails/${email.id}`, {
      credentials: 'include'
    })
    if (res.ok) {
      const data = await res.json()
      selectedEmail.value = data
      editForm.value = {
        email_key: data.email_key,
        site: data.site || 'prosaurus',
        from_address: data.from_address,
        subject: data.subject,
        description: data.description || '',
        html_content: data.html_content
      }
      // Reset states
      showPreview.value = false
      saveError.value = ''
      saveSuccess.value = ''
      recipientText.value = ''
      sendError.value = ''
      sendSuccess.value = ''
      sendResults.value = []
      showConfigureModal.value = true
    }
  } catch (err) {
    console.error('Failed to fetch email:', err)
  }
}

function closeConfigureModal() {
  showConfigureModal.value = false
  selectedEmail.value = null
}

function togglePreview() {
  showPreview.value = !showPreview.value
}

async function saveOverOriginal() {
  const { email_key, site, from_address, subject, html_content, description } = editForm.value

  if (!email_key || !from_address || !subject || !html_content) {
    saveError.value = 'Email key, from address, subject, and HTML content are required'
    return
  }

  if (!selectedEmail.value?.id) {
    saveError.value = 'No original email selected'
    return
  }

  saving.value = true
  saveError.value = ''
  saveSuccess.value = ''

  try {
    const res = await fetch(`/api/system-emails/${selectedEmail.value.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email_key, site, from_address, subject, html_content, description })
    })

    const data = await res.json()

    if (res.ok) {
      saveSuccess.value = 'Email template updated successfully!'
      await fetchEmails() // Refresh the list
    } else {
      saveError.value = data.message || 'Failed to update email template'
    }
  } catch (err) {
    saveError.value = 'Failed to update: ' + err.message
  } finally {
    saving.value = false
  }
}

async function saveAsNew() {
  const { email_key, site, from_address, subject, html_content, description } = editForm.value

  if (!email_key || !from_address || !subject || !html_content) {
    saveError.value = 'Email key, from address, subject, and HTML content are required'
    return
  }

  saving.value = true
  saveError.value = ''
  saveSuccess.value = ''

  try {
    const res = await fetch('/api/system-emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email_key, site, from_address, subject, html_content, description })
    })

    const data = await res.json()

    if (res.ok) {
      saveSuccess.value = 'Email template saved successfully!'
      await fetchEmails() // Refresh the list
    } else {
      saveError.value = data.message || 'Failed to save email template'
    }
  } catch (err) {
    saveError.value = 'Failed to save: ' + err.message
  } finally {
    saving.value = false
  }
}

async function sendEmail() {
  const recipients = recipientText.value
    .split('\n')
    .map(e => e.trim())
    .filter(e => e.length > 0)

  if (recipients.length === 0) {
    sendError.value = 'Please enter at least one email address'
    return
  }

  const { from_address, subject, html_content } = editForm.value

  if (!from_address || !subject || !html_content) {
    sendError.value = 'From address, subject, and HTML content are required'
    return
  }

  sending.value = true
  sendError.value = ''
  sendSuccess.value = ''
  sendResults.value = []

  try {
    const res = await fetch('/api/system-emails/send-custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ recipients, from_address, subject, html_content })
    })

    const data = await res.json()

    if (res.ok) {
      sendSuccess.value = data.message
      sendResults.value = data.results || []
    } else {
      sendError.value = data.message || 'Failed to send email'
    }
  } catch (err) {
    sendError.value = 'Failed to send email: ' + err.message
  } finally {
    sending.value = false
  }
}
</script>

<style scoped>
h1 {
  color: var(--color-text);
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 20px;
  background: var(--color-background-card);
}

th, td {
  border: 1px solid var(--color-border);
  padding: 10px;
  text-align: left;
  color: var(--color-text);
}

thead {
  background-color: var(--color-background-soft);
}

code {
  background: var(--color-background-soft);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.9em;
  color: var(--color-text);
}

button {
  padding: 6px 12px;
  cursor: pointer;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-background-card);
  color: var(--color-text);
}

button:hover {
  background: var(--color-background-soft);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: var(--color-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--color-background-card);
  padding: 25px;
  border-radius: 8px;
  max-width: 800px;
  width: 95%;
  max-height: 90vh;
  overflow-y: auto;
}

.configure-modal h2 {
  margin-top: 0;
  margin-bottom: 20px;
  color: var(--color-text);
}

.form-group {
  margin-bottom: 15px;
}

.form-group label {
  display: block;
  margin-bottom: 5px;
  font-weight: bold;
  color: var(--color-text);
}

.form-group input,
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-family: inherit;
  font-size: 14px;
  box-sizing: border-box;
  background: var(--color-background-input);
  color: var(--color-text);
}

.form-group textarea {
  resize: vertical;
  font-family: monospace;
}

.form-row {
  display: flex;
  gap: 15px;
}

.form-group.half {
  flex: 1;
}

.preview-section {
  margin: 20px 0;
  padding: 15px;
  background: var(--color-background-soft);
  border-radius: 4px;
}

.preview-toggle-btn {
  margin-bottom: 10px;
}

.preview-content {
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 15px;
  background: var(--color-background);
  max-height: 300px;
  overflow-y: auto;
  color: var(--color-text);
}

.save-section {
  margin: 20px 0;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.save-btn {
  color: white;
  border: none;
  padding: 8px 16px;
}

.save-original-btn {
  background: #007bff;
}

.save-original-btn:hover {
  background: #0069d9;
}

.save-new-btn {
  background: var(--color-success);
}

.save-new-btn:hover {
  background: var(--color-accent);
}

hr {
  margin: 25px 0;
  border: none;
  border-top: 1px solid var(--color-border);
}

.send-section {
  margin: 20px 0;
}

.send-section h3 {
  margin-top: 0;
  margin-bottom: 15px;
  color: var(--color-text);
}

.send-btn {
  background: #007bff;
  color: white;
  border: none;
  padding: 8px 16px;
}

.send-btn:hover {
  background: #0069d9;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
  padding-top: 15px;
  border-top: 1px solid var(--color-border);
}

.close-btn {
  background: var(--color-button-secondary);
  color: var(--color-text);
  border: none;
}

.close-btn:hover {
  background: var(--color-button-secondary-hover);
}

.error {
  color: var(--color-error);
  margin: 10px 0;
}

.success {
  color: var(--color-success);
  margin: 10px 0;
}

.send-results {
  margin-top: 15px;
  padding: 10px;
  background: var(--color-background-soft);
  border-radius: 4px;
}

.send-results h4 {
  margin: 0 0 10px 0;
  font-size: 0.9em;
  color: var(--color-text);
}

.send-results ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.send-results li {
  padding: 4px 0;
  font-size: 0.9em;
}
</style>
