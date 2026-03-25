# Reportes (solo real, por divisa)

- **Utilidad**, **comisiones/profit**, **gastos** y **resultado** se muestran **por divisa**, sin total consolidado en una divisa base.
- No hay cotizaciones manuales ni modo estimado: se eliminó `manual_fx_quotes` y el parámetro `base_currency_id` de `GET /api/reportes`.
- La lógica de cálculo en backend (`reportes_service`: `computeFXUtility`, `computeProfit`, `computeGastos`, `computeResultado`) no cambia en lo contable.
