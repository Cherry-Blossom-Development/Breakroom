// Rich-text descriptions are HTML from the editor (RichTextEditor.vue), but
// older ones are plain text from before it existed -- lines separated by
// newlines. Rendered or loaded as HTML, those newlines collapse and every
// line runs together, so plain text is turned into one paragraph per line
// first. Anything that already contains tags is returned unchanged.

const HAS_TAGS = /<\/?[a-z][\s\S]*?>/i

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
