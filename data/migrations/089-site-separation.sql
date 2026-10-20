-- Migration 089: Keep each site's content apart
-- One backend serves Prosaurus and the Greywire Studio community
-- (community.greywirestudio.com). Accounts are shared, but chat rooms,
-- sessions and bands each belong to one site; the backend reads req.site
-- (see backend/utilities/site.js) and only lists that site's content.
-- DMs (chat_rooms.type = 'dm') are shared and ignore the column.
-- Shortlists follow their band, so they need no column of their own.
-- Everything that exists today stays on Prosaurus.

ALTER TABLE chat_rooms
  ADD COLUMN site ENUM('prosaurus', 'greywire') NOT NULL DEFAULT 'prosaurus';

-- Room names only need to be unique within a site. The original UNIQUE on
-- name (data/2-chat.sql) gets MariaDB's default index name, `name`.
ALTER TABLE chat_rooms DROP INDEX IF EXISTS name;
ALTER TABLE chat_rooms ADD UNIQUE KEY uq_chat_rooms_site_name (site, name);

ALTER TABLE sessions
  ADD COLUMN site ENUM('prosaurus', 'greywire') NOT NULL DEFAULT 'prosaurus',
  ADD INDEX idx_sessions_site_user (site, user_id);

ALTER TABLE bands
  ADD COLUMN site ENUM('prosaurus', 'greywire') NOT NULL DEFAULT 'prosaurus',
  ADD INDEX idx_bands_site (site);

-- Which site each account signed up on (for branding emails later)
ALTER TABLE users
  ADD COLUMN signup_site ENUM('prosaurus', 'greywire') NOT NULL DEFAULT 'prosaurus';
