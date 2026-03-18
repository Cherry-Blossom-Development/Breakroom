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

const OPENAI_THRESHOLD = 0.85;

/**
 * Calls the OpenAI Moderation API.
 * Returns the highest-scoring category name if any score exceeds the threshold,
 * or null if the content is clean or the API is unavailable.
 */
async function checkWithOpenAI(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ input: text })
    });

    if (!res.ok) {
      console.warn(`[contentFilter] OpenAI Moderation API returned ${res.status} — failing open`);
      return null;
    }

    const data = await res.json();
    const result = data.results?.[0];
    if (!result) return null;

    // Find the highest-scoring category that exceeds the threshold
    const flaggedCategory = Object.entries(result.category_scores)
      .filter(([, score]) => score >= OPENAI_THRESHOLD)
      .sort(([, a], [, b]) => b - a)[0];

    return flaggedCategory ? flaggedCategory[0] : null;
  } catch (err) {
    console.warn('[contentFilter] OpenAI Moderation API error — failing open:', err.message);
    return null;
  }
}

const TABLE_MAP = {
  post: 'blog_posts',
  comment: 'blog_comments',
  chat_message: 'chat_messages',
  artwork: 'gallery_artworks',
  lyrics: 'lyrics'
};

async function hideAndFlag(client, contentType, contentId, authorId, reason) {
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
    [contentType, contentId, authorId, reason]
  );
}

/**
 * Checks text against active keywords and (async) the OpenAI Moderation API.
 * If either check flags the content, it is hidden and a pending flag is created.
 * Returns true if the keyword check filtered the content (OpenAI runs fire-and-forget after).
 */
async function checkAndFilterContent(contentType, contentId, texts, authorId) {
  const combinedText = (Array.isArray(texts) ? texts : [texts]).join(' ');

  // --- Keyword check (fast, synchronous-ish) ---
  const keywords = await getActiveKeywords();
  const matchedKeyword = matchesKeyword(combinedText, keywords);
  if (matchedKeyword) {
    const client = await getClient();
    try {
      await hideAndFlag(client, contentType, contentId, authorId,
        `Auto-filtered: matched keyword "${matchedKeyword}"`);
    } finally {
      client.release();
    }
    return true;
  }

  // --- OpenAI check (async, fire-and-forget from caller's perspective) ---
  checkWithOpenAI(combinedText).then(async (category) => {
    if (!category) return;
    const client = await getClient();
    try {
      await hideAndFlag(client, contentType, contentId, authorId,
        `Auto-filtered: OpenAI moderation (${category})`);
    } finally {
      client.release();
    }
  }).catch((err) => {
    console.warn('[contentFilter] OpenAI follow-up action failed:', err.message);
  });

  return false;
}

module.exports = { checkAndFilterContent, invalidateCache };
