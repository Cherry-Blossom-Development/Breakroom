const crypto = require('crypto');
require('dotenv').config();

/**
 * Anonymous surveys on greywirestudio.com ("Your Opinion"). The questions here
 * must match the form fields in the website's survey pages
 * (GreywireStudio-Website, survey-*.html): `id` is the field name and each
 * option's `value` is the input value. Labels are for the admin results.
 */
const SURVEYS = {
  musician: {
    title: 'What kind of musician are you',
    page: 'survey-musician.html',
    questions: [
      {
        id: 'plays', type: 'multi', label: 'What do you play?',
        options: [
          ['electric-guitar', 'Electric guitar'], ['acoustic-guitar', 'Acoustic guitar'], ['bass', 'Bass'],
          ['keys', 'Keys / synth'], ['drums', 'Drums'], ['vocals', 'Vocals'], ['other', 'Other'],
        ],
      },
      {
        id: 'main', type: 'single', label: 'Your main instrument',
        options: [
          ['electric-guitar', 'Electric guitar'], ['acoustic-guitar', 'Acoustic guitar'], ['bass', 'Bass'],
          ['keys', 'Keys / synth'], ['drums', 'Drums'], ['vocals', 'Vocals'], ['other', 'Other'],
        ],
      },
      {
        id: 'years', type: 'single', label: 'How long have you been playing?',
        options: [
          ['under-1', 'Under 1 year'], ['1-5', '1–5 years'], ['5-10', '5–10 years'],
          ['10-20', '10–20 years'], ['20-plus', 'More than 20 years'],
        ],
      },
      {
        id: 'level', type: 'single', label: 'How would you describe yourself?',
        options: [
          ['starting', 'Just starting out'], ['hobbyist', 'Hobbyist'], ['gigging', 'Gigging musician'],
          ['professional', 'Professional / session'], ['producer', 'Producer / home recording'],
        ],
      },
      {
        id: 'where', type: 'multi', label: 'Where do you play most?',
        options: [
          ['home', 'At home'], ['recording', 'Recording'], ['rehearsals', 'Band rehearsals'],
          ['live', 'Live shows'], ['worship', 'Church / worship'], ['online', 'Online / streaming'],
        ],
      },
      {
        id: 'live', type: 'single', label: 'How often do you play live?',
        options: [
          ['never', 'Never'], ['few-a-year', 'A few times a year'], ['monthly', 'Monthly'], ['weekly', 'Weekly or more'],
        ],
      },
      {
        id: 'styles', type: 'multi', label: 'What styles do you play?',
        options: [
          ['rock', 'Rock'], ['blues', 'Blues'], ['metal', 'Metal'], ['punk', 'Punk'], ['indie', 'Indie / alternative'],
          ['country', 'Country'], ['jazz', 'Jazz'], ['funk-soul', 'Funk / soul'], ['pop', 'Pop'], ['worship', 'Worship'],
          ['ambient', 'Ambient / experimental'], ['other', 'Other'],
        ],
      },
      {
        id: 'region', type: 'single', label: 'Where are you?',
        options: [
          ['us', 'United States'], ['canada', 'Canada'], ['uk', 'United Kingdom'], ['eu', 'European Union'],
          ['au-nz', 'Australia / New Zealand'], ['elsewhere', 'Somewhere else'],
        ],
      },
      { id: 'comments', type: 'text', label: 'Anything else you\'d like us to know?', maxLength: 2000 },
    ],
  },
};

/**
 * Keeps only answers the survey defines: known option values, one for a
 * single choice, any number for a multi choice, trimmed text up to its limit.
 * Returns null when nothing was answered.
 */
function cleanAnswers(survey, body) {
  const answers = {};
  for (const q of survey.questions) {
    const raw = body[q.id];
    const values = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).map(String);
    if (q.type === 'text') {
      const text = (values[0] || '').trim().slice(0, q.maxLength);
      if (text) answers[q.id] = text;
      continue;
    }
    const allowed = new Set(q.options.map(([value]) => value));
    const picked = [...new Set(values.filter(v => allowed.has(v)))];
    if (!picked.length) continue;
    answers[q.id] = q.type === 'single' ? picked[0] : picked;
  }
  return Object.keys(answers).length ? answers : null;
}

// Keyed so the hashes can't be reversed by hashing every possible IP. Derived
// from SECRET_KEY: changing that key means later submissions no longer match
// earlier ones.
const HASH_KEY = crypto.createHmac('sha256', process.env.SECRET_KEY || '').update('greywire-survey').digest();

function hash(value) {
  return crypto.createHmac('sha256', HASH_KEY).update(value).digest('hex');
}

/**
 * The anonymous visitor's identity, as one-way hashes: their IP address, and
 * the browser details every request carries (user agent, languages and
 * Chrome's client hints). nginx sets X-Real-IP from the connection itself, so
 * unlike X-Forwarded-For it can't be faked by the visitor.
 */
function visitorHashes(req) {
  const ip = String(req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
  const browser = ['user-agent', 'accept-language', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform']
    .map(h => req.headers[h] || '')
    .join('\n');
  return { ipHash: hash(ip), browserHash: hash(browser) };
}

module.exports = { SURVEYS, cleanAnswers, visitorHashes };
