// Cleans user-written HTML before it's put on the page (the v-safe-html
// directive, registered in main.js). Ticket/company/job descriptions, bios,
// blog posts and storefront pages are HTML from the editors, and any of it
// could be crafted to run script -- so everything shown with v-safe-html
// goes through DOMPurify: scripts, event handlers, javascript: URLs, forms
// and embeds are removed; normal formatting, links, images and the blog
// editor's <font> tags are kept.
//
// KEEP IN SYNC with backend/utilities/sanitizeHtml.js, which applies the
// same policy when this HTML is saved.
import DOMPurify from 'dompurify'

// Inline style properties the editors produce (alignment, font, colors).
// Anything else -- position, display, width/height, url(...) -- is dropped,
// so content can't overlay or restyle the rest of the page.
const ALLOWED_STYLES = new Set([
  'text-align', 'color', 'background-color', 'font-size', 'font-family',
  'font-weight', 'font-style', 'text-decoration', 'text-decoration-line'
])

const CONFIG = {
  USE_PROFILES: { html: true }, // HTML only: no SVG or MathML
  ADD_ATTR: ['target'],
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option', 'iframe', 'object', 'embed']
}

function filterStyle(value) {
  return value
    .split(';')
    .map(decl => decl.trim())
    .filter(decl => {
      const [prop, ...rest] = decl.split(':')
      const val = rest.join(':')
      return prop && val && ALLOWED_STYLES.has(prop.trim().toLowerCase()) && !/url\s*\(|expression\s*\(/i.test(val)
    })
    .join('; ')
}

DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (data.attrName === 'style') {
    const kept = filterStyle(data.attrValue)
    if (kept) data.attrValue = kept
    else data.keepAttr = false
  }
  if (data.attrName === 'target' && data.attrValue !== '_blank') data.keepAttr = false
})

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  // New-tab links can't reach back into this page
  if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export function sanitizeHtml(html) {
  if (!html) return ''
  return DOMPurify.sanitize(String(html), CONFIG)
}

// v-safe-html: like v-html, but sanitized
export const safeHtmlDirective = {
  mounted(el, { value }) {
    el.innerHTML = sanitizeHtml(value)
  },
  updated(el, { value, oldValue }) {
    if (value !== oldValue) el.innerHTML = sanitizeHtml(value)
  }
}
