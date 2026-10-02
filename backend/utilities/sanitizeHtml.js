// Cleans user-written HTML before it's saved: ticket, company and job
// descriptions, bios, blog posts and storefront pages are HTML from the web
// editors, but the API takes whatever it's sent, so it could carry script.
// DOMPurify (on a jsdom window) removes scripts, event handlers,
// javascript: URLs, forms and embeds, keeping normal formatting, links,
// images and the blog editor's <font> tags. The web app also sanitizes
// when displaying (frontend v-safe-html), which covers anything stored
// before this existed.
//
// KEEP IN SYNC with frontend/src/utilities/sanitizeHtml.js.
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');

const DOMPurify = createDOMPurify(new JSDOM('').window);

// Inline style properties the editors produce (alignment, font, colors).
// Anything else -- position, display, width/height, url(...) -- is dropped.
const ALLOWED_STYLES = new Set([
  'text-align', 'color', 'background-color', 'font-size', 'font-family',
  'font-weight', 'font-style', 'text-decoration', 'text-decoration-line'
]);

const CONFIG = {
  USE_PROFILES: { html: true }, // HTML only: no SVG or MathML
  ADD_ATTR: ['target'],
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option', 'iframe', 'object', 'embed']
};

function filterStyle(value) {
  return value
    .split(';')
    .map(decl => decl.trim())
    .filter(decl => {
      const [prop, ...rest] = decl.split(':');
      const val = rest.join(':');
      return prop && val && ALLOWED_STYLES.has(prop.trim().toLowerCase()) && !/url\s*\(|expression\s*\(/i.test(val);
    })
    .join('; ');
}

DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (data.attrName === 'style') {
    const kept = filterStyle(data.attrValue);
    if (kept) data.attrValue = kept;
    else data.keepAttr = false;
  }
  if (data.attrName === 'target' && data.attrValue !== '_blank') data.keepAttr = false;
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

// Returns cleaned HTML; null/undefined pass through so "not provided" and
// "cleared" keep their meaning in update routes.
function sanitizeHtml(html) {
  if (html === null || html === undefined) return html;
  return DOMPurify.sanitize(String(html), CONFIG);
}

module.exports = { sanitizeHtml };
