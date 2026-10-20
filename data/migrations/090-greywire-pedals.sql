-- Migration 090: Greywire pedal registry and membership
-- Only Greywire members can use community.greywirestudio.com. Someone
-- becomes a member by claiming a pedal's serial (the 64-bit unique ID of the
-- pedal's flash chip, read over MIDI), or by an admin granting it by hand.
-- Membership is worked out from these two sources rather than stored, so
-- transferring a pedal to its new owner takes the old owner's access with it
-- (see backend/utilities/greywire.js).

-- Every pedal built, recorded at build time. Each serial can be claimed once.
CREATE TABLE greywire_pedals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  model VARCHAR(50) NOT NULL,
  serial CHAR(16) NOT NULL,           -- 16 uppercase hex digits
  build_date DATE NULL,
  notes VARCHAR(255) NULL,
  claimed_by INT NULL,
  claimed_at DATETIME NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_greywire_pedals_serial (serial),
  INDEX idx_greywire_pedals_claimed_by (claimed_by),
  FOREIGN KEY (claimed_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Who held each pedal and when, for resale questions and disputes.
CREATE TABLE greywire_pedal_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pedal_id INT NOT NULL,
  event ENUM('added', 'claimed', 'transferred', 'released') NOT NULL,
  from_user_id INT NULL,
  to_user_id INT NULL,
  by_user_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_greywire_pedal_events_pedal (pedal_id),
  FOREIGN KEY (pedal_id) REFERENCES greywire_pedals(id) ON DELETE CASCADE,
  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Membership granted by hand (until pedals exist, and for staff or testers)
ALTER TABLE users
  ADD COLUMN greywire_granted_at DATETIME NULL,
  ADD COLUMN greywire_granted_by INT NULL;
