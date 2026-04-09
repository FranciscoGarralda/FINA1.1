-- Arqueo por divisa + formato (CASH / DIGITAL).
-- Histórico: las filas existentes se marcan como CASH (no había desglose real).

BEGIN;

ALTER TABLE cash_arqueo_lines
    ADD COLUMN line_format TEXT NOT NULL DEFAULT 'CASH';

ALTER TABLE cash_arqueo_lines DROP CONSTRAINT IF EXISTS cash_arqueo_lines_cash_arqueo_id_currency_id_key;

ALTER TABLE cash_arqueo_lines
    ADD CONSTRAINT cash_arqueo_lines_line_format_check CHECK (line_format IN ('CASH', 'DIGITAL'));

ALTER TABLE cash_arqueo_lines
    ADD CONSTRAINT cash_arqueo_lines_arqueo_currency_format_key UNIQUE (cash_arqueo_id, currency_id, line_format);

COMMIT;
