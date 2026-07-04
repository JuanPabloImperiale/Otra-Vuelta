import { useState, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { calcAcreditadoPorVenta, calcTotalPorVenta, calcCierrePorVenta } from '../utils/calculos'
import { fmt$, fmtDate, today, thisMonth, monthLabel } from '../utils/formatters'
import { Modal, SearchBar, Button, Input, SectionHeader, EmptyState, InfoRow, Tabs } from '../components/ui'

export default function Gastos() {
  const { gastos, ventas, cobros, pagos, cuentasCorrientes, mediosPago, addGasto, updateGasto, deleteGasto } = useApp()
  const mesActual = thisMonth()
  const [year, setYear]  = useState(mesActual.slice(0, 4))
  const [month, setMonth]= useState(mesActual.slice(5, 7))
  const [tab, setTab]    = useState('balance')
  const [modal, setM]    = useState(null)
  const [q, setQ]        = useState('')
  const mes = `${year}-${month}`
  const hoy = today()

  const recordatoriosPendientes = useMemo(() =>
    gastos
      .filter(g => g.recordatorioPendiente && g.recordatorioFecha && g.recordatorioFecha <= hoy)
      .sort((a, b) => (a.recordatorioFecha || '').localeCompare(b.recordatorioFecha || ''))
  , [gastos, hoy])

  const years = useMemo(() => ['2030', '2029', '2028', '2027', '2026', '2025', '2024'], [])

  const monthsForYear = useMemo(() => (
    ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']
  ), [])

  const monthNames = {
    '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
    '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
    '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre',
  }

  const acreditadoPorVenta = useMemo(() =>
    calcAcreditadoPorVenta(cobros, cuentasCorrientes, hoy, mediosPago)
  , [cobros, cuentasCorrientes, hoy, mediosPago])

  const totalPorVenta = useMemo(() =>
    calcTotalPorVenta(ventas)
  , [ventas])

  const cierrePorVenta = useMemo(() =>
    calcCierrePorVenta(ventas, cobros, hoy, mediosPago)
  , [ventas, cobros, hoy, mediosPago])

  const statsMes = useMemo(() => {
    const ventasCerradas = ventas.filter(v => !v.cancelada && cierrePorVenta[v.IDVenta]?.fechaCierre?.startsWith(mes))
    const ganancia = ventasCerradas.reduce((s, v) => s + (v.GananciaNegocio || 0), 0)
    const facturado = ventasCerradas.reduce((s, v) => s + (v.PrecioVentaFinal || 0), 0)
    const gastosMes = gastos.filter(g => (g.mes || g.fecha?.slice(0, 7)) === mes).reduce((s, g) => s + (g.monto || 0), 0)
    return { ganancia, facturado, gastosMes, balance: ganancia - gastosMes, prendas: ventasCerradas.length }
  }, [ventas, gastos, mes, cierrePorVenta])

  const gastosFiltrados = useMemo(() => {
    // Gastos del mes actual
    let list = gastos.filter(g => (g.mes || g.fecha?.slice(0, 7)) === mes)
    
    // Si no tenemos gastos recurrentes de este mes, heredar del mes anterior
    const mesAnterior = new Date(mes + '-01')
    mesAnterior.setMonth(mesAnterior.getMonth() - 1)
    const ymAnterior = mesAnterior.toISOString().slice(0, 7)
    
    const gastosRecurrentesMesAnt = gastos.filter(g => (g.mes || g.fecha?.slice(0, 7)) === ymAnterior && g.recurrente)
    const gastosMesActualDesc = new Set(list.map(g => g.descripcion?.toLowerCase()))
    
    // Agregar gastos recurrentes que no existan en el mes actual
    const recurrentesHeredados = gastosRecurrentesMesAnt
      .filter(g => !gastosMesActualDesc.has(g.descripcion?.toLowerCase()))
      .map(g => ({ ...g, es_heredado: true, mes: mes, fecha: mes + '-01' }))
    
    list = [...list, ...recurrentesHeredados]
    
    if (q) list = list.filter(g => g.descripcion?.toLowerCase().includes(q.toLowerCase()))
    return list.sort((a, b) => (b.mes || b.fecha || '').localeCompare(a.mes || a.fecha || ''))
  }, [gastos, mes, q])

  // Gastos recurrentes que debería haber en este mes (solo mostrar si no están siendo heredados)
  const sugerencias = useMemo(() => {
    const mesAnterior = new Date(mes + '-01')
    mesAnterior.setMonth(mesAnterior.getMonth() - 1)
    const ymAnterior = mesAnterior.toISOString().slice(0, 7)
    
    const gastosRecurrentesMesAnt = gastos.filter(g => (g.mes || g.fecha?.slice(0, 7)) === ymAnterior && g.recurrente)
    const gastosMesActual = new Set(gastos.filter(g => (g.mes || g.fecha?.slice(0, 7)) === mes).map(g => g.descripcion?.toLowerCase()))
    
    return gastosRecurrentesMesAnt.filter(g => !gastosMesActual.has(g.descripcion?.toLowerCase()))
  }, [gastos, mes])

  const confirmarSugerencia = async (g) => {
    await addGasto({
      descripcion: g.descripcion,
      monto: g.monto,
      mes: mes,
      fecha: mes + '-01',
      recurrente: true,
    })
  }

  // ── Balance completo del mes ───────────────────────────────────────────────
  const balanceMes = useMemo(() => {
    const ventasMes = ventas.filter(v => v.FechaVenta?.startsWith(mes) && !v.cancelada)

    // Ventas cerradas en este mes (por acreditación real)
    const cerradas = ventas.filter(v => !v.cancelada && cierrePorVenta[v.IDVenta]?.fechaCierre?.startsWith(mes))

    // Pendientes de cobro
    const pendienteCobro = ventasMes.filter(v => {
      const acred = (acreditadoPorVenta[v.IDVenta]?.acreditado) || 0
      const total = totalPorVenta[v.IDVenta] || 0
      return acred < total || total === 0
    })

    const totalVentas   = cerradas.reduce((s, v) => s + (Number(v.PrecioVentaFinal) || 0), 0)
    const totalCostoProv= cerradas.reduce((s, v) => s + (Number(v.CostoProveedor)    || 0), 0)
    const gananciaBruta = cerradas.reduce((s, v) => s + (Number(v.GananciaNegocio)   || 0), 0)

    // Pagos realizados a proveedores en el mes
    const pagadosMes = pagos
      .filter(p => p.fecha?.startsWith(mes))
      .reduce((s, p) => s + (Number(p.monto) || 0), 0)

    // Pendiente de pagar a proveedores (ventas cerradas sin pago)
    const pagadosSet = new Set(pagos.map(p => `${p.idVenta}-${p.idProducto}`))
    const pendientePagosProv = cerradas
      .filter(v => v.PagoProveedor !== true && !pagadosSet.has(`${v.IDVenta}-${v.IDProducto}`))
      .reduce((s, v) => s + (Number(v.CostoProveedor) || 0), 0)

    const gastosMes = gastos.filter(g => (g.mes || g.fecha?.slice(0, 7)) === mes).reduce((s, g) => s + (Number(g.monto) || 0), 0)
    const gananciaNeta = gananciaBruta - gastosMes

    // Cobros acreditados de ventas cerradas del período por medio de pago
    const bnaSet = new Set(mediosPago.filter(m => m.esBNA).map(m => m.id))
    if (bnaSet.size === 0) bnaSet.add('BNA')
    const mediosLabels = Object.fromEntries(mediosPago.map(m => [m.id, m.label]))
    const mapMedios = {}
    const idsVentasCerradas = new Set(cerradas.map(v => v.IDVenta))
    cobros.forEach(c => {
      if (!idsVentasCerradas.has(c.idVenta)) return
      const fe = (bnaSet.has(c.medio) && c.fechaReal) ? c.fechaReal : c.fecha
      if (!fe || fe > hoy) return
      const key = c.medio || 'Otro'
      mapMedios[key] = (mapMedios[key] || 0) + (Number(c.monto) || 0)
    })
    const cobrosPorMedio = Object.entries(mapMedios)
      .map(([medio, monto]) => ({ medio, label: mediosLabels[medio] || medio, monto }))
      .sort((a, b) => b.monto - a.monto)
    const totalAcreditadoVentasMes = cobrosPorMedio.reduce((s, x) => s + x.monto, 0)

    // Cobrado este mes con acreditación futura (CC o diferidos)
    const mapFuturo = {}
    let totalCobradoMesAcreditaFuturo = 0
    cobros.forEach(c => {
      if (!c.fecha?.startsWith(mes)) return
      const monto = Number(c.monto) || 0
      if (monto <= 0) return

      const isCC = c.medio === 'CC' || !!c.idCuentaCorriente
      const isDiferido = bnaSet.has(c.medio) || (!!c.fechaReal && c.fechaReal !== c.fecha)
      if (!isCC && !isDiferido) return

      const fechaAcreditacion = c.fechaReal || c.fecha
      const acreditaFuturo = !!fechaAcreditacion && fechaAcreditacion > hoy
      const ccSinAcreditar = isCC && (!c.fechaReal || c.fechaReal > hoy)
      if (!acreditaFuturo && !ccSinAcreditar) return

      const key = c.medio || 'Otro'
      if (!mapFuturo[key]) {
        mapFuturo[key] = {
          medio: key,
          label: mediosLabels[key] || key,
          monto: 0,
          tipo: isCC ? 'CC' : 'Diferido',
        }
      }
      mapFuturo[key].monto += monto
      totalCobradoMesAcreditaFuturo += monto
    })
    const cobrosFuturosPorMedio = Object.values(mapFuturo).sort((a, b) => b.monto - a.monto)

    // Por categoría
    const porCategoria = {}
    cerradas.forEach(v => {
      const cat = v.Categoria || 'Sin categoría'
      if (!porCategoria[cat]) porCategoria[cat] = { prendas: 0, ventas: 0, costo: 0, ganancia: 0 }
      porCategoria[cat].prendas++
      porCategoria[cat].ventas   += Number(v.PrecioVentaFinal) || 0
      porCategoria[cat].costo    += Number(v.CostoProveedor) || 0
      porCategoria[cat].ganancia += Number(v.GananciaNegocio) || 0
    })

    // Top proveedores del mes
    const porProv = {}
    cerradas.forEach(v => {
      const id = v.ProveedorID
      if (!porProv[id]) porProv[id] = { nombre: v.ProveedorNombre || id, prendas: 0, ventas: 0, costo: 0, ganancia: 0 }
      porProv[id].prendas++
      porProv[id].ventas   += Number(v.PrecioVentaFinal) || 0
      porProv[id].costo    += Number(v.CostoProveedor) || 0
      porProv[id].ganancia += Number(v.GananciaNegocio) || 0
    })

    // Ventas incluidas en el balance del mes (agrupadas por IDVenta)
    const ventasCierreMap = {}
    cerradas.forEach((v) => {
      const idVenta = v.IDVenta
      if (!idVenta) return
      if (!ventasCierreMap[idVenta]) {
        ventasCierreMap[idVenta] = {
          idVenta,
          fechaVenta: v.FechaVenta || '',
          fechaCierre: cierrePorVenta[idVenta]?.fechaCierre || '',
          prendas: 0,
          totalVenta: 0,
          totalCosto: 0,
          ganancia: 0,
        }
      }
      ventasCierreMap[idVenta].prendas += 1
      ventasCierreMap[idVenta].totalVenta += Number(v.PrecioVentaFinal) || 0
      ventasCierreMap[idVenta].totalCosto += Number(v.CostoProveedor) || 0
      ventasCierreMap[idVenta].ganancia += Number(v.GananciaNegocio) || 0
    })

    const ventasCierreList = Object.values(ventasCierreMap)
      .sort((a, b) => b.fechaCierre.localeCompare(a.fechaCierre) || b.idVenta.localeCompare(a.idVenta))

    return {
      prendas: cerradas.length,
      prendasPendCobro: pendienteCobro.length,
      totalVentas, totalCostoProv, gananciaBruta,
      gastosMes, gananciaNeta,
      pagadosMes, pendientePagosProv,
      cobrosPorMedio, totalAcreditadoVentasMes,
      cobrosFuturosPorMedio, totalCobradoMesAcreditaFuturo,
      ventasCierreList,
      porCategoria: Object.entries(porCategoria).sort((a,b) => b[1].ventas - a[1].ventas),
      topProvs: Object.values(porProv).sort((a,b) => b.ganancia - a.ganancia).slice(0, 8),
      margenBruto: totalVentas > 0 ? ((gananciaBruta / totalVentas) * 100).toFixed(1) : '0',
    }
  }, [ventas, cobros, pagos, gastos, mes, hoy, acreditadoPorVenta, totalPorVenta, cierrePorVenta, mediosPago])

  return (
    <div>
      <SectionHeader title="Ganancia & Balance"
        action={tab === 'gastos' && <Button size="sm" onClick={() => setM({ _new: true, descripcion: '', monto: '', mes: mes, fecha: mes + '-01', recurrente: false })}>+ Gasto</Button>}
      />

      {/* Selector de año y mes */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <select
          value={year}
          onChange={e => setYear(e.target.value)}
          className="input-base text-sm"
        >
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={month} onChange={e => setMonth(e.target.value)} className="input-base text-sm">
          {monthsForYear.map(m => <option key={m} value={m}>{monthNames[m] || m}</option>)}
        </select>
      </div>

      <Tabs
        tabs={[{ id: 'balance', label: '📊 Cierre mensual' }, { id: 'gastos', label: '📋 Gastos' }]}
        active={tab} onChange={setTab}
      />

      {/* ── TAB BALANCE ─────────────────────────────────────────────────── */}
      {tab === 'balance' && (
        <div className="space-y-4">

          {/* Resumen ejecutivo */}
          <div className="card overflow-hidden">
            <div className="bg-brand-700 text-white px-4 py-3">
              <div className="text-sm font-semibold uppercase tracking-wide opacity-80">Cierre — {monthLabel(mes)}</div>
              <div className="text-3xl font-bold mt-1">{fmt$(balanceMes.gananciaNeta)}</div>
              <div className="text-sm opacity-80 mt-0.5">Ganancia neta del negocio</div>
            </div>
            <div className="p-4 grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-lg font-bold text-green-700">{fmt$(balanceMes.totalVentas)}</div>
                <div className="text-xs text-text3">Facturado</div>
              </div>
              <div>
                <div className="text-lg font-bold text-red-600">{fmt$(balanceMes.totalCostoProv)}</div>
                <div className="text-xs text-text3">Costo proveedores</div>
              </div>
              <div>
                <div className="text-lg font-bold text-brand-700">{balanceMes.margenBruto}%</div>
                <div className="text-xs text-text3">Margen bruto</div>
              </div>
            </div>
          </div>

          {/* Desglose completo */}
          <div className="card p-4">
            <div className="text-xs font-semibold text-text3 uppercase tracking-wide mb-3">Desglose P&L</div>

            <div className="space-y-1">
              <div className="flex justify-between items-center py-1.5">
                <span className="text-sm text-text2">Ventas cobradas al 100% ({balanceMes.prendas} prendas)</span>
                <span className="text-sm font-semibold text-green-700">+{fmt$(balanceMes.totalVentas)}</span>
              </div>
              <div className="flex justify-between items-center py-1.5">
                <span className="text-sm text-text2">Costo mercadería (proveedores)</span>
                <span className="text-sm font-semibold text-red-600">-{fmt$(balanceMes.totalCostoProv)}</span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-t border-border">
                <span className="text-sm font-medium text-text1">Ganancia bruta</span>
                <span className="text-sm font-bold text-green-700">{fmt$(balanceMes.gananciaBruta)}</span>
              </div>
              <div className="flex justify-between items-center py-1.5">
                <span className="text-sm text-text2">Gastos operativos del mes</span>
                <span className="text-sm font-semibold text-red-600">-{fmt$(balanceMes.gastosMes)}</span>
              </div>
              <div className="flex justify-between items-center py-2.5 border-t-2 border-brand-200 mt-1">
                <span className="text-base font-bold text-text1">GANANCIA NETA</span>
                <span className={`text-xl font-bold ${balanceMes.gananciaNeta >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {fmt$(balanceMes.gananciaNeta)}
                </span>
              </div>
            </div>
          </div>

          {/* Cobros acreditados de ventas cerradas del período por medio */}
          <div className="card p-4">
            <div className="text-xs font-semibold text-text3 uppercase tracking-wide mb-3">Cómo se cobró lo acreditado del balance</div>
            {balanceMes.cobrosPorMedio.length === 0 ? (
              <div className="text-sm text-text3">Sin cobros acreditados para las ventas cerradas de {monthLabel(mes)}.</div>
            ) : (
              <div className="space-y-2">
                {balanceMes.cobrosPorMedio.map((m) => {
                  const pct = balanceMes.totalAcreditadoVentasMes > 0 ? (m.monto / balanceMes.totalAcreditadoVentasMes) * 100 : 0
                  return (
                    <div key={m.medio}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-text2">{m.label}</span>
                        <span className="font-semibold text-text1">{fmt$(m.monto)} · {pct.toFixed(1)}%</span>
                      </div>
                      <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-1.5 bg-brand-600 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
                <div className="flex items-center justify-between text-sm border-t border-border pt-2 mt-1">
                  <span className="font-semibold text-text2">Total acreditado del balance</span>
                  <span className="font-bold text-green-700">{fmt$(balanceMes.totalAcreditadoVentasMes)}</span>
                </div>
                <div className="text-xs text-text3">Referencia: ventas cobradas al 100% ({fmt$(balanceMes.totalVentas)}).</div>
              </div>
            )}
          </div>

          {/* Cobrado este mes que acredita en el futuro */}
          <div className="card p-4">
            <div className="text-xs font-semibold text-text3 uppercase tracking-wide mb-3">Cobrado en {monthLabel(mes)} con acreditación futura</div>
            {balanceMes.cobrosFuturosPorMedio.length === 0 ? (
              <div className="text-sm text-text3">No hay cobros del mes con acreditación futura (CC o diferidos).</div>
            ) : (
              <div className="space-y-2">
                {balanceMes.cobrosFuturosPorMedio.map((m) => {
                  const pct = balanceMes.totalCobradoMesAcreditaFuturo > 0 ? (m.monto / balanceMes.totalCobradoMesAcreditaFuturo) * 100 : 0
                  return (
                    <div key={m.medio}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-text2">{m.label} <span className="text-xs text-text3">({m.tipo})</span></span>
                        <span className="font-semibold text-text1">{fmt$(m.monto)} · {pct.toFixed(1)}%</span>
                      </div>
                      <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-1.5 bg-orange-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
                <div className="flex items-center justify-between text-sm border-t border-border pt-2 mt-1">
                  <span className="font-semibold text-text2">Total cobrado del mes a acreditar</span>
                  <span className="font-bold text-orange-700">{fmt$(balanceMes.totalCobradoMesAcreditaFuturo)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Estado de pagos a proveedores */}
          <div className="card p-4">
            <div className="text-xs font-semibold text-text3 uppercase tracking-wide mb-3">Estado proveedores</div>
            <InfoRow label="Pagado a proveedores este mes:" value={fmt$(balanceMes.pagadosMes)} valueClass="text-green-700 font-semibold" />
            <InfoRow label="Pendiente de pagar (ventas cerradas):" value={fmt$(balanceMes.pendientePagosProv)}
              valueClass={balanceMes.pendientePagosProv > 0 ? 'text-orange-600 font-semibold' : 'text-green-700'} />
            {balanceMes.prendasPendCobro > 0 && (
              <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded-lg p-2 text-xs text-yellow-800">
                ⏳ {balanceMes.prendasPendCobro} prenda(s) vendidas aún sin cobrar al 100% — no incluidas en este balance.
              </div>
            )}
          </div>

          {/* Ventas incluidas en el balance */}
          <div className="card p-4">
            <div className="text-xs font-semibold text-text3 uppercase tracking-wide mb-3">Ventas asociadas al balance ({monthLabel(mes)})</div>
            {balanceMes.ventasCierreList.length === 0 ? (
              <div className="text-sm text-text3">No hay ventas cerradas para este mes.</div>
            ) : (
              <>
                <div className="text-xs text-text3 mb-2">
                  Cada venta aparece una sola vez según su fecha de cierre (acreditación completa).
                </div>
                <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                  {balanceMes.ventasCierreList.map((v) => (
                    <div key={v.idVenta} className="border border-border rounded-xl p-3 bg-white">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-text1">{v.idVenta}</div>
                        <div className="text-sm font-bold text-green-700">{fmt$(v.totalVenta)}</div>
                      </div>
                      <div className="text-xs text-text3 mt-1">
                        Cierre: {fmtDate(v.fechaCierre)} · Venta: {fmtDate(v.fechaVenta)} · {v.prendas} prenda(s)
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="text-text3">Costo proveedor: {fmt$(v.totalCosto)}</span>
                        <span className="font-semibold text-brand-700">Ganancia: {fmt$(v.ganancia)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Por categoría */}
          {balanceMes.porCategoria.length > 0 && (
            <div className="card p-4">
              <div className="text-xs font-semibold text-text3 uppercase tracking-wide mb-3">Por categoría</div>
              <div className="space-y-2">
                {balanceMes.porCategoria.map(([cat, d]) => (
                  <div key={cat} className="flex items-center gap-3">
                    <span className="text-xs bg-brand-100 text-brand-700 font-bold px-2 py-0.5 rounded-full w-10 text-center">{cat}</span>
                    <div className="flex-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-text2">{d.prendas} prendas · {fmt$(d.ventas)}</span>
                        <span className="font-semibold text-green-700">+{fmt$(d.ganancia)}</span>
                      </div>
                      <div className="bg-gray-100 rounded-full h-1.5 mt-1">
                        <div className="bg-green-500 h-1.5 rounded-full"
                          style={{ width: `${balanceMes.gananciaBruta > 0 ? (d.ganancia / balanceMes.gananciaBruta * 100).toFixed(0) : 0}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top proveedores */}
          {balanceMes.topProvs.length > 0 && (
            <div className="card p-4">
              <div className="text-xs font-semibold text-text3 uppercase tracking-wide mb-3">Ranking proveedores — ganancia generada</div>
              {balanceMes.topProvs.map((p, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  <div className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center flex-shrink-0">{i+1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text1 truncate">{p.nombre}</div>
                    <div className="text-xs text-text3">{p.prendas} prendas · vendido {fmt$(p.ventas)}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-bold text-green-700">{fmt$(p.ganancia)}</div>
                    <div className="text-xs text-text3">{p.ventas > 0 ? ((p.ganancia/p.ventas)*100).toFixed(0) : 0}% margen</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {balanceMes.prendas === 0 && (
            <EmptyState icon="📊" title="Sin ventas cerradas" subtitle="No hay ventas 100% cobradas en este período." />
          )}
        </div>
      )}

      {/* ── TAB GASTOS ──────────────────────────────────────────────────── */}
      {tab === 'gastos' && (
        <div>
          {sugerencias.length > 0 && (
            <div className="card border-yellow-200 bg-yellow-50 p-4 mb-4">
              <div className="font-semibold text-yellow-800 mb-2">💡 Gastos recurrentes del mes anterior</div>
              {sugerencias.map((g, i) => (
                <div key={i} className="flex justify-between items-center py-2 border-b border-yellow-200 last:border-0">
                  <div>
                    <div className="text-sm text-yellow-900">{g.descripcion}</div>
                    <div className="text-xs text-yellow-600">Mes anterior: {fmt$(g.monto)}</div>
                  </div>
                  <button onClick={() => confirmarSugerencia(g)} className="text-xs bg-yellow-200 text-yellow-900 px-3 py-1.5 rounded-lg font-medium">
                    + Agregar
                  </button>
                </div>
              ))}
            </div>
          )}

          <SearchBar value={q} onChange={setQ} placeholder="Buscar gasto…" className="mb-3" />

          {recordatoriosPendientes.length > 0 && (
            <div className="card border-red-200 bg-red-50 p-4 mb-4">
              <div className="font-semibold text-red-800 mb-2">🔔 Recordatorios de pago pendientes</div>
              {recordatoriosPendientes.slice(0, 5).map(g => (
                <button
                  key={g.id}
                  onClick={() => setM(g)}
                  className="w-full flex justify-between items-center py-2 border-b border-red-200 last:border-0 text-left"
                >
                  <span className="text-sm text-red-900 font-medium">{g.descripcion}</span>
                  <span className="text-sm text-red-700 font-bold">{fmtDate(g.recordatorioFecha)}</span>
                </button>
              ))}
              {recordatoriosPendientes.length > 5 && <div className="text-xs text-red-700 mt-2">+{recordatoriosPendientes.length - 5} recordatorio(s) más</div>}
            </div>
          )}

          {gastosFiltrados.length === 0 ? (
            <EmptyState icon="📋" title="Sin gastos este mes"
              action={<Button size="sm" onClick={() => setM({ _new: true, descripcion: '', monto: '', mes: mes, fecha: mes + '-01', recurrente: false })}>+ Agregar gasto</Button>} />
          ) : (
            <div className="space-y-2">
              {gastosFiltrados.map(g => (
                <div key={g.id + (g.es_heredado ? '-heredado' : '')} className="card p-3 active:bg-gray-50 flex justify-between items-center hover:bg-gray-50 transition border-l-4" style={{ borderLeftColor: g.es_heredado ? '#fbbf24' : '#e5e7eb' }}>
                  <div className="flex-1 cursor-pointer" onClick={() => setM({ ...g, es_heredado: false })}>
                    <div className="text-sm font-medium text-text1">
                      {g.descripcion}
                      {g.es_heredado && <span className="text-xs ml-2 bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">Del mes anterior</span>}
                    </div>
                    <div className="text-xs text-text3 mt-0.5">
                      {monthLabel(g.mes || g.fecha?.slice(0, 7) || '')}
                      {g.recurrente && ' · 🔁 Recurrente'}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="font-bold text-red-600">{fmt$(g.monto)}</div>
                    <div className="flex gap-1">
                      <button
                        onClick={(e) => { 
                          e.stopPropagation()
                          // Si es heredado, no pasar el ID para que se cree como nuevo
                          const gastoParaEditar = g.es_heredado 
                            ? { descripcion: g.descripcion, monto: g.monto, recurrente: g.recurrente, mes: mes, fecha: mes + '-01', _new: true }
                            : { ...g, es_heredado: false }
                          setM(gastoParaEditar)
                        }}
                        className="text-xs px-2 py-1 rounded bg-brand-100 text-brand-700 hover:bg-brand-200 transition"
                      >
                        {g.es_heredado ? 'Usar' : 'Editar'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setM({ ...g, es_heredado: false, _showDeleteConfirm: true }) }}
                        className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 transition"
                        title="Eliminar gasto"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <div className="card bg-cream p-3 flex justify-between items-center mt-3">
                <span className="text-sm font-semibold text-text2">Total gastos del mes</span>
                <span className="font-bold text-red-700">{fmt$(statsMes.gastosMes)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {modal && (
        <GastoModal
          gasto={modal}
          onSave={async (data) => {
            if (data._new) await addGasto(data)
            else await updateGasto(data.id, data)
            setM(null)
          }}
          onDelete={async (id) => { await deleteGasto(id); setM(null) }}
          onClose={() => setM(null)}
        />
      )}
    </div>
  )
}

function GastoModal({ gasto, onSave, onDelete, onClose }) {
  const mesActual = thisMonth()
  const [form, setForm] = useState({ ...gasto })
  const [confirm, setC] = useState(gasto._showDeleteConfirm || false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Si es un gasto nuevo o heredado, tratarlo como nuevo
  const esNuevo = gasto._new || gasto.es_heredado

  // Extraer mes y año del gasto (formato YYYY-MM-01)
  const gastoMes = form.mes || form.fecha?.slice(0, 7) || mesActual
  const [year, setYear] = useState(gastoMes.slice(0, 4))
  const [month, setMonth] = useState(gastoMes.slice(5, 7))

  const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']
  const monthNames = {
    '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
    '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
    '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre',
  }
  const years = ['2030', '2029', '2028', '2027', '2026', '2025', '2024']

  const handleSave = () => {
    const nuevoMes = `${year}-${month}`
    const dataGuardar = { 
      ...form, 
      mes: nuevoMes, 
      fecha: `${nuevoMes}-01`
    }
    
    // Si viene marcado como _new (heredado o nuevo), asegurate de no tener ID
    if (dataGuardar._new) {
      delete dataGuardar.id
    }
    
    onSave(dataGuardar)
  }

  if (confirm) {
    return (
      <Modal title="¿Eliminar este gasto?" onClose={onClose}
        footer={
          <>
            <Button variant="ghost" size="md" className="flex-1" onClick={() => setC(false)}>Cancelar</Button>
            <Button variant="danger" size="md" className="flex-1" onClick={() => onDelete(form.id)}>Sí, eliminar</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="text-sm font-semibold text-red-700 mb-1">{form.descripcion}</div>
            <div className="text-sm text-red-600">{fmt$(form.monto)}</div>
          </div>
          <div className="text-sm text-text2">
            {form.recurrente ? (
              <>Se eliminará esta instancia del mes actual. Si también quieres eliminar el gasto de otros meses, deberás hacerlo individualmente.</>
            ) : (
              <>Esta acción no se puede deshacer.</>
            )}
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={esNuevo ? (gasto.es_heredado ? 'Usar gasto recurrente' : 'Nuevo gasto') : 'Editar gasto'} onClose={onClose}
      footer={
        <>
          {!esNuevo && form.id && <Button variant="danger" size="md" onClick={() => setC(true)}>Eliminar</Button>}
          <Button size="md" className="flex-1" onClick={handleSave} disabled={!form.descripcion || !form.monto}>
            {gasto.es_heredado ? 'Usar este mes' : 'Guardar'}
          </Button>
        </>
      }
    >
      {gasto.es_heredado && (
        <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="text-xs text-yellow-800">
            Este es un gasto recurrente del mes anterior. Si lo usas, se creará una copia para este mes que puedes editar independientemente.
          </div>
        </div>
      )}

      <Input label="Descripción *" value={form.descripcion || ''} onChange={e => set('descripcion', e.target.value)} placeholder="Ej: Alquiler, Luz, Internet…" />
      <Input label="Monto ($) *" type="number" value={form.monto || ''} onChange={e => set('monto', Number(e.target.value))} step="0.01" />

      {/* Selector de mes y año */}
      <div className="mt-4 pt-3 border-t border-border">
        <label className="text-sm font-medium text-text1 mb-3 block">Mes y año del gasto *</label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-text3 block mb-1">Mes</label>
            <select value={month} onChange={e => setMonth(e.target.value)} className="input-base w-full text-sm">
              {months.map(m => <option key={m} value={m}>{monthNames[m]}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-text3 block mb-1">Año</label>
            <select value={year} onChange={e => setYear(e.target.value)} className="input-base w-full text-sm">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Opción recurrente */}
      <div className="mt-4 pt-3 border-t border-border flex items-center gap-3">
        <input type="checkbox" id="recurrente" checked={!!form.recurrente} onChange={e => set('recurrente', e.target.checked)} className="w-4 h-4 accent-brand-700" />
        <label htmlFor="recurrente" className="text-sm text-text2">🔁 Gasto recurrente (se repite cada mes)</label>
      </div>
      {form.recurrente && (
        <div className="text-xs text-text3 mt-2 ml-7 bg-brand-50 border border-brand-200 rounded-lg p-2">
          Este gasto se repetirá automáticamente el próximo mes con el mismo monto, a menos que lo edites.
        </div>
      )}
    </Modal>
  )
}
