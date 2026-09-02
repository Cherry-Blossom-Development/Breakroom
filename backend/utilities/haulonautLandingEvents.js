// A small curated pool of "Oregon Trail"-style outcomes for Haulonaut's
// planet-landing feature (POST /:gameKey/characters/:id/land in
// backend/routes/games.js). Deliberately simple for a first pass: one
// randomly-weighted flavor line plus a direct credits/rations/fuel delta --
// no new stats, no multi-turn expedition state. Weighted so good and bad
// outcomes both come up regularly; nothing here is meant to be a
// guaranteed grind, same spirit as the source material.
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const LANDING_EVENTS = [
  { weight: 14, narrate: () => 'The surface is quiet. Nothing of note turns up.', apply: () => ({}) },
  { weight: 10, narrate: () => 'You find a cache of abandoned rations.', apply: () => ({ rations: rand(5, 15) }) },
  { weight: 8, narrate: () => 'Local traders offer a fair price for scrap metal.', apply: () => ({ credits: rand(20, 80) }) },
  { weight: 6, narrate: () => 'You strike a vein of raw ore.', apply: () => ({ credits: rand(50, 150) }) },
  { weight: 7, narrate: () => 'A leaking fuel cell is salvaged from old wreckage.', apply: () => ({ fuel: rand(5, 20) }) },
  { weight: 8, narrate: () => 'A sudden storm damages the landing gear.', apply: () => ({ fuel: -rand(3, 10) }) },
  { weight: 8, narrate: () => 'Toxic spores drift through camp; supplies spoil.', apply: () => ({ rations: -rand(5, 15) }) },
  { weight: 6, narrate: () => 'Local fauna raids the supply crates overnight.', apply: () => ({ rations: -rand(3, 8), credits: -rand(5, 20) }) },
  { weight: 4, narrate: () => 'Hostile terrain forces a hasty, costly retreat.', apply: () => ({ fuel: -rand(2, 6), credits: -rand(10, 30) }) },
  { weight: 2, narrate: () => 'Ancient technology, still humming with power, is recovered intact.', apply: () => ({ credits: rand(200, 400) }) }
];

const TOTAL_WEIGHT = LANDING_EVENTS.reduce((sum, e) => sum + e.weight, 0);

function rollLandingEvent() {
  let roll = Math.random() * TOTAL_WEIGHT;
  for (const event of LANDING_EVENTS) {
    if (roll < event.weight) return { narration: event.narrate(), effects: event.apply() };
    roll -= event.weight;
  }
  return { narration: LANDING_EVENTS[0].narrate(), effects: {} }; // unreachable; floating-point safety net
}

module.exports = { rollLandingEvent };
