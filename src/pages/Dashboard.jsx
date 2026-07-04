import { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from 'recharts'
import { useApp } from '../context/AppContext'
import { fmt$, today, thisMonth, monthLabel, diffDays } from '../utils/formatters'
import { calcAcreditadoPorVenta, calcTotalPorVenta, calcCierrePorVenta } from '../utils/calculos'
import { StatCard, SectionHeader, Tabs } from '../components/ui'
import { MEDIO_COLORS } from '../constants'
import { getProductoIssues, getVentaItemIssues } from '../utils/dataQuality'

const CHART_COLORS = ['#6366f1','#22c55e','#f59e0b','#3b82f6','#ec4899','#14b8a6']
const PIE_LABEL_THRESHOLD = 0.08

function renderPiePercentLabel({ cx, cy, midAngle, outerRadius, percent }) {
  if (!percent || percent < PIE_LABEL_THRESHOLD) return null
  const RADIAN = Math.PI / 180
  const radius = outerRadius + 16
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text
      x={x}
      y={y}
      fill="#334155"
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      fontSize={12}
      fontWeight={700}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

export default function Dashboard({ setSection }) {
  const { ventas, cobros, pagos, gastos, productos, config, cuentasCorrientes, mediosPago } = useApp()
  const [tab, setTab] = useState('mes')
  const hoy = today()
  const mes = thisMonth()
  const productosById = useMemo(() => Object.fromEntries(productos.map(p => [p.id, p])), [productos])

  // ── Cobros acreditados por venta (CC-aware) ───────────────────────────────
  const acreditadoPorVenta = useMemo(() =>
    calcAcreditadoPorVenta(cobros, cuentasCorrientes, hoy, mediosPago)
  , [cobros, cuentasCorrientes, hoy, mediosPago])

  const totalPorVenta = useMemo(() =>
    calcTotalPorVenta(ventas)
  , [ventas])

  const cierrePorVenta = useMemo(() =>
    calcCierrePorVenta(ventas, cobros, hoy, mediosPago)
  , [ventas, cobros, hoy, mediosPago])

  // ── Stats del mes ─────────────────────────────────────────────────────────
  const statsMes = useMemo(() => {
    const ventasCerradas = ventas.filter(v => !v.cancelada && cierrePorVenta[v.IDVenta]?.fechaCierre?.startsWith(mes))
    const ganancia  = ventasCerradas.reduce((s, v) => s + (v.GananciaNegocio || 0), 0)
    const facturado = ventasCerradas.reduce((s, v) => s + (v.PrecioVentaFinal || 0), 0)

    const bnaSet = new Set(mediosPago.filter(m => m.esBNA).map(m => m.id))
    if (bnaSet.size === 0) bnaSet.add('BNA')

    // Ingresos acreditados este mes
    const ingresosAcreditados = cobros
      .filter(c => {
        const fe = (bnaSet.has(c.medio) && c.fechaReal) ? c.fechaReal : c.fecha
        return fe?.startsWith(mes)
      })
      .reduce((s, c) => s + (c.monto || 0), 0)

    const gastosMes    = gastos.filter(g => g.fecha?.startsWith(mes)).reduce((s, g) => s + (g.monto || 0), 0)
    const bnaPendiente = cobros.filter(c => bnaSet.has(c.medio) && c.fechaReal && c.fechaReal > hoy).reduce((s, c) => s + (c.monto || 0), 0)

    // Deuda a proveedores: vendido + cobrado al 100% + no pagado
    const pagadosSet = new Set(pagos.map(p => `${p.idVenta}-${p.idProducto}`))
    const deudaProv = ventas
      .filter(v => !v.cancelada && v.PagoProveedor !== true)
      .filter(v => {
        const a = acreditadoPorVenta[v.IDVenta]
        return a && a.acreditado >= (totalPorVenta[v.IDVenta] || 0) && totalPorVenta[v.IDVenta] > 0
      })
      .filter(v => !pagadosSet.has(`${v.IDVenta}-${v.IDProducto}`))
      .reduce((s, v) => s + (v.CostoProveedor || 0), 0)

    return { ingresosAcreditados, ganancia, facturado, gastosMes, bnaPendiente, deudaProv, balance: ganancia - gastosMes }
  }, [ventas, cobros, pagos, gastos, mes, hoy, acreditadoPorVenta, totalPorVenta, cierrePorVenta, mediosPago])

  // ── Stock parado ──────────────────────────────────────────────────────────
  const diasParada = config?.diasParada || 60
  const parados = useMemo(() =>
    productos.filter(p => p.enStock && !p.vendido && !p.devolucion && diffDays(p.fechaIngreso) >= diasParada)
  , [productos, diasParada])
  const stockTotal = useMemo(() => productos.filter(p => p.enStock && !p.vendido && !p.devolucion).length, [productos])

  const repairCenter = useMemo(() => {
    const productosIncompletos = productos.filter(p => getProductoIssues(p).length > 0)

    const ventasAgrupadas = {}
    ventas.filter(v => !v.cancelada).forEach(v => {
      if (!ventasAgrupadas[v.IDVenta]) ventasAgrupadas[v.IDVenta] = []
      ventasAgrupadas[v.IDVenta].push(v)
    })

    const ventasConErrores = Object.entries(ventasAgrupadas)
      .map(([idVenta, items]) => {
        const errores = items
          .map(item => ({ item, issues: getVentaItemIssues(item, productosById[item.IDProducto] || null) }))
          .filter(entry => entry.issues.length > 0)
        return {
          idVenta,
          fecha: items[0]?.FechaVenta || '',
          errores,
        }
      })
      .filter(venta => venta.errores.length > 0)

    return {
      productosIncompletos,
      ventasConErrores,
    }
  }, [productos, productosById, ventas])

  // ── Datos gráficos — últimos 6 meses ─────────────────────────────────────
  const datosMeses = useMemo(() => {
    const meses = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i)
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const ventasM = ventas.filter(v => !v.cancelada && cierrePorVenta[v.IDVenta]?.fechaCierre?.startsWith(ym))
      const ganancia = ventasM.reduce((s, v) => s + (v.GananciaNegocio || 0), 0)
      const facturado = ventasM.reduce((s, v) => s + (v.PrecioVentaFinal || 0), 0)
      meses.push({ mes: monthLabel(ym), facturado, ganancia, prendas: ventasM.length })
    }
    return meses
  }, [ventas, cierrePorVenta])

  // ── Pie medios de cobro (mes actual) ─────────────────────────────────────
  const dataMedios = useMemo(() => {
    const bnaSet = new Set(mediosPago.filter(m => m.esBNA).map(m => m.id))
    if (bnaSet.size === 0) bnaSet.add('BNA')
    const map = {}
    cobros.forEach(c => {
      const fe = (bnaSet.has(c.medio) && c.fechaReal) ? c.fechaReal : c.fecha
      if (!fe?.startsWith(mes)) return
      map[c.medio] = (map[c.medio] || 0) + (c.monto || 0)
    })
    const labels = Object.fromEntries(mediosPago.map(m => [m.id, m.label]))
    return Object.entries(map).map(([medio, monto]) => ({ name: labels[medio] || medio, value: monto, medio }))
  }, [cobros, mes, mediosPago])

  // ── Top proveedores del mes ───────────────────────────────────────────────
  const topProveedores = useMemo(() => {
    const map = {}
    ventas.filter(v => !v.cancelada && cierrePorVenta[v.IDVenta]?.fechaCierre?.startsWith(mes)).forEach(v => {
      if (!map[v.ProveedorID]) map[v.ProveedorID] = { nombre: v.ProveedorNombre || v.ProveedorID, monto: 0, ganancia: 0, prendas: 0 }
      map[v.ProveedorID].monto    += v.PrecioVentaFinal || 0
      map[v.ProveedorID].ganancia += v.GananciaNegocio  || 0
      map[v.ProveedorID].prendas  += 1
    })
    return Object.values(map).sort((a, b) => b.monto - a.monto).slice(0, 5)
  }, [ventas, mes, cierrePorVenta])

  const fmtK = (n) => n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : fmt$(n)
  const goToVentasErrores = (ids = null) => setSection('ventas', { filter: 'errores', ids })
  const goToProductosIncompletos = (ids = null) => setSection('inventario', { filter: 'incompletos', ids })

  return (
    <div>
      <SectionHeader title="Dashboard" />
      <p className="text-sm text-text3 -mt-2 mb-5">
        {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
      </p>

      {/* Tarjetas */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <StatCard icon="💵" label="Ingresos del mes" value={fmt$(statsMes.ingresosAcreditados)} sub="Cobros acreditados" color="green" />
        <StatCard icon="📈" label="Ganancia neta" value={fmt$(statsMes.ganancia)} sub={`Balance: ${fmt$(statsMes.balance)}`} color="gold" />
        <StatCard icon="⚠️" label="Debo a proveedores" value={fmt$(statsMes.deudaProv)} sub="Cobrado sin pagar" color="red" onClick={() => setSection('pagos')} />
        <StatCard icon="🏦" label="BNA pendiente" value={fmt$(statsMes.bnaPendiente)} sub="Acredita próximo mes" color="blue" />
        <StatCard icon="📦" label="Stock disponible" value={stockTotal} sub={parados.length > 0 ? `⚠️ ${parados.length} paradas +${diasParada}d` : 'Todo activo'} color={parados.length > 0 ? 'purple' : 'gray'} />
        <StatCard icon="📋" label="Gastos del mes" value={fmt$(statsMes.gastosMes)} sub="Costos fijos" color="gray" onClick={() => setSection('gastos')} />
      </div>

      {/* Alertas */}
      {parados.length > 0 && (
        <div className="card border-yellow-200 bg-yellow-50 p-4 mb-4">
          <div className="font-semibold text-yellow-800 mb-1">⚠️ {parados.length} prendas paradas +{diasParada} días</div>
          <div className="text-sm text-yellow-700">Considerá devolver o ajustar precio.</div>
          <div className="mt-2 space-y-1">
            {parados.slice(0, 3).map(p => (
              <div key={p.id} className="text-xs text-yellow-800 flex justify-between">
                <span>{p.notas?.slice(0, 35) || p.id}</span>
                <span>{diffDays(p.fechaIngreso)}d · {fmt$(p.precio)}</span>
              </div>
            ))}
            {parados.length > 3 && <div className="text-xs text-yellow-600">+{parados.length - 3} más</div>}
          </div>
        </div>
      )}

      {statsMes.bnaPendiente > 0 && (
        <div className="card border-blue-200 bg-blue-50 p-4 mb-6">
          <div className="font-semibold text-blue-800">🏦 {fmt$(statsMes.bnaPendiente)} pendiente de acreditación BNA</div>
          <div className="text-sm text-blue-600 mt-0.5">Se acredita el próximo mes.</div>
        </div>
      )}

      {(repairCenter.ventasConErrores.length > 0 || repairCenter.productosIncompletos.length > 0) && (
        <div className="card border-red-200 bg-red-50 p-4 mb-6">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <div className="font-semibold text-red-800">Centro de reparación</div>
              <div className="text-sm text-red-700 mt-0.5">Detectamos datos incompletos heredados de importaciones o cargas inconsistentes.</div>
            </div>
            <div className="text-xs font-semibold text-red-700 bg-white border border-red-200 rounded-full px-2 py-1">
              Atención
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <button
              onClick={() => goToVentasErrores()}
              className="text-left bg-white border border-red-200 rounded-xl p-3 hover:bg-red-100 transition-colors"
            >
              <div className="text-xs text-red-600 uppercase tracking-wide mb-1">Ventas con errores</div>
              <div className="text-2xl font-bold text-red-800">{repairCenter.ventasConErrores.length}</div>
              <div className="text-xs text-red-700 mt-1">Abrí Ventas y usá la pestaña "Con errores" para reparar precio, descripción o producto faltante.</div>
            </button>
            <button
              onClick={() => goToProductosIncompletos()}
              className="text-left bg-white border border-red-200 rounded-xl p-3 hover:bg-red-100 transition-colors"
            >
              <div className="text-xs text-red-600 uppercase tracking-wide mb-1">Productos incompletos</div>
              <div className="text-2xl font-bold text-red-800">{repairCenter.productosIncompletos.length}</div>
              <div className="text-xs text-red-700 mt-1">Abrí Inventario y usá la pestaña "Incompletos" para completar descripción o precio.</div>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-white/80 border border-red-100 rounded-xl p-3">
              <div className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2">Ventas a revisar</div>
              {repairCenter.ventasConErrores.slice(0, 3).map(venta => (
                <button key={venta.idVenta} onClick={() => goToVentasErrores([venta.idVenta])} className="w-full flex justify-between items-center text-xs py-1 border-b border-red-50 last:border-0 text-left hover:bg-red-50 rounded">
                  <span className="text-text1 font-medium">{venta.idVenta}</span>
                  <span className="text-red-700">{venta.errores.length} error(es)</span>
                </button>
              ))}
              {repairCenter.ventasConErrores.length > 3 && (
                <div className="text-xs text-red-600 mt-2">+{repairCenter.ventasConErrores.length - 3} ventas más</div>
              )}
            </div>

            <div className="bg-white/80 border border-red-100 rounded-xl p-3">
              <div className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2">Productos a completar</div>
              {repairCenter.productosIncompletos.slice(0, 3).map(producto => (
                <button key={producto.id} onClick={() => goToProductosIncompletos([producto.id])} className="w-full flex justify-between items-center text-xs py-1 border-b border-red-50 last:border-0 gap-2 text-left hover:bg-red-50 rounded">
                  <span className="text-text1 font-medium truncate">{producto.notas || producto.id}</span>
                  <span className="text-red-700 text-right">{getProductoIssues(producto).join(' · ')}</span>
                </button>
              ))}
              {repairCenter.productosIncompletos.length > 3 && (
                <div className="text-xs text-red-600 mt-2">+{repairCenter.productosIncompletos.length - 3} productos más</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Gráficos — en desktop se muestran todos juntos en grid */}
      <div className="hidden sm:grid sm:grid-cols-2 gap-4 mb-4">
        <div className="card p-4">
          <div className="text-sm font-semibold text-text2 mb-3">Facturado vs Ganancia</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={datosMeses} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="mes" tick={{ fontSize: 9 }} />
              <YAxis tickFormatter={fmtK} tick={{ fontSize: 9 }} />
              <Tooltip formatter={(v) => fmt$(v)} />
              <Bar dataKey="facturado" fill="#c7d2fe" name="Facturado" radius={[3,3,0,0]} />
              <Bar dataKey="ganancia"  fill="#6366f1" name="Ganancia"  radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card p-4">
          <div className="text-sm font-semibold text-text2 mb-3">Prendas vendidas por mes</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={datosMeses} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="mes" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} />
              <Tooltip />
              <Bar dataKey="prendas" fill="#22c55e" name="Prendas" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card p-4">
          <div className="text-sm font-semibold text-text2 mb-3">Medios de cobro — {monthLabel(mes)}</div>
          {dataMedios.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart margin={{ top: 8, right: 24, left: 24, bottom: 8 }}>
                  <Pie
                    data={dataMedios}
                    cx="50%"
                    cy="46%"
                    innerRadius={42}
                    outerRadius={74}
                    paddingAngle={2}
                    dataKey="value"
                    label={renderPiePercentLabel}
                    labelLine={false}
                  >
                    {dataMedios.map((entry, i) => <Cell key={i} fill={MEDIO_COLORS[entry.medio] || CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => fmt$(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2 text-xs">
                {dataMedios.map((entry, i) => (
                  <div key={entry.medio} className="flex items-center justify-between gap-2 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: MEDIO_COLORS[entry.medio] || CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="text-text2 truncate">{entry.name}</span>
                    </div>
                    <span className="font-semibold text-text1 flex-shrink-0">{fmt$(entry.value)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : <div className="text-sm text-text3 text-center py-10">Sin cobros este mes</div>}
        </div>
        <div className="card p-4">
          <div className="text-sm font-semibold text-text2 mb-3">Top proveedores — {monthLabel(mes)}</div>
          {topProveedores.length > 0 ? topProveedores.map((p, i) => (
            <div key={i} className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0">
              <div className="w-5 h-5 rounded-full bg-brand-100 flex items-center justify-center text-xs font-bold text-brand-700 flex-shrink-0">{i+1}</div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-text1 truncate">{p.nombre}</div>
                <div className="text-xs text-text3">{p.prendas} prendas</div>
              </div>
              <div className="text-xs font-bold text-brand-700">{fmt$(p.monto)}</div>
            </div>
          )) : <div className="text-sm text-text3 text-center py-8">Sin ventas este mes</div>}
        </div>
      </div>

      {/* Tabs gráficos — solo en mobile */}
      <div className="sm:hidden">
      <Tabs
        tabs={[{ id: 'mes', label: 'Por mes' }, { id: 'medios', label: 'Medios de cobro' }, { id: 'provs', label: 'Proveedores' }]}
        active={tab} onChange={setTab}
      />

      {tab === 'mes' && (
        <div className="card p-4 mb-4">
          <div className="text-sm font-semibold text-text2 mb-4">Facturado vs Ganancia (últimos 6 meses)</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={datosMeses} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={fmtK} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => fmt$(v)} />
              <Bar dataKey="facturado" fill="#c7d2fe" name="Facturado" radius={[3, 3, 0, 0]} />
              <Bar dataKey="ganancia"  fill="#6366f1" name="Ganancia"  radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-4">
            <div className="text-sm font-semibold text-text2 mb-2">Prendas vendidas</div>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={datosMeses} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="prendas" fill="#22c55e" name="Prendas" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {tab === 'medios' && (
        <div className="card p-4 mb-4">
          <div className="text-sm font-semibold text-text2 mb-4">Cobros del mes por medio</div>
          {dataMedios.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart margin={{ top: 8, right: 30, left: 30, bottom: 8 }}>
                  <Pie
                    data={dataMedios}
                    cx="50%"
                    cy="44%"
                    innerRadius={52}
                    outerRadius={86}
                    paddingAngle={2}
                    dataKey="value"
                    label={renderPiePercentLabel}
                    labelLine={false}
                  >
                    {dataMedios.map((entry, i) => (
                      <Cell key={i} fill={MEDIO_COLORS[entry.medio] || CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => fmt$(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 mt-1">
                {dataMedios.map((entry, i) => (
                  <div key={entry.medio} className="flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: MEDIO_COLORS[entry.medio] || CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="text-text2 truncate">{entry.name}</span>
                    </div>
                    <span className="font-semibold text-text1 flex-shrink-0">{fmt$(entry.value)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-sm text-text3 text-center py-10">Sin cobros registrados este mes</div>
          )}
        </div>
      )}

      {tab === 'provs' && (
        <div className="card p-4 mb-4">
          <div className="text-sm font-semibold text-text2 mb-3">Top proveedores — {monthLabel(mes)}</div>
          {topProveedores.length > 0 ? topProveedores.map((p, i) => (
            <div key={i} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
              <div className="w-6 h-6 rounded-full bg-brand-100 flex items-center justify-center text-xs font-bold text-brand-700">{i + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text1 truncate">{p.nombre}</div>
                <div className="text-xs text-text3">{p.prendas} prendas · Ganancia {fmt$(p.ganancia)}</div>
              </div>
              <div className="text-sm font-bold text-brand-700">{fmt$(p.monto)}</div>
            </div>
          )) : (
            <div className="text-sm text-text3 text-center py-10">Sin ventas este mes</div>
          )}
        </div>
      )}
      </div>{/* fin sm:hidden */}
    </div>
  )
}
