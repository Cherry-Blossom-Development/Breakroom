-- Migration 082: Project settings + project members
--
-- sprint_duration_days: the project's sprint length (Settings page). Stored
-- in days; the UI offers 1-4 weeks. Defaults to two weeks.
--
-- project_members: people invited to a project, with a role. Company
-- employees keep their existing access to every project regardless; a
-- membership row is what gives a NON-employee access to one project, and
-- what decides who manages the project's settings and members:
--   owner   - manage settings and members, including other owners
--   manager - manage settings and members (except owners)
--   member  - view and work the project's tickets
--   viewer  - view only (non-employees)
-- Company owners/admins can always manage a project, so existing projects
-- (which have no members yet) stay manageable. No backfill: projects never
-- recorded a creator, so ownership starts with projects created from here on.

ALTER TABLE projects
  ADD COLUMN sprint_duration_days INT NOT NULL DEFAULT 14;

CREATE TABLE project_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  user_id INT NOT NULL,
  role ENUM('owner', 'manager', 'member', 'viewer') NOT NULL DEFAULT 'member',
  status ENUM('invited', 'active', 'declined') NOT NULL DEFAULT 'invited',
  invited_by INT NULL,
  invited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  joined_at TIMESTAMP NULL,
  UNIQUE KEY uq_project_member (project_id, user_id),
  INDEX idx_project_members_user (user_id, status),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
