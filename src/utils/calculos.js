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
 * Determina en qué fecha queda cerrada cada venta (cuando acreditado alcanza el total).
 * La fecha de cierre se usa para imputar facturación/ganancia por mes de acreditación real.
 *
 * @param {Array} ventas
 * @param {Array} cobros
 * @param {string} hoy — fecha ISO "YYYY-MM-DD"
 * @param {Array} mediosPago
 * @returns {Object} map: { IDVenta -> { total, acreditado, cerrada, fechaCierre } }
 */
export function calcCierrePorVenta(ventas, cobros, hoy, mediosPago = []) {
  const bnaSet = new Set(mediosPago.filter(m => m.esBNA).map(m => m.id))
  if (bnaSet.size === 0) bnaSet.add('BNA')

  const totalPorVenta = calcTotalPorVenta(ventas)
  const cobrosPorVenta = {}

  cobros.forEach((c) => {
    const idVenta = c.idVenta
    if (!idVenta) return
    const monto = Number(c.monto) || 0
    if (!(monto > 0)) return
    const fechaAcreditacion = (bnaSet.has(c.medio) && c.fechaReal) ? c.fechaReal : c.fecha
    if (!fechaAcreditacion) return
    if (!cobrosPorVenta[idVenta]) cobrosPorVenta[idVenta] = []
    cobrosPorVenta[idVenta].push({
      id: c.id || c._docId || '',
      fecha: fechaAcreditacion,
      monto,
    })
  })

  const out = {}
  Object.entries(totalPorVenta).forEach(([idVenta, total]) => {
    const timeline = (cobrosPorVenta[idVenta] || [])
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.id).localeCompare(String(b.id)))

    let acreditado = 0
    let fechaCierre = ''
    timeline.forEach((m) => {
      if (m.fecha > hoy) return
      acreditado += m.monto
      if (!fechaCierre && total > 0 && acreditado >= total) {
        fechaCierre = m.fecha
      }
    })

    out[idVenta] = {
      total,
      acreditado,
      cerrada: !!fechaCierre,
      fechaCierre,
    }
  })

  return out
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
