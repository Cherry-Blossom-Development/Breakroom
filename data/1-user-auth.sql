-- MariaDB/MySQL schema for Breakroom

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  handle VARCHAR(32) UNIQUE NOT NULL,
  first_name VARCHAR(32),
  last_name VARCHAR(32),
  email VARCHAR(255) UNIQUE NOT NULL,
  email_verified BOOLEAN DEFAULT FALSE,
  verification_token VARCHAR(64),
  verification_expires_at TIMESTAMP NULL,
  hash VARCHAR(64),
  salt VARCHAR(32),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) UNIQUE NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `groups` (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) UNIQUE NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- User-permission direct assignments
CREATE TABLE user_permissions (
  user_id INT NOT NULL,
  permission_id INT NOT NULL,
  PRIMARY KEY (user_id, permission_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Group-permission assignments
CREATE TABLE group_permissions (
  group_id INT NOT NULL,
  permission_id INT NOT NULL,
  PRIMARY KEY (group_id, permission_id),
  FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- User-group assignments
CREATE TABLE user_groups (
  user_id INT NOT NULL,
  group_id INT NOT NULL,
  PRIMARY KEY (user_id, group_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES `groups`(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert basic groups/permissions

-- Administrator Group
INSERT INTO `groups` (name, description) VALUES
  ('Administrator', 'Can perform all actions');

-- Administrator Permissions
INSERT INTO permissions (name, description) VALUES
  ('create_user', 'Ability to create new users'),
  ('read_user', 'Ability to read user information'),
  ('update_user', 'Ability to update users'),
  ('delete_user', 'Ability to delete user');

-- Group Leader Group
INSERT INTO `groups` (name, description) VALUES
  ('Group Leader', 'Can manage self and other group members');

-- Group Leader Permissions (CRUD for groups)
INSERT INTO permissions (name, description) VALUES
  ('create_group', 'Ability to create new groups'),
  ('read_group', 'Ability to view group information'),
  ('update_group', 'Ability to modify group details'),
  ('delete_group', 'Ability to remove groups');

-- Billing Manager Group
INSERT INTO `groups` (name, description) VALUES
  ('Billing Manager', 'Can manage billing');

-- Billing Manager Permissions (CRUD for billing methods)
INSERT INTO permissions (name, description) VALUES
  ('create_billing', 'Ability to create billing methods'),
  ('read_billing', 'Ability to view billing information'),
  ('update_billing', 'Ability to update billing details'),
  ('delete_billing', 'Ability to remove billing methods');

-- Standard User Group
INSERT INTO `groups` (name, description) VALUES
  ('Standard', 'Can interact with social network');

-- Standard User Permissions (CRUD for posts)
INSERT INTO permissions (name, description) VALUES
  ('create_post', 'Ability to create new posts'),
  ('read_post', 'Ability to read posts'),
  ('update_post', 'Ability to edit posts'),
  ('delete_post', 'Ability to delete posts');

-- Restricted User Group
INSERT INTO `groups` (name, description) VALUES
  ('Restricted', 'Limited interaction with social network');

-- Restricted Permissions (CRUD for approved posts)
INSERT INTO permissions (name, description) VALUES
  ('create_approved_post', 'Ability to create approved posts'),
  ('read_approved_post', 'Ability to view approved posts'),
  ('update_approved_post', 'Ability to edit approved posts'),
  ('delete_approved_post', 'Ability to delete approved posts');

-- Administrator: Full access to user management
INSERT INTO group_permissions (group_id, permission_id)
SELECT g.id, p.id FROM `groups` g, permissions p
WHERE g.name = 'Administrator' AND p.name = 'create_user';

INSERT INTO group_permissions (group_id, permission_id)
SELECT g.id, p.id FROM `groups` g, permissions p
WHERE g.name = 'Administrator' AND p.name = 'read_user';

INSERT INTO group_permissions (group_id, permission_id)
SELECT g.id, p.id FROM `groups` g, permissions p
WHERE g.name = 'Administrator' AND p.name = 'update_user';

INSERT INTO group_permissions (group_id, permission_id)
SELECT g.id, p.id FROM `groups` g, permissions p
WHERE g.name = 'Administrator' AND p.name = 'delete_user';

-- Group Leader: Manage groups
INSERT INTO group_permissions (group_id, permission_id)
SELECT g.id, p.id FROM `groups` g, permissions p
WHERE g.name = 'Group Leader' AND p.name = 'create_group';

INSERT INTO group_permissions (group_id, permission_id)
SELECT g.id, p.id FROM `groups` g, permissions p
WHERE g.name = 'Group Leader' AND p.name = 'read_group';

INSERT INTO group_permissions (group_id, permission_id)
SELECT g.id, p.id FROM `groups` g, permissions p
WHERE g.name = 'Group Leader' AND p.name = 'update_group';

INSERT INTO group_permissions (group_id, permission_id)
SELECT g.id, p.id FROM `groups` g, permissions p
WHERE g.name = 'Group Leader' AND p.name = 'delete_group';

-- Billing Manager: Manage billing methods
INSERT INTO group_permissions (group_id, permission_id)
SELECT g.id, p.id FROM `groups` g, permissions p
WHERE g.name = 'Billing Manager' AND p.name = 'create_billing';

INSERT INTO group_permissions (group_id, permission_id)
SELECT g.id, p.id FROM `groups` g, permissions p
WHERE g.name = 'Billing Manager' AND p.name = 'read_billing';

INSERT INTO group_permissions (group_id, permission_id)
SELECT g.id, p.id FROM `groups` g, permissions p
WHERE g.name = 'Billing Manager' AND p.name = 'update_billing';

INSERT INTO group_permissions (group_id, permission_id)
SELECT g.id, p.id FROM `groups` g, permissions p
WHERE g.name = 'Billing Manager' AND p.name = 'delete_billing';

-- Standard: Can interact with the social network
INSERT INTO group_permissions (group_id, permission_id)
SELECT g.id, p.id FROM `groups` g, permissions p
WHERE g.name = 'Standard' AND p.name = 'create_post';

INSERT INTO group_permissions (group_id, permission_id)
SELECT g.id, p.id FROM `groups` g, permissions p
WHERE g.name = 'Standard' AND p.name = 'read_post';

INSERT INTO group_permissions (group_id, permission_id)
SELECT g.id, p.id FROM `groups` g, permissions p
WHERE g.name = 'Standard' AND p.name = 'update_post';

INSERT INTO group_permissions (group_id, permission_id)
SELECT g.id, p.id FROM `groups` g, permissions p
WHERE g.name = 'Standard' AND p.name = 'delete_post';

-- Restricted: Limited to approved posts only
INSERT INTO group_permissions (group_id, permission_id)
SELECT g.id, p.id FROM `groups` g, permissions p
WHERE g.name = 'Restricted' AND p.name = 'create_approved_post';

INSERT INTO group_permissions (group_id, permission_id)
SELECT g.id, p.id FROM `groups` g, permissions p
WHERE g.name = 'Restricted' AND p.name = 'read_approved_post';

INSERT INTO group_permissions (group_id, permission_id)
SELECT g.id, p.id FROM `groups` g, permissions p
WHERE g.name = 'Restricted' AND p.name = 'update_approved_post';

INSERT INTO group_permissions (group_id, permission_id)
SELECT g.id, p.id FROM `groups` g, permissions p
WHERE g.name = 'Restricted' AND p.name = 'delete_approved_post';

CREATE TABLE IF NOT EXISTS user_fcm_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  fcm_token VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_token (fcm_token),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
