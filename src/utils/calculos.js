/**
 * Calcula cuánto está acreditado por venta, respetando las reglas:
 * - Cobros normales: acreditado cuando fecha <= hoy (BNA usa fechaReal)
 * - Cobros de CC: acreditan por fecha de cobro como cobro inmediato
 *
 * @param {Array} cobros
 * @param {Array} cuentasCorrientes
 * @param {string} hoy  — fecha ISO "YYYY-MM-DD"
 * @param {Array}  mediosPago — lista dinámica de medios (opcional)
 * @returns {Object} map: { idVenta → { cobrado, acreditado } }
 */
export function calcAcreditadoPorVenta(cobros, cuentasCorrientes, hoy, mediosPago = []) {
  // Set de IDs de medios con acreditación diferida (esBNA)
  const bnaSet = new Set(mediosPago.filter(m => m.esBNA).map(m => m.id))
  // Fallback: si no hay lista dinámica, usar 'BNA'
  if (bnaSet.size === 0) bnaSet.add('BNA')

  const map = {}

  cobros.forEach(c => {
    const vid = c.idVenta
    if (!vid) return
    if (!map[vid]) map[vid] = { cobrado: 0, acreditado: 0 }

    const monto = Number(c.monto) || 0
    map[vid].cobrado += monto

    // Cobro inmediato por defecto; solo medios diferidos acreditan en fechaReal
    const fe = (bnaSet.has(c.medio) && c.fechaReal) ? c.fechaReal : c.fecha
    if (fe && fe <= hoy) {
      map[vid].acreditado += monto
    }
  })

  return map
}

/**
 * Calcula el total por venta (suma de PrecioVentaFinal de cada línea)
 * @param {Array} ventas
 * @returns {Object} map: { IDVenta → number }
 */
export function calcTotalPorVenta(ventas) {
  const map = {}
  ventas.filter(v => !v.cancelada).forEach(v => {
    const vid = v.IDVenta
    if (!vid) return
    map[vid] = (map[vid] || 0) + (Number(v.PrecioVentaFinal) || 0)
  })
  return map
}
