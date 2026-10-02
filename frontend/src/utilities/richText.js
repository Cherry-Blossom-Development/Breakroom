// Rich-text descriptions are HTML from the editor (RichTextEditor.vue), but
// older ones are plain text from before it existed -- lines separated by
// newlines. Rendered or loaded as HTML, those newlines collapse and every
// line runs together, so plain text is turned into one paragraph per line
// first. Text counts as HTML only if it has real formatting tags -- plain
// text can contain angle brackets too, like old support requests'
// "Name <email@example.com>", which must stay visible text.

const HAS_TAGS = /<\/?(p|div|br|span|ul|ol|li|h[1-6]|strong|em|b|i|u|s|a|img|blockquote|pre|code|font|hr)\b[^>]*>/i

const escapeHtml = (s) => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

export function toRichHtml(text) {
  if (!text) return ''
  if (HAS_TAGS.test(text)) return text
  return text
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => `<p>${escapeHtml(line)}</p>`)
    .join('')
}
