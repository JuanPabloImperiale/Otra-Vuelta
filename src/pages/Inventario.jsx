import { useState, useMemo, useRef, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { fmt$, fmtDate, today, diffDays } from '../utils/formatters'
import { Modal, SearchBar, Button, Input, Select, SearchableSelect, SectionHeader, Chip, EmptyState, InfoRow } from '../components/ui'
import { getProductoIssues, hasText, isPositiveNumber } from '../utils/dataQuality'

export default function Inventario({ navigation, setSection }) {
  const { productos, proveedores, categorias, addProducto, updateProducto, deleteProducto, devolverProducto, config } = useApp()
  const [q, setQ]                 = useState('')
  const [filtroEstado, setFiltro] = useState('stock')
  const [filtroProv, setFiltroProv] = useState('')
  const [modal, setModal]         = useState(null)   // null | 'nuevo' | producto
  const [page, setPage]           = useState(1)
  const [focusProductIds, setFocusProductIds] = useState(null)
  const PER_PAGE = 50

  const filtrados = useMemo(() => {
    let list = productos
    if (filtroEstado === 'stock')    list = list.filter(p => p.enStock && !p.vendido && !p.devolucion)
    else if (filtroEstado === 'vendido')   list = list.filter(p => p.vendido && !p.cancelada)
    else if (filtroEstado === 'devuelto')  list = list.filter(p => p.devolucion)
    else if (filtroEstado === 'incompletos') list = list.filter(p => getProductoIssues(p).length > 0)
    if (focusProductIds?.length) list = list.filter(p => focusProductIds.includes(p.id))
    if (filtroProv) list = list.filter(p => p.proveedorID === filtroProv)
    if (q) {
      const ql = q.toLowerCase()
      list = list.filter(p =>
        p.notas?.toLowerCase().includes(ql) ||
        p.id?.toLowerCase().includes(ql) ||
        p.proveedorNombre?.toLowerCase().includes(ql) ||
        p.categoria?.toLowerCase().includes(ql)
      )
    }
    // Ordenar de más reciente a más antiguo
    list.sort((a, b) => {
      const fechaA = new Date(a.fechaIngreso || '').getTime()
      const fechaB = new Date(b.fechaIngreso || '').getTime()
      return fechaB - fechaA
    })
    return list
  }, [productos, filtroEstado, filtroProv, q, focusProductIds])

  useEffect(() => {
    if (!navigation || navigation.target !== 'inventario') return
    if (navigation.filter) setFiltro(navigation.filter)
    if (navigation.ids?.length) {
      setFocusProductIds(navigation.ids)
      setQ('')
      setPage(1)
      return
    }
    setFocusProductIds(null)
    if (navigation.search != null) setQ(navigation.search)
  }, [navigation])

  const paginados = filtrados.slice(0, page * PER_PAGE)
  const hayMas    = filtrados.length > paginados.length

  const contadores = useMemo(() => ({
    stock:    productos.filter(p => p.enStock && !p.vendido && !p.devolucion).length,
    vendido:  productos.filter(p => p.vendido).length,
    devuelto: productos.filter(p => p.devolucion).length,
    incompletos: productos.filter(p => getProductoIssues(p).length > 0).length,
  }), [productos])

  const openNew = () => setModal({ _new: true, proveedorID: '', proveedorNombre: '', categoria: 'B', fechaIngreso: today(), precio: '', notas: '', foto: '' })
  const proveedoresOptions = useMemo(() =>
    proveedores.map(p => ({
      value: p.id,
      label: `${p.nombre} · ${p.id}`,
      searchText: `${p.nombre} ${p.id}`,
    }))
  , [proveedores])

  return (
    <div>
      <SectionHeader title="Inventario"
        action={<Button size="sm" onClick={openNew}>+ Nuevo</Button>}
      />

      <SearchBar value={q} onChange={v => { setQ(v); setPage(1) }} placeholder="Buscar descripción, ID, proveedor…" className="mb-3" />

      {/* Filtros estado */}
      <div className="flex gap-2 flex-wrap mb-3">
        <Chip label={`En stock (${contadores.stock})`}    active={filtroEstado === 'stock'}    onClick={() => { setFiltro('stock');    setPage(1); setFocusProductIds(null) }} />
        <Chip label={`Vendidos (${contadores.vendido})`}  active={filtroEstado === 'vendido'}  onClick={() => { setFiltro('vendido');  setPage(1); setFocusProductIds(null) }} />
        <Chip label={`Devueltos (${contadores.devuelto})`}active={filtroEstado === 'devuelto'} onClick={() => { setFiltro('devuelto'); setPage(1); setFocusProductIds(null) }} />
        <Chip label={`Incompletos (${contadores.incompletos})`} active={filtroEstado === 'incompletos'} onClick={() => { setFiltro('incompletos'); setPage(1); setFocusProductIds(null) }} />
        <Chip label="Todos"                               active={filtroEstado === 'todos'}    onClick={() => { setFiltro('todos');    setPage(1); setFocusProductIds(null) }} />
      </div>

      {focusProductIds?.length > 0 && (
        <div className="mb-3 bg-brand-50 border border-brand-200 rounded-xl px-3 py-2 flex items-center justify-between gap-3 text-xs text-brand-700">
          <span>Mostrando solo los productos seleccionados desde el Centro de reparación.</span>
          <button className="font-semibold" onClick={() => setFocusProductIds(null)}>Ver todos</button>
        </div>
      )}

      {/* Filtro proveedor */}
      <SearchableSelect
        className="mb-4"
        value={filtroProv}
        onChange={setFiltroProv}
        options={proveedoresOptions}
        emptyOptionLabel="Todos los proveedores"
        searchPlaceholder="Filtrar por proveedor (nombre o ID)"
      />

      <div className="text-xs text-text3 mb-3">Mostrando {paginados.length} de {filtrados.length}</div>

      {filtrados.length === 0 ? (
        <EmptyState icon="👗" title="Sin productos" subtitle="Agregá el primero con el botón + Nuevo" action={<Button size="sm" onClick={openNew}>+ Nuevo producto</Button>} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {paginados.map(p => (
            <ProductoCard key={p.id} producto={p} diasParada={config?.diasParada || 60} onClick={() => setModal(p)} />
          ))}
          {hayMas && (
            <button onClick={() => setPage(pg => pg + 1)} className="w-full py-3 text-sm text-brand-700 font-medium hover:bg-brand-50 rounded-xl transition-colors">
              Cargar más ({filtrados.length - paginados.length} restantes)
            </button>
          )}
        </div>
      )}

      {modal && (
        <ProductoModal
          producto={modal}
          categorias={categorias}
          proveedores={proveedores}
          onOpenVenta={(ventaId) => {
            setModal(null)
            setSection?.('ventas', { ids: [ventaId] })
          }}
          onSave={async (data) => {
            if (!data.id) await addProducto(data)
            else await updateProducto(data.id, data)
            setModal(null)
          }}
          onDelete={async (id) => {
            const ok = await deleteProducto(id)
            if (ok) setModal(null)
          }}
          onDevolver={async (id) => { await devolverProducto(id); setModal(null) }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

function ProductoCard({ producto: p, diasParada, onClick }) {
  const parado = p.enStock && !p.vendido && !p.devolucion && diffDays(p.fechaIngreso) >= diasParada
  const issues = getProductoIssues(p)
  return (
    <div onClick={onClick} className="card p-3 flex gap-3 cursor-pointer active:bg-gray-50 transition-colors">
      {p.foto
        ? <img src={p.foto} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
        : <div className="w-14 h-14 rounded-lg bg-cream flex items-center justify-center text-2xl flex-shrink-0">👗</div>
      }
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-start gap-2">
          <div className="text-sm font-semibold text-text1 leading-tight line-clamp-2">{p.notas || p.id}</div>
          <div className="text-sm font-bold text-brand-700 flex-shrink-0">{fmt$(p.precio)}</div>
        </div>
        <div className="text-xs text-text3 mt-1">{p.proveedorNombre || p.proveedorID} · {p.categoria} · {fmtDate(p.fechaIngreso)}</div>
        <div className="flex gap-2 mt-2 flex-wrap">
          {issues.length > 0 && <span className="bg-red-50 text-red-700 text-xs px-2 py-0.5 rounded-full">⚠️ Incompleto</span>}
          {p.vendido    && <span className="badge-vendido">Vendida</span>}
          {p.devolucion && <span className="badge-devuelto">Devuelta</span>}
          {!p.vendido && !p.devolucion && !parado && <span className="badge-stock">En stock</span>}
          {parado && <span className="bg-yellow-100 text-yellow-700 text-xs px-2 py-0.5 rounded-full">⚠️ {diffDays(p.fechaIngreso)}d parada</span>}
          <span className="text-xs text-text3 px-2 py-0.5 bg-gray-50 rounded-full">{p.id}</span>
        </div>
      </div>
    </div>
  )
}

function ProductoModal({ producto, categorias, proveedores, onSave, onDelete, onDevolver, onOpenVenta, onClose }) {
  const { ventas } = useApp()
  const isNew = !producto.id
  const [form, setForm] = useState({ ...producto })
  const [confirm, setConfirm] = useState(null)
  const [providerQuery, setProviderQuery] = useState('')
  const [providerOpen, setProviderOpen] = useState(false)
  const fileRef = useRef()

  const set = (k, v) => {
    setForm(f => {
      const upd = { ...f, [k]: v }
      if (k === 'categoria') {
        const cat = categorias.find(c => c.id === v)
        if (cat) upd.porcProveedor = cat.porcentaje
      }
      if (k === 'proveedorID') {
        const prov = proveedores.find(p => p.id === v)
        if (prov) upd.proveedorNombre = prov.nombre
      }
      return upd
    })
  }

  const handleFoto = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => set('foto', ev.target.result)
    reader.readAsDataURL(file)
  }

  const catSel    = categorias.find(c => c.id === form.categoria) || { porcentaje: 0.5 }
  const costo     = Math.round((form.precio || 0) * catSel.porcentaje)
  const ganancia  = (form.precio || 0) - costo
  const ventaAsociada = useMemo(() => {
    if (isNew) return null
    return ventas.find(v => v.IDProducto === form.id && !v.cancelada) || ventas.find(v => v.IDProducto === form.id) || null
  }, [isNew, ventas, form.id])
  // Solo se considera "bloqueante" si la venta asociada no está cancelada
  const ventaActivaAsociada = ventaAsociada && !ventaAsociada.cancelada
  const asociadoAVenta = !!ventaActivaAsociada
  const canDelete = !isNew && !form.vendido && !asociadoAVenta && (!!form.enStock || !!form.devolucion)
  const canReturn = !isNew && !!form.enStock && !form.vendido && !form.devolucion && !asociadoAVenta
  const issues = getProductoIssues(form)
  const canSave = hasText(form.notas) && isPositiveNumber(form.precio)
  const proveedorSeleccionado = proveedores.find(p => p.id === form.proveedorID) || null
  const proveedoresFiltrados = useMemo(() => {
    const q = providerQuery.trim().toLowerCase()
    if (!q) return proveedores
    return proveedores.filter((p) =>
      String(p.id || '').toLowerCase().includes(q) ||
      String(p.nombre || '').toLowerCase().includes(q)
    )
  }, [proveedores, providerQuery])

  useEffect(() => {
    if (!providerOpen) {
      setProviderQuery(proveedorSeleccionado ? `${proveedorSeleccionado.nombre} · ${proveedorSeleccionado.id}` : '')
    }
  }, [providerOpen, proveedorSeleccionado])

  const seleccionarProveedor = (p) => {
    set('proveedorID', p?.id || '')
    setProviderQuery(p ? `${p.nombre} · ${p.id}` : '')
    setProviderOpen(false)
  }

  return (
    <Modal
      title={isNew ? 'Nuevo producto' : form.id}
      onClose={onClose}
      footer={
        <>
          <Button size="md" className="flex-1"
            onClick={() => onSave(form)}
              disabled={!canSave}>
            {isNew ? 'Guardar' : 'Actualizar'}
          </Button>
        </>
      }
    >

            {!isNew && (
              <div className="bg-cream rounded-xl p-3 mb-4 border border-border">
                <div className="text-xs font-semibold text-text3 uppercase tracking-wide mb-2">Acciones sobre la prenda</div>
                <div className="flex gap-2 flex-wrap">
                  {canReturn && (
                    <Button variant="ghost" size="sm" onClick={() => setConfirm('devolver')}>🔄 Marcar como devuelta</Button>
                  )}
                  {canDelete && (
                    <Button variant="danger" size="sm" onClick={() => setConfirm('delete')}>Eliminar producto</Button>
                  )}
                </div>
                {!canReturn && !canDelete && (
                  <div className="text-xs text-text3">
                    {asociadoAVenta
                      ? 'No se puede devolver ni eliminar porque la prenda está asociada a una venta activa.'
                      : form.vendido
                      ? 'No se puede devolver ni eliminar porque la prenda ya fue vendida.'
                      : form.devolucion
                      ? 'La prenda ya fue marcada como devuelta.'
                      : !form.enStock
                      ? 'No se puede devolver ni eliminar porque la prenda no está en stock.'
                      : 'No hay acciones disponibles para esta prenda.'}
                  </div>
                )}

                {ventaAsociada && (
                  <div className="mt-3 bg-white rounded-xl border border-border p-3">
                    <div className="text-xs font-semibold text-text3 uppercase tracking-wide mb-2">Venta asociada</div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-text1">{ventaAsociada.IDVenta}</div>
                        <div className="text-xs text-text3">{fmtDate(ventaAsociada.FechaVenta)}{ventaAsociada.cancelada ? ' · Cancelada' : ''}</div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => onOpenVenta?.(ventaAsociada.IDVenta)}>
                        Ver venta
                      </Button>
                    </div>
                  </div>
                )}

                {confirm === 'delete' && (
                  <div className="mt-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                    <div className="text-sm font-semibold text-red-700 mb-2">¿Eliminar este producto?</div>
                    <div className="text-xs text-red-600 mb-3">Solo se puede eliminar porque no está asociado a ninguna venta y no fue vendido. Puede estar en stock o ya marcado como devuelto.</div>
                    <div className="flex gap-2">
                      <Button variant="danger" size="sm" className="flex-1" onClick={() => onDelete(form.id)}>Sí, eliminar</Button>
                      <Button variant="ghost" size="sm" className="flex-1" onClick={() => setConfirm(null)}>Cancelar</Button>
                    </div>
                  </div>
                )}

                {confirm === 'devolver' && (
                  <div className="mt-3 p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
                    <div className="text-sm font-semibold text-yellow-800 mb-2">¿Marcar como devuelto al proveedor?</div>
                    <div className="text-xs text-yellow-700 mb-3">Esta acción solo está disponible mientras la prenda siga en stock y sin ventas asociadas.</div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" className="flex-1 border-yellow-300 text-yellow-800" onClick={() => onDevolver(form.id)}>Sí, devolver</Button>
                      <Button variant="ghost" size="sm" className="flex-1" onClick={() => setConfirm(null)}>Cancelar</Button>
                    </div>
                  </div>
                )}
              </div>
            )}
        {issues.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
            <div className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2">Datos faltantes</div>
            <div className="space-y-1">
              {issues.map((issue, idx) => (
                <div key={idx} className="text-sm text-red-700">• {issue}</div>
              ))}
            </div>
          </div>
        )}

      {/* Foto */}
      <div className="flex flex-col items-center mb-4">
        <div onClick={() => fileRef.current.click()}
          className="w-24 h-24 rounded-xl bg-cream border-2 border-dashed border-border cursor-pointer flex items-center justify-center overflow-hidden">
          {form.foto ? <img src={form.foto} className="w-full h-full object-cover" alt="" /> : <span className="text-3xl">📷</span>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleFoto} className="hidden" />
        <div className="text-xs text-text3 mt-1">Tocá para agregar foto</div>
      </div>

      <Input label="Descripción *" value={form.notas} onChange={e => set('notas', e.target.value)} placeholder="Ej: Jeans Muaa Con roturas 26" />

      <Select label="Categoría" value={form.categoria} onChange={e => set('categoria', e.target.value)}>
        {categorias.map(c => <option key={c.id} value={c.id}>{c.id} — {c.nombre} ({(c.porcentaje * 100).toFixed(0)}%)</option>)}
      </Select>

      <div className="mb-4">
        <label className="block text-xs uppercase tracking-wide text-text3 mb-1">Proveedor</label>
        <Input
          value={providerQuery}
          onFocus={() => setProviderOpen(true)}
          onBlur={() => setTimeout(() => setProviderOpen(false), 120)}
          onChange={e => {
            setProviderQuery(e.target.value)
            setProviderOpen(true)
          }}
          placeholder="Buscar por nombre o ID"
        />

        {providerOpen && (
          <div className="mt-2 border border-border rounded-xl bg-white max-h-52 overflow-y-auto">
            <button
              type="button"
              onClick={() => seleccionarProveedor(null)}
              className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 hover:bg-cream ${!form.proveedorID ? 'bg-brand-50 text-brand-700 font-medium' : 'text-text2'}`}
            >
              — Sin asignar —
            </button>
            {proveedoresFiltrados.slice(0, 40).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => seleccionarProveedor(p)}
                className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 last:border-0 hover:bg-cream ${form.proveedorID === p.id ? 'bg-brand-50 text-brand-700 font-medium' : 'text-text2'}`}
              >
                {p.nombre} · {p.id}
              </button>
            ))}
            {proveedoresFiltrados.length === 0 && (
              <div className="px-3 py-2 text-xs text-text3">No se encontraron proveedores.</div>
            )}
          </div>
        )}
      </div>

      <Input label="Precio de venta ($) *" type="number" value={form.precio} onChange={e => set('precio', e.target.value === '' ? '' : Number(e.target.value))} placeholder="0" />

      {form.precio > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 mt-3">
          <div className="text-xs text-text3 mb-2">Desglose automático ({(catSel.porcentaje * 100).toFixed(0)}% proveedor)</div>
          <InfoRow label="Al proveedor:" value={fmt$(costo)} valueClass="text-red-700" />
          <InfoRow label="Ganancia negocio:" value={fmt$(ganancia)} valueClass="text-green-700" />
        </div>
      )}

      <Input label="Fecha de ingreso" type="date" value={form.fechaIngreso} onChange={e => set('fechaIngreso', e.target.value)} />
    </Modal>
  )
}
