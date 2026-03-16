const { getClient } = require('./db');

let keywordCache = null;
let cacheExpiry = 0;
const CACHE_TTL = 60000; // 1 minute

async function getActiveKeywords() {
  const now = Date.now();
  if (keywordCache && now < cacheExpiry) return keywordCache;
  const client = await getClient();
  try {
    const result = await client.query(
      'SELECT keyword FROM content_filter_keywords WHERE is_active = TRUE'
    );
    keywordCache = result.rows.map(r => r.keyword.toLowerCase());
    cacheExpiry = now + CACHE_TTL;
    return keywordCache;
  } finally {
    client.release();
  }
}

function invalidateCache() {
  keywordCache = null;
  cacheExpiry = 0;
}

function matchesKeyword(text, keywords) {
  if (!text || !keywords.length) return null;
  const lower = text.toLowerCase();
  return keywords.find(kw => lower.includes(kw)) || null;
}

const TABLE_MAP = {
  post: 'blog_posts',
  comment: 'blog_comments',
  chat_message: 'chat_messages',
  artwork: 'gallery_artworks',
  lyrics: 'lyrics'
};

/**
 * Checks text fields against active keywords.
 * If a keyword matches, hides the content and creates a pending flag.
 * Returns true if content was auto-filtered.
 */
async function checkAndFilterContent(contentType, contentId, texts, authorId) {
  const keywords = await getActiveKeywords();
  const combinedText = (Array.isArray(texts) ? texts : [texts]).join(' ');
  const matchedKeyword = matchesKeyword(combinedText, keywords);
  if (!matchedKeyword) return false;

  const client = await getClient();
  try {
    const table = TABLE_MAP[contentType];
    if (table) {
      await client.query(
        `UPDATE ${table} SET is_hidden = TRUE, hidden_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [contentId]
      );
    }
    await client.query(
      `INSERT INTO content_flags (content_type, content_id, content_author_id, flagged_by_user_id, reason, status)
       VALUES ($1, $2, $3, NULL, $4, 'pending')`,
      [contentType, contentId, authorId, `Auto-filtered: matched keyword "${matchedKeyword}"`]
    );
    return true;
  } finally {
    client.release();
  }
}

module.exports = { checkAndFilterContent, invalidateCache };
