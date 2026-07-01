import { describe, expect, it } from 'vitest'
import {
  canAddCobroToCuentaCorriente,
  canAddCobroToVenta,
  canCancelVenta,
  hasActiveVentaForProducto,
} from './businessRules'

describe('Business rules: ventas y cobros', () => {
  it('bloquea cancelar una venta si tiene al menos una prenda pagada a proveedor', () => {
    const ventas = [
      { IDVenta: 'V10', IDProducto: 'P1', PrecioVentaFinal: 100, cancelada: false, PagoProveedor: true },
      { IDVenta: 'V10', IDProducto: 'P2', PrecioVentaFinal: 80, cancelada: false, PagoProveedor: false },
    ]
    const pagos = []
    const cobros = [{ id: 'C1', idVenta: 'V10', monto: 50 }]

    const result = canCancelVenta({ idVenta: 'V10', ventas, pagos, cobros })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('provider_payment_exists')
  })

  it('permite cancelar venta sin pagos a proveedor y marca cobros asociados para eliminar', () => {
    const ventas = [
      { IDVenta: 'V11', IDProducto: 'P1', PrecioVentaFinal: 100, cancelada: false, PagoProveedor: false },
      { IDVenta: 'V11', IDProducto: 'P2', PrecioVentaFinal: 100, cancelada: false, PagoProveedor: false },
    ]
    const pagos = []
    const cobros = [
      { id: 'C11', idVenta: 'V11', monto: 50 },
      { id: 'C12', idVenta: 'V11', monto: 40 },
      { id: 'C99', idVenta: 'V99', monto: 10 },
    ]

    const result = canCancelVenta({ idVenta: 'V11', ventas, pagos, cobros })

    expect(result.ok).toBe(true)
    expect(result.reason).toBeNull()
    expect(result.cobrosToDelete).toEqual(['C11', 'C12'])
  })

  it('bloquea sobrecobro cuando el monto excede saldo pendiente de la venta', () => {
    const ventas = [
      { IDVenta: 'V20', IDProducto: 'P1', PrecioVentaFinal: 60, cancelada: false },
      { IDVenta: 'V20', IDProducto: 'P2', PrecioVentaFinal: 40, cancelada: false },
    ]
    const cobros = [{ id: 'C20', idVenta: 'V20', monto: 90 }]

    const result = canAddCobroToVenta({ idVenta: 'V20', monto: 15, ventas, cobros })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('over_sale_balance')
    expect(result.pending).toBe(10)
  })

  it('bloquea cobro adicional en cuenta corriente ya saldada/cancelada', () => {
    const cuentasCorrientes = [
      { id: 'CC1', totalAdeudado: 100, estado: 'Cancelada' },
    ]
    const cobros = [{ id: 'C30', idCuentaCorriente: 'CC1', monto: 100 }]

    const result = canAddCobroToCuentaCorriente({ ccId: 'CC1', monto: 1, cuentasCorrientes, cobros })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('cc_settled')
    expect(result.pending).toBe(0)
  })

  it('permite asociar venta a CC con monto 0 cuando se habilita allowZero', () => {
    const ventas = [
      { IDVenta: 'V21', IDProducto: 'P1', PrecioVentaFinal: 60, cancelada: false },
      { IDVenta: 'V21', IDProducto: 'P2', PrecioVentaFinal: 40, cancelada: false },
    ]
    const cobros = []

    const result = canAddCobroToVenta({ idVenta: 'V21', monto: 0, ventas, cobros, allowZero: true })

    expect(result.ok).toBe(true)
    expect(result.reason).toBeNull()
    expect(result.pending).toBe(100)
  })

  it('permite cobro 0 en cuenta corriente activa para asociacion sin pago inicial', () => {
    const cuentasCorrientes = [
      { id: 'CC2', totalAdeudado: 100, estado: 'Activa' },
    ]
    const cobros = []

    const result = canAddCobroToCuentaCorriente({ ccId: 'CC2', monto: 0, cuentasCorrientes, cobros })

    expect(result.ok).toBe(true)
    expect(result.reason).toBeNull()
    expect(result.pending).toBe(100)
  })

  it('detecta asociacion activa de producto solo cuando la venta no esta cancelada', () => {
    const ventas = [
      { IDVenta: 'V30', IDProducto: 'P30', cancelada: true },
      { IDVenta: 'V31', IDProducto: 'P31', cancelada: false },
    ]

    expect(hasActiveVentaForProducto(ventas, 'P30')).toBe(false)
    expect(hasActiveVentaForProducto(ventas, 'P31')).toBe(true)
    expect(hasActiveVentaForProducto(ventas, 'P99')).toBe(false)
  })
})
