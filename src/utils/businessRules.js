import { toFiniteNumber } from './dataQuality'

const EPSILON = 0.0001

export function hasProviderPaymentForVenta(ventas, pagos, idVenta) {
  const hasFlag = ventas.some(v => v.IDVenta === idVenta && v.PagoProveedor === true)
  const hasPago = pagos.some(p => p.idVenta === idVenta)
  return hasFlag || hasPago
}

export function getActiveVentaItems(ventas, idVenta) {
  return ventas.filter(v => v.IDVenta === idVenta && !v.cancelada)
}

export function hasActiveVentaForProducto(ventas, idProducto) {
  return ventas.some(v => v.IDProducto === idProducto && !v.cancelada)
}

export function getVentaTotal(ventas, idVenta) {
  return getActiveVentaItems(ventas, idVenta)
    .reduce((sum, item) => sum + toFiniteNumber(item.PrecioVentaFinal, 0), 0)
}

export function getCobradoVenta(cobros, idVenta, excludeCobroId = null) {
  return cobros
    .filter(c => c.idVenta === idVenta && (!excludeCobroId || c.id !== excludeCobroId))
    .reduce((sum, c) => sum + toFiniteNumber(c.monto, 0), 0)
}

export function canCancelVenta({ idVenta, ventas = [], pagos = [], cobros = [] }) {
  const activeItems = getActiveVentaItems(ventas, idVenta)
  if (!activeItems.length) return { ok: false, reason: 'sale_missing_or_canceled' }

  if (hasProviderPaymentForVenta(ventas, pagos, idVenta)) {
    return { ok: false, reason: 'provider_payment_exists' }
  }

  const totalVenta = getVentaTotal(ventas, idVenta)
  const totalCobrado = getCobradoVenta(cobros, idVenta)
  if (totalVenta > 0 && totalCobrado >= totalVenta - EPSILON) {
    return { ok: false, reason: 'sale_fully_collected' }
  }

  const cobrosToDelete = cobros.filter(c => c.idVenta === idVenta).map(c => c.id)
  return { ok: true, reason: null, cobrosToDelete }
}

export function canAddCobroToVenta({ idVenta, monto, ventas = [], cobros = [], excludeCobroId = null, allowZero = false }) {
  const activeItems = getActiveVentaItems(ventas, idVenta)
  if (!activeItems.length) return { ok: false, reason: 'sale_missing_or_canceled' }

  const parsedMonto = toFiniteNumber(monto, NaN)
  const validAmount = allowZero ? parsedMonto >= 0 : parsedMonto > 0
  if (!validAmount) return { ok: false, reason: 'invalid_amount' }

  const totalVenta = getVentaTotal(ventas, idVenta)
  if (!(totalVenta > 0)) return { ok: false, reason: 'invalid_sale_total' }

  const totalCobrado = getCobradoVenta(cobros, idVenta, excludeCobroId)
  const pending = Math.max(totalVenta - totalCobrado, 0)
  if (parsedMonto > pending + EPSILON) {
    return { ok: false, reason: 'over_sale_balance', pending }
  }

  return { ok: true, reason: null, pending }
}

export function canAddCobroToCuentaCorriente({ ccId, monto, cuentasCorrientes = [], cobros = [], excludeCobroId = null }) {
  const cc = cuentasCorrientes.find(x => x.id === ccId)
  if (!cc) return { ok: false, reason: 'cc_missing' }

  const parsedMonto = toFiniteNumber(monto, NaN)
  if (!(parsedMonto >= 0)) return { ok: false, reason: 'invalid_amount' }

  const totalAdeudado = toFiniteNumber(cc.totalAdeudado, 0)
  const totalPagado = cobros
    .filter(c => c.idCuentaCorriente === ccId && (!excludeCobroId || c.id !== excludeCobroId))
    .reduce((sum, c) => sum + toFiniteNumber(c.monto, 0), 0)
  const pending = Math.max(totalAdeudado - totalPagado, 0)

  if (cc.estado === 'Cancelada' || pending <= EPSILON) {
    return { ok: false, reason: 'cc_settled', pending }
  }
  if (parsedMonto > pending + EPSILON) {
    return { ok: false, reason: 'over_cc_balance', pending }
  }

  return { ok: true, reason: null, pending }
}
