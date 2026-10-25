const express = require('express');
const router = express.Router();
const { getClient } = require('../utilities/db');
const { SURVEYS, cleanAnswers, visitorHashes } = require('../utilities/surveys');

// Anonymous surveys from greywirestudio.com. The website is plain HTML, so the
// forms post here directly (nginx proxies /api/surveys/ on that domain) and
// get a redirect back to a website page. See data/migrations/095-surveys.sql.

/**
 * POST /api/surveys/:slug
 * Saves one submission. Earlier valid submissions to the same survey from the
 * same IP and browser are marked invalid, so only the newest one counts.
 */
router.post('/:slug', async (req, res) => {
  const survey = Object.hasOwn(SURVEYS, req.params.slug) ? SURVEYS[req.params.slug] : null;
  if (!survey) return res.redirect(303, '/opinion.html');

  const answers = cleanAnswers(survey, req.body || {});
  if (!answers) return res.redirect(303, `/${survey.page}#empty`);

  const { ipHash, browserHash } = visitorHashes(req);
  const client = await getClient();
  try {
    const result = await client.query(
      `INSERT INTO survey_responses (survey, answers, ip_hash, browser_hash) VALUES ($1, $2, $3, $4)`,
      [req.params.slug, JSON.stringify(answers), ipHash, browserHash]
    );
    // Only rows before this one: if two arrive at once, the later replaces the earlier
    await client.query(
      `UPDATE survey_responses SET is_valid = 0, superseded_by = $1
       WHERE survey = $2 AND ip_hash = $3 AND browser_hash = $4 AND id < $1 AND is_valid = 1`,
      [result.insertId, req.params.slug, ipHash, browserHash]
    );
    res.redirect(303, '/survey-thanks.html');
  } catch (err) {
    console.error('Error saving survey response:', err);
    res.redirect(303, `/${survey.page}#failed`);
  } finally {
    client.release();
  }
});

module.exports = router;
