BEGIN;

DO $$
DECLARE
    c RECORD;
BEGIN
    FOR c IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = 'public'
          AND rel.relname = 'pending_items'
          AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) ILIKE '%type%'
    LOOP
        EXECUTE format('ALTER TABLE pending_items DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE pending_items
    ADD CONSTRAINT pending_items_type_check
    CHECK (
        type IN (
            'PENDIENTE_DE_PAGO',
            'PENDIENTE_DE_RETIRO',
            'PENDIENTE_DE_COBRO_COMISION',
            'PENDIENTE_DE_PAGO_COMISION'
        )
    );

COMMIT;
