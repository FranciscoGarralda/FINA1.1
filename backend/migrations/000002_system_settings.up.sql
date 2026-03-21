BEGIN;

CREATE TABLE system_settings (
    key                VARCHAR PRIMARY KEY,
    value_json         JSONB NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by_user_id UUID NULL REFERENCES users(id)
);

COMMIT;
