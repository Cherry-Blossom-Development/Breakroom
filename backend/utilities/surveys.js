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
  gear: {
    title: 'What gear do you use',
    page: 'survey-gear.html',
    questions: [
      {
        id: 'guitars', type: 'multi', label: 'What do you mostly play?',
        options: [
          ['single-coil', 'Single-coil guitar (Strat or Tele style)'], ['humbucker', 'Humbucker solid body (Les Paul or SG style)'],
          ['hollow', 'Semi-hollow or hollow body'], ['extended', '7-, 8- or baritone guitar'], ['bass', 'Bass'],
          ['acoustic', 'Acoustic with a pickup'], ['other', 'Other'],
        ],
      },
      {
        id: 'amp', type: 'multi', label: 'What do you play through?',
        options: [
          ['tube', 'Tube amp'], ['solid-state', 'Solid-state amp'], ['modeling-amp', 'Modeling amp'],
          ['floor-modeler', 'Floor modeler or multi-effects unit'], ['computer', 'Computer plugins'],
          ['direct', 'Straight into a PA or audio interface'], ['headphones', 'Headphone amp'],
        ],
      },
      {
        id: 'pedal-count', type: 'single', label: 'How many pedals are on your board?',
        options: [['none', 'None'], ['1-3', '1–3'], ['4-7', '4–7'], ['8-12', '8–12'], ['13-plus', '13 or more']],
      },
      {
        id: 'effects', type: 'multi', label: 'Which effects do you use?',
        options: [
          ['overdrive', 'Overdrive'], ['distortion', 'Distortion'], ['fuzz', 'Fuzz'], ['boost', 'Boost'],
          ['compressor', 'Compressor'], ['eq', 'EQ'], ['noise-gate', 'Noise gate'], ['wah', 'Wah or envelope filter'],
          ['chorus', 'Chorus'], ['phaser', 'Phaser'], ['flanger', 'Flanger'], ['tremolo', 'Tremolo'],
          ['pitch', 'Octave or pitch shifter'], ['delay', 'Delay'], ['reverb', 'Reverb'], ['looper', 'Looper'],
          ['tuner', 'Tuner'],
        ],
      },
      {
        id: 'power', type: 'single', label: 'How do you power your pedals?',
        options: [
          ['battery', 'Batteries'], ['daisy-chain', 'One adapter with a daisy chain'],
          ['isolated', 'Isolated power supply'], ['none', 'Not needed (no pedals, or one unit)'],
        ],
      },
      {
        id: 'switching', type: 'single', label: 'How do you change sounds during a song?',
        options: [
          ['tap', 'Stomp individual pedals'], ['switcher', 'Loop switcher or controller'],
          ['presets', 'Presets on a multi-effects unit'], ['dont', 'I don\'t change sounds mid-song'],
        ],
      },
      {
        id: 'midi', type: 'single', label: 'Do you use MIDI with your gear?',
        options: [
          ['unfamiliar', 'Not sure what that is'], ['no', 'I know it, but don\'t use it'],
          ['some', 'Yes, for one or two things'], ['central', 'Yes, it runs my whole rig'],
        ],
      },
      {
        id: 'problems', type: 'multi', label: 'What bugs you most about your setup?',
        options: [
          ['tap-dancing', 'Too much tap dancing'], ['recall', 'Getting settings right for each song'],
          ['size', 'Board too big or heavy'], ['noise', 'Noise or hum'], ['tone-loss', 'Losing tone with long cables or many pedals'],
          ['power', 'Power problems'], ['cost', 'Cost'], ['nothing', 'Nothing, it\'s perfect'],
        ],
      },
      {
        id: 'spend', type: 'single', label: 'What do you usually spend on one pedal?',
        options: [
          ['under-50', 'Under $50'], ['50-100', '$50–$100'], ['100-200', '$100–$200'],
          ['200-300', '$200–$300'], ['300-plus', 'More than $300'],
        ],
      },
      { id: 'comments', type: 'text', label: 'Anything else about your gear?', maxLength: 2000 },
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
