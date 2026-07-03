// Renders chat message text as safe HTML: escapes user input, then turns
// plain-text URLs into clickable link buttons and @mentions into highlighted spans.

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = (text) => text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch])

const URL_REGEX = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi
const TRAILING_PUNCTUATION = /[.,!?:;)\]}'"]+$/

// Strips trailing punctuation that's more likely to be sentence punctuation
// than part of the URL (e.g. "check https://x.com." -> url ends before the period).
function splitTrailingPunctuation(url) {
  const match = url.match(TRAILING_PUNCTUATION)
  if (!match) return { url, trailing: '' }
  let trailing = match[0]
  let core = url.slice(0, url.length - trailing.length)
  // Keep a closing paren/bracket if it balances one inside the URL, e.g. Wikipedia links.
  while (trailing.startsWith(')') && (core.match(/\(/g) || []).length > (core.match(/\)/g) || []).length) {
    core += trailing[0]
    trailing = trailing.slice(1)
  }
  return { url: core, trailing }
}

const LINK_ICON = '<svg class="chat-link-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
  '<path fill="currentColor" d="M6.5 3a.5.5 0 000 1H8.79L4.15 7.65a.5.5 0 10.7.7L9.5 4.7V7a.5.5 0 001 0V3.5A.5.5 0 0010 3H6.5zM4 4.5A1.5 1.5 0 002.5 6v6A1.5 1.5 0 004 13.5h6A1.5 1.5 0 0011.5 12V9a.5.5 0 00-1 0v3a.5.5 0 01-.5.5H4a.5.5 0 01-.5-.5V6a.5.5 0 01.5-.5h3a.5.5 0 000-1H4z"/></svg>'

function linkButton(rawUrl) {
  const { url, trailing } = splitTrailingPunctuation(rawUrl)
  const href = escapeHtml(url.startsWith('www.') ? `https://${url}` : url)
  const label = escapeHtml(url)
  return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="chat-link">${LINK_ICON}${label}</a>${escapeHtml(trailing)}`
}

const withMentions = (escapedSegment) =>
  escapedSegment.replace(/@(\w+)/g, '<span class="mention-highlight">@$1</span>')

// Escapes `text`, then replaces URLs with link buttons and @mentions with
// highlighted spans. URL matching runs on the raw text so real quote/angle-bracket
// characters (not HTML entities) correctly terminate a URL match.
export function renderMessage(text) {
  if (!text) return ''

  let html = ''
  let lastIndex = 0
  for (const match of text.matchAll(URL_REGEX)) {
    html += withMentions(escapeHtml(text.slice(lastIndex, match.index)))
    html += linkButton(match[0])
    lastIndex = match.index + match[0].length
  }
  html += withMentions(escapeHtml(text.slice(lastIndex)))
  return html
}
