-- Add 'mashup' as a valid session_type so merged recordings are stored distinctly
-- from plain individual recordings and can be shown in the Mashups section only.
ALTER TABLE sessions MODIFY COLUMN session_type ENUM('band', 'individual', 'mashup') NOT NULL DEFAULT 'band';
