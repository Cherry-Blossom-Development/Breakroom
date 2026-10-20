-- Migration 092: Starter chat rooms for the Greywire community
-- Default, discoverable rooms on the Greywire site. New members join them
-- when they claim a pedal or are granted membership (joinDefaultRooms in
-- backend/utilities/greywire.js), since most members will be existing
-- accounts that never signed up on the Greywire site. Rename or add rooms
-- freely; anything with is_default = true and site = 'greywire' is joined.

INSERT INTO chat_rooms (name, description, is_active, is_default, discoverable, site) VALUES
  ('General', 'Say hello to other Greywire players.', true, true, true, 'greywire'),
  ('Gear and Tone', 'Pedals, amps, settings and the sounds you are chasing.', true, true, true, 'greywire'),
  ('Gigs and Bands', 'Shows, practice, and finding people to play with.', true, true, true, 'greywire');

-- Anyone who is already a member joins them now
INSERT IGNORE INTO users_rooms (user_id, room_id, accepted)
SELECT u.id, r.id, true
FROM users u
JOIN chat_rooms r ON r.site = 'greywire' AND r.is_default = true AND r.is_active = true
WHERE u.is_guest = FALSE
  AND (u.greywire_granted_at IS NOT NULL
       OR EXISTS (SELECT 1 FROM greywire_pedals p WHERE p.claimed_by = u.id));
