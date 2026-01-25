const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');

require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

// Auth middleware for admin endpoints (viewing results)
const authenticate = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const payload = jwt.verify(token, SECRET_KEY);
    const client = await getClient();
    const result = await client.query(
      'SELECT id, handle, first_name, last_name FROM users WHERE handle = $1',
      [payload.username]
    );
    client.release();

    if (result.rowCount === 0) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// API key middleware for test reporter (no user auth needed)
const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  // For now, accept a simple key from environment or skip if not configured
  const expectedKey = process.env.TEST_API_KEY;

  if (expectedKey && apiKey !== expectedKey) {
    return res.status(401).json({ message: 'Invalid API key' });
  }
  next();
};

// ============================================
// TEST REPORTER ENDPOINTS (for BreakTest)
// ============================================

// Start a new test run
router.post('/runs', apiKeyAuth, async (req, res) => {
  const { platform, environment, branch, commit_hash } = req.body;
  const client = await getClient();

  try {
    if (!platform || !['web', 'android'].includes(platform)) {
      return res.status(400).json({ message: 'Platform must be "web" or "android"' });
    }

    await client.query(
      `INSERT INTO test_runs (platform, environment, branch, commit_hash, started_at, status)
       VALUES ($1, $2, $3, $4, NOW(), 'running')`,
      [platform, environment || 'local', branch || null, commit_hash || null]
    );

    // Get the inserted run
    const result = await client.query(
      'SELECT * FROM test_runs ORDER BY id DESC LIMIT 1'
    );

    res.status(201).json({ run: result.rows[0] });
  } catch (err) {
    console.error('Error creating test run:', err);
    res.status(500).json({ message: 'Failed to create test run' });
  } finally {
    client.release();
  }
});

// Add a test suite to a run
router.post('/runs/:runId/suites', apiKeyAuth, async (req, res) => {
  const { runId } = req.params;
  const { name, file_path } = req.body;
  const client = await getClient();

  try {
    if (!name) {
      return res.status(400).json({ message: 'Suite name is required' });
    }

    await client.query(
      `INSERT INTO test_suites (test_run_id, name, file_path, started_at, status)
       VALUES ($1, $2, $3, NOW(), 'running')`,
      [runId, name, file_path || null]
    );

    const result = await client.query(
      'SELECT * FROM test_suites WHERE test_run_id = $1 ORDER BY id DESC LIMIT 1',
      [runId]
    );

    res.status(201).json({ suite: result.rows[0] });
  } catch (err) {
    console.error('Error creating test suite:', err);
    res.status(500).json({ message: 'Failed to create test suite' });
  } finally {
    client.release();
  }
});

// Add a test case to a suite
router.post('/suites/:suiteId/cases', apiKeyAuth, async (req, res) => {
  const { suiteId } = req.params;
  const { name, status, duration_ms, error_message, error_stack } = req.body;
  const client = await getClient();

  try {
    if (!name) {
      return res.status(400).json({ message: 'Test case name is required' });
    }

    await client.query(
      `INSERT INTO test_cases (test_suite_id, name, status, duration_ms, started_at, ended_at, error_message, error_stack)
       VALUES ($1, $2, $3, $4, NOW(), NOW(), $5, $6)`,
      [suiteId, name, status || 'pending', duration_ms || null, error_message || null, error_stack || null]
    );

    const result = await client.query(
      'SELECT * FROM test_cases WHERE test_suite_id = $1 ORDER BY id DESC LIMIT 1',
      [suiteId]
    );

    res.status(201).json({ testCase: result.rows[0] });
  } catch (err) {
    console.error('Error creating test case:', err);
    res.status(500).json({ message: 'Failed to create test case' });
  } finally {
    client.release();
  }
});

// Complete a test suite (update counts and status)
router.put('/suites/:suiteId/complete', apiKeyAuth, async (req, res) => {
  const { suiteId } = req.params;
  const { duration_ms } = req.body;
  const client = await getClient();

  try {
    // Calculate counts from test cases
    const countsResult = await client.query(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) as passed,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
         SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped
       FROM test_cases WHERE test_suite_id = $1`,
      [suiteId]
    );

    const counts = countsResult.rows[0];
    const status = counts.failed > 0 ? 'failed' : 'passed';

    await client.query(
      `UPDATE test_suites
       SET ended_at = NOW(), duration_ms = $1, status = $2,
           total_tests = $3, passed_tests = $4, failed_tests = $5, skipped_tests = $6
       WHERE id = $7`,
      [duration_ms || null, status, counts.total, counts.passed, counts.failed, counts.skipped, suiteId]
    );

    const result = await client.query('SELECT * FROM test_suites WHERE id = $1', [suiteId]);
    res.json({ suite: result.rows[0] });
  } catch (err) {
    console.error('Error completing test suite:', err);
    res.status(500).json({ message: 'Failed to complete test suite' });
  } finally {
    client.release();
  }
});

// Complete a test run (update counts and status)
router.put('/runs/:runId/complete', apiKeyAuth, async (req, res) => {
  const { runId } = req.params;
  const client = await getClient();

  try {
    // Calculate counts from all test cases in this run
    const countsResult = await client.query(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN tc.status = 'passed' THEN 1 ELSE 0 END) as passed,
         SUM(CASE WHEN tc.status = 'failed' THEN 1 ELSE 0 END) as failed,
         SUM(CASE WHEN tc.status = 'skipped' THEN 1 ELSE 0 END) as skipped
       FROM test_cases tc
       JOIN test_suites ts ON tc.test_suite_id = ts.id
       WHERE ts.test_run_id = $1`,
      [runId]
    );

    const counts = countsResult.rows[0];
    const status = counts.failed > 0 ? 'failed' : 'completed';

    await client.query(
      `UPDATE test_runs
       SET ended_at = NOW(), status = $1,
           total_tests = $2, passed_tests = $3, failed_tests = $4, skipped_tests = $5
       WHERE id = $6`,
      [status, counts.total, counts.passed, counts.failed, counts.skipped, runId]
    );

    const result = await client.query('SELECT * FROM test_runs WHERE id = $1', [runId]);
    res.json({ run: result.rows[0] });
  } catch (err) {
    console.error('Error completing test run:', err);
    res.status(500).json({ message: 'Failed to complete test run' });
  } finally {
    client.release();
  }
});

// Bulk report - submit entire run with all suites and cases at once
router.post('/runs/bulk', apiKeyAuth, async (req, res) => {
  const { platform, environment, branch, commit_hash, suites } = req.body;
  const client = await getClient();

  try {
    if (!platform || !['web', 'android'].includes(platform)) {
      return res.status(400).json({ message: 'Platform must be "web" or "android"' });
    }

    if (!suites || !Array.isArray(suites)) {
      return res.status(400).json({ message: 'Suites array is required' });
    }

    await client.beginTransaction();

    // Calculate totals
    let totalTests = 0, passedTests = 0, failedTests = 0, skippedTests = 0;

    for (const suite of suites) {
      for (const test of (suite.tests || [])) {
        totalTests++;
        if (test.status === 'passed') passedTests++;
        else if (test.status === 'failed') failedTests++;
        else if (test.status === 'skipped') skippedTests++;
      }
    }

    const runStatus = failedTests > 0 ? 'failed' : 'completed';

    // Insert test run
    await client.query(
      `INSERT INTO test_runs (platform, environment, branch, commit_hash, started_at, ended_at,
         total_tests, passed_tests, failed_tests, skipped_tests, status)
       VALUES ($1, $2, $3, $4, NOW(), NOW(), $5, $6, $7, $8, $9)`,
      [platform, environment || 'local', branch || null, commit_hash || null,
       totalTests, passedTests, failedTests, skippedTests, runStatus]
    );

    // Get the run ID
    const runResult = await client.query('SELECT id FROM test_runs ORDER BY id DESC LIMIT 1');
    const runId = runResult.rows[0].id;

    // Insert suites and cases
    for (const suite of suites) {
      let suitePassed = 0, suiteFailed = 0, suiteSkipped = 0;

      for (const test of (suite.tests || [])) {
        if (test.status === 'passed') suitePassed++;
        else if (test.status === 'failed') suiteFailed++;
        else if (test.status === 'skipped') suiteSkipped++;
      }

      const suiteStatus = suiteFailed > 0 ? 'failed' : 'passed';

      await client.query(
        `INSERT INTO test_suites (test_run_id, name, file_path, category, started_at, ended_at, duration_ms,
           total_tests, passed_tests, failed_tests, skipped_tests, status)
         VALUES ($1, $2, $3, $4, NOW(), NOW(), $5, $6, $7, $8, $9, $10)`,
        [runId, suite.name, suite.file_path || null, suite.category || null, suite.duration_ms || null,
         suite.tests?.length || 0, suitePassed, suiteFailed, suiteSkipped, suiteStatus]
      );

      // Get suite ID
      const suiteResult = await client.query(
        'SELECT id FROM test_suites WHERE test_run_id = $1 ORDER BY id DESC LIMIT 1',
        [runId]
      );
      const suiteId = suiteResult.rows[0].id;

      // Insert test cases
      for (const test of (suite.tests || [])) {
        await client.query(
          `INSERT INTO test_cases (test_suite_id, name, status, duration_ms, started_at, ended_at, error_message, error_stack)
           VALUES ($1, $2, $3, $4, NOW(), NOW(), $5, $6)`,
          [suiteId, test.name, test.status || 'pending', test.duration_ms || null,
           test.error_message || null, test.error_stack || null]
        );
      }
    }

    await client.commit();

    // Fetch the complete run with all data
    const result = await client.query('SELECT * FROM test_runs WHERE id = $1', [runId]);
    res.status(201).json({ run: result.rows[0] });
  } catch (err) {
    await client.rollback();
    console.error('Error creating bulk test run:', err);
    res.status(500).json({ message: 'Failed to create test run' });
  } finally {
    client.release();
  }
});

// ============================================
// ADMIN ENDPOINTS (for viewing results)
// ============================================

// Get all test runs (paginated)
router.get('/runs', authenticate, async (req, res) => {
  const { page = 1, limit = 20, platform, status } = req.query;
  const offset = (page - 1) * limit;
  const client = await getClient();

  try {
    let whereClause = '';
    const params = [];
    let paramIndex = 1;

    if (platform) {
      whereClause += ` WHERE platform = $${paramIndex++}`;
      params.push(platform);
    }

    if (status) {
      whereClause += whereClause ? ' AND' : ' WHERE';
      whereClause += ` status = $${paramIndex++}`;
      params.push(status);
    }

    // Get total count
    const countResult = await client.query(
      `SELECT COUNT(*) as total FROM test_runs${whereClause}`,
      params
    );

    // Get runs
    params.push(limit, offset);
    const result = await client.query(
      `SELECT * FROM test_runs${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
    );

    res.json({
      runs: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].total),
        pages: Math.ceil(countResult.rows[0].total / limit)
      }
    });
  } catch (err) {
    console.error('Error fetching test runs:', err);
    res.status(500).json({ message: 'Failed to fetch test runs' });
  } finally {
    client.release();
  }
});

// Get a single test run with all suites and cases
router.get('/runs/:runId', authenticate, async (req, res) => {
  const { runId } = req.params;
  const client = await getClient();

  try {
    // Get the run
    const runResult = await client.query(
      'SELECT * FROM test_runs WHERE id = $1',
      [runId]
    );

    if (runResult.rowCount === 0) {
      return res.status(404).json({ message: 'Test run not found' });
    }

    // Get suites
    const suitesResult = await client.query(
      'SELECT * FROM test_suites WHERE test_run_id = $1 ORDER BY id',
      [runId]
    );

    // Get all cases for these suites
    const suiteIds = suitesResult.rows.map(s => s.id);
    let cases = [];

    if (suiteIds.length > 0) {
      const casesResult = await client.query(
        `SELECT * FROM test_cases WHERE test_suite_id IN (${suiteIds.map((_, i) => `$${i + 1}`).join(',')}) ORDER BY id`,
        suiteIds
      );
      cases = casesResult.rows;
    }

    // Attach cases to their suites
    const suites = suitesResult.rows.map(suite => ({
      ...suite,
      cases: cases.filter(c => c.test_suite_id === suite.id)
    }));

    res.json({
      run: runResult.rows[0],
      suites
    });
  } catch (err) {
    console.error('Error fetching test run:', err);
    res.status(500).json({ message: 'Failed to fetch test run' });
  } finally {
    client.release();
  }
});

// Delete a test run
router.delete('/runs/:runId', authenticate, async (req, res) => {
  const { runId } = req.params;
  const client = await getClient();

  try {
    const result = await client.query('DELETE FROM test_runs WHERE id = $1', [runId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Test run not found' });
    }

    res.json({ message: 'Test run deleted successfully' });
  } catch (err) {
    console.error('Error deleting test run:', err);
    res.status(500).json({ message: 'Failed to delete test run' });
  } finally {
    client.release();
  }
});

module.exports = router;
