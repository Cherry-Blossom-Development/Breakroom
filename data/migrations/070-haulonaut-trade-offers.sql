-- Migration 070: Player-to-player trade offers
--
-- Second of three planned pieces (chat, trading, combat) for what happens
-- when characters share a sector. Scope is deliberately narrow: one
-- character (the item-holder) offers a fixed quantity of ONE item from
-- their own haulonaut_pilot_inventory in exchange for a fixed amount of
-- credits from a specific other character -- not a general multi-item
-- negotiation or counter-offer system. A direct credit gift (no item,
-- no acceptance needed) doesn't need a row here at all -- it's just two
-- UPDATEs on haulonaut_pilots.credits in one transaction (see games.js's
-- /give route).
--
-- Both sides are re-validated at accept time (still in the same sector,
-- proposer still holds the item, target still has the credits) rather than
-- trusting whatever was true when the offer was created -- exactly like
-- the existing /purchase route re-checks the pilot's sector and balance
-- server-side instead of trusting the client. There's no expiry column:
-- a stale offer (proposer warped away, spent the item, or the target ran
-- out of credits) simply fails that re-validation with a clear error
-- instead of silently succeeding.

CREATE TABLE haulonaut_trade_offers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  from_game_user_id INT NOT NULL,
  to_game_user_id INT NOT NULL,
  item_id INT NOT NULL,
  quantity INT NOT NULL,
  credits INT NOT NULL,
  status ENUM('pending', 'accepted', 'declined') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  FOREIGN KEY (from_game_user_id) REFERENCES game_users(id) ON DELETE CASCADE,
  FOREIGN KEY (to_game_user_id) REFERENCES game_users(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES haulonaut_items(id) ON DELETE CASCADE,
  INDEX idx_trade_offers_to (to_game_user_id, status),
  INDEX idx_trade_offers_from (from_game_user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
