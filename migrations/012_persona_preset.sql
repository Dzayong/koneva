-- Which preset a number was last set to (NULL = hand-tuned).
ALTER TABLE device_personas ADD COLUMN IF NOT EXISTS preset VARCHAR(30);
