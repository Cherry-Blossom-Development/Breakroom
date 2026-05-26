ALTER TABLE user_collections ADD COLUMN display_order INT NOT NULL DEFAULT 0;

-- Initialize per-user sequential ordering based on existing created_at DESC
UPDATE user_collections uc
  JOIN (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
    FROM user_collections
  ) r ON uc.id = r.id
SET uc.display_order = r.rn;
