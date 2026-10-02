// Ranks tickets for the "depends on" autocomplete (DependencyPicker.vue).
// Pure, so it can be unit-tested.
//
//   - With nothing typed, only the ticket's own category is offered: the
//     other subtasks of the same split ticket (migration 086). A ticket
//     outside any category gets no suggestions until you type.
//   - Typed text is matched against #id and title: an exact id beats an id
//     prefix, which beats a title that starts with the text, then a word
//     that starts with it, then the text anywhere. Several words must all
//     match; a number among them (with or without #) may match the id, so
//     a picked "#5 Payment webhooks" still finds #5 after it's edited.
//   - Category matches always come first; other tickets only fill the
//     remaining slots, below them.
//   - At most `limit` results.

function matchScore(ticket, terms, idQuery) {
  const id = String(ticket.id)
  if (idQuery) {
    if (id === idQuery) return 100
    if (id.startsWith(idQuery)) return 80
  }
  const title = ticket.title.toLowerCase()
  const words = title.split(/[^a-z0-9]+/).filter(Boolean)
  let score = 0
  for (const term of terms) {
    if (/^\d+$/.test(term) && id.startsWith(term)) score += id === term ? 40 : 25
    else if (title.startsWith(term)) score += 30
    else if (words.some(w => w.startsWith(term))) score += 20
    else if (title.includes(term)) score += 10
    else return 0 // every word typed must match
  }
  return score
}

/**
 * @param {Array}  candidates  tickets that may be chosen
 * @param {string} query       what's typed
 * @param {Set}    categoryIds ids of the ticket's category siblings
 * @param {number} limit
 * @returns {Array<{ ticket, inCategory: boolean }>}
 */
export function rankDependencyCandidates(candidates, query, categoryIds, limit = 10) {
  const q = (query || '').trim().toLowerCase()
  const inCategory = (t) => categoryIds.has(t.id)

  if (!q) {
    return candidates
      .filter(inCategory)
      .sort((a, b) => a.id - b.id)
      .slice(0, limit)
      .map(ticket => ({ ticket, inCategory: true }))
  }

  const idQuery = /^#?\d+$/.test(q) ? q.replace('#', '') : null
  const terms = q.split(/\s+/).map(t => t.replace(/^#/, '')).filter(Boolean)
  const scored = candidates
    .map(ticket => ({ ticket, score: matchScore(ticket, terms, idQuery), inCategory: inCategory(ticket) }))
    .filter(r => r.score > 0)
    .sort((a, b) => (b.inCategory - a.inCategory) || (b.score - a.score) || (a.ticket.id - b.ticket.id))

  return scored.slice(0, limit).map(({ ticket, inCategory: cat }) => ({ ticket, inCategory: cat }))
}
