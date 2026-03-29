/** Tipos compartidos: GET /api/reportes y métricas dentro de GET /api/dashboard/daily-summary. */

export interface CurrencyAmount {
  currency_id: string;
  currency_code: string;
  amount: string;
}

export interface ReportSection {
  by_currency: CurrencyAmount[];
}

/** Bloque utilidad / profit / gastos / resultado (misma forma en reportes y dashboard). */
export interface ReportMetrics {
  utilidad: ReportSection;
  profit: ReportSection;
  gastos: ReportSection;
  resultado: ReportSection;
}

/** Respuesta de GET /api/reportes?from=&to= */
export type ReportData = ReportMetrics;

/** Respuesta de GET /api/dashboard/daily-summary?date= */
export interface DailySummary {
  reference_date: string;
  compare_date: string;
  reference: ReportMetrics;
  compare: ReportMetrics;
  definitions: Record<string, string>;
}

export type ReportMetricKey = keyof ReportMetrics;
