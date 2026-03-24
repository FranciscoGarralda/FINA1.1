-- Departamento del cliente: opcional, texto libre (listado y ficha).
ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS department VARCHAR(255) NULL;
