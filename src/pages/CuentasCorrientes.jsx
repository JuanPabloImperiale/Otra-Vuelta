import { useState, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { fmt$, fmtDate, today } from '../utils/formatters'
import { Modal, SearchBar, Button, Input, Select, SearchableSelect, SectionHeader, EmptyState, InfoRow, Chip } from '../components/ui'
// medios se usan dinámicos desde contexto

function buildVentasAsociadasCC(cc, pagosItems, ventas, cobros) {
  const ids = [...new Set([
    ...(Array.isArray(cc?.ventasAsociadas) ? cc.ventasAsociadas : []),
    cc?.idVenta,
    ...((pagosItems || []).map(p => p.idVenta)),
  ].filter(Boolean))]

  return ids
    .map((id) => {
      const lineasVenta = ventas.filter(v => v.IDVenta === id && !v.cancelada)
      const total = lineasVenta.reduce((sum, v) => sum + (v.PrecioVentaFinal || 0), 0)
      const cobradoTotal = cobros.filter(c => c.idVenta === id).reduce((sum, c) => sum + (c.monto || 0), 0)
      const cobradoCC = cobros
        .filter(c => c.idCuentaCorriente === cc.id && c.idVenta === id)
        .reduce((sum, c) => sum + (c.monto || 0), 0)
      const pendiente = Math.max(total - cobradoTotal, 0)
      const fecha = lineasVenta[0]?.FechaVenta || ''
      const cancelada = lineasVenta.length === 0
      const saldada = !cancelada && pendiente <= 0
      const overcobrada = !cancelada && cobradoTotal > total

      return {
        id,
        fecha,
        total,
        cobradoTotal,
        cobradoCC,
        pendiente,
        cancelada,
        saldada,
        overcobrada,
      }
    })
    .sort((a, b) => {
      const rank = (v) => (v.cancelada ? 2 : v.saldada ? 1 : 0)
      const diff = rank(a) - rank(b)
      if (diff !== 0) return diff
      return String(b.id).localeCompare(String(a.id), undefined, { numeric: true })
    })
}

export default function CuentasCorrientes({ setSection }) {
  const { cuentasCorrientes, ventas, cobros, addCC, updateCC, deleteCC, pagarCC, showToast } = useApp()
  // ventas agrupadas para el selector en CC manual
  const ventasUnicas = useMemo(() => {
    const map = {}
    ventas.filter(v => !v.cancelada).forEach(v => { map[v.IDVenta] = v.FechaVenta })
    return Object.entries(map).sort((a, b) => parseInt(b[0].slice(1)) - parseInt(a[0].slice(1))).slice(0, 50)
  }, [ventas])
  const [q, setQ]         = useState('')
  const [filtro, setF]    = useState('activas')
  const [modal, setM]     = useState(null)
  const [detalle, setD]   = useState(null)

  // Pagos registrados por CC
  const pagosPorCC = useMemo(() => {
    const map = {}
    cobros.filter(c => c.idCuentaCorriente).forEach(c => {
      if (!map[c.idCuentaCorriente]) map[c.idCuentaCorriente] = { total: 0, items: [] }
      map[c.idCuentaCorriente].total += c.monto || 0
      map[c.idCuentaCorriente].items.push(c)
    })
    return map
  }, [cobros])

  const filtradas = useMemo(() => {
    let list = cuentasCorrientes
    if (filtro === 'activas')    list = list.filter(cc => cc.estado !== 'Cancelada')
    if (filtro === 'canceladas') list = list.filter(cc => cc.estado === 'Cancelada')
    if (q) {
      const ql = q.toLowerCase()
      list = list.filter(cc => cc.cliente?.toLowerCase().includes(ql) || cc.id?.toLowerCase().includes(ql))
    }
    return list.sort((a, b) => (b.fechaInicio || '').localeCompare(a.fechaInicio || ''))
  }, [cuentasCorrientes, filtro, q])

  const totalDeuda = useMemo(() =>
    cuentasCorrientes.filter(cc => cc.estado !== 'Cancelada')
      .reduce((s, cc) => s + ((cc.totalAdeudado || 0) - (pagosPorCC[cc.id]?.total || cc.totalPagado || 0)), 0)
  , [cuentasCorrientes, pagosPorCC])

  return (
    <div>
      <SectionHeader title="Cuentas Corrientes"
        action={<Button size="sm" onClick={() => setM({ _new: true, cliente: '', notas: '', fechaInicio: today(), totalAdeudado: '', estado: 'Activa' })}>+ Nueva CC</Button>}
      />

      {totalDeuda > 0 && (
        <div className="card border-orange-200 bg-orange-50 p-4 mb-4">
          <div className="text-sm text-orange-700">Total adeudado (CCs activas)</div>
          <div className="text-2xl font-bold text-orange-800 mt-1">{fmt$(totalDeuda)}</div>
        </div>
      )}

      <SearchBar value={q} onChange={setQ} placeholder="Buscar cliente o ID…" className="mb-3" />

      <div className="flex gap-2 mb-4">
        <Chip label="Activas"    active={filtro === 'activas'}    onClick={() => setF('activas')} />
        <Chip label="Canceladas" active={filtro === 'canceladas'} onClick={() => setF('canceladas')} />
        <Chip label="Todas"      active={filtro === 'todas'}      onClick={() => setF('todas')} />
      </div>

      {filtradas.length === 0 ? (
        <EmptyState icon="💳" title="Sin cuentas corrientes"
          subtitle="Cuando una clienta pague en cuotas, registrala acá"
          action={<Button size="sm" onClick={() => setM({ _new: true, cliente: '', notas: '', fechaInicio: today(), totalAdeudado: '', estado: 'Activa' })}>+ Nueva CC</Button>}
        />
      ) : (
        <div className="space-y-2">
          {filtradas.map(cc => {
            const pagos = pagosPorCC[cc.id] || {}
            const pagado  = pagos.total ?? cc.totalPagado ?? 0
            const adeudado = cc.totalAdeudado || 0
            const saldo   = adeudado - pagado
            const pct     = adeudado > 0 ? Math.min((pagado / adeudado) * 100, 100) : 0
            const cancelada = cc.estado === 'Cancelada' || saldo <= 0

            return (
              <div key={cc.id} onClick={() => setD(cc)} className="card p-3 cursor-pointer active:bg-gray-50">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-semibold text-text1">{cc.cliente}</div>
                    <div className="text-xs text-text3 mt-0.5">{cc.id} · {fmtDate(cc.fechaInicio)}</div>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold text-sm ${cancelada ? 'text-green-700' : 'text-orange-700'}`}>
                      {cancelada ? '✅ Cancelada' : fmt$(saldo) + ' pendiente'}
                    </div>
                    <div className="text-xs text-text3 mt-0.5">Total: {fmt$(adeudado)}</div>
                  </div>
                </div>
                {/* Barra de progreso */}
                <div className="mt-2 bg-gray-100 rounded-full h-1.5">
                  <div className="bg-green-500 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="text-xs text-text3 mt-1">{fmt$(pagado)} pagado · {pct.toFixed(0)}%</div>
              </div>
            )
          })}
        </div>
      )}

      {modal && (
        <CCModal
          cc={modal}
          ventasUnicas={ventasUnicas}
          onSave={async (data) => {
            if (data._new) await addCC(data)
            else await updateCC(data.id, data)
            setM(null)
          }}
          onDelete={async (id) => {
            const ok = await deleteCC(id)
            if (ok) setM(null)
          }}
          onClose={() => setM(null)}
        />
      )}

      {detalle && (
        (() => {
          const pagosDetalle = pagosPorCC[detalle.id] || {}
          const ventasAsociadas = buildVentasAsociadasCC(detalle, pagosDetalle.items || [], ventas, cobros)
          return (
        <DetalleCCModal
          cc={detalle}
          pagos={pagosDetalle}
          ventasAsociadas={ventasAsociadas}
          onGoVenta={(idVenta) => {
            setD(null)
            setSection?.('ventas', { ids: [idVenta], filter: 'todos' })
          }}
          onGoCobros={() => {
            setD(null)
            setSection?.('cobros', { ccId: detalle.id, idVenta: detalle.idVenta || null })
          }}
          onPago={async ({ idVenta, medio, monto, fecha, obs }) => {
            await pagarCC(detalle.id, { idVenta, medio, monto, fecha, obs })
            setD(null)
          }}
          onEdit={() => { setM(detalle); setD(null) }}
          onClose={() => setD(null)}
          onRecalcular={async (nuevoTotal) => {
            const nuevoSaldo = nuevoTotal - (pagosPorCC[detalle.id]?.total || 0)
            await updateCC(detalle.id, { totalAdeudado: nuevoTotal, saldo: nuevoSaldo })
            setD(prev => ({ ...prev, totalAdeudado: nuevoTotal, saldo: nuevoSaldo }))
          }}
        />
          )
        })()
      )}
    </div>
  )
}

// ── Modal nueva / editar CC ───────────────────────────────────────────────────
function CCModal({ cc, ventasUnicas = [], onSave, onDelete, onClose }) {
  const [form, setForm] = useState({ ...cc })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const ventasOptions = useMemo(() =>
    ventasUnicas.map(([id, fecha]) => ({
      value: id,
      label: `${id} · ${fmtDate(fecha)}`,
      searchText: `${id} ${fecha}`,
    }))
  , [ventasUnicas])

  return (
    <Modal title={cc._new ? 'Nueva cuenta corriente' : `Editar ${cc.id}`} onClose={onClose}
      footer={
        <>
          {!cc._new && <Button variant="danger" size="md" onClick={() => setConfirmDelete(true)}>Eliminar</Button>}
          <Button size="lg" className="flex-1" onClick={() => onSave(form)} disabled={!form.cliente || !form.totalAdeudado}>Guardar</Button>
        </>
      }
    >
      <Input label="Nombre de la clienta *" value={form.cliente || ''} onChange={e => set('cliente', e.target.value)} placeholder="Nombre y apellido" />
      <Input label="Total adeudado ($) *" type="number" value={form.totalAdeudado || ''} onChange={e => set('totalAdeudado', Number(e.target.value))} />
      <Input label="Fecha de inicio" type="date" value={form.fechaInicio || today()} onChange={e => set('fechaInicio', e.target.value)} />

      {ventasUnicas.length > 0 && (
        <SearchableSelect
          label="Vincular a venta (opcional)"
          value={form.idVenta || ''}
          onChange={(v) => set('idVenta', v)}
          options={ventasOptions}
          emptyOptionLabel="— Sin vincular —"
          searchPlaceholder="Buscar venta por ID o fecha"
        />
      )}

      <Input label="Notas (opcional)" value={form.notas || ''} onChange={e => set('notas', e.target.value)} placeholder="Observaciones sobre la deuda" />

      {!cc._new && (
        <Select label="Estado" value={form.estado || 'Activa'} onChange={e => set('estado', e.target.value)}>
          <option value="Activa">Activa</option>
          <option value="Cancelada">Cancelada</option>
        </Select>
      )}

      {confirmDelete && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl">
          <div className="text-sm font-semibold text-red-700 mb-2">¿Eliminar esta cuenta corriente?</div>
          <div className="text-xs text-red-600 mb-3">Solo se eliminará si no tiene cobros asociados.</div>
          <div className="flex gap-2">
            <Button variant="danger" size="sm" className="flex-1" onClick={() => onDelete(form.id)}>Sí, eliminar</Button>
            <Button variant="ghost" size="sm" className="flex-1" onClick={() => setConfirmDelete(false)}>No</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Detalle CC ────────────────────────────────────────────────────────────────
function DetalleCCModal({ cc, pagos, ventasAsociadas = [], onPago, onEdit, onGoVenta, onGoCobros, onClose, onRecalcular }) {
  const { mediosPago: mpDyn } = useApp()
  const mediosLabels = Object.fromEntries(mpDyn.map(m => [m.id, m.label]))
  const [modalPago, setMP] = useState(false)
  const pagado  = pagos.total ?? cc.totalPagado ?? 0
  const saldo   = (cc.totalAdeudado || 0) - pagado
  const cancelada = cc.estado === 'Cancelada' || saldo <= 0

  // Calcular el total real sumando todas las ventas asociadas
  const totalRealVentas = ventasAsociadas
    .filter(v => !v.cancelada)
    .reduce((s, v) => s + (v.total || 0), 0)
  const totalDesincronizado = totalRealVentas > 0 && Math.abs(totalRealVentas - (cc.totalAdeudado || 0)) > 0.5

  return (
    <Modal title={cc.cliente} onClose={onClose}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onEdit}>✏️ Editar</Button>
          {!cancelada && <Button size="md" className="flex-1" onClick={() => setMP(true)}>💰 Registrar pago</Button>}
        </>
      }
    >
      <div className="text-xs text-text3 mb-4">{cc.id} · Abierta el {fmtDate(cc.fechaInicio)}{cc.notas ? ` · ${cc.notas}` : ''}</div>

      <div className="card bg-cream p-4 mb-4">
        <InfoRow label="Total deuda:" value={fmt$(cc.totalAdeudado)} valueClass="font-bold" />
        <InfoRow label="Total pagado:" value={fmt$(pagado)} valueClass="text-green-700" />
        <InfoRow label="Saldo pendiente:" value={fmt$(Math.max(saldo, 0))} valueClass={cancelada ? 'text-green-700 font-bold' : 'text-orange-700 font-bold'} />
        <InfoRow label="Estado:" value={cancelada ? '✅ Cancelada' : '⏳ Activa'} />
        {ventasAsociadas.length > 0 && <InfoRow label="Ventas asociadas:" value={String(ventasAsociadas.length)} />}
        {cc.fechaCancelacion && <InfoRow label="Cancelada el:" value={fmtDate(cc.fechaCancelacion)} />}
        {totalDesincronizado && (
          <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="text-xs text-yellow-800 mb-2">
              ⚠️ El total registrado ({fmt$(cc.totalAdeudado)}) no coincide con la suma de ventas asociadas ({fmt$(totalRealVentas)}).
            </div>
            <button
              onClick={() => onRecalcular(totalRealVentas)}
              className="text-xs font-semibold bg-yellow-200 text-yellow-900 px-3 py-1.5 rounded-lg w-full hover:bg-yellow-300 transition"
            >
              🔄 Corregir total a {fmt$(totalRealVentas)}
            </button>
          </div>
        )}
      </div>

      {ventasAsociadas.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-medium text-text3 uppercase tracking-wide mb-2">Ventas asociadas</div>
          <div className="space-y-1">
            {ventasAsociadas.map((v) => (
              <div key={v.id} className="rounded-xl border border-gray-100 bg-white px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-text1">{v.id}</div>
                  <div className={`text-xs font-semibold ${v.cancelada ? 'text-red-700' : v.saldada ? 'text-green-700' : 'text-orange-700'}`}>
                    {v.cancelada ? 'Cancelada' : v.saldada ? 'Saldada' : `Pendiente ${fmt$(v.pendiente)}`}
                  </div>
                </div>
                <div className="mt-1 text-xs text-text3">
                  Total {fmt$(v.total)} · Cobrado {fmt$(v.cobradoTotal)} · En CC {fmt$(v.cobradoCC)}
                  {v.fecha ? ` · ${fmtDate(v.fecha)}` : ''}
                  {v.overcobrada ? ' · Error: sobrecobrada' : ''}
                </div>
                <div className="mt-2">
                  <Button variant="ghost" size="sm" onClick={() => onGoVenta?.(v.id)}>🧾 Ver venta</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <Button variant="ghost" size="sm" onClick={onGoCobros}>💳 Ver cobros de esta CC</Button>
      </div>

      {/* Barra de progreso */}
      {cc.totalAdeudado > 0 && (
        <div className="mb-4">
          <div className="flex justify-between text-xs text-text3 mb-1">
            <span>Progreso de pago</span>
            <span>{Math.min((pagado / cc.totalAdeudado) * 100, 100).toFixed(0)}%</span>
          </div>
          <div className="bg-gray-100 rounded-full h-3">
            <div className="bg-green-500 h-3 rounded-full transition-all"
              style={{ width: `${Math.min((pagado / cc.totalAdeudado) * 100, 100)}%` }} />
          </div>
        </div>
      )}

      {/* Historial de pagos */}
      {pagos.items?.length > 0 && (
        <div>
          <div className="text-xs font-medium text-text3 uppercase tracking-wide mb-2">Pagos registrados</div>
          <div className="space-y-1">
            {[...pagos.items].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).map((p, i) => (
              <div key={i} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0 text-sm">
                <span className="text-text2">{mediosLabels[p.medio] || p.medio} · {fmtDate(p.fecha)}{p.obs ? ` · ${p.obs}` : ''}</span>
                <span className="font-semibold text-green-700">{fmt$(p.monto)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {modalPago && (
        <PagoCCModal
          cc={cc}
          saldo={saldo}
          ventasAsociadas={ventasAsociadas}
          onSave={async (cobro) => { await onPago(cobro); setMP(false) }}
          onClose={() => setMP(false)}
        />
      )}
    </Modal>
  )
}

// ── Modal pago parcial CC ─────────────────────────────────────────────────────
function PagoCCModal({ cc, saldo, ventasAsociadas = [], onSave, onClose }) {
  const { mediosPago: mpDyn, showToast } = useApp()
  const ventasDisponibles = ventasAsociadas.filter(v => !v.cancelada)
  const primeraConPendiente = ventasDisponibles.find(v => v.pendiente > 0)
  const ventaInicial = primeraConPendiente?.id || ventasDisponibles[0]?.id || cc.idVenta || ''
  const [form, setForm] = useState({ idVenta: ventaInicial, fecha: today(), medio: 'EFE', monto: saldo, fechaReal: '', obs: '' })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const ventaSeleccionada = ventasDisponibles.find(v => v.id === form.idVenta) || null
  const ventasOptions = useMemo(() =>
    ventasDisponibles.map(v => ({
      value: v.id,
      label: `${v.id} · ${v.saldada ? 'Saldada' : `Pendiente ${fmt$(v.pendiente)}`} · Total ${fmt$(v.total)}`,
      searchText: `${v.id} ${v.fecha || ''}`,
    }))
  , [ventasDisponibles])
  const maxMontoVenta = ventaSeleccionada ? Math.max(ventaSeleccionada.pendiente, 0) : 0
  const maxMontoPermitido = Math.max(Math.min(maxMontoVenta, Math.max(saldo, 0)), 0)
  const puedeGuardar = !!ventaSeleccionada && Number(form.monto) > 0

  return (
    <Modal title="Registrar pago" onClose={onClose}
      footer={<Button size="lg" onClick={() => {
        if (!ventaSeleccionada) {
          showToast('Seleccioná una venta asociada para imputar el pago', 'error')
          return
        }
        if (maxMontoPermitido <= 0) {
          showToast('La venta seleccionada no tiene saldo pendiente', 'error')
          return
        }
        if (Number(form.monto) > maxMontoPermitido) {
          showToast(`El monto supera el pendiente de la venta (${fmt$(maxMontoPermitido)})`, 'error')
          return
        }
        onSave({ ...form, monto: Number(form.monto) })
      }} disabled={!puedeGuardar}>
        Registrar {fmt$(Number(form.monto))}
      </Button>}
    >
      <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-4">
        <InfoRow label="Clienta:" value={cc.cliente} />
        <InfoRow label="Saldo pendiente:" value={fmt$(saldo)} valueClass="text-orange-700 font-bold" />
        {ventaSeleccionada && (
          <>
            <InfoRow label="Venta seleccionada:" value={ventaSeleccionada.id} />
            <InfoRow label="Pendiente de venta:" value={fmt$(ventaSeleccionada.pendiente)} />
          </>
        )}
      </div>

      <SearchableSelect
        label="Aplicar a venta"
        value={form.idVenta}
        onChange={(v) => set('idVenta', v)}
        options={ventasOptions}
        emptyOptionLabel="— Seleccionar venta —"
        searchPlaceholder="Buscar venta por ID"
      />

      <Select label="Medio de pago" value={form.medio} onChange={e => set('medio', e.target.value)}>
        {mpDyn.filter(m => !m.esCC && !m.esBNA).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
      </Select>
      <Input label="Fecha" type="date" value={form.fecha} onChange={e => set('fecha', e.target.value)} />
      <Input
        label={`Monto ($) — max permitido: ${fmt$(maxMontoPermitido)}`}
        type="number"
        value={form.monto}
        onChange={e => set('monto', Number(e.target.value))}
      />
      <Input label="Observación (opcional)" value={form.obs} onChange={e => set('obs', e.target.value)} placeholder="Referencia del pago…" />
    </Modal>
  )
}
