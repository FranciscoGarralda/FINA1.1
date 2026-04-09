-- Revierte formato por línea. Pierde filas DIGITAL (datos posteriores al upgrade).
-- Solo usar si no hay dos líneas por misma divisa en un arqueo.

BEGIN;

DELETE FROM cash_arqueo_lines WHERE line_format = 'DIGITAL';

ALTER TABLE cash_arqueo_lines DROP CONSTRAINT IF EXISTS cash_arqueo_lines_arqueo_currency_format_key;
ALTER TABLE cash_arqueo_lines DROP CONSTRAINT IF EXISTS cash_arqueo_lines_line_format_check;

ALTER TABLE cash_arqueo_lines DROP COLUMN IF EXISTS line_format;

ALTER TABLE cash_arqueo_lines
    ADD CONSTRAINT cash_arqueo_lines_cash_arqueo_id_currency_id_key UNIQUE (cash_arqueo_id, currency_id);

COMMIT;
