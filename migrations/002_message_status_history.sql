CREATE TABLE message_status_history (
    id BIGSERIAL PRIMARY KEY,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_message_status_history_message
    ON message_status_history(message_id, created_at);

CREATE OR REPLACE FUNCTION record_message_status()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO message_status_history (message_id, status)
        VALUES (NEW.id, NEW.status);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER record_message_status_trigger
AFTER INSERT OR UPDATE OF status ON messages
FOR EACH ROW EXECUTE FUNCTION record_message_status();
