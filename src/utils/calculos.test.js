import { describe, expect, it } from 'vitest'
import { calcAcreditadoPorVenta } from './calculos'

describe('calculos: acreditacion por venta', () => {
  it('acredita cobros de CC por fecha de cobro (inmediatos)', () => {
    const cobros = [
      { id: 'C1', idVenta: 'V1', medio: 'CC', idCuentaCorriente: 'CC1', fecha: '2026-06-05', monto: 5000 },
    ]
    const cuentasCorrientes = [
      { id: 'CC1', estado: 'Activa', totalAdeudado: 20000, saldo: 15000 },
    ]

    const result = calcAcreditadoPorVenta(cobros, cuentasCorrientes, '2026-06-05', [
      { id: 'CC', esCC: true, esBNA: false },
      { id: 'BNA', esCC: false, esBNA: true },
    ])

    expect(result.V1.cobrado).toBe(5000)
    expect(result.V1.acreditado).toBe(5000)
  })

  it('mantiene medios diferidos acreditando por fechaReal', () => {
    const cobros = [
      { id: 'C2', idVenta: 'V2', medio: 'BNA', fecha: '2026-06-05', fechaReal: '2026-07-01', monto: 10000 },
    ]

    const before = calcAcreditadoPorVenta(cobros, [], '2026-06-30', [
      { id: 'BNA', esBNA: true },
    ])
    const after = calcAcreditadoPorVenta(cobros, [], '2026-07-01', [
      { id: 'BNA', esBNA: true },
    ])

    expect(before.V2.cobrado).toBe(10000)
    expect(before.V2.acreditado).toBe(0)
    expect(after.V2.acreditado).toBe(10000)
  })
})
