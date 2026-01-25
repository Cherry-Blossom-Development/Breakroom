-- Test results tracking for BreakTest suite
-- Stores results from web and mobile test runs

-- Test runs - represents a single execution of the test suite
CREATE TABLE test_runs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  platform ENUM('web', 'android') NOT NULL,
  environment VARCHAR(32) DEFAULT 'local',
  branch VARCHAR(128),
  commit_hash VARCHAR(40),
  started_at TIMESTAMP NULL,
  ended_at TIMESTAMP NULL,
  total_tests INT DEFAULT 0,
  passed_tests INT DEFAULT 0,
  failed_tests INT DEFAULT 0,
  skipped_tests INT DEFAULT 0,
  status ENUM('running', 'completed', 'failed', 'cancelled') DEFAULT 'running',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Test suites - represents a describe() block
CREATE TABLE test_suites (
  id INT AUTO_INCREMENT PRIMARY KEY,
  test_run_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  file_path VARCHAR(512),
  category VARCHAR(64),
  started_at TIMESTAMP NULL,
  ended_at TIMESTAMP NULL,
  duration_ms INT,
  total_tests INT DEFAULT 0,
  passed_tests INT DEFAULT 0,
  failed_tests INT DEFAULT 0,
  skipped_tests INT DEFAULT 0,
  status ENUM('running', 'passed', 'failed', 'skipped') DEFAULT 'running',
  FOREIGN KEY (test_run_id) REFERENCES test_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Test cases - represents an it() block
CREATE TABLE test_cases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  test_suite_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  status ENUM('passed', 'failed', 'skipped', 'pending', 'running') DEFAULT 'pending',
  duration_ms INT,
  started_at TIMESTAMP NULL,
  ended_at TIMESTAMP NULL,
  error_message TEXT,
  error_stack TEXT,
  FOREIGN KEY (test_suite_id) REFERENCES test_suites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Indexes for common queries
CREATE INDEX idx_test_runs_platform ON test_runs(platform);
CREATE INDEX idx_test_runs_status ON test_runs(status);
CREATE INDEX idx_test_runs_created_at ON test_runs(created_at);
CREATE INDEX idx_test_suites_run_id ON test_suites(test_run_id);
CREATE INDEX idx_test_suites_category ON test_suites(category);
CREATE INDEX idx_test_cases_suite_id ON test_cases(test_suite_id);
CREATE INDEX idx_test_cases_status ON test_cases(status);
