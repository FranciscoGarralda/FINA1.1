BEGIN;

CREATE TABLE movement_corrections (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_movement_id UUID NOT NULL REFERENCES movements(id),
    draft_movement_id  UUID NOT NULL UNIQUE REFERENCES movements(id) ON DELETE CASCADE,
    mode               VARCHAR NOT NULL CHECK (mode IN ('MODIFY', 'RECREATE')),
    status             VARCHAR NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPLIED')),
    created_by_user_id UUID NOT NULL REFERENCES users(id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_at         TIMESTAMPTZ NULL
);

CREATE INDEX idx_movement_corrections_source ON movement_corrections(source_movement_id);

COMMIT;
