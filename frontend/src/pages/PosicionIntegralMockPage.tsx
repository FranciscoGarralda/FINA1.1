import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatMoneyAR } from '../utils/money';

type PeriodoGenerado = 'dia' | 'semana' | 'mes';

/** Datos 100 % ficticios — solo maqueta de layout y jerarquía de totales → detalle. */
const MOCK_CAJA_EFECTIVO = [
  { cuenta: 'Caja F', divisa: 'USD', monto: 23900 },
  { cuenta: 'Caja R', divisa: 'USD', monto: 400 },
  { cuenta: 'Caja F', divisa: 'EUR', monto: 1680 },
  { cuenta: 'Caja R', divisa: 'ARS', monto: 560000 },
  { cuenta: 'Caja F', divisa: 'ARS', monto: 32000 },
];

const MOCK_CAJA_DIGITAL = [
  { cuenta: 'USD Digital F', divisa: 'USD', monto: 8200 },
  { cuenta: 'USD Digital R', divisa: 'USD', monto: 3100 },
  { cuenta: 'Mercury', divisa: 'USD', monto: 4500 },
  { cuenta: 'USDT F', divisa: 'USDT', monto: 2100 },
  { cuenta: 'USDT R', divisa: 'USDT', monto: 1800 },
  { cuenta: 'MP F', divisa: 'ARS', monto: 4731000 },
  { cuenta: 'MP R', divisa: 'ARS', monto: 1200000 },
];

const MOCK_PEND_RETIRO = [
  { cliente: 'Alan Cocilov', divisa: 'USD', monto: 1200, ref: '#1042' },
  { cliente: 'Emanuel Pesi', divisa: 'USD', monto: 890, ref: '#1045' },
  { cliente: 'Cecilia Valde', divisa: 'USD', monto: 1517, ref: '#1048' },
];

const MOCK_PEND_ENTREGA = [
  { cliente: 'Paula Barcia', divisa: 'USD', monto: 600, ref: '#1051' },
  { cliente: 'Valeria Galai', divisa: 'EUR', monto: 400, ref: '#1052' },
];

const MOCK_CC = [
  { cliente: 'Hector Legu', divisa: 'USD', saldo: 8200 },
  { cliente: 'More Exchan', divisa: 'USD', saldo: 5100 },
  { cliente: 'Jesus CC', divisa: 'USD', saldo: -3589 },
  { cliente: 'Luciana Vidal', divisa: 'ARS', saldo: 450000 },
];

const MOCK_GENERADO = {
  dia: {
    utilidadUsd: 1240,
    profitUsd: 180,
    gastosUsd: 320,
    resultadoUsd: 1100,
    nota: 'Ventana: solo hoy (ejemplo).',
  },
  semana: {
    utilidadUsd: 8420,
    profitUsd: 1210,
    gastosUsd: 2180,
    resultadoUsd: 7450,
    nota: 'Ventana: lun–dom de la semana del corte (ejemplo).',
  },
  mes: {
    utilidadUsd: 31200,
    profitUsd: 4800,
    gastosUsd: 8900,
    resultadoUsd: 27100,
    nota: 'Ventana: mes calendario del corte (ejemplo).',
  },
} as const;

function sum(rows: { monto?: number; saldo?: number }[], key: 'monto' | 'saldo') {
  return rows.reduce((a, r) => a + (key === 'monto' ? r.monto ?? 0 : r.saldo ?? 0), 0);
}

function Disclosure({
  id,
  title,
  subtitle,
  totalLabel,
  totalValue,
  children,
  defaultOpen = false,
}: {
  id: string;
  title: string;
  subtitle?: string;
  totalLabel: string;
  totalValue: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      id={id}
      className="rounded-lg border border-subtle bg-elevated overflow-hidden group"
      open={defaultOpen}
    >
      <summary className="cursor-pointer list-none px-4 py-3 flex flex-wrap items-center justify-between gap-2 hover:bg-surface/80 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="font-semibold text-fg block">{title}</span>
          {subtitle ? <span className="text-xs text-fg-muted block mt-0.5">{subtitle}</span> : null}
        </span>
        <span className="text-right shrink-0">
          <span className="text-xs text-fg-muted block">{totalLabel}</span>
          <span className="text-lg font-mono font-semibold text-fg">{totalValue}</span>
        </span>
        <span className="text-fg-muted text-sm w-full sm:w-auto sm:ml-2 group-open:hidden">Desplegar detalle</span>
        <span className="text-fg-muted text-sm w-full sm:w-auto sm:ml-2 hidden group-open:inline">Ocultar</span>
      </summary>
      <div className="border-t border-subtle px-4 py-3 bg-surface/40">{children}</div>
    </details>
  );
}

export default function PosicionIntegralMockPage() {
  const [periodo, setPeriodo] = useState<PeriodoGenerado>('dia');
  const [asOf] = useState('2026-01-22');

  const totalEfectivo = sum(MOCK_CAJA_EFECTIVO, 'monto');
  const totalDigital = sum(MOCK_CAJA_DIGITAL, 'monto');
  const totalRetiros = sum(MOCK_PEND_RETIRO, 'monto');
  const totalEntregas = sum(MOCK_PEND_ENTREGA, 'monto');
  const totalCcUsdEquivalente = 37156; // ficticio consolidado
  const gen = MOCK_GENERADO[periodo];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="rounded-lg border-2 border-brand/30 bg-brand-soft/30 px-4 py-3 space-y-2">
        <p className="text-sm font-semibold text-fg">Vista mock (solo diseño)</p>
        <p className="text-xs text-fg-muted leading-relaxed">
          Números y filas son <strong>ficticios</strong>. Sirve para validar nombres de totales, orden de bloques y el
          patrón «total → desplegable con detalle» sin salir de la pantalla. La implementación real enlazaría caja,
          pendientes, CC, reportes por rango, etc.
        </p>
        <Link
          to="/posicion-integral"
          className="text-sm font-medium text-brand hover:underline inline-block"
        >
          Ir a Posición integral (datos reales)
        </Link>
      </div>

      <div className="card-surface space-y-4">
        <h1 className="text-xl font-semibold text-fg">Posición integral — mock</h1>
        <div className="flex flex-wrap gap-4 items-end text-sm">
          <div>
            <span className="block text-xs text-fg-muted mb-0.5">Corte (stock)</span>
            <span className="input-field inline-block px-3 py-1.5 text-fg-muted">{asOf}</span>
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-fg-muted uppercase tracking-wide">Stock al corte</h2>
        <p className="text-xs text-fg-muted -mt-1">
          Todo lo que sigue sería «al día del corte»: saldos de libro, pendientes abiertos y CC. Aquí solo maqueta.
        </p>

        <Disclosure
          id="mock-efectivo"
          title="Efectivo en caja (todas las cuentas)"
          subtitle="En producción: suma CASH por cuenta/divisa; F/R si existen como cuentas o sububicaciones."
          totalLabel="Total referencia (mock)"
          totalValue={formatMoneyAR(totalEfectivo)}
        >
          <div className="table-scroll rounded border border-subtle">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-fg-muted border-b border-subtle bg-surface">
                  <th className="px-3 py-2">Cuenta</th>
                  <th className="px-3 py-2">Divisa</th>
                  <th className="px-3 py-2 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_CAJA_EFECTIVO.map((r, i) => (
                  <tr key={i} className="border-b border-subtle/60 last:border-0">
                    <td className="px-3 py-2 text-fg">{r.cuenta}</td>
                    <td className="px-3 py-2 font-medium">{r.divisa}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMoneyAR(r.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>

        <Disclosure
          id="mock-digital"
          title="Digital (todas las cuentas)"
          subtitle="En producción: filas DIGITAL de /cash-position; nombres = cuentas reales."
          totalLabel="Total referencia (mock)"
          totalValue={formatMoneyAR(totalDigital)}
        >
          <div className="table-scroll rounded border border-subtle">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-fg-muted border-b border-subtle bg-surface">
                  <th className="px-3 py-2">Cuenta / canal</th>
                  <th className="px-3 py-2">Divisa</th>
                  <th className="px-3 py-2 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_CAJA_DIGITAL.map((r, i) => (
                  <tr key={i} className="border-b border-subtle/60 last:border-0">
                    <td className="px-3 py-2 text-fg">{r.cuenta}</td>
                    <td className="px-3 py-2 font-medium">{r.divisa}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMoneyAR(r.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>

        <Disclosure
          id="mock-pend-retiro"
          title="Pendientes — Retiro (etiqueta UI «Retiro»)"
          subtitle="Suma obligaciones que en Pendientes se muestran como retiro (criterio a documentar en prod)."
          totalLabel="Total USD (mock)"
          totalValue={formatMoneyAR(totalRetiros)}
        >
          <ul className="space-y-2 text-sm">
            {MOCK_PEND_RETIRO.map((r, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 border-b border-subtle/50 pb-2 last:border-0">
                <span className="text-fg">{r.cliente}</span>
                <span className="font-mono text-fg-muted">
                  {r.divisa} {formatMoneyAR(r.monto)} <span className="text-xs">({r.ref})</span>
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>

        <Disclosure
          id="mock-pend-entrega"
          title="Pendientes — Entrega / salida (etiqueta «Entrega»)"
          subtitle="Bloque separado del de Retiro; en prod misma API /pendientes con otro filtro."
          totalLabel="Total (mock mix)"
          totalValue={formatMoneyAR(totalEntregas)}
        >
          <ul className="space-y-2 text-sm">
            {MOCK_PEND_ENTREGA.map((r, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 border-b border-subtle/50 pb-2 last:border-0">
                <span className="text-fg">{r.cliente}</span>
                <span className="font-mono text-fg-muted">
                  {r.divisa} {formatMoneyAR(r.monto)} <span className="text-xs">({r.ref})</span>
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>

        <Disclosure
          id="mock-cc"
          title="Cuentas corrientes (saldo comercial)"
          subtitle="En prod: GET /cc-balances; columna «en USD» según reglas de cotización."
          totalLabel="Total equivalente (mock)"
          totalValue={formatMoneyAR(totalCcUsdEquivalente)}
          defaultOpen
        >
          <div className="table-scroll rounded border border-subtle">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-fg-muted border-b border-subtle bg-surface">
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Divisa</th>
                  <th className="px-3 py-2 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_CC.map((r, i) => (
                  <tr key={i} className="border-b border-subtle/60 last:border-0">
                    <td className="px-3 py-2 text-fg">{r.cliente}</td>
                    <td className="px-3 py-2 font-medium">{r.divisa}</td>
                    <td
                      className={`px-3 py-2 text-right font-mono ${
                        r.saldo >= 0 ? 'text-success' : 'text-error'
                      }`}
                    >
                      {formatMoneyAR(r.saldo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-fg-muted uppercase tracking-wide">Generado en el período</h2>
        <p className="text-xs text-fg-muted -mt-1">
          En prod: <code className="text-xs bg-surface px-1 rounded">GET /api/reportes?from=&amp;to=</code> con permiso
          reportes. Aquí solo cambia el bloque de cifras ficticias.
        </p>
        <div className="flex flex-wrap gap-2">
          {(['dia', 'semana', 'mes'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriodo(p)}
              className={`px-3 py-1.5 text-sm rounded-md border transition ${
                periodo === p
                  ? 'bg-brand text-white border-brand'
                  : 'border-subtle text-fg-muted hover:bg-surface'
              }`}
            >
              {p === 'dia' ? 'Día' : p === 'semana' ? 'Semana' : 'Mes'}
            </button>
          ))}
        </div>
        <p className="text-xs text-fg-muted">{gen.nota}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="card-surface">
            <h3 className="text-xs font-medium text-fg-muted mb-1">Utilidad (equiv. mock)</h3>
            <p className="text-lg font-mono font-semibold text-fg">{formatMoneyAR(gen.utilidadUsd)}</p>
          </div>
          <div className="card-surface">
            <h3 className="text-xs font-medium text-fg-muted mb-1">Comisiones / profit</h3>
            <p className="text-lg font-mono font-semibold text-fg">{formatMoneyAR(gen.profitUsd)}</p>
          </div>
          <div className="card-surface">
            <h3 className="text-xs font-medium text-fg-muted mb-1">Gastos</h3>
            <p className="text-lg font-mono font-semibold text-error">{formatMoneyAR(gen.gastosUsd)}</p>
          </div>
          <div className="card-surface border-2 border-success/30">
            <h3 className="text-xs font-medium text-fg-muted mb-1">Resultado neto</h3>
            <p className="text-lg font-mono font-bold text-success">{formatMoneyAR(gen.resultadoUsd)}</p>
          </div>
        </div>
        <Disclosure
          id="mock-generado-detalle"
          title="Detalle por divisa (mock)"
          subtitle="En prod: mismas métricas que Inicio/reportes, tabla por USD, EUR, ARS…"
          totalLabel="Suma mock"
          totalValue={formatMoneyAR(gen.resultadoUsd)}
        >
          <p className="text-sm text-fg-muted">
            Ejemplo: filas USD / EUR / ARS con importes por métrica — reemplazar por respuesta real de{' '}
            <code className="text-xs bg-surface px-1 rounded">reportes</code>.
          </p>
        </Disclosure>
      </section>

      <section className="card-surface border-2 border-subtle">
        <h2 className="text-sm font-semibold text-fg-muted mb-2">Resumen «una línea» (mock)</h2>
        <p className="text-xs text-fg-muted mb-3">
          En prod habría que mostrar la fórmula explícita (p. ej. si gastos del período entran o no en «capital»).
        </p>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-2 border-b border-subtle/60 pb-2">
            <dt className="text-fg-muted">Bruto caja (efectivo + digital)</dt>
            <dd className="font-mono font-medium">{formatMoneyAR(totalEfectivo + totalDigital)}</dd>
          </div>
          <div className="flex justify-between gap-2 border-b border-subtle/60 pb-2">
            <dt className="text-fg-muted">± CC (mock)</dt>
            <dd className="font-mono font-medium">{formatMoneyAR(totalCcUsdEquivalente)}</dd>
          </div>
          <div className="flex justify-between gap-2 border-b border-subtle/60 pb-2">
            <dt className="text-fg-muted">− Pendientes retiro</dt>
            <dd className="font-mono font-medium">{formatMoneyAR(totalRetiros)}</dd>
          </div>
          <div className="flex justify-between gap-2 pb-2">
            <dt className="text-fg font-medium">Indicador mock</dt>
            <dd className="font-mono font-bold text-brand">{formatMoneyAR(90250)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
