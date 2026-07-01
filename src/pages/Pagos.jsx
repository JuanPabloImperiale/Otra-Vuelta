import { useState, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { calcAcreditadoPorVenta, calcTotalPorVenta } from '../utils/calculos'
import { fmt$, fmtDate, today, monthLabel, monthsRange } from '../utils/formatters'
import { exportarLotePagosPDF } from '../utils/exporters'
import { SearchBar, Button, SectionHeader, EmptyState, InfoRow, Select } from '../components/ui'

export default function Pagos() {
  const { ventas, cobros, pagos, proveedores, cuentasCorrientes, mediosPago, addPago, showToast } = useApp()
  const [q, setQ]       = useState('')
  const [mesFiltro, setMes] = useState('')
  const hoy = today()

  const acreditadoPorVenta = useMemo(() =>
    calcAcreditadoPorVenta(cobros, cuentasCorrientes, hoy, mediosPago)
  , [cobros, cuentasCorrientes, hoy])

  const totalPorVenta = useMemo(() =>
    calcTotalPorVenta(ventas)
  , [ventas])

  // Prendas listas para pagar por proveedor
  const pendientesPorProv = useMemo(() => {
    const pagadosSet = new Set(pagos.map(p => `${p.idVenta}-${p.idProducto}`))
    const map = {}
    ventas.filter(v => !v.cancelada && v.PagoProveedor !== true).forEach(v => {
      if (pagadosSet.has(`${v.IDVenta}-${v.IDProducto}`)) return
      const acred = acreditadoPorVenta[v.IDVenta]?.acreditado || 0
      const total = totalPorVenta[v.IDVenta] || 0
      if (acred < total || total === 0) return
      // Filtro por mes si aplica
      if (mesFiltro && !v.FechaVenta?.startsWith(mesFiltro)) return
      if (!map[v.ProveedorID]) map[v.ProveedorID] = { prendas: [], total: 0 }
      map[v.ProveedorID].prendas.push(v)
      map[v.ProveedorID].total += v.CostoProveedor || 0
    })
    return map
  }, [ventas, pagos, acreditadoPorVenta, totalPorVenta, mesFiltro])

  const conPendiente = useMemo(() =>
    Object.entries(pendientesPorProv)
      .map(([id, data]) => ({ id, data, prov: proveedores.find(p => p.id === id) }))
      .filter(x => !q || x.prov?.nombre?.toLowerCase().includes(q.toLowerCase()) || x.id.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => b.data.total - a.data.total)
  , [pendientesPorProv, proveedores, q])

  const totalAPagar = conPendiente.reduce((s, x) => s + x.data.total, 0)

  // Historial de pagos
  const historial = useMemo(() => {
    const lotes = {}
    pagos.forEach(p => {
      if (!lotes[p.id]) lotes[p.id] = { id: p.id, fecha: p.fecha, proveedorID: p.proveedorID, total: 0, items: [] }
      lotes[p.id].total += p.monto || 0
      lotes[p.id].items.push(p)
    })
    return Object.values(lotes).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
  }, [pagos])

  const meses = useMemo(() => monthsRange(ventas, 'FechaVenta'), [ventas])

  const copiarLista = () => {
    const lineas = conPendiente.map(({ id, data, prov }) =>
      `${prov?.nombre || id}${prov?.alias ? ` (${prov.alias})` : ''}: ${fmt$(data.total)} (${data.prendas.length} prendas)`
    ).join('\n')
    const texto = `*OTRA VUELTA — Lote de pagos*\n*Fecha:* ${fmtDate(today())}\n\n${lineas}\n\n*TOTAL: ${fmt$(totalAPagar)}*`
    navigator.clipboard?.writeText(texto).then(() => showToast('Lista copiada ✅'))
  }

  const exportarPDF = () => {
    const proveedoresPDF = conPendiente.map(({ id, data, prov }) => ({
      id,
      nombre: prov?.nombre || id,
      total: data.total,
      prendas: data.prendas,
    }))
    exportarLotePagosPDF({
      fecha: today(),
      mesLabel: mesFiltro ? monthLabel(mesFiltro) : 'Todos los meses',
      proveedores: proveedoresPDF,
    })
    showToast('PDF generado y descargado ✅')
  }

  const [vista, setVista] = useState('pendiente')

  return (
    <div>
      <SectionHeader title="Pagos Proveedores"
        action={conPendiente.length > 0 && (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={copiarLista}>📋 Copiar</Button>
            <Button variant="ghost" size="sm" onClick={exportarPDF}>🧾 PDF</Button>
          </div>
        )}
      />

      <div className="flex gap-2 mb-4">
        <button onClick={() => setVista('pendiente')} className={`flex-1 py-2 text-sm font-medium rounded-xl transition-colors ${vista === 'pendiente' ? 'bg-brand-700 text-white' : 'bg-cream text-text2'}`}>
          A pagar ({conPendiente.length})
        </button>
        <button onClick={() => setVista('historial')} className={`flex-1 py-2 text-sm font-medium rounded-xl transition-colors ${vista === 'historial' ? 'bg-brand-700 text-white' : 'bg-cream text-text2'}`}>
          Historial ({historial.length})
        </button>
      </div>

      {vista === 'pendiente' && (
        <>
          <div className="flex gap-2 mb-3">
            <SearchBar value={q} onChange={setQ} placeholder="Buscar proveedor…" className="flex-1" />
            <select value={mesFiltro} onChange={e => setMes(e.target.value)} className="input-base w-32 text-sm">
              <option value="">Todos los meses</option>
              {meses.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>

          {conPendiente.length === 0 ? (
            <div className="card border-green-200 bg-green-50 p-6 text-center">
              <div className="text-3xl mb-2">✅</div>
              <div className="font-semibold text-green-800">Todo pagado</div>
              <div className="text-sm text-green-600 mt-1">No hay proveedores con saldo pendiente.</div>
            </div>
          ) : (
            <>
              <div className="card border-red-200 bg-red-50 p-4 mb-4">
                <div className="text-sm text-red-700">Total a pagar</div>
                <div className="text-2xl font-bold text-brand-700 mt-1">{fmt$(totalAPagar)}</div>
                <div className="text-xs text-text3 mt-0.5">{conPendiente.length} proveedor(es) · {conPendiente.reduce((s, x) => s + x.data.prendas.length, 0)} prendas</div>
              </div>
              <div className="space-y-3">
                {conPendiente.map(({ id, data, prov }) => (
                  <ProveedorPagoCard key={id} id={id} prov={prov} data={data} onPagar={() => addPago({ proveedorID: id, prendas: data.prendas })} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {vista === 'historial' && (
        <>
          <SearchBar value={q} onChange={setQ} placeholder="Buscar proveedor…" className="mb-3" />
          {historial.length === 0 ? (
            <EmptyState icon="📄" title="Sin pagos registrados" />
          ) : (
            <div className="space-y-2">
              {historial
                .filter(l => !q || proveedores.find(p => p.id === l.proveedorID)?.nombre?.toLowerCase().includes(q.toLowerCase()))
                .slice(0, 60)
                .map(lote => {
                  const prov = proveedores.find(p => p.id === lote.proveedorID)
                  return (
                    <HistorialLoteCard key={lote.id} lote={lote} provNombre={prov?.nombre || lote.proveedorID} />
                  )
                })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ProveedorPagoCard({ id, prov, data, onPagar }) {
  const [open, setOpen]    = useState(false)
  const [confirm, setConf] = useState(false)

  return (
    <div className="card border-orange-200">
      <div className="p-3">
        <div className="flex justify-between items-start">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-text1 truncate">{prov?.nombre || id}</div>
            <div className="text-xs text-text3 mt-0.5">{id}{prov?.alias ? ` · ${prov.alias}` : ''}</div>
            <div className="text-xs text-text2 mt-1">{data.prendas.length} prenda(s)</div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-xl font-bold text-orange-700">{fmt$(data.total)}</div>
          </div>
        </div>

        <button onClick={() => setOpen(o => !o)} className="text-xs text-brand-700 mt-2 underline">
          {open ? 'Ocultar prendas' : 'Ver prendas'}
        </button>

        {open && (
          <div className="mt-2 space-y-1 border-t border-orange-100 pt-2">
            {data.prendas.map((v, i) => (
              <div key={i} className="flex justify-between text-xs text-text2">
                <span>{(v.Descripcion || v.IDProducto || '').slice(0, 38)}</span>
                <span className="font-medium">{fmt$(v.CostoProveedor)}</span>
              </div>
            ))}
          </div>
        )}

        {!confirm ? (
          <button onClick={() => setConf(true)} className="mt-3 w-full bg-green-600 text-white text-sm font-semibold py-2.5 rounded-xl">
            ✅ Confirmar pago — {fmt$(data.total)}
          </button>
        ) : (
          <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-xl">
            <div className="text-sm font-semibold text-green-800 mb-2">¿Confirmar pago de {fmt$(data.total)} a {prov?.nombre || id}?</div>
            <div className="flex gap-2">
              <button onClick={onPagar} className="flex-1 bg-green-600 text-white text-sm py-2 rounded-lg">Sí, pagado</button>
              <button onClick={() => setConf(false)} className="flex-1 border border-border text-text2 text-sm py-2 rounded-lg">Cancelar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function HistorialLoteCard({ lote, provNombre }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="card overflow-hidden">
      <div onClick={() => setOpen(o => !o)} className="p-3 cursor-pointer flex justify-between items-center">
        <div>
          <div className="font-semibold text-sm text-text1">{lote.id} · {provNombre}</div>
          <div className="text-xs text-text3 mt-0.5">{fmtDate(lote.fecha)} · {lote.items.length} prendas</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-bold text-green-700">{fmt$(lote.total)}</span>
          <span className="text-text3 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </div>
      {open && (
        <div className="border-t border-border p-3 space-y-1 bg-green-50">
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
