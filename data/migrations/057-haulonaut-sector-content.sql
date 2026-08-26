-- Migration 057: Sector descriptions and contents (planets, trading
-- outposts, and future unknowns)
--
-- haulonaut_sectors.description: every sector's own flavor text, shown
-- regardless of what's in it. Nullable/settable rather than generated at
-- the DB layer -- "configurable" per the request, currently populated by
-- the universe generator picking from a pool, but not tied to it.
--
-- haulonaut_sector_features: a generic "what's here" table rather than one
-- table per content type. feature_type is a plain VARCHAR, not an ENUM, so
-- a brand new content type never needs a migration to introduce -- just a
-- new feature_type value from app code. name + description cover what's
-- been asked for (planets, trading outposts) with room for whatever comes
-- next; if some future type needs real structured data (e.g. trading
-- outposts eventually needing actual commodity prices), that's a proper
-- follow-up table FK'd to this row's id at that point, not something to
-- guess the shape of now. No uniqueness constraint on (sector_id,
-- feature_type) -- nothing says a sector can't eventually hold more than
-- one of the same kind of thing.
--
-- "Other players in a sector" is deliberately NOT a table here -- it's
-- just a live query over haulonaut_pilots.current_sector_id, joined to
-- game_users. No new storage needed for that one.

ALTER TABLE haulonaut_sectors ADD COLUMN description TEXT NULL AFTER sector_number;

CREATE TABLE haulonaut_sector_features (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sector_id INT NOT NULL,
  feature_type VARCHAR(32) NOT NULL,
  name VARCHAR(128) NOT NULL,
  description TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sector_id) REFERENCES haulonaut_sectors(id) ON DELETE CASCADE,
  INDEX idx_sector_features_sector (sector_id),
  INDEX idx_sector_features_type (feature_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
