BEGIN;

CREATE TABLE movement_drafts (
    movement_id        UUID PRIMARY KEY REFERENCES movements(id) ON DELETE CASCADE,
    payload            JSONB NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by_user_id UUID NOT NULL REFERENCES users(id)
);

CREATE INDEX idx_movement_drafts_updated_at ON movement_drafts(updated_at DESC);

COMMIT;
