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
  sounds: {
    title: 'What sounds cool to you',
    page: 'survey-sounds.html',
    questions: [
      {
        id: 'sounds', type: 'multi', label: 'Which guitar sounds do you love?',
        options: [
          ['clean', 'Clean and sparkly'], ['edge', 'Just breaking up'], ['crunch', 'Classic rock crunch'],
          ['high-gain', 'High-gain metal'], ['fuzz', 'Thick, woolly fuzz'], ['ambient', 'Ambient and washy'],
          ['twang', 'Twangy country'], ['funk', 'Funky clean'], ['lo-fi', 'Lo-fi and broken'],
        ],
      },
      {
        id: 'gain', type: 'single', label: 'How much gain do you usually use?',
        options: [
          ['none', 'None, I play clean'], ['little', 'A little, just breaking up'], ['medium', 'Medium crunch'],
          ['lots', 'A lot, high gain'], ['fuzz', 'Fuzz on everything'],
        ],
      },
      {
        id: 'eras', type: 'multi', label: 'Which classic sounds would you want from a pedal?',
        options: [
          ['60s-fuzz', '60s fuzz'], ['70s-rock', '70s rock distortion'], ['80s-metal', '80s hard rock and metal'],
          ['90s-grunge', '90s grunge'], ['modern-metal', 'Modern high gain'], ['blues', 'Blues overdrive'],
          ['shoegaze', 'Shoegaze wall of sound'], ['surf', 'Surf tremolo and reverb'],
        ],
      },
      {
        id: 'pedals', type: 'multi', label: 'Which pedals would you like us to make next?',
        options: [
          ['tap-changer', 'Tap Changer clean boost'], ['three-phase', 'Three Phase phaser'],
          ['rolling-blackout', 'Rolling Blackout tremolo'], ['double-circuit', 'Double Circuit chorus'],
          ['overdrive', 'Overdrive'], ['fuzz', 'Fuzz'], ['octave-fuzz', 'Octave fuzz'],
          ['compressor', 'Compressor'], ['envelope', 'Envelope filter'],
        ],
      },
      {
        id: 'linked', type: 'single', label: 'How do you feel about pedals that change settings by themselves for each part of a song?',
        options: [
          ['not-for-me', 'Not for me'], ['maybe', 'Could be handy'], ['want', 'I want that'],
          ['must', 'I\'d buy a pedal for that alone'],
        ],
      },
      {
        id: 'analog', type: 'single', label: 'How much does analog matter to you?',
        options: [
          ['only', 'Analog only'], ['prefer', 'I prefer analog'], ['dont-care', 'I don\'t mind, if it sounds good'],
          ['digital', 'I prefer digital for its flexibility'],
        ],
      },
      {
        id: 'knobs', type: 'single', label: 'How many knobs do you like on a pedal?',
        options: [
          ['one-two', 'One or two, keep it simple'], ['three-four', 'Three or four'],
          ['lots', 'Lots, I like to tweak'], ['app', 'A few, with deeper settings in an app'],
        ],
      },
      { id: 'tone', type: 'text', label: 'Name a guitar tone you love: a player, a song or an album', maxLength: 300 },
      { id: 'comments', type: 'text', label: 'Anything else you\'d like to hear from a pedal?', maxLength: 2000 },
    ],
  },
  buying: {
    title: 'How you buy gear',
    page: 'survey-buying.html',
    questions: [
      {
        id: 'where', type: 'multi', label: 'Where do you buy pedals?',
        options: [
          ['local-store', 'A local music store'], ['online-store', 'Online music retailers'], ['amazon', 'Amazon'],
          ['reverb', 'Reverb or other gear marketplaces'], ['maker', 'Direct from the maker\'s website'],
          ['local-used', 'Used, locally (classifieds, Marketplace)'], ['trade', 'Trades and swaps'],
        ],
      },
      {
        id: 'condition', type: 'single', label: 'New or used?',
        options: [['new', 'Mostly new'], ['mix', 'About half and half'], ['used', 'Mostly used']],
      },
      {
        id: 'discover', type: 'multi', label: 'Where do you hear about new gear?',
        options: [
          ['youtube', 'YouTube demos and reviews'], ['instagram', 'Instagram'], ['tiktok', 'TikTok'],
          ['forums', 'Forums and Reddit'], ['friends', 'Friends and bandmates'], ['store-staff', 'Music store staff'],
          ['artists', 'Players I follow'], ['print-podcasts', 'Magazines and podcasts'],
        ],
      },
      {
        id: 'decide', type: 'multi', label: 'What makes you buy a pedal?',
        options: [
          ['demo', 'Hearing a good demo'], ['try', 'Trying it myself'], ['reviews', 'Reviews and ratings'],
          ['price', 'A good price or a sale'], ['recommend', 'A friend recommends it'], ['artist', 'A player I like uses it'],
          ['build', 'Build quality and warranty'], ['small-maker', 'Supporting a small maker'],
        ],
      },
      {
        id: 'preorder', type: 'single', label: 'Would you preorder a pedal from a new, small maker?',
        options: [
          ['no', 'No, I wait until it\'s out and reviewed'], ['discount', 'Maybe, for a preorder discount'],
          ['refundable', 'Yes, if I could cancel for a refund'], ['yes', 'Yes, if I liked the demos'],
        ],
      },
      {
        id: 'crowdfund', type: 'single', label: 'Have you backed a crowdfunding campaign for gear?',
        options: [
          ['never', 'No, and I wouldn\'t'], ['maybe', 'No, but I might'], ['once', 'Once'], ['several', 'More than once'],
        ],
      },
      {
        id: 'controller-price', type: 'single', label: 'What would you pay for a controller that switches your pedals for each part of a song?',
        options: [
          ['wouldnt-buy', 'I wouldn\'t buy one'], ['under-100', 'Under $100'], ['100-200', '$100–200'],
          ['200-300', '$200–300'], ['300-plus', 'Over $300'],
        ],
      },
      {
        id: 'bundle', type: 'single', label: 'Which would you rather buy?',
        options: [
          ['single', 'One pedal at a time'], ['pair', 'A pair of pedals at a discount'],
          ['set', 'A full set with the controller, at a bigger discount'], ['no-preference', 'No preference'],
        ],
      },
      {
        id: 'warranty', type: 'single', label: 'How much does the warranty matter to you?',
        options: [
          ['not-much', 'Not much, pedals rarely break'], ['one-year', 'A year is fine'], ['two-three', 'Two or three years'],
          ['lifetime', 'A lifetime warranty would win me over'],
        ],
      },
      {
        id: 'kit', type: 'single', label: 'Would you build a pedal yourself from a kit?',
        options: [
          ['no', 'No, I want it ready to play'], ['maybe', 'Maybe, if it were simple'], ['yes', 'Yes, that sounds fun'],
          ['already', 'I already build pedals'],
        ],
      },
      { id: 'comments', type: 'text', label: 'Anything else about how you buy gear?', maxLength: 2000 },
    ],
  },
  pedalboard: {
    title: 'Your pedalboard',
    page: 'survey-pedalboard.html',
    questions: [
      {
        id: 'room', type: 'single', label: 'How much room is left on your board?',
        options: [
          ['no-board', 'I don\'t use a board'], ['full', 'None, it\'s full'], ['little', 'Room for one more'],
          ['plenty', 'Plenty of room'],
        ],
      },
      {
        id: 'size', type: 'single', label: 'What size of pedal do you prefer?',
        options: [
          ['mini', 'Mini, as small as possible'], ['standard', 'Standard, like most pedals'],
          ['bigger', 'Bigger is fine if it\'s easier to use'], ['dont-mind', 'I don\'t mind'],
        ],
      },
      {
        id: 'jacks', type: 'single', label: 'Where do you want the jacks?',
        options: [['top', 'On top'], ['sides', 'On the sides'], ['dont-mind', 'I don\'t mind']],
      },
      {
        id: 'bypass', type: 'single', label: 'True bypass or buffered bypass?',
        options: [
          ['true', 'True bypass only'], ['buffer-ok', 'A good buffer is fine'], ['buffer', 'I prefer buffered'],
          ['dont-know', 'I don\'t know the difference'],
        ],
      },
      {
        id: 'stereo', type: 'single', label: 'Do you play in stereo?',
        options: [
          ['mono', 'No, always mono'], ['someday', 'Not yet, but I\'d like to'], ['sometimes', 'Sometimes'],
          ['always', 'Always'],
        ],
      },
      {
        id: 'phone', type: 'single', label: 'Which phone do you use?',
        options: [['iphone', 'iPhone'], ['android', 'Android'], ['other', 'Something else, or no smartphone']],
      },
      {
        id: 'phone-place', type: 'single', label: 'If an app ran your board, where would your phone go on stage?',
        options: [
          ['board-mount', 'In a mount on the board'], ['stand', 'On a mic stand or music stand'],
          ['pocket', 'In my pocket or on the amp'], ['not-on-stage', 'I wouldn\'t use a phone on stage'],
        ],
      },
      {
        id: 'looks', type: 'multi', label: 'What looks do you like on a pedal?',
        options: [
          ['bare', 'Bare or brushed metal'], ['bold-color', 'Bold, solid colors'], ['artwork', 'Detailed artwork'],
          ['minimal', 'Dark and minimal'], ['vintage', 'Vintage and retro'], ['matching', 'A matching look across a series'],
        ],
      },
      {
        id: 'leds', type: 'single', label: 'How bright should a pedal\'s lights be?',
        options: [
          ['dim', 'Dim, bright LEDs blind me'], ['normal', 'Normal'], ['bright', 'Bright enough to see outdoors'],
          ['adjustable', 'Adjustable'],
        ],
      },
      { id: 'comments', type: 'text', label: 'Anything else about your board, or what a pedal should look like?', maxLength: 2000 },
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
