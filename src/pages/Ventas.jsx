import { useState, useMemo, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { fmt$, fmtDate, today } from '../utils/formatters'
import { Modal, SearchBar, Button, Input, Select, SearchableSelect, SectionHeader, EmptyState, InfoRow, Chip } from '../components/ui'
import { getProductoIssues, getVentaItemIssues, hasText, isPositiveNumber, toFiniteNumber } from '../utils/dataQuality'
// medios dinámicos desde contexto

export default function Ventas({ setSection, navigation }) {
  const { ventas, cobros, pagos, productos, categorias, addVenta, cancelarVentaPorFalla, addCobro, repairVentaItem, showToast } = useApp()
  const [q, setQ]               = useState('')
  const [filtro, setFiltro]     = useState('todos')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [modalVenta, setMV]     = useState(false)
  const [detalleVenta, setDV]   = useState(null)
  const [modalCobro, setMC]     = useState(null)  // idVenta para cobro post-venta
  const [repairTarget, setRepairTarget] = useState(null)
  const [focusVentaIds, setFocusVentaIds] = useState(null)

  const hoy = today()
  const productosById = useMemo(() => Object.fromEntries(productos.map(p => [p.id, p])), [productos])

  // Cobros acreditados por venta
  const cvMap = useMemo(() => {
    const map = {}
    cobros.forEach(c => {
      const fe = (c.medio === 'BNA' && c.fechaReal) ? c.fechaReal : c.fecha
      const monto = c.monto || 0
      const esCC = c.medio === 'CC' || !!c.idCuentaCorriente
      if (!map[c.idVenta]) {
        map[c.idVenta] = {
          cobrado: 0,
          acreditado: 0,
          cobradoCC: 0,
          cobradoOtros: 0,
          acreditadoCC: 0,
          acreditadoOtros: 0,
          items: [],
        }
      }
      map[c.idVenta].cobrado += monto
      map[c.idVenta].items.push(c)
      if (esCC) map[c.idVenta].cobradoCC += monto
      else map[c.idVenta].cobradoOtros += monto

      if (fe && fe <= hoy) {
        map[c.idVenta].acreditado += monto
        if (esCC) map[c.idVenta].acreditadoCC += monto
        else map[c.idVenta].acreditadoOtros += monto
      }
    })
    return map
  }, [cobros, hoy])

  // Agrupadas por IDVenta
  const ventasAgrupadas = useMemo(() => {
    const map = {}
    ventas.filter(v => !v.cancelada).forEach(v => {
      if (!map[v.IDVenta]) map[v.IDVenta] = { id: v.IDVenta, fecha: v.FechaVenta, items: [], total: 0, ganancia: 0 }
      map[v.IDVenta].items.push(v)
      map[v.IDVenta].total    += toFiniteNumber(v.PrecioVentaFinal, 0)
      map[v.IDVenta].ganancia += toFiniteNumber(v.GananciaNegocio, 0)
    })
    return Object.values(map).map(venta => {
      const errorItems = venta.items
        .map(item => ({ item, issues: getVentaItemIssues(item, productosById[item.IDProducto] || null) }))
        .filter(entry => entry.issues.length > 0)

      return {
        ...venta,
        errorItems,
        errorCount: errorItems.length,
      }
    }).sort((a, b) => {
      const na = parseInt(a.id.slice(1)), nb = parseInt(b.id.slice(1))
      return nb - na
    })
  }, [ventas, productosById])

  const ventasConPagoProveedor = useMemo(() => {
    const set = new Set()
    ventas.filter(v => v.PagoProveedor === true).forEach(v => set.add(v.IDVenta))
    pagos.forEach(p => { if (p.idVenta) set.add(p.idVenta) })
    return set
  }, [ventas, pagos])

  const filtradas = useMemo(() => {
    let list = [...ventasAgrupadas]
    if (filtro === 'cobradas')   list = list.filter(v => { const cv = cvMap[v.id]; return cv && cv.acreditado >= v.total && v.total > 0 })
    if (filtro === 'pendientes') list = list.filter(v => { const cv = cvMap[v.id]; return !cv || cv.acreditado < v.total })
    if (filtro === 'errores')    list = list.filter(v => {
      const cv = cvMap[v.id] || {}
      const overcobrada = Number(cv.cobrado || 0) > Number(v.total || 0)
      return v.errorCount > 0 || overcobrada
    })
    if (filtro === 'cc') {
      const ccIds = new Set()
      cobros.filter(c => c.idCuentaCorriente).forEach(c => ccIds.add(c.idVenta))
      list = list.filter(v => ccIds.has(v.id))
    }
    if (focusVentaIds?.length) list = list.filter(v => focusVentaIds.includes(v.id))
    if (fechaDesde) list = list.filter(v => v.fecha && v.fecha >= fechaDesde)
    if (fechaHasta) list = list.filter(v => v.fecha && v.fecha <= fechaHasta)
    if (q) {
      const ql = q.toLowerCase()
      list = list.filter(v =>
        v.id.toLowerCase().includes(ql) ||
        v.fecha?.includes(q) ||
        v.items.some(i => i.Descripcion?.toLowerCase().includes(ql) || i.IDProducto?.toLowerCase().includes(ql) || i.ProveedorNombre?.toLowerCase().includes(ql))
      )
    }
    // Ordenar de más reciente a menos reciente
    list.sort((a, b) => parseInt(b.id.slice(1)) - parseInt(a.id.slice(1)))
    return list.slice(0, 80)
  }, [ventasAgrupadas, filtro, q, cvMap, focusVentaIds, fechaDesde, fechaHasta, cobros])

  useEffect(() => {
    if (!navigation || navigation.target !== 'ventas') return
    if (navigation.filter) setFiltro(navigation.filter)
    if (navigation.ids?.length) {
      setFocusVentaIds(navigation.ids)
      setQ('')
      return
    }
    setFocusVentaIds(null)
    if (navigation.search != null) setQ(navigation.search)
  }, [navigation])

  const ventasConErrores = useMemo(() =>
    ventasAgrupadas.filter(v => {
      const cv = cvMap[v.id] || {}
      const overcobrada = Number(cv.cobrado || 0) > Number(v.total || 0)
      return v.errorCount > 0 || overcobrada
    }).length
  , [ventasAgrupadas, cvMap])

  const ventasAsociadasACC = useMemo(() => {
    const ccIds = new Set()
    cobros.filter(c => c.idCuentaCorriente).forEach(c => {
      ccIds.add(c.idVenta)
    })
    return ventasAgrupadas.filter(v => ccIds.has(v.id)).length
  }, [ventasAgrupadas, cobros])

  const handleNuevaVenta = async (items, fecha) => {
    const invalidItem = items.find(item => !hasText(item.notas || item.Descripcion) || !isPositiveNumber(item.precioVenta))
    if (invalidItem) {
      showToast(`La prenda ${invalidItem.id} tiene datos incompletos y no puede venderse`, 'error')
      return
    }
    const idVenta = await addVenta(items, fecha)
    if (!idVenta) return
    setMV(false)
    setMC(idVenta) // abrir cobro inmediatamente
  }

  return (
    <div>
      <SectionHeader title="Ventas" action={<Button size="sm" onClick={() => setMV(true)}>+ Nueva venta</Button>} />

      <SearchBar value={q} onChange={setQ} placeholder="Buscar ID, producto, proveedor, fecha…" className="mb-3" />

      <div className="flex gap-2 mb-3 flex-wrap items-end">
        <Chip label="Todas"     active={filtro === 'todos'}     onClick={() => { setFiltro('todos'); setFocusVentaIds(null) }} />
        <Chip label="Cobradas"  active={filtro === 'cobradas'}  onClick={() => { setFiltro('cobradas'); setFocusVentaIds(null) }} />
        <Chip label="Pendientes"active={filtro === 'pendientes'}onClick={() => { setFiltro('pendientes'); setFocusVentaIds(null) }} />
        <Chip label={`Con errores (${ventasConErrores})`} active={filtro === 'errores'} onClick={() => { setFiltro('errores'); setFocusVentaIds(null) }} />
        <Chip label={`Con CC (${ventasAsociadasACC})`} active={filtro === 'cc'} onClick={() => { setFiltro('cc'); setFocusVentaIds(null) }} />
      </div>

      <div className="flex gap-2 mb-3 flex-wrap items-end">
        <Input 
          type="date"
          value={fechaDesde}
          onChange={e => setFechaDesde(e.target.value)}
          placeholder="Desde"
          label="Desde"
          className="flex-1 min-w-[150px]"
        />
        <Input 
          type="date"
          value={fechaHasta}
          onChange={e => setFechaHasta(e.target.value)}
          placeholder="Hasta"
          label="Hasta"
          className="flex-1 min-w-[150px]"
        />
        {(fechaDesde || fechaHasta) && (
          <Button variant="ghost" size="sm" onClick={() => { setFechaDesde(''); setFechaHasta('') }}>✕ Limpiar fechas</Button>
        )}
      </div>

      {focusVentaIds?.length > 0 && (
        <div className="mb-3 bg-brand-50 border border-brand-200 rounded-xl px-3 py-2 flex items-center justify-between gap-3 text-xs text-brand-700">
          <span>Mostrando solo las ventas seleccionadas desde el Centro de reparación.</span>
          <button className="font-semibold" onClick={() => setFocusVentaIds(null)}>Ver todas</button>
        </div>
      )}

      {filtradas.length === 0 ? (
        <EmptyState icon="🛍️" title="Sin ventas" subtitle="Registrá tu primera venta" action={<Button size="sm" onClick={() => setMV(true)}>+ Nueva venta</Button>} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {filtradas.map(v => {
            const cv = cvMap[v.id] || {}
            const cerrada = cv.acreditado >= v.total && v.total > 0
            const overcobrada = Number(cv.cobrado || 0) > Number(v.total || 0) && Number(v.total || 0) > 0
            const parcial = cv.cobrado > 0 && !cerrada
            const saleLocked = ventasConPagoProveedor.has(v.id)
            return (
              <div key={v.id} onClick={() => setDV(v)} className="card p-3 cursor-pointer active:bg-gray-50 transition-colors">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-bold text-brand-700">{v.id}</span>
                    <span className="text-xs text-text3 ml-2">{fmtDate(v.fecha)}</span>
                  </div>
                  <span className="font-bold text-text1">{fmt$(v.total)}</span>
                </div>
                <div className="text-xs text-text3 mt-1">{v.items.length} prenda(s) · Ganancia {fmt$(v.ganancia)}</div>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {v.errorCount > 0 && <span className="bg-red-50 text-red-700 text-xs px-2 py-0.5 rounded-full">⚠️ {v.errorCount} error(es)</span>}
                  {overcobrada && <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full">🚨 Sobrecobrada {fmt$(Number(cv.cobrado || 0) - Number(v.total || 0))}</span>}
                  {saleLocked && <span className="bg-orange-100 text-orange-700 text-xs px-2 py-0.5 rounded-full">🔒 Pagada proveedor</span>}
                  {cerrada
                    ? <span className="badge-vendido">✅ Cobrada</span>
                    : parcial
                    ? <span className="bg-yellow-100 text-yellow-700 text-xs px-2 py-0.5 rounded-full">⏳ Parcial {fmt$(cv.cobrado)}</span>
                    : <span className="bg-red-50 text-red-600 text-xs px-2 py-0.5 rounded-full">⭕ Sin cobrar</span>
                  }
                </div>
                {(Number(cv.cobradoCC || 0) > 0 || Number(cv.cobradoOtros || 0) > 0) && (
                  <div className="mt-2 text-[11px] text-text3">
                    Cobrado: CC {fmt$(cv.cobradoCC || 0)} · Otros {fmt$(cv.cobradoOtros || 0)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal nueva venta */}
      {modalVenta && (
        <NuevaVentaModal
          productos={productos}
          categorias={categorias}
          showToast={showToast}
          onSave={handleNuevaVenta}
          onClose={() => setMV(false)}
        />
      )}

      {/* Modal cobro post-venta */}
      {modalCobro && (
        <CobroRapidoModal
          idVenta={modalCobro}
          ventas={ventas}
          cvMap={cvMap}
          addCobro={addCobro}
          onClose={() => setMC(null)}
        />
      )}

      {/* Detalle venta */}
      {detalleVenta && (
        <DetalleVentaModal
          venta={detalleVenta}
          cv={cvMap[detalleVenta.id] || {}}
          saleLocked={ventasConPagoProveedor.has(detalleVenta.id)}
          productsById={productosById}
          onClose={() => setDV(null)}
          onCobrar={(id) => { setDV(null); setMC(id) }}
          onGestionCobros={(id) => { setDV(null); setSection('cobros', { idVenta: id }) }}
          onOpenCobro={(cobroId, ventaId) => { setDV(null); setSection('cobros', { idVenta: ventaId, cobroId }) }}
          onOpenProducto={(productoId) => { setDV(null); setSection('inventario', { ids: [productoId], filter: 'todos' }) }}
          onOpenCC={(ccId) => { setDV(null); setSection('cuentas', { ccId }) }}
          onRepair={(payload) => setRepairTarget(payload)}
          onCancelarPorFalla={async (id, payload) => {
            const ok = await cancelarVentaPorFalla(id, payload)
            if (ok) setDV(null)
          }}
        />
      )}

      {repairTarget && (
        <RepararVentaItemModal
          repair={repairTarget}
          onClose={() => setRepairTarget(null)}
          onSave={async (payload) => {
            const ok = await repairVentaItem(payload)
            if (ok) {
              setRepairTarget(null)
              // Refrescar el detalle de venta con datos actualizados
              const ventaActualizada = ventas.find(v => v.id === payload.idVenta)
              if (ventaActualizada && detalleVenta) {
                setDV(ventaActualizada)
              }
            }
          }}
        />
      )}
    </div>
  )
}

// ── Nueva Venta — pantalla completa ──────────────────────────────────────────
function NuevaVentaModal({ productos, categorias, showToast, onSave, onClose }) {
  const [q, setQ]         = useState('')
  const [carrito, setC]   = useState([])
  const [fecha, setFecha] = useState(today())
  const inputRef          = useRef(null)

  const stockDisponible = useMemo(() =>
    productos.filter(p => p.enStock && !p.vendido && !p.devolucion)
  , [productos])

  const stockBloqueado = useMemo(() =>
    stockDisponible.filter(p => getProductoIssues(p).length > 0)
  , [stockDisponible])

  const stockVendible = useMemo(() =>
    stockDisponible.filter(p => getProductoIssues(p).length === 0)
  , [stockDisponible])

  const resultados = useMemo(() => {
    if (!q || q.length < 1) return []
    const ql = q.toLowerCase()
    const ids = new Set(carrito.map(x => x.id))
    return stockVendible.filter(p =>
      !ids.has(p.id) && (
        p.notas?.toLowerCase().includes(ql) ||
        p.id?.toLowerCase().includes(ql) ||
        p.proveedorID?.toLowerCase().includes(ql) ||
        p.proveedorNombre?.toLowerCase().includes(ql)
      )
    ).slice(0, 25)
  }, [q, stockVendible, carrito])

  const agregar = (p) => {
    const issues = getProductoIssues(p)
    if (issues.length) {
      showToast(`La prenda ${p.id} no puede venderse: ${issues.join(' · ')}`, 'error')
      return
    }
    setC(c => [...c, { ...p, precioVenta: p.precio }])
    setQ('')
    inputRef.current?.focus()
  }

  const totalVenta     = carrito.reduce((s, p) => s + (p.precioVenta || 0), 0)
  const totalProveedor = carrito.reduce((s, p) => {
    const cat = categorias.find(c => c.id === p.categoria) || { porcentaje: 0.5 }
    return s + Math.round((p.precioVenta || 0) * cat.porcentaje)
  }, 0)
  const carritoValido = carrito.every(p => hasText(p.notas || p.Descripcion) && isPositiveNumber(p.precioVenta))

  return (
    // Full-screen overlay
    <div className="fixed inset-0 bg-black/50 z-50 flex flex-col">
      <div className="bg-white flex flex-col h-full w-full sm:max-w-lg sm:mx-auto sm:my-4 sm:rounded-2xl sm:h-auto sm:max-h-[95vh] shadow-2xl">

        {/* Header fijo */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <h3 className="font-serif text-lg font-semibold text-text1">Nueva venta</h3>
          <button onClick={onClose} className="p-2 text-text3 hover:text-text1 rounded-lg">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Buscador + fecha — sticky */}
        <div className="px-4 pt-3 pb-2 border-b border-border flex-shrink-0 bg-white">
          {stockBloqueado.length > 0 && (
            <div className="mb-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
              {stockBloqueado.length} producto(s) del inventario tienen datos incompletos y quedan bloqueados para venta hasta ser reparados en Inventario.
            </div>
          )}
          <div className="flex gap-2 items-center mb-2">
            <label className="text-xs text-text3 whitespace-nowrap">Fecha:</label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
              className="input-base text-sm py-1.5 flex-1" />
          </div>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={inputRef}
              value={q} onChange={e => setQ(e.target.value)}
              placeholder="Buscar por descripción, ID prenda, ID o nombre de proveedor…"
              className="input-base pl-9 text-sm"
              autoFocus
            />
            {q && (
              <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text3">✕</button>
            )}
          </div>
          {q.length > 0 && (
            <div className="text-xs text-text3 mt-1">
              {resultados.length > 0 ? `${resultados.length} resultado(s)` : 'Sin resultados'}
            </div>
          )}
        </div>

        {/* Área scrollable: resultados + carrito */}
        <div className="flex-1 overflow-y-auto">

          {/* Resultados de búsqueda */}
          {resultados.length > 0 && (
            <div className="border-b border-border">
              <div className="px-4 py-2 bg-brand-50 text-xs font-medium text-brand-700 uppercase tracking-wide">
                Resultados — tocá para agregar
              </div>
              {resultados.map(p => (
                <div key={p.id} onClick={() => agregar(p)}
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer active:bg-cream border-b border-gray-50 last:border-0">
                  {p.foto
                    ? <img src={p.foto} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" alt="" />
                    : <div className="w-12 h-12 rounded-lg bg-cream flex items-center justify-center text-xl flex-shrink-0">👗</div>
                  }
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text1 leading-snug">{p.notas || p.id}</div>
                    <div className="text-xs text-text3 mt-0.5">{p.proveedorNombre} · {p.id}</div>
                  </div>
                  <div className="flex flex-col items-end flex-shrink-0">
                    <div className="text-sm font-bold text-brand-700">{fmt$(p.precio)}</div>
                    <div className="text-xs text-green-700 mt-0.5">+{fmt$(p.precio - Math.round(p.precio * (p.porcProveedor || 0.5)))}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Carrito */}
          {carrito.length > 0 && (
            <div>
              <div className="px-4 py-2 bg-green-50 text-xs font-medium text-green-700 uppercase tracking-wide sticky top-0 border-b border-green-100">
                {carrito.length} prenda(s) en esta venta
              </div>
              <div className="divide-y divide-gray-50">
                {carrito.map((p, i) => (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                    {p.foto
                      ? <img src={p.foto} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" alt="" />
                      : <div className="w-10 h-10 rounded-lg bg-cream flex items-center justify-center text-lg flex-shrink-0">👗</div>
                    }
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text1 truncate">{p.notas || p.id}</div>
                      <div className="text-xs text-text3">{p.proveedorNombre}</div>
                    </div>
                    <input
                      type="number"
                      value={p.precioVenta}
                      onChange={e => setC(c => c.map((x, j) => j === i ? { ...x, precioVenta: e.target.value === '' ? '' : Number(e.target.value) } : x))}
                      className="w-24 input-base text-right text-sm px-2 py-1.5 flex-shrink-0"
                    />
                    <button onClick={() => setC(c => c.filter((_, j) => j !== i))}
                      className="text-red-400 active:text-red-600 p-1 flex-shrink-0">✕</button>
                  </div>
                ))}
              </div>
              {!carritoValido && (
                <div className="px-4 py-2 text-xs text-red-700 bg-red-50 border-t border-red-100">
                  Hay prendas sin precio valido o descripcion. Corregilas antes de registrar la venta.
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!q && carrito.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <div className="text-5xl mb-3">🔍</div>
              <div className="text-sm font-medium text-text2">Buscá una prenda para agregarla</div>
              <div className="text-xs text-text3 mt-1">Podés buscar por descripción, ID de producto, ID de proveedor o nombre de proveedor</div>
            </div>
          )}
        </div>

        {/* Footer fijo con totales */}
        <div className="border-t border-border px-4 py-3 flex-shrink-0 bg-white">
          {carrito.length > 0 && (
            <div className="flex justify-between text-sm mb-3">
              <div className="space-y-0.5">
                <div className="flex gap-4">
                  <span className="text-text3">A proveedores:</span>
                  <span className="text-red-700 font-medium">{fmt$(totalProveedor)}</span>
                </div>
                <div className="flex gap-4">
                  <span className="text-text3">Ganancia:</span>
                  <span className="text-green-700 font-medium">{fmt$(totalVenta - totalProveedor)}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-text3">Total</div>
                <div className="text-xl font-bold text-text1">{fmt$(totalVenta)}</div>
              </div>
            </div>
          )}
          <button
            disabled={!carrito.length || !carritoValido || !fecha}
            onClick={() => onSave(carrito, fecha)}
            className={`w-full py-3.5 rounded-xl font-semibold text-base transition-colors ${carrito.length && carritoValido && fecha ? 'bg-brand-700 text-white active:bg-brand-800' : 'bg-gray-100 text-gray-400'}`}
          >
            {carrito.length > 0 ? `Registrar venta — ${carrito.length} prenda(s)` : 'Agregá al menos una prenda'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Cobro rápido post-venta ───────────────────────────────────────────────────
function CobroRapidoModal({ idVenta, ventas, cvMap, addCobro, onClose }) {
  const { cuentasCorrientes, addCC, updateCC, deleteCC, pagarCC, mediosPago: mpDyn, showToast } = useApp()

  const totalVenta = ventas.filter(v => v.IDVenta === idVenta).reduce((s, v) => s + (v.PrecioVentaFinal || 0), 0)
  const cv         = cvMap[idVenta] || {}
  const pendiente  = totalVenta - (cv.cobrado || 0)

  const [form, setForm]   = useState({ medio: 'EFE', monto: pendiente, fecha: today(), fechaReal: '', obs: '' })
  // CC state
  const [ccOpcion, setCCOp]   = useState('existente')  // 'existente' | 'nueva'
  const [ccSelId,  setCCSel]  = useState('')
  const [ccNueva,  setCCNueva] = useState({ cliente: '', notas: '' })
  const dynamicSectionRef = useRef(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const ccActivas = cuentasCorrientes.filter(cc => cc.estado !== 'Cancelada')
  const ccIdsAsociadas = useMemo(() => {
    const ids = new Set()
    ;(cv.items || []).forEach((c) => {
      if (c.idCuentaCorriente) ids.add(c.idCuentaCorriente)
    })
    cuentasCorrientes.forEach((cc) => {
      if (cc.idVenta === idVenta || (cc.ventasAsociadas || []).includes(idVenta)) ids.add(cc.id)
    })
    return [...ids]
  }, [cv.items, cuentasCorrientes, idVenta])
  const ventaYaAsociadaACC = ccIdsAsociadas.length > 0
  const ccAsociadaId = ccIdsAsociadas[0] || ''
  const ccAsociada = cuentasCorrientes.find(cc => cc.id === ccAsociadaId) || null
  const ccActivasDisponibles = useMemo(() =>
    ventaYaAsociadaACC ? ccActivas.filter(cc => ccIdsAsociadas.includes(cc.id)) : ccActivas
  , [ccActivas, ventaYaAsociadaACC, ccIdsAsociadas])
  const ccActivasOptions = useMemo(() =>
    ccActivasDisponibles.map(cc => ({
      value: cc.id,
      label: `${cc.cliente} · Saldo ${fmt$(cc.saldo || 0)} · ${cc.id}`,
      searchText: `${cc.cliente} ${cc.id}`,
    }))
  , [ccActivasDisponibles])
  const mediosDisponibles = useMemo(() =>
    ventaYaAsociadaACC ? mpDyn.filter(m => !m.esCC && !m.esBNA) : mpDyn
  , [mpDyn, ventaYaAsociadaACC])

  useEffect(() => {
    if (ventaYaAsociadaACC) {
      if (form.medio !== 'CC') set('medio', 'CC')
      return
    }
    if (!mediosDisponibles.some(m => m.id === form.medio)) {
      set('medio', mediosDisponibles[0]?.id || '')
    }
  }, [ventaYaAsociadaACC, mediosDisponibles, form.medio])

  useEffect(() => {
    if (!ventaYaAsociadaACC) return
    setCCOp('existente')
    if (ccSelId !== ccAsociadaId) {
      setCCSel(ccAsociadaId)
    }
  }, [ventaYaAsociadaACC, ccSelId, ccAsociadaId])

  useEffect(() => {
    if (esBNA) {
      const d = new Date(form.fecha); d.setMonth(d.getMonth() + 1); d.setDate(1)
      set('fechaReal', d.toISOString().split('T')[0])
    } else {
      set('fechaReal', form.fecha)
    }
  }, [form.medio, form.fecha])

  const medioSel = mpDyn.find(m => m.id === form.medio) || {}
  const esCC  = medioSel.esCC  || false
  const esBNA = medioSel.esBNA || false
  const nombreNuevaCC = String(ccNueva.cliente || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const ccDuplicada = ccOpcion === 'nueva' && nombreNuevaCC
    ? ccActivas.find(cc => String(cc.cliente || '').trim().toLowerCase().replace(/\s+/g, ' ') === nombreNuevaCC)
    : null

  // Permitir monto 0 solo si es CC
  const montoValido = esCC ? Number(form.monto) >= 0 : Number(form.monto) > 0
  const canSave = montoValido && !!form.fecha && (
    ventaYaAsociadaACC
      ? form.medio === 'CC' && !!ccSelId
      : ((!esBNA || !!form.fechaReal) && (!esCC || (ccOpcion === 'existente' ? !!ccSelId : !!ccNueva.cliente)))
  ) && !ccDuplicada

  useEffect(() => {
    if (ventaYaAsociadaACC || esBNA || esCC) {
      requestAnimationFrame(() => dynamicSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }, [ventaYaAsociadaACC, esBNA, esCC, ccOpcion])

  const guardar = async () => {
    const montoCobro = Number(form.monto)
    const montoPuede = esCC ? montoCobro >= 0 : montoCobro > 0
    if (!montoPuede || !Number.isFinite(montoCobro)) {
      showToast(esCC ? 'El monto debe ser ≥ 0' : 'El monto debe ser mayor a 0', 'error')
      return
    }
    if (montoCobro > Number(pendiente || 0)) {
      showToast(`El cobro supera el saldo pendiente de la venta (${fmt$(pendiente)})`, 'error')
      return
    }

    if (ventaYaAsociadaACC) {
      const ok = await pagarCC(ccSelId, {
        idVenta,
        medio: form.medio,
        monto: montoCobro,
        fecha: form.fecha,
        obs: form.obs,
      })
      if (ok === null) return
      onClose()
      return
    }

    if (esCC) {
      // Determinar a qué CC vincular
      let ccId = ccSelId
      let rollbackNuevaCC = null
      let rollbackExistente = null

      if (ccOpcion === 'nueva') {
        if (ccDuplicada) {
          showToast(`Ya existe una cuenta corriente activa para ${ccDuplicada.cliente} (${ccDuplicada.id})`, 'error')
          return
        }
        // Crear nueva CC
        ccId = await addCC({
          cliente:        ccNueva.cliente,
          idVenta,
          notas:          ccNueva.notas || '',
          totalAdeudado:  Number(totalVenta),
          totalPagado:    0,
          saldo:          Number(totalVenta),
          estado:         'Activa',
          fechaInicio:    form.fecha,
        })
        if (!ccId) return
        rollbackNuevaCC = ccId
      } else {
        // Sumar deuda a CC existente — usar el total de la venta, no el cobro inicial
        const cc = ccActivas.find(x => x.id === ccSelId)
        if (cc) {
          const nuevoTotal = (Number(cc.totalAdeudado) || 0) + Number(totalVenta)
          const nuevoSaldo = nuevoTotal - (Number(cc.totalPagado) || 0)
          rollbackExistente = {
            id: ccSelId,
            totalAdeudado: Number(cc.totalAdeudado) || 0,
            saldo: Number(cc.saldo) || 0,
          }
          const okUpdate = await updateCC(ccSelId, { totalAdeudado: nuevoTotal, saldo: nuevoSaldo })
          if (okUpdate === null) return
        }
      }

      // Registrar cobro vinculado a la CC
      const idCobro = await addCobro({
        idVenta,
        idCuentaCorriente: ccId,
        fecha:    form.fecha,
        medio:    'CC',
        monto:    montoCobro,
        fechaReal: form.fecha,
        obs:      form.obs || `CC: ${ccOpcion === 'nueva' ? ccNueva.cliente : ccActivas.find(x => x.id === ccSelId)?.cliente || ccId}`,
      })

      if (!idCobro) {
        if (rollbackNuevaCC) {
          await deleteCC(rollbackNuevaCC)
        }
        if (rollbackExistente) {
          await updateCC(rollbackExistente.id, {
            totalAdeudado: rollbackExistente.totalAdeudado,
            saldo: rollbackExistente.saldo,
          })
        }
        return
      }
    } else {
      // Cobro normal
      const idCobro = await addCobro({
        idVenta,
        fecha:    form.fecha,
        medio:    form.medio,
        monto:    montoCobro,
        fechaReal: form.fechaReal,
        obs:      form.obs,
      })
      if (!idCobro) return
    }
    onClose()
  }

  return (
    <Modal title={`Registrar cobro — ${idVenta}`} onClose={onClose}
      footer={<Button size="lg" onClick={guardar} disabled={!canSave}>
        {ventaYaAsociadaACC ? '💸 Registrar pago de cuenta corriente' : (esCC ? '💳 Registrar en cuenta corriente' : `Registrar cobro ${fmt$(Number(form.monto))}`)}
      </Button>}
    >
      {/* Resumen venta */}
      <div className="bg-brand-50 border border-brand-200 rounded-xl p-3 mb-4">
        <div className="text-sm text-text2 mb-1">Venta <span className="font-bold">{idVenta}</span></div>
        <InfoRow label="Total venta:"  value={fmt$(totalVenta)} />
        <InfoRow label="Ya cobrado:"   value={fmt$(cv.cobrado || 0)} />
        <InfoRow label="Pendiente:"    value={fmt$(pendiente)} valueClass="text-red-700 font-bold" />
      </div>

      {ventaYaAsociadaACC ? (
        <Input label="Medio de pago" value="Cuenta Corriente" disabled />
      ) : (
        <Select label="Medio de pago" value={form.medio} onChange={e => set('medio', e.target.value)}>
          {mediosDisponibles.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </Select>
      )}

      {ventaYaAsociadaACC && (
        <div ref={dynamicSectionRef} className="bg-orange-50 border border-orange-200 rounded-xl p-4 mt-3">
          <div className="text-sm font-semibold text-orange-800 mb-2">💳 Venta ya asociada a cuenta corriente</div>
          <div className="text-xs text-orange-700 mb-3">
            Este registro se guardará como pago de la cuenta corriente asociada, no como nueva deuda.
          </div>
          {ccAsociada ? (
            <Input
              label="Cuenta corriente asociada"
              value={`${ccAsociada.cliente} · Saldo ${fmt$(ccAsociada.saldo || 0)} · ${ccAsociada.id}`}
              disabled
            />
          ) : (
            <div className="text-sm text-orange-700 text-center py-2">
              No se encontró la cuenta corriente asociada a esta venta.
            </div>
          )}

          {ccSelId && (
            <div className="mt-3 bg-white rounded-lg p-2 text-xs text-orange-800">
              El saldo de {ccAsociada?.cliente || ccSelId} pasará de{' '}
              <strong>{fmt$(ccAsociada?.saldo || 0)}</strong>{' '}
              a <strong>{fmt$(Math.max((ccAsociada?.saldo || 0) - Number(form.monto || 0), 0))}</strong>
            </div>
          )}
        </div>
      )}

      {/* BNA */}
      {!ventaYaAsociadaACC && esBNA && (
        <div ref={dynamicSectionRef} className="bg-blue-50 border border-blue-200 rounded-xl p-3 mt-3">
          <div className="text-sm font-medium text-blue-800 mb-2">🏦 Acreditación diferida</div>
          <Input label="Fecha de acreditación real" type="date" value={form.fechaReal} onChange={e => set('fechaReal', e.target.value)} />
          <div className="text-xs text-blue-600 mt-1">El proveedor se paga cuando esta fecha se cumpla.</div>
        </div>
      )}

      {/* CC — selector de cuenta corriente */}
      {!ventaYaAsociadaACC && esCC && (
        <div ref={dynamicSectionRef} className="bg-orange-50 border border-orange-200 rounded-xl p-4 mt-3">
          <div className="text-sm font-semibold text-orange-800 mb-3">💳 Cuenta Corriente</div>

          {/* Toggle existente / nueva */}
          <div className="flex gap-2 mb-3">
            <button onClick={() => setCCOp('existente')}
              className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${ccOpcion === 'existente' ? 'bg-orange-600 text-white' : 'bg-white border border-orange-200 text-orange-700'}`}>
              Agregar a CC existente
            </button>
            <button onClick={() => setCCOp('nueva')}
              className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${ccOpcion === 'nueva' ? 'bg-orange-600 text-white' : 'bg-white border border-orange-200 text-orange-700'}`}>
              Crear nueva CC
            </button>
          </div>

          {ccOpcion === 'existente' ? (
            ccActivas.length > 0 ? (
              <SearchableSelect
                value={ccSelId}
                onChange={(v) => setCCSel(v)}
                options={ccActivasOptions}
                emptyOptionLabel="— Seleccioná una cuenta corriente —"
                searchPlaceholder="Buscar CC por clienta o ID"
              />
            ) : (
              <div className="text-sm text-orange-700 text-center py-2">
                No hay CCs activas. Creá una nueva.
              </div>
            )
          ) : (
            <div className="space-y-2">
              <Input
                label="Nombre de la clienta *"
                value={ccNueva.cliente}
                onChange={e => setCCNueva(f => ({ ...f, cliente: e.target.value }))}
                placeholder="Nombre y apellido"
              />
              <Input
                label="Notas (opcional)"
                value={ccNueva.notas}
                onChange={e => setCCNueva(f => ({ ...f, notas: e.target.value }))}
                placeholder="Observaciones…"
              />
              {ccDuplicada && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
                  Ya existe una cuenta corriente activa para {ccDuplicada.cliente} ({ccDuplicada.id}). Elegí "Agregar a CC existente" para no duplicarla.
                </div>
              )}
            </div>
          )}

          {ccSelId && ccOpcion === 'existente' && (
            <div className="mt-3 bg-white rounded-lg p-2 text-xs text-orange-800">
              El saldo de {ccActivas.find(x => x.id === ccSelId)?.cliente} pasará de{' '}
              <strong>{fmt$(ccActivas.find(x => x.id === ccSelId)?.saldo || 0)}</strong>{' '}
              a <strong>{fmt$((ccActivas.find(x => x.id === ccSelId)?.saldo || 0) + Number(form.monto || 0))}</strong>
            </div>
          )}
        </div>
      )}

      <Input label="Fecha" type="date" value={form.fecha} onChange={e => set('fecha', e.target.value)} />
      <Input label={`Monto ($) — pendiente: ${fmt$(pendiente)}`} type="number" value={form.monto} onChange={e => set('monto', e.target.value)} />
      <Input label="Observación (opcional)" value={form.obs} onChange={e => set('obs', e.target.value)} placeholder="Nombre cliente, referencia…" />
    </Modal>
  )
}

// ── Detalle Venta ─────────────────────────────────────────────────────────────
function DetalleVentaModal({ venta, cv, saleLocked, productsById, onClose, onCobrar, onGestionCobros, onOpenCobro, onOpenProducto, onOpenCC, onRepair, onCancelarPorFalla }) {
  const { mediosPago: mpDyn } = useApp()
  const mediosLabels = Object.fromEntries(mpDyn.map(m => [m.id, m.label]))
  const mediosDiferidos = new Set(mpDyn.filter(m => m.esBNA).map(m => m.id))
  const hoy = today()
  const [confirmCancel, setCC] = useState(false)
  const [notaCancel, setNotaCancel] = useState('')
  const [selectedCancelIds, setSelectedCancelIds] = useState([])
  const cancelPanelRef = useRef(null)
  const cerrada = cv.acreditado >= venta.total && venta.total > 0
  const overcobrada = Number(cv.cobrado || 0) > Number(venta.total || 0) && Number(venta.total || 0) > 0
  const cobrosPorMedio = Object.values((cv.items || []).reduce((acc, c) => {
    const key = `${c.medio || 'NA'}_${c.idCuentaCorriente ? 'cc' : 'std'}`
    if (!acc[key]) {
      acc[key] = {
        key,
        label: `${mediosLabels[c.medio] || c.medio}${c.idCuentaCorriente ? ' (CC)' : ''}`,
        total: 0,
      }
    }
    acc[key].total += Number(c.monto) || 0
    return acc
  }, {})).sort((a, b) => b.total - a.total)
  const proximaAcreditacion = (cv.items || [])
    .map((c) => {
      const fechaAcreditacion = (mediosDiferidos.has(c.medio) && c.fechaReal) ? c.fechaReal : c.fecha
      return fechaAcreditacion && fechaAcreditacion > hoy ? fechaAcreditacion : null
    })
    .filter(Boolean)
    .sort()[0] || null

  useEffect(() => {
    if (!confirmCancel) return
    setSelectedCancelIds(venta.items.map(v => v.IDProducto))
  }, [confirmCancel, venta.items])

  useEffect(() => {
    if (confirmCancel) {
      requestAnimationFrame(() => cancelPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }, [confirmCancel])

  return (
    <Modal title={`${venta.id} — ${fmtDate(venta.fecha)}`} onClose={onClose}
      footer={
        <>
          {!saleLocked && <Button variant="danger" size="md" onClick={() => setCC(true)}>Cancelar por falla</Button>}
          {!saleLocked && overcobrada && <Button variant="ghost" size="md" className="flex-1" onClick={() => onGestionCobros?.(venta.id)}>🛠️ Corregir cobros</Button>}
          {!cerrada && !saleLocked && !overcobrada && <Button size="md" className="flex-1" onClick={() => onCobrar(venta.id)}>💰 Registrar cobro</Button>}
        </>
      }
    >
      {saleLocked && (
        <div className="mb-3 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg p-2">
          Esta venta ya fue pagada al proveedor. Por regla de negocio no se puede cancelar ni registrar nuevos cobros.
        </div>
      )}

      {venta.errorCount > 0 && (
        <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
          Esta venta tiene {venta.errorCount} linea(s) con datos inconsistentes. Reparala antes de seguir operando con esos registros.
        </div>
      )}

      {overcobrada && (
        <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
          Esta venta está sobrecobrada por {fmt$(Number(cv.cobrado || 0) - Number(venta.total || 0))}. Corregí desde "Corregir cobros" para editar o eliminar cobros asociados.
        </div>
      )}

      <div className="space-y-2 mb-4">
        {venta.items.map((item, i) => (
          <div key={i} className="bg-cream rounded-xl p-3">
            <div className="flex justify-between items-start gap-3">
              <div>
                <button
                  onClick={() => onOpenProducto?.(item.IDProducto)}
                  className="text-left"
                >
                  <div className="text-sm font-medium text-text1 hover:text-brand-700 transition-colors">{item.Descripcion || item.IDProducto}</div>
                  <div className="text-xs text-text3 mt-0.5">{item.IDProducto} · {item.ProveedorNombre || item.ProveedorID}</div>
                  <div className="text-[11px] text-brand-700 mt-1">Ver producto</div>
                </button>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-brand-700">{fmt$(item.PrecioVentaFinal)}</div>
                <div className="text-xs text-green-700">+{fmt$(item.GananciaNegocio)}</div>
              </div>
            </div>

            {getVentaItemIssues(item, productsById[item.IDProducto] || null).length > 0 && (
              <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-2">
                <div className="text-xs font-semibold text-red-700 mb-1">Errores detectados</div>
                <div className="space-y-1 mb-2">
                  {getVentaItemIssues(item, productsById[item.IDProducto] || null).map((issue, idx) => (
                    <div key={idx} className="text-xs text-red-700">• {issue}</div>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => onRepair({ ventaId: venta.id, item, producto: productsById[item.IDProducto] || null, issues: getVentaItemIssues(item, productsById[item.IDProducto] || null) })}
                >
                  Reparar registro
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4">
        {cobrosPorMedio.length > 0 ? (
          <>
            <div className="text-xs font-medium text-text3 uppercase tracking-wide mt-3 mb-1">Modo de cobro</div>
            {cobrosPorMedio.map((m) => (
              <InfoRow key={m.key} label={m.label} value={fmt$(m.total)} valueClass="text-brand-700" />
            ))}
          </>
        ) : (
          <InfoRow label="Modo de cobro:" value="Sin cobros" />
        )}
        <InfoRow
          label="¿Dinero acreditado?:"
          value={cerrada ? '✅ Sí' : '⏳ No'}
          valueClass={cerrada ? 'text-green-700 font-bold' : 'text-orange-700 font-bold'}
        />
        {!cerrada && (
          <InfoRow
            label="Próxima acreditación:"
            value={proximaAcreditacion ? fmtDate(proximaAcreditacion) : 'Sin fecha estimada'}
            valueClass="text-text2"
          />
        )}
      </div>

      {cv.items?.length > 0 && (
        <div>
          <div className="text-xs font-medium text-text3 uppercase tracking-wide mb-2">Cobros registrados</div>
          {cv.items.map((c, i) => (
            <div key={i} className="py-1.5 text-sm border-b border-gray-50 last:border-0 flex items-center justify-between gap-2 hover:bg-cream rounded-lg px-1 transition-colors">
              <button
                onClick={() => onOpenCobro?.(c.id, venta.id)}
                className="flex-1 text-left"
              >
                <span className="text-text2">{mediosLabels[c.medio] || c.medio}{c.idCuentaCorriente ? ' (CC)' : ''} · {fmtDate(c.fecha)} · {c.id}</span>
              </button>
              <span className="font-medium text-text1 min-w-fit">{fmt$(c.monto)}</span>
              {c.idCuentaCorriente && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenCC?.(c.idCuentaCorriente)}
                  title={`Ver cuenta corriente ${c.idCuentaCorriente}`}
                >
                  💳
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {confirmCancel && (
        <div ref={cancelPanelRef} className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl">
          <div className="text-sm font-semibold text-red-700 mb-2">Cancelar venta por falla</div>
          <div className="text-xs text-red-600 mb-3">Seleccioná qué prendas vuelven a stock. Si cancelás todas, se eliminan todos los cobros. Si cancelás parcial, los cobros se ajustan al nuevo total de la venta.</div>

          <div className="space-y-1 mb-3 max-h-44 overflow-y-auto bg-white border border-red-100 rounded-lg p-2">
            {venta.items.map((item) => {
              const checked = selectedCancelIds.includes(item.IDProducto)
              return (
                <label key={item.IDProducto} className="flex items-center gap-2 text-sm text-text2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      setSelectedCancelIds((prev) => {
                        if (e.target.checked) return [...new Set([...prev, item.IDProducto])]
                        return prev.filter(id => id !== item.IDProducto)
                      })
                    }}
                  />
                  <span>{item.IDProducto} · {item.Descripcion || item.IDProducto}</span>
                </label>
              )
            })}
          </div>

          <div className="flex gap-2 mb-3">
            <Button variant="ghost" size="sm" className="flex-1" onClick={() => setSelectedCancelIds(venta.items.map(v => v.IDProducto))}>Seleccionar todas</Button>
            <Button variant="ghost" size="sm" className="flex-1" onClick={() => setSelectedCancelIds([])}>Limpiar selección</Button>
          </div>

          <Input
            label="Nota de falla *"
            value={notaCancel}
            onChange={(e) => setNotaCancel(e.target.value)}
            placeholder="Ej: Se descosió la manga al probarla"
          />

          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              className="flex-1"
              disabled={!selectedCancelIds.length || !hasText(notaCancel)}
              onClick={() => onCancelarPorFalla?.(venta.id, { idsProducto: selectedCancelIds, nota: notaCancel })}
            >
              {selectedCancelIds.length === venta.items.length ? 'Cancelar venta completa' : `Cancelar ${selectedCancelIds.length} prenda(s)`}
            </Button>
            <Button variant="ghost" size="sm" className="flex-1" onClick={() => setCC(false)}>No</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function RepararVentaItemModal({ repair, onSave, onClose }) {
  const producto = repair.producto
  const [form, setForm] = useState({
    descripcion: repair.item.Descripcion || producto?.notas || '',
    precioVenta: repair.item.PrecioVentaFinal || producto?.precio || '',
    sincronizarProducto: !!producto,
    crearProductoSiNoExiste: !producto,
  })

  const canSave = hasText(form.descripcion) && isPositiveNumber(form.precioVenta)

  return (
    <Modal
      title={`Reparar ${repair.item.IDProducto}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" size="md" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            size="md"
            className="flex-1"
            disabled={!canSave}
            onClick={() => onSave({
              idVenta: repair.ventaId,
              idProducto: repair.item.IDProducto,
              descripcion: form.descripcion,
              precioVenta: Number(form.precioVenta),
              sincronizarProducto: !!producto && form.sincronizarProducto,
              crearProductoSiNoExiste: !producto || form.crearProductoSiNoExiste,
            })}
          >
            {producto ? 'Guardar reparación' : 'Guardar y agregar producto'}
          </Button>
        </>
      }
    >
      <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
        <div className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2">Problemas detectados</div>
        <div className="space-y-1">
          {repair.issues.map((issue, idx) => (
            <div key={idx} className="text-sm text-red-700">• {issue}</div>
          ))}
        </div>
      </div>

      <Input
        label="Descripcion corregida *"
        value={form.descripcion}
        onChange={e => setForm(current => ({ ...current, descripcion: e.target.value }))}
        placeholder="Descripcion de la prenda"
      />

      <Input
        label="Precio de venta corregido *"
        type="number"
        value={form.precioVenta}
        onChange={e => setForm(current => ({ ...current, precioVenta: e.target.value === '' ? '' : Number(e.target.value) }))}
        placeholder="0"
      />

      {!producto ? (
        <div className="mt-3 bg-brand-50 border border-brand-200 rounded-xl p-3 text-sm text-brand-700">
          Este guardado también crea el producto faltante en inventario para dejar la venta consistente.
        </div>
      ) : (
        <label className="mt-3 flex items-center gap-2 text-sm text-text2">
          <input
            type="checkbox"
            checked={form.sincronizarProducto}
            onChange={e => setForm(current => ({ ...current, sincronizarProducto: e.target.checked }))}
          />
          Actualizar también descripcion/precio del producto en inventario
        </label>
      )}
    </Modal>
  )
}
