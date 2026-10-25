-- Migration 095: Anonymous surveys (greywirestudio.com "Your Opinion")
-- The website's survey forms post here through nginx; no account is needed.
-- Every submission is kept. To keep the numbers honest, a new submission from
-- the same connection and browser as earlier ones marks those earlier ones
-- is_valid = 0, so only the newest counts. The IP address and browser details
-- are stored only as keyed one-way hashes (backend/utilities/surveys.js): they
-- match exactly, but can't be read back.

CREATE TABLE survey_responses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  survey VARCHAR(50) NOT NULL,                  -- survey slug, e.g. 'musician'
  answers LONGTEXT NOT NULL CHECK (JSON_VALID(answers)),
  ip_hash CHAR(64) NOT NULL,
  browser_hash CHAR(64) NOT NULL,               -- user agent, languages, client hints
  is_valid TINYINT(1) NOT NULL DEFAULT 1,       -- set by the system, never by the visitor
  superseded_by INT NULL,                       -- the later submission that replaced this one
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_survey_match (survey, ip_hash, browser_hash),
  INDEX idx_survey_valid (survey, is_valid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
