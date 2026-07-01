import { useState, useMemo, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { fmt$, fmtDate, today } from '../utils/formatters'
import { Modal, SearchBar, Button, Input, Select, SearchableSelect, SectionHeader, EmptyState, InfoRow } from '../components/ui'
// medios dinámicos desde contexto

const shiftISODate = (isoDate, days) => {
  if (!isoDate) return ''
  const d = new Date(`${isoDate}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

const byNewestCobro = (a, b) => (b.fecha || '').localeCompare(a.fecha || '')
const byFechaRealAsc = (a, b) => (a.fechaReal || '').localeCompare(b.fechaReal || '')

export default function Cobros({ navigation, setSection }) {
  const { ventas, cobros, pagos, mediosPago: mpDyn, addCobro, deleteCobro, updateCobro, showToast } = useApp()
  const mediosLabels = Object.fromEntries(mpDyn.map(m => [m.id, m.label]))
  const mediosDiferidos = useMemo(() => new Set(mpDyn.filter(m => m.esBNA).map(m => m.id)), [mpDyn])
  const [q, setQ]          = useState('')
  const [tab, setTab]      = useState('todos')
  const [focusCCId, setFocusCCId] = useState(null)
  const [focusVentaId, setFocusVentaId] = useState(null)
  const [focusCobroId, setFocusCobroId] = useState(null)
  const [modal, setModal]  = useState(false)
  const [detalle, setDet]  = useState(null)

  const hoy = today()
  const haceCincoDias = useMemo(() => shiftISODate(hoy, -5), [hoy])
  const isCobroDiferido = (c) => mediosDiferidos.has(c.medio) || (!!c.fechaReal && c.fechaReal !== c.fecha)

  const totalPorVenta = useMemo(() => {
    const map = {}
    ventas.filter(v => !v.cancelada).forEach(v => {
      if (!map[v.IDVenta]) map[v.IDVenta] = { total: 0, fecha: v.FechaVenta, items: [] }
      map[v.IDVenta].total += Number(v.PrecioVentaFinal) || 0  // Number() evita bug de string
      map[v.IDVenta].items.push(v)
    })
    return map
  }, [ventas])

  const cobradoPorVenta = useMemo(() => {
    const map = {}
    cobros.forEach(c => {
      if (!map[c.idVenta]) map[c.idVenta] = 0
      map[c.idVenta] += Number(c.monto) || 0
    })
    return map
  }, [cobros])

  const ventasConPagoProveedor = useMemo(() => {
    const set = new Set()
    ventas.filter(v => v.PagoProveedor === true).forEach(v => set.add(v.IDVenta))
    pagos.forEach(p => { if (p.idVenta) set.add(p.idVenta) })
    return set
  }, [ventas, pagos])

  const ventasPendientes = useMemo(() =>
    Object.entries(totalPorVenta)
      .filter(([id, v]) => (cobradoPorVenta[id] || 0) < v.total)
      .map(([id, v]) => ({ id, ...v, cobrado: cobradoPorVenta[id] || 0, pendiente: v.total - (cobradoPorVenta[id] || 0) }))
      .sort((a, b) => parseInt(b.id.slice(1)) - parseInt(a.id.slice(1)))
  , [totalPorVenta, cobradoPorVenta])

  useEffect(() => {
    if (!navigation || navigation.target !== 'cobros') return
    setTab('todos')
    setQ('')
    setFocusCCId(navigation.ccId || null)
    setFocusVentaId(navigation.idVenta || null)
    setFocusCobroId(navigation.cobroId || null)
  }, [navigation])

  useEffect(() => {
    if (!focusCobroId) return
    const target = cobros.find(c => c.id === focusCobroId)
    if (target) setDet(target)
  }, [focusCobroId, cobros])

  const filterByFocus = (list) => list.filter(c => {
    if (focusCCId && c.idCuentaCorriente !== focusCCId) return false
    if (focusVentaId && c.idVenta !== focusVentaId) return false
    if (focusCobroId && c.id !== focusCobroId) return false
    return true
  })

  const cobrosOrdenados = useMemo(() => {
    let list = filterByFocus([...cobros].sort(byNewestCobro))
    if (q) {
      const ql = q.toLowerCase()
      list = list.filter(c =>
        c.id?.toLowerCase().includes(ql) ||
        c.idVenta?.toLowerCase().includes(ql) ||
        c.medio?.toLowerCase().includes(ql) ||
        mediosLabels[c.medio]?.toLowerCase().includes(ql) ||
        c.obs?.toLowerCase().includes(ql) ||
        c.fecha?.includes(q)
      )
    }
    return list.slice(0, 80)
  }, [cobros, q, mediosLabels, focusCCId, focusVentaId])

  const cobrosDiferidos = useMemo(() =>
    filterByFocus(cobros.filter(c => isCobroDiferido(c)).sort(byFechaRealAsc))
  , [cobros, mediosDiferidos, focusCCId, focusVentaId])

  const diferidosPendientes = useMemo(() =>
    cobrosDiferidos.filter(c => c.fechaReal && c.fechaReal > hoy)
  , [cobrosDiferidos, hoy])

  const acreditadosRecientes = useMemo(() =>
    cobrosDiferidos
      .filter(c => c.fechaReal && c.fechaReal <= hoy && c.fechaReal >= haceCincoDias)
      .sort((a, b) => (b.fechaReal || '').localeCompare(a.fechaReal || ''))
  , [cobrosDiferidos, hoy, haceCincoDias])

  const acreditadosHoy = useMemo(() =>
    acreditadosRecientes.filter(c => c.fechaReal === hoy)
  , [acreditadosRecientes, hoy])

  const agendaDiferidos = useMemo(() => {
    const grouped = {}
    diferidosPendientes.forEach(c => {
      const key = c.fechaReal
      if (!grouped[key]) grouped[key] = { fecha: key, total: 0, items: [] }
      grouped[key].total += Number(c.monto) || 0
      grouped[key].items.push(c)
    })
    return Object.values(grouped).sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))
  }, [diferidosPendientes])

  const diferidosPendientesFiltrados = useMemo(() => {
    if (!q) return diferidosPendientes.slice(0, 80)
    const ql = q.toLowerCase()
    return diferidosPendientes.filter(c =>
      c.id?.toLowerCase().includes(ql) ||
      c.idVenta?.toLowerCase().includes(ql) ||
      (mediosLabels[c.medio] || c.medio)?.toLowerCase().includes(ql) ||
      c.fechaReal?.includes(q) ||
      c.obs?.toLowerCase().includes(ql)
    ).slice(0, 80)
  }, [diferidosPendientes, q, mediosLabels])

  const acreditadosRecientesFiltrados = useMemo(() => {
    if (!q) return acreditadosRecientes.slice(0, 80)
    const ql = q.toLowerCase()
    return acreditadosRecientes.filter(c =>
      c.id?.toLowerCase().includes(ql) ||
      c.idVenta?.toLowerCase().includes(ql) ||
      (mediosLabels[c.medio] || c.medio)?.toLowerCase().includes(ql) ||
      c.fechaReal?.includes(q) ||
      c.obs?.toLowerCase().includes(ql)
    ).slice(0, 80)
  }, [acreditadosRecientes, q, mediosLabels])

  const cobrosVisibles = tab === 'diferidos'
    ? diferidosPendientesFiltrados
    : tab === 'recientes'
    ? acreditadosRecientesFiltrados
    : cobrosOrdenados

  return (
    <div>
      <SectionHeader title="Cobros" action={<Button size="sm" onClick={() => setModal(true)}>+ Cobro</Button>} />

      {(focusCCId || focusVentaId) && (
        <div className="mb-3 bg-brand-50 border border-brand-200 rounded-xl px-3 py-2 flex items-center justify-between gap-3 text-xs text-brand-700">
          <span>
            Vista filtrada:
            {focusCCId ? ` CC ${focusCCId}` : ''}
            {focusVentaId ? ` · Venta ${focusVentaId}` : ''}
            {focusCobroId ? ` · Cobro ${focusCobroId}` : ''}
          </span>
          <button className="font-semibold" onClick={() => { setFocusCCId(null); setFocusVentaId(null); setFocusCobroId(null) }}>Ver todos</button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
        <button
          onClick={() => setTab('todos')}
          className={`rounded-xl border p-3 text-left transition-colors ${tab === 'todos' ? 'bg-brand-700 text-white border-brand-700' : 'bg-white border-border hover:bg-cream'}`}
        >
          <div className={`text-xs ${tab === 'todos' ? 'text-white/80' : 'text-text3'}`}>Cobros registrados</div>
          <div className="text-xl font-bold">{cobros.length}</div>
        </button>
        <button
          onClick={() => setTab('diferidos')}
          className={`rounded-xl border p-3 text-left transition-colors ${tab === 'diferidos' ? 'bg-blue-700 text-white border-blue-700' : 'bg-white border-border hover:bg-blue-50'}`}
        >
          <div className={`text-xs ${tab === 'diferidos' ? 'text-white/80' : 'text-text3'}`}>Diferidos por acreditar</div>
          <div className="text-xl font-bold">{diferidosPendientes.length}</div>
          <div className={`text-xs mt-0.5 ${tab === 'diferidos' ? 'text-white/80' : 'text-blue-700'}`}>{fmt$(diferidosPendientes.reduce((s, c) => s + (Number(c.monto) || 0), 0))}</div>
        </button>
        <button
          onClick={() => setTab('recientes')}
          className={`rounded-xl border p-3 text-left transition-colors ${tab === 'recientes' ? 'bg-green-700 text-white border-green-700' : 'bg-white border-border hover:bg-green-50'}`}
        >
          <div className={`text-xs ${tab === 'recientes' ? 'text-white/80' : 'text-text3'}`}>Acreditados últimos 5 días</div>
          <div className="text-xl font-bold">{acreditadosRecientes.length}</div>
          <div className={`text-xs mt-0.5 ${tab === 'recientes' ? 'text-white/80' : 'text-green-700'}`}>Hoy: {fmt$(acreditadosHoy.reduce((s, c) => s + (Number(c.monto) || 0), 0))}</div>
        </button>
      </div>

      {tab === 'diferidos' && agendaDiferidos.length > 0 && (
        <div className="card border-blue-200 bg-blue-50 p-4 mb-4">
          <div className="font-semibold text-blue-800 mb-2">📅 Agenda de acreditaciones pendientes</div>
          <div className="space-y-2">
            {agendaDiferidos.slice(0, 6).map(agenda => (
              <div key={agenda.fecha} className="flex justify-between items-center border-b border-blue-100 last:border-0 pb-2 last:pb-0">
                <div>
                  <div className="text-sm font-medium text-blue-900">{fmtDate(agenda.fecha)}</div>
                  <div className="text-xs text-blue-700">{agenda.items.length} cobro(s)</div>
                </div>
                <div className="text-sm font-bold text-blue-800">{fmt$(agenda.total)}</div>
              </div>
            ))}
          </div>
          {agendaDiferidos.length > 6 && <div className="text-xs text-blue-700 mt-2">+{agendaDiferidos.length - 6} fecha(s) más</div>}
        </div>
      )}

      {tab === 'recientes' && (
        <div className="card border-green-200 bg-green-50 p-4 mb-4">
          <div className="font-semibold text-green-800 mb-1">🔔 Notificaciones de acreditación</div>
          <div className="text-sm text-green-700">Entraron {fmt$(acreditadosRecientes.reduce((s, c) => s + (Number(c.monto) || 0), 0))} entre hoy y los últimos 5 días.</div>
          {acreditadosHoy.length > 0 && (
            <div className="text-sm font-semibold text-green-900 mt-1">Hoy ingresaron {fmt$(acreditadosHoy.reduce((s, c) => s + (Number(c.monto) || 0), 0))} en {acreditadosHoy.length} cobro(s).</div>
          )}
        </div>
      )}

      {ventasPendientes.length > 0 && (
        <div className="card border-yellow-200 bg-yellow-50 p-4 mb-4">
          <div className="font-semibold text-yellow-800 mb-3">⏳ {ventasPendientes.length} venta(s) pendientes de cobro</div>
          {ventasPendientes.slice(0, 4).map(v => (
            <div key={v.id} onClick={() => setModal(v.id)}
              className="flex justify-between items-center py-2 border-b border-yellow-200 last:border-0 cursor-pointer">
              <span className="text-sm text-yellow-900 font-medium">{v.id} · {fmtDate(v.fecha)}</span>
              <span className="text-sm text-red-700 font-bold">Faltan {fmt$(v.pendiente)}</span>
            </div>
          ))}
          {ventasPendientes.length > 4 && <div className="text-xs text-yellow-600 mt-2">+{ventasPendientes.length - 4} más</div>}
        </div>
      )}

      <SearchBar
        value={q}
        onChange={setQ}
        placeholder={tab === 'diferidos' ? 'Buscar diferidos por fecha de acreditación, venta o referencia…' : tab === 'recientes' ? 'Buscar acreditados recientes…' : 'Buscar cobro, venta, medio, fecha…'}
        className="mb-4"
      />

      {cobrosVisibles.length === 0 && !q ? (
        <EmptyState icon="💰" title="Sin cobros" subtitle="Registrá cobros desde una venta o con el botón +" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {cobrosVisibles.map(c => {
            const ventaDetalle = totalPorVenta[c.idVenta] || { items: [] }
            const totalV  = Number(ventaDetalle.total) || 0
            const cobradoV = Number(cobradoPorVenta[c.idVenta]) || 0
            const cerrada  = totalV > 0 && cobradoV >= totalV
            const parcial  = cobradoV > 0 && !cerrada
            const bloqueada = ventasConPagoProveedor.has(c.idVenta)
            const diferido = isCobroDiferido(c)
            const acreditadoReciente = diferido && c.fechaReal && c.fechaReal <= hoy && c.fechaReal >= haceCincoDias
            const pendienteAcreditar = diferido && c.fechaReal && c.fechaReal > hoy
            const proveedores = [...new Set((ventaDetalle.items || []).map(item => item.ProveedorNombre || item.ProveedorID).filter(Boolean))]
            return (
              <div key={c.id} onClick={() => setDet(c)} className="card p-3 cursor-pointer active:bg-gray-50">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-brand-700 text-sm">{c.id}</span>
                    <span className="text-xs text-text3">{c.idVenta}</span>
                    {bloqueada && <span className="bg-orange-100 text-orange-700 text-xs px-2 py-0.5 rounded-full">🔒 Pagada proveedor</span>}
                    {pendienteAcreditar && <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">📅 Acredita {fmtDate(c.fechaReal)}</span>}
                    {acreditadoReciente && <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full">🔔 Acreditó {fmtDate(c.fechaReal)}</span>}
                    {cerrada
                      ? <span className="badge-vendido">✅ Cobrada</span>
                      : parcial
                      ? <span className="bg-yellow-100 text-yellow-700 text-xs px-2 py-0.5 rounded-full">⏳ Parcial</span>
                      : <span className="bg-red-50 text-red-600 text-xs px-2 py-0.5 rounded-full">⭕ Pendiente</span>
                    }
                  </div>
                  <span className="font-bold text-green-700 flex-shrink-0">{fmt$(c.monto)}</span>
                </div>
                <div className="text-xs text-text3 mt-1">
                  {mediosLabels[c.medio] || c.medio} · {fmtDate(c.fecha)}
                  {diferido && c.fechaReal && ` · Acred. ${fmtDate(c.fechaReal)}`}
                  {c.obs && ` · ${c.obs}`}
                </div>
                {ventaDetalle.items?.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {(ventaDetalle.items || []).slice(0, 2).map((item, idx) => (
                      <div key={`${c.id}_${idx}`} className="text-xs text-text2 flex justify-between gap-3">
                        <span className="truncate">{item.Descripcion || item.IDProducto}</span>
                        <span className="text-text3 truncate">{item.ProveedorNombre || item.ProveedorID}</span>
                      </div>
                    ))}
                    {ventaDetalle.items.length > 2 && (
                      <div className="text-[11px] text-text3">+{ventaDetalle.items.length - 2} producto(s) más</div>
                    )}
                    {proveedores.length > 0 && (
                      <div className="text-[11px] text-text3">Proveedor(es): {proveedores.join(', ')}</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {modal && (
        <NuevoCobroModal
          ventasPendientes={ventasPendientes}
          cobradoPorVenta={cobradoPorVenta}
          totalPorVenta={totalPorVenta}
          addCobro={addCobro}
          showToast={showToast}
          idVentaInicial={typeof modal === 'string' ? modal : ''}
          onClose={() => setModal(false)}
        />
      )}

      {detalle && (
        <DetalleCobroModal
          cobro={detalle}
          ventaDetalle={totalPorVenta[detalle.idVenta] || { items: [], total: 0, fecha: '' }}
          totalPorVenta={totalPorVenta}
          cobradoPorVenta={cobradoPorVenta}
          saleLocked={ventasConPagoProveedor.has(detalle.idVenta)}
          showToast={showToast}
          onOpenCC={(ccId) => { setDet(null); setSection?.('cuentas', { ccId }) }}
          onDelete={async () => {
            const ok = await deleteCobro(detalle.id)
            if (ok) setDet(null)
          }}
          onUpdate={async (data) => {
            const ok = await updateCobro(detalle.id, data)
            if (ok) setDet(null)
          }}
          onClose={() => setDet(null)}
        />
      )}
    </div>
  )
}

function NuevoCobroModal({ ventasPendientes, cobradoPorVenta, totalPorVenta, addCobro, showToast, idVentaInicial, onClose }) {
  const { mediosPago: mpDyn } = useApp()
  const [form, setForm] = useState({
    idVenta: idVentaInicial || '',
    fecha: today(), medio: 'EFE', monto: '', fechaReal: '', obs: '',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const ventaSel  = totalPorVenta[form.idVenta]
  const pendiente = ventaSel ? ventaSel.total - (cobradoPorVenta[form.idVenta] || 0) : 0

  const esBNA = mpDyn.find(m => m.id === form.medio)?.esBNA

  useEffect(() => {
    if (esBNA && form.fecha) {
      const d = new Date(form.fecha); d.setMonth(d.getMonth() + 1); d.setDate(1)
      set('fechaReal', d.toISOString().split('T')[0])
    } else set('fechaReal', form.fecha)
  }, [form.medio, form.fecha])

  useEffect(() => {
    if (pendiente > 0) set('monto', pendiente)
  }, [form.idVenta])

  const canSave = !!form.idVenta && !!form.fecha && Number(form.monto) > 0 && (!esBNA || !!form.fechaReal)
  const ventasOptions = useMemo(() =>
    ventasPendientes.map(v => ({
      value: v.id,
      label: `${v.id} · ${fmtDate(v.fecha)} · Pendiente ${fmt$(v.pendiente)}`,
      searchText: `${v.id} ${v.fecha}`,
    }))
  , [ventasPendientes])

  const guardar = async () => {
    if (!form.idVenta || !form.monto) return
    const monto = Number(form.monto)
    const maxPermitido = Number(pendiente || 0)

    if (!form.fecha) {
      showToast('La fecha de cobro es obligatoria', 'error')
      return
    }
    if (!(monto > 0)) {
      showToast('El monto debe ser mayor a 0', 'error')
      return
    }
    if (maxPermitido > 0 && monto > maxPermitido) {
      showToast(`El monto no puede superar el saldo pendiente (${fmt$(maxPermitido)})`, 'error')
      return
    }

    const esBNA = mpDyn.find(m => m.id === form.medio)?.esBNA
    if (esBNA) {
      if (!form.fechaReal) {
        showToast('Para BNA, la fecha de acreditación es obligatoria', 'error')
        return
      }
      if (form.fechaReal < form.fecha) {
        showToast('La fecha de acreditación no puede ser anterior a la fecha de cobro', 'error')
        return
      }
    }

    await addCobro({
      ...form,
      monto,
      fechaReal: esBNA ? form.fechaReal : form.fecha,
    })
    onClose()
  }

  return (
    <Modal title="Registrar cobro" onClose={onClose}
      footer={<Button size="lg" onClick={guardar} disabled={!canSave}>Registrar {form.monto ? fmt$(Number(form.monto)) : ''}</Button>}
    >
      <SearchableSelect
        label="Venta a cobrar"
        value={form.idVenta}
        onChange={(v) => set('idVenta', v)}
        options={ventasOptions}
        emptyOptionLabel="— Seleccioná una venta —"
        searchPlaceholder="Buscar venta por ID o fecha"
      />

      {ventasPendientes.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 mt-2">
          <div className="text-sm font-medium text-green-800">✅ No hay ventas pendientes de cobro</div>
          <div className="text-xs text-green-600 mt-0.5">Todas las ventas registradas están 100% cobradas. Para cobrar, primero registrá una nueva venta desde el módulo Ventas.</div>
        </div>
      )}

      {ventaSel && (
        <div className="bg-brand-50 border border-brand-200 rounded-xl p-3 mt-3">
          <InfoRow label="Total:" value={fmt$(ventaSel.total)} />
          <InfoRow label="Cobrado:" value={fmt$(cobradoPorVenta[form.idVenta] || 0)} />
          <InfoRow label="Pendiente:" value={fmt$(pendiente)} valueClass="text-red-700 font-bold" />
        </div>
      )}

      <Select label="Medio de pago" value={form.medio} onChange={e => set('medio', e.target.value)}>
        {mpDyn.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
      </Select>

      <Input label="Fecha de cobro" type="date" value={form.fecha} onChange={e => set('fecha', e.target.value)} />

      {esBNA && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mt-3">
          <div className="text-sm font-medium text-blue-800 mb-2">🏦 Acreditación diferida</div>
          <Input label="Fecha de acreditación real" type="date" value={form.fechaReal} onChange={e => set('fechaReal', e.target.value)} />
        </div>
      )}

      <Input label={`Monto ($)${pendiente > 0 ? ` — pendiente: ${fmt$(pendiente)}` : ''}`} type="number" value={form.monto} onChange={e => set('monto', e.target.value)} />
      <Input label="Observación (opcional)" value={form.obs} onChange={e => set('obs', e.target.value)} placeholder="Nombre cliente, referencia…" />
    </Modal>
  )
}

function DetalleCobroModal({ cobro, ventaDetalle, totalPorVenta, cobradoPorVenta, saleLocked, showToast, onOpenCC, onDelete, onUpdate, onClose }) {
  const { mediosPago: mpDyn } = useApp()
  const mediosLabels = Object.fromEntries(mpDyn.map(m => [m.id, m.label]))
  const [editMode, setEdit] = useState(false)
  const [form, setForm]     = useState({ ...cobro })
  const [confirm, setConf]  = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const totalVenta = Number(totalPorVenta[cobro.idVenta]?.total) || 0
  const totalCob   = Number(cobradoPorVenta[cobro.idVenta]) || 0
  const overcobrada = totalVenta > 0 && totalCob > totalVenta
  const cerradaExacta = totalVenta > 0 && !overcobrada && totalCob >= totalVenta
  const esCobroCC  = !!cobro.idCuentaCorriente
  const totalSinActual = Math.max(0, totalCob - (Number(cobro.monto) || 0))
  const maxMontoEdit = Math.max(0, totalVenta - totalSinActual)

  const guardarEdicion = async () => {
    const monto = Number(form.monto)
    const esBNA = mpDyn.find(m => m.id === form.medio)?.esBNA

    if (!form.fecha) {
      showToast('La fecha de cobro es obligatoria', 'error')
      return
    }
    if (!(monto > 0)) {
      showToast('El monto debe ser mayor a 0', 'error')
      return
    }
    if (maxMontoEdit > 0 && monto > maxMontoEdit) {
      showToast(`El monto no puede superar el máximo permitido (${fmt$(maxMontoEdit)})`, 'error')
      return
    }

    if (esBNA) {
      if (!form.fechaReal) {
        showToast('Para BNA, la fecha de acreditación es obligatoria', 'error')
        return
      }
      if (form.fechaReal < form.fecha) {
        showToast('La fecha de acreditación no puede ser anterior a la fecha de cobro', 'error')
        return
      }
    }

    await onUpdate({
      ...form,
      monto,
      fechaReal: esBNA ? form.fechaReal : form.fecha,
    })
  }

  return (
    <Modal title={`Cobro ${cobro.id}`} onClose={onClose}
      footer={
        <>
          {(!cerradaExacta || overcobrada) && !saleLocked && <Button variant="danger" size="md" onClick={() => setConf(true)}>Eliminar</Button>}
          {!editMode && (!cerradaExacta || overcobrada) && !saleLocked && <Button variant="ghost" size="md" onClick={() => setEdit(true)}>Editar</Button>}
          {editMode && <Button size="md" className="flex-1" onClick={guardarEdicion}>Guardar</Button>}
        </>
      }
    >
      {saleLocked && (
        <div className="mb-3 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg p-2">
          Esta venta ya fue pagada al proveedor. Por regla de negocio este cobro no se puede editar ni eliminar.
        </div>
      )}

      {overcobrada && !saleLocked && (
        <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
          Esta venta tiene sobrecobro ({fmt$(totalCob - totalVenta)} por encima del total). Solo podés editar o eliminar cobros para corregir el saldo.
        </div>
      )}

      {!editMode ? (
        <div className="space-y-1">
          <InfoRow label="Venta:" value={cobro.idVenta} />
          {ventaDetalle?.fecha && <InfoRow label="Fecha venta:" value={fmtDate(ventaDetalle.fecha)} />}
          <InfoRow label="Medio:" value={mediosLabels[cobro.medio] || cobro.medio} />
          <InfoRow label="Monto:" value={fmt$(cobro.monto)} valueClass="font-bold text-green-700" />
          <InfoRow label="Fecha cobro:" value={fmtDate(cobro.fecha)} />
          {cobro.fechaReal && <InfoRow label="Fecha acreditación:" value={fmtDate(cobro.fechaReal)} />}
          {cobro.obs && <InfoRow label="Observación:" value={cobro.obs} />}
          {cobro.idCuentaCorriente && (
            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-blue-700">💳 Cuenta Corriente</span>
                <span className="text-sm text-blue-600">{cobro.idCuentaCorriente}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenCC?.(cobro.idCuentaCorriente)}
              >
                Ver CC
              </Button>
            </div>
          )}
        </div>
      ) : (
        <>
          <Select label="Medio de pago" value={form.medio} onChange={e => set('medio', e.target.value)} disabled={esCobroCC}>
            {mpDyn.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </Select>
          <Input
            label={`Monto ($)${maxMontoEdit > 0 ? ` — máximo: ${fmt$(maxMontoEdit)}` : ''}`}
            type="number"
            value={form.monto}
            onChange={e => set('monto', Number(e.target.value))}
          />
          <Input label="Fecha cobro" type="date" value={form.fecha} onChange={e => set('fecha', e.target.value)} />
          {mpDyn.find(m => m.id === form.medio)?.esBNA && <Input label="Fecha acreditación" type="date" value={form.fechaReal || ''} onChange={e => set('fechaReal', e.target.value)} />}
          <Input label="Observación" value={form.obs || ''} onChange={e => set('obs', e.target.value)} />
          {esCobroCC && (
            <div className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg p-2">
              Este cobro está vinculado a una cuenta corriente. El medio no se puede cambiar desde este modal.
            </div>
          )}
        </>
      )}

      {ventaDetalle?.items?.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-medium text-text3 uppercase tracking-wide mb-2">Detalle de la venta</div>
          <div className="space-y-2">
            {ventaDetalle.items.map((item, idx) => (
              <div key={`${cobro.id}_item_${idx}`} className="bg-cream rounded-xl p-3">
                <div className="flex justify-between items-start gap-3">
                  <div>
                    <div className="text-sm font-medium text-text1">{item.Descripcion || item.IDProducto}</div>
                    <div className="text-xs text-text3 mt-0.5">{item.IDProducto} · {item.ProveedorNombre || item.ProveedorID || 'Sin proveedor'}</div>
                  </div>
                  <div className="text-sm font-semibold text-brand-700">{fmt$(item.PrecioVentaFinal)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {confirm && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl">
          <div className="text-sm font-semibold text-red-700 mb-2">¿Eliminar este cobro?</div>
          <div className="flex gap-2">
            <Button variant="danger" size="sm" className="flex-1" onClick={onDelete}>Sí</Button>
            <Button variant="ghost" size="sm" className="flex-1" onClick={() => setConf(false)}>No</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
