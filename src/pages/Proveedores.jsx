import { useState, useMemo, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { calcAcreditadoPorVenta, calcTotalPorVenta } from '../utils/calculos'
import { fmt$, fmtDate, today, diffDays } from '../utils/formatters'
import { Modal, SearchBar, Button, Input, Select, SectionHeader, EmptyState, InfoRow, Tabs, Chip } from '../components/ui'
import { generarPDFProveedor, generarTextoWA } from '../utils/exporters'

export default function Proveedores() {
  const { proveedores, productos, ventas, cobros, pagos, cuentasCorrientes, mediosPago, addProveedor, updateProveedor, deleteProveedor } = useApp()
  const [q, setQ]           = useState('')
  const [modal, setM]       = useState(null)
  const [ficha, setF]       = useState(null)
  const [soloDeuda, setSoloDeuda] = useState(false)

  // Stats rápidas por proveedor (debe ir antes de filtrados para poder usarlo)
  const stats = useMemo(() => {
    const map = {}
    proveedores.forEach(p => { map[p.id] = { stock: 0, vendidos: 0, devueltos: 0 } })
    productos.forEach(p => {
      if (!map[p.proveedorID]) return
      if (p.vendido) map[p.proveedorID].vendidos++
      else if (p.devolucion) map[p.proveedorID].devueltos++
      else map[p.proveedorID].stock++
    })
    // Deuda pendiente (CC-aware)
    const hoy = today()
    const acreditado = calcAcreditadoPorVenta(cobros, cuentasCorrientes, hoy, mediosPago)
    const totalPorV  = calcTotalPorVenta(ventas)
    const pagadosSet = new Set(pagos.map(p => `${p.idVenta}-${p.idProducto}`))
    ventas.filter(v => !v.cancelada && v.PagoProveedor !== true).forEach(v => {
      if (!map[v.ProveedorID]) return
      const acred = acreditado[v.IDVenta]?.acreditado || 0
      const total = totalPorV[v.IDVenta] || 0
      if (acred >= total && total > 0 && !pagadosSet.has(`${v.IDVenta}-${v.IDProducto}`)) {
        map[v.ProveedorID].deuda = (map[v.ProveedorID].deuda || 0) + (v.CostoProveedor || 0)
      }
    })
    return map
  }, [proveedores, productos, ventas, cobros, pagos, cuentasCorrientes, mediosPago])

  const conDeudaCount = useMemo(() => Object.values(stats).filter(s => s.deuda > 0).length, [stats])

  const filtrados = useMemo(() => {
    let list = [...proveedores].sort((a, b) => a.nombre?.localeCompare(b.nombre))
    if (soloDeuda) list = list.filter(p => (stats[p.id]?.deuda || 0) > 0)
    if (q) {
      const ql = q.toLowerCase()
      list = list.filter(p => p.nombre?.toLowerCase().includes(ql) || p.id?.toLowerCase().includes(ql) || p.alias?.toLowerCase().includes(ql))
    }
    return list
  }, [proveedores, q, soloDeuda, stats])

  return (
    <div>
      <SectionHeader title="Proveedores" action={<Button size="sm" onClick={() => setM({ _new: true, nombre: '', telefono: '', alias: '', notas: '' })}>+ Nuevo</Button>} />
      <SearchBar value={q} onChange={setQ} placeholder="Buscar nombre, ID, alias…" className="mb-3" />

      <div className="flex gap-2 mb-4 flex-wrap">
        <Chip label="Todos" active={!soloDeuda} onClick={() => setSoloDeuda(false)} />
        <Chip label={`A pagar (${conDeudaCount})`} active={soloDeuda} onClick={() => setSoloDeuda(true)} />
      </div>

      {filtrados.length === 0 ? (
        <EmptyState icon="🤝" title="Sin proveedores" action={<Button size="sm" onClick={() => setM({ _new: true, nombre: '', telefono: '', alias: '', notas: '' })}>+ Nuevo proveedor</Button>} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {filtrados.map(p => {
            const st = stats[p.id] || {}
            return (
              <div key={p.id} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-text1 truncate">{p.nombre}</div>
                    <div className="text-xs text-text3 mt-0.5">{p.id}{p.alias ? ` · ${p.alias}` : ''}</div>
                    <div className="flex gap-3 mt-2 text-xs">
                      <span className="text-blue-600">📦 {st.stock || 0}</span>
                      <span className="text-green-700">✅ {st.vendidos || 0}</span>
                      <span className="text-red-600">🔄 {st.devueltos || 0}</span>
                      {st.deuda > 0 && <span className="text-orange-600 font-semibold">⚠️ Debo {fmt$(st.deuda)}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => setF(p)} className="text-xs bg-brand-50 text-brand-700 border border-brand-200 rounded-lg px-2.5 py-1.5 font-medium">Ver</button>
                    <button onClick={() => setM({ ...p, _new: false })} className="text-xs bg-cream border border-border rounded-lg px-2.5 py-1.5 text-text2">✏️</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {modal && (
        <ProveedorModal
          prov={modal}
          onSave={async (data) => {
            if (data._new && !data.id) await addProveedor(data)
            else await updateProveedor(data.id, data)
            setM(null)
          }}
          onDelete={async (id) => {
            const ok = await deleteProveedor(id)
            if (ok) setM(null)
          }}
          onClose={() => setM(null)}
        />
      )}

      {ficha && (
        <FichaProveedor
          proveedor={ficha}
          productos={productos}
          ventas={ventas}
          cobros={cobros}
          pagos={pagos}
          cuentasCorrientes={cuentasCorrientes}
          onClose={() => setF(null)}
        />
      )}
    </div>
  )
}

// ── Modal Proveedor ───────────────────────────────────────────────────────────
function ProveedorModal({ prov, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({ ...prov })
  const [confirm, setC] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <Modal title={prov._new ? 'Nuevo proveedor' : 'Editar proveedor'} onClose={onClose}
      footer={
        <>
          {!prov._new && <Button variant="danger" size="md" onClick={() => setC(true)}>Eliminar</Button>}
          <Button size="md" className="flex-1" onClick={() => onSave(form)} disabled={!form.nombre}>Guardar</Button>
        </>
      }
    >
      <Input label="Nombre / Alias Instagram *" value={form.nombre || ''} onChange={e => set('nombre', e.target.value)} placeholder="Ej: Daniela Genero / tomas2022" />
      <Input label="Teléfono / WhatsApp" value={form.telefono || ''} onChange={e => set('telefono', e.target.value)} placeholder="+54 9 11…" />
      <Input label="Alias CBU / CVU" value={form.alias || ''} onChange={e => set('alias', e.target.value)} placeholder="alias.mercadopago" />
      <Input label="Notas" value={form.notas || ''} onChange={e => set('notas', e.target.value)} placeholder="Observaciones…" />

      {confirm && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl">
          <div className="text-sm font-semibold text-red-700 mb-2">¿Eliminar proveedor?</div>
          <div className="flex gap-2">
            <Button variant="danger" size="sm" className="flex-1" onClick={() => onDelete(form.id)}>Sí</Button>
            <Button variant="ghost" size="sm" className="flex-1" onClick={() => setC(false)}>No</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Ficha Proveedor ───────────────────────────────────────────────────────────
function FichaProveedor({ proveedor, productos, ventas, cobros, pagos, cuentasCorrientes, onClose }) {
  const { mediosPago, showToast } = useApp()
  const [tab, setTab]       = useState('listo')
  const [showReport, setSR] = useState(false)
  const [pdfReady, setPDF]  = useState(null)
  const [reportSections, setReportSections] = useState({
    listos: true,
    pendientes: true,
    pagados: true,
    stock: true,
    devueltos: true,
  })
  const hoy = today()

  const acreditadoPorVenta = useMemo(() =>
    calcAcreditadoPorVenta(cobros, cuentasCorrientes, hoy, mediosPago)
  , [cobros, cuentasCorrientes, hoy, mediosPago])

  const totalPorVenta = useMemo(() => calcTotalPorVenta(ventas), [ventas])

  const ventasProv = useMemo(() => ventas.filter(v => v.ProveedorID === proveedor.id && !v.cancelada), [ventas, proveedor.id])
  const pagadosSet  = useMemo(() => new Set(pagos.filter(p => p.proveedorID === proveedor.id).map(p => `${p.idVenta}-${p.idProducto}`)), [pagos, proveedor.id])

  const stockItems = useMemo(() =>
    productos.filter(p => p.proveedorID === proveedor.id && p.enStock && !p.vendido && !p.devolucion)
  , [productos, proveedor.id])

  const listosPagar = useMemo(() =>
    ventasProv.filter(v => {
      if (v.PagoProveedor === true || pagadosSet.has(`${v.IDVenta}-${v.IDProducto}`)) return false
      const acred = acreditadoPorVenta[v.IDVenta]?.acreditado || 0
      const total = totalPorVenta[v.IDVenta] || 0
      return acred >= total && total > 0
    })
  , [ventasProv, acreditadoPorVenta, totalPorVenta, pagadosSet])

  const pendienteCobro = useMemo(() =>
    ventasProv.filter(v => {
      if (v.PagoProveedor === true || pagadosSet.has(`${v.IDVenta}-${v.IDProducto}`)) return false
      const acred = acreditadoPorVenta[v.IDVenta]?.acreditado || 0
      const total = totalPorVenta[v.IDVenta] || 0
      return acred < total || total === 0
    })
  , [ventasProv, acreditadoPorVenta, totalPorVenta, pagadosSet])

  const historialPagos = useMemo(() => {
    const lotes = {}
    pagos.filter(p => p.proveedorID === proveedor.id).forEach(p => {
      if (!lotes[p.id]) lotes[p.id] = { id: p.id, fecha: p.fecha, monto: 0, obs: p.obs, items: [] }
      lotes[p.id].monto += p.monto || 0
      lotes[p.id].items.push(p)
    })
    return Object.values(lotes).sort((a, b) => b.fecha?.localeCompare(a.fecha || '') || 0)
  }, [pagos, proveedor.id])

  const totalListo = listosPagar.reduce((s, v) => s + (v.CostoProveedor || 0), 0)
  const totalPendCob = pendienteCobro.reduce((s, v) => s + (v.CostoProveedor || 0), 0)

  const devueltosItems = useMemo(() =>
    productos.filter(p => p.proveedorID === proveedor.id && p.devolucion && !p.vendido)
  , [productos, proveedor.id])

  const generarReporte = () => {
    const data = {
      proveedor,
      productos,
      stockItems: reportSections.stock ? stockItems : [],
      pendienteCobro: reportSections.pendientes ? pendienteCobro : [],
      listosPagar: reportSections.listos ? listosPagar : [],
      historialPagos: reportSections.pagados ? historialPagos : [],
      devueltosItems: reportSections.devueltos ? devueltosItems : [],
    }
    const doc = generarPDFProveedor(data)
    setPDF(doc)
    setSR(true)
  }

  const [showWAText, setShowWAText] = useState(false)
  const [waTexto, setWATexto] = useState('')
  const [waCopied, setWACopied] = useState(false)
  const reportConfigRef = useRef(null)
  const reportReadyRef = useRef(null)
  const waTextRef = useRef(null)

  useEffect(() => {
    if (showReport && !pdfReady) {
      requestAnimationFrame(() => reportConfigRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }, [showReport, pdfReady])

  useEffect(() => {
    if (showReport && pdfReady) {
      requestAnimationFrame(() => reportReadyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }, [showReport, pdfReady])

  useEffect(() => {
    if (showWAText) {
      requestAnimationFrame(() => waTextRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }, [showWAText])

  const compartirWA = () => {
    const texto = generarTextoWA({ proveedor, stockItems, pendienteCobro, listosPagar })
    setWATexto(texto)
    setWACopied(false)
    setShowWAText(true)
  }

  const copiarYAbrir = async () => {
    try { await navigator.clipboard.writeText(waTexto) } catch (_) {}
    setWACopied(true)
    const tel = proveedor.telefono?.replace(/\D/g, '') || ''
    const url = tel ? `https://wa.me/${tel}` : `https://wa.me/`
    window.open(url, '_blank')
  }

  const tabs = [
    { id: 'listo',   label: `✅ Pagar (${listosPagar.length})` },
    { id: 'pendcob', label: `⏳ Sin cobrar (${pendienteCobro.length})` },
    { id: 'stock',   label: `📦 Stock (${stockItems.length})` },
    { id: 'historial', label: `📄 Historial` },
  ]

  return (
    <Modal title={proveedor.nombre} onClose={onClose}
      footer={
        <div className="flex gap-2 w-full">
          <Button variant="ghost" size="md" onClick={() => setSR(true)} className="flex-1">📋 Reporte</Button>
          <Button variant="success" size="md" onClick={compartirWA} className="flex-1">📱 WhatsApp</Button>
        </div>
      }
    >
      <div className="text-xs text-text3 mb-1">{proveedor.id}{proveedor.alias ? ` · ${proveedor.alias}` : ''}{proveedor.telefono ? ` · ${proveedor.telefono}` : ''}</div>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-2 mb-4 mt-3">
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-center">
          <div className="text-lg font-bold text-orange-700">{fmt$(totalListo)}</div>
          <div className="text-xs text-orange-600">A pagar</div>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-center">
          <div className="text-lg font-bold text-yellow-700">{fmt$(totalPendCob)}</div>
          <div className="text-xs text-yellow-600">Pend. cobro</div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
          <div className="text-lg font-bold text-blue-700">{stockItems.length}</div>
          <div className="text-xs text-blue-600">En stock</div>
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'listo' && (
        listosPagar.length === 0
          ? <div className="text-sm text-text3 text-center py-8">Sin prendas listas para pagar</div>
          : <div className="space-y-2">
              {listosPagar.map((v, i) => (
                <div key={i} className="bg-green-50 rounded-xl p-3 flex justify-between">
                  <div>
                    <div className="text-sm text-text1">{(v.Descripcion || v.IDProducto || '').slice(0, 40)}</div>
                    <div className="text-xs text-text3">{v.IDVenta} · {fmtDate(v.FechaVenta)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-text3">{fmt$(v.PrecioVentaFinal)}</div>
                    <div className="text-sm font-bold text-green-700">{fmt$(v.CostoProveedor)}</div>
                  </div>
                </div>
              ))}
            </div>
      )}

      {tab === 'pendcob' && (
        pendienteCobro.length === 0
          ? <div className="text-sm text-text3 text-center py-8">Sin prendas pendientes de cobro</div>
          : <div className="space-y-2">
              {pendienteCobro.map((v, i) => (
                <div key={i} className="bg-yellow-50 rounded-xl p-3 flex justify-between">
                  <div>
                    <div className="text-sm text-text1">{(v.Descripcion || v.IDProducto || '').slice(0, 40)}</div>
                    <div className="text-xs text-text3">{v.IDVenta} · {fmtDate(v.FechaVenta)}</div>
                  </div>
                  <div className="text-sm font-bold text-yellow-700">{fmt$(v.CostoProveedor)}</div>
                </div>
              ))}
            </div>
      )}

      {tab === 'stock' && (
        stockItems.length === 0
          ? <div className="text-sm text-text3 text-center py-8">Sin prendas en stock</div>
          : <div className="space-y-2">
              {stockItems.map(p => (
                <div key={p.id} className="bg-blue-50 rounded-xl p-3 flex justify-between items-center">
                  <div>
                    <div className="text-sm text-text1">{(p.notas || p.id || '').slice(0, 40)}</div>
                    <div className="text-xs text-text3">{diffDays(p.fechaIngreso)} días en local · {p.id}</div>
                  </div>
                  <div className="text-sm font-bold text-brand-700">{fmt$(p.precio)}</div>
                </div>
              ))}
            </div>
      )}

      {tab === 'historial' && (
        historialPagos.length === 0
          ? <div className="text-sm text-text3 text-center py-8">Sin pagos registrados</div>
          : <div className="space-y-3">
              {historialPagos.map(lote => (
                <PagoLoteCard key={lote.id} lote={lote} />
              ))}
            </div>
      )}

      {/* Preview PDF */}
      {showReport && !pdfReady && (
        <div ref={reportConfigRef} className="mt-4 p-4 bg-brand-50 border border-brand-200 rounded-xl">
          <div className="font-semibold text-brand-700 mb-3">📋 Configurar reporte</div>
          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={reportSections.listos}
                onChange={(e) => setReportSections(r => ({ ...r, listos: e.target.checked }))}
                className="w-4 h-4"
              />
              <span className="text-sm">✅ Productos listos para pagar ({listosPagar.length})</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={reportSections.pendientes}
                onChange={(e) => setReportSections(r => ({ ...r, pendientes: e.target.checked }))}
                className="w-4 h-4"
              />
              <span className="text-sm">⏳ Productos vendidos pendientes de cobro ({pendienteCobro.length})</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={reportSections.pagados}
                onChange={(e) => setReportSections(r => ({ ...r, pagados: e.target.checked }))}
                className="w-4 h-4"
              />
              <span className="text-sm">📄 Pagos ya realizados — historial ({historialPagos.length})</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={reportSections.stock}
                onChange={(e) => setReportSections(r => ({ ...r, stock: e.target.checked }))}
                className="w-4 h-4"
              />
              <span className="text-sm">📦 Productos en stock ({stockItems.length})</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={reportSections.devueltos}
                onChange={(e) => setReportSections(r => ({ ...r, devueltos: e.target.checked }))}
                className="w-4 h-4"
              />
              <span className="text-sm">🔄 Productos devueltos ({devueltosItems.length})</span>
            </label>
          </div>
          <div className="flex gap-2 mt-4">
            <Button variant="ghost" size="sm" className="flex-1" onClick={() => setSR(false)}>Cancelar</Button>
            <Button size="sm" className="flex-1" onClick={generarReporte}>Generar PDF</Button>
          </div>
        </div>
      )}

      {showReport && pdfReady && (
        <div ref={reportReadyRef} className="mt-4 p-4 bg-brand-50 border border-brand-200 rounded-xl">
          <div className="font-semibold text-brand-700 mb-3">📋 Reporte generado</div>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={() => pdfReady.save(`OtraVuelta_${proveedor.nombre.replace(/\s/g,'_')}_${today()}.pdf`)}>
              ⬇️ Descargar PDF
            </Button>
            <Button variant="success" size="sm" className="flex-1" onClick={compartirWA}>
              📱 Enviar WA
            </Button>
          </div>
          <button onClick={() => { setSR(false); setPDF(null) }} className="text-xs text-text3 mt-2 w-full text-center">Volver a configurar</button>
        </div>
      )}

      {/* Popup texto WhatsApp */}
      {showWAText && (
        <div ref={waTextRef} className="mt-4 p-4 bg-green-50 border border-green-200 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold text-green-800 text-sm">📱 Texto para WhatsApp</div>
            <button onClick={() => setShowWAText(false)} className="text-green-600 text-xs">✕ Cerrar</button>
          </div>
          <textarea
            readOnly
            value={waTexto}
            rows={10}
            className="w-full text-xs bg-white border border-green-200 rounded-lg p-2 resize-none font-mono"
          />
          <div className="flex gap-2 mt-3">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1"
              onClick={async () => {
                try { await navigator.clipboard.writeText(waTexto) } catch (_) {}
                setWACopied(true)
              }}
            >
              {waCopied ? '✅ Copiado' : '📋 Copiar texto'}
            </Button>
            <Button
              variant="success"
              size="sm"
              className="flex-1"
              onClick={copiarYAbrir}
            >
              Copiar y abrir WA
            </Button>
          </div>
          {waCopied && (
            <div className="text-xs text-green-700 text-center mt-2">Texto copiado — pegalo en WhatsApp con Cmd+V / Ctrl+V</div>
          )}
        </div>
      )}
    </Modal>
  )
}

function PagoLoteCard({ lote }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-green-50 border border-green-200 rounded-xl overflow-hidden">
      <div onClick={() => setOpen(o => !o)} className="flex justify-between items-center p-3 cursor-pointer">
        <div>
          <div className="text-sm font-semibold text-green-800">{lote.id} · {fmtDate(lote.fecha)}</div>
          <div className="text-xs text-green-600">{lote.items.length} prenda(s){lote.obs ? ` · ${lote.obs}` : ''}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-green-700">{fmt$(lote.monto)}</span>
          <span className="text-green-400">{open ? '▲' : '▼'}</span>
        </div>
      </div>
      {open && (
        <div className="border-t border-green-200 p-3 space-y-1">
          {lote.items.map((item, i) => (
            <div key={i} className="flex justify-between text-xs text-green-800">
              <span>{item.idProducto} · {item.idVenta}</span>
              <span>{fmt$(item.monto)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
