let originalLinks = null

function getIconLinks() {
  return Array.from(document.head.querySelectorAll('link[rel~="icon"]'))
}

// Some browsers (Firefox/Safari) don't refresh the tab icon on an in-place
// href mutation, so replace the <link> nodes entirely rather than editing them.
export function setFavicon(url) {
  if (!url) return
  if (!originalLinks) originalLinks = getIconLinks().map(link => link.cloneNode(true))

  getIconLinks().forEach(link => {
    const replacement = link.cloneNode(true)
    replacement.href = url
    link.replaceWith(replacement)
  })
}

export function resetFavicon() {
  if (!originalLinks) return
  getIconLinks().forEach(link => link.remove())
  originalLinks.forEach(link => document.head.appendChild(link.cloneNode(true)))
}
