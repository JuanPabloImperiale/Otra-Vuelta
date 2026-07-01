import { useState, useMemo, useEffect } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { useApp } from '../context/AppContext'
import { fmt$, monthLabel, monthsRange, today } from '../utils/formatters'
import { Button, SectionHeader, Modal } from '../components/ui'
import { exportarMesExcel } from '../utils/exporters'
import { exportarMesCSVReimportable } from '../utils/exporters'
import { parsearCSV } from '../utils/exporters'
import { doc, setDoc, writeBatch } from 'firebase/firestore'
import { db } from '../firebase'

export default function Configuracion() {
  const { categorias, saveCategorias, config, saveConfig, mediosPago, saveMediosPago,
          productos, ventas, cobros, pagos, proveedores, gastos, cuentasCorrientes, archivarMes, showToast } = useApp()
  const [nueva, setNueva]        = useState({ id: '', nombre: '', porcentaje: '' })
  const [nuevoMedio, setNuevoM]  = useState({ id: '', label: '', color: '#2563eb', esBNA: false, esCC: false })
  const [draftCategorias, setDraftCategorias] = useState(categorias)
  const [draftMediosPago, setDraftMediosPago] = useState(mediosPago)
  const [diasParada, setDias]    = useState(config?.diasParada || 60)
  const [mesArchivo, setMesArch] = useState('')
  const [pendingArchivoAction, setPendingArchivoAction] = useState(null)
  const [activeTab, setActiveTab] = useState('categorias')
  const [pendingDelete, setPendingDelete] = useState(null)

  const meses = useMemo(() => monthsRange(ventas, 'FechaVenta').slice(1), [ventas]) // excluir mes actual
  const tabs = [
    { id: 'categorias', label: 'Categorias' },
    { id: 'medios', label: 'Medios de pago' },
    { id: 'stock', label: 'Umbral stock' },
    { id: 'archivo', label: 'Archivo mensual' },
    { id: 'importar', label: 'Importar CSV' },
    { id: 'sesion', label: 'Sesion' },
  ]

  // ── Categorías ────────────────────────────────────────────────────────────
  useEffect(() => setDraftCategorias(categorias), [categorias])
  useEffect(() => setDraftMediosPago(mediosPago), [mediosPago])

  const agregarCat = () => {
    if (!nueva.id || !nueva.nombre || !nueva.porcentaje) return
    saveCategorias([...categorias, { id: nueva.id.toUpperCase(), nombre: nueva.nombre, porcentaje: Number(nueva.porcentaje) }])
    setNueva({ id: '', nombre: '', porcentaje: '' })
  }

  const eliminarCat = (id) => {
    if (categorias.length <= 1) return
    saveCategorias(categorias.filter(c => c.id !== id))
  }

  const eliminarMedio = (id) => {
    saveMediosPago(mediosPago.filter(x => x.id !== id))
  }

  const updateDraftCategoria = (id, patch) => {
    setDraftCategorias(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
  }

  const categoriaDirty = (id) => {
    const base = categorias.find(c => c.id === id)
    const draft = draftCategorias.find(c => c.id === id)
    if (!base || !draft) return false
    return draft.nombre !== base.nombre || Number(draft.porcentaje) !== Number(base.porcentaje)
  }

  const guardarCategoria = (id) => {
    const draft = draftCategorias.find(c => c.id === id)
    if (!draft) return
    saveCategorias(categorias.map(c => c.id === id
      ? { ...c, nombre: draft.nombre, porcentaje: Number(draft.porcentaje) }
      : c
    ))
  }

  const updateDraftMedio = (id, patch) => {
    setDraftMediosPago(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m))
  }

  const medioDirty = (id) => {
    const base = mediosPago.find(m => m.id === id)
    const draft = draftMediosPago.find(m => m.id === id)
    if (!base || !draft) return false
    return draft.label !== base.label || draft.color !== base.color
  }

  const guardarMedio = (id) => {
    const draft = draftMediosPago.find(m => m.id === id)
    if (!draft) return
    saveMediosPago(mediosPago.map(m => m.id === id
      ? { ...m, label: draft.label, color: draft.color }
      : m
    ))
  }

  // ── Archivo mensual ───────────────────────────────────────────────────────
  const exportarMes = () => {
    if (!mesArchivo) { showToast('Seleccioná un mes', 'error'); return }
    exportarMesExcel({ mes: mesArchivo, productos, ventas, cobros, pagos, proveedores, gastos, cuentasCorrientes })
    showToast('Excel descargado ✅')
  }

  const exportarMesCSV = () => {
    if (!mesArchivo) { showToast('Seleccioná un mes', 'error'); return }
    const result = exportarMesCSVReimportable({
      mes: mesArchivo,
      productos,
      ventas,
      cobros,
      pagos,
      proveedores,
      cuentasCorrientes,
      gastos,
      categorias,
    })
    if (!result.files) {
      showToast('No hay datos para exportar en CSV en ese mes', 'error')
      return
    }
    showToast(`CSV reimportable listo ✅ (${result.files} archivo/s)`)
  }

  const ejecutarArchivo = async () => {
    if (!mesArchivo) return
    await archivarMes(mesArchivo)
  }

  const ejecutarAccionArchivo = async () => {
    if (!pendingArchivoAction || !mesArchivo) return

    if (pendingArchivoAction === 'excel') {
      exportarMes()
    }
    if (pendingArchivoAction === 'csv') {
      exportarMesCSV()
    }
    if (pendingArchivoAction === 'archive') {
      await ejecutarArchivo()
    }

    setPendingArchivoAction(null)
  }

  // ── Importar CSV ──────────────────────────────────────────────────────────
  const [importando, setImportando] = useState(false)
  const [importProgress, setProgress] = useState('')
  const [importPreview, setImportPreview] = useState(null)
  const [importInputKey, setImportInputKey] = useState(0)

  const csvEscape = (value) => {
    const str = value == null ? '' : String(value)
    return `"${str.replace(/"/g, '""')}"`
  }

  const rowsToCSV = (rows) => {
    if (!rows.length) return ''
    const headers = Array.from(rows.reduce((set, row) => {
      Object.keys(row || {}).forEach(k => set.add(k))
      return set
    }, new Set()))
    const lines = rows.map(row => headers.map(h => csvEscape(row?.[h])).join(','))
    return [headers.join(','), ...lines].join('\n')
  }

  const downloadCSV = (filename, rows) => {
    if (!rows.length) return false
    const csv = rowsToCSV(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return true
  }

  const commitEnLotes = async (ops) => {
    const CHUNK = 400
    for (let i = 0; i < ops.length; i += CHUNK) {
      const chunk = ops.slice(i, i + CHUNK)
      const batch = writeBatch(db)
      chunk.forEach(({ colName, docId, data }) => {
        batch.set(doc(db, colName, String(docId)), data)
      })
      await batch.commit()
      setProgress(`Importando… ${Math.min(i + CHUNK, ops.length)} / ${ops.length}`)
    }
  }

  const inferImportSpec = (name) => {
    if (name.includes('proveedor')) return { colName: 'proveedores', idField: 'id' }
    if (name.includes('categoria')) return { colName: 'config', idField: null }
    if (name.includes('producto'))  return { colName: 'productos', idField: 'id' }
    if (name.includes('venta'))     return { colName: 'ventas', idField: null }
    if (name.includes('cobro'))     return { colName: 'cobros', idField: 'id' }
    if (name.includes('pago'))      return { colName: 'pagos', idField: null }
    if (name.includes('cuenta'))    return { colName: 'cuentasCorrientes', idField: 'id' }
    if (name.includes('gasto'))     return { colName: 'gastos', idField: 'id' }
    return null
  }

  const buildImportPreview = async (files) => {
    const parsedFiles = []
    let totalRows = 0

    for (const file of files) {
      const text = await file.text()
      const rows = parsearCSV(text)
      totalRows += rows.length
      const spec = inferImportSpec(file.name.toLowerCase())
      parsedFiles.push({
        fileName: file.name,
        rows,
        ...spec,
        skipped: !spec,
      })
    }

    const importedProvIds = new Set()
    const importedProdIds = new Set()
    const importedVentaIds = new Set()

    parsedFiles.forEach(f => {
      if (f.skipped) return
      f.rows.forEach(r => {
        if (f.colName === 'proveedores' && r.id) importedProvIds.add(String(r.id))
        if (f.colName === 'productos' && r.id) importedProdIds.add(String(r.id))
        if (f.colName === 'ventas' && r.IDVenta) importedVentaIds.add(String(r.IDVenta))
      })
    })

    const refProvIds = new Set([...proveedores.map(p => String(p.id)), ...importedProvIds])
    const refProdIds = new Set([...productos.map(p => String(p.id)), ...importedProdIds])
    const refVentaIds = new Set([...ventas.map(v => String(v.IDVenta)), ...importedVentaIds])

    const validOps = []
    const validCategorias = []
    const rejected = []
    const seenDocIds = new Set()

    const reject = (fileName, rowNumber, entity, reason, rowData = null) => {
      rejected.push({ fileName, rowNumber, entity, reason, rowData })
    }

    parsedFiles.forEach(file => {
      if (file.skipped) {
        reject(file.fileName, '-', 'archivo', 'Nombre de archivo no reconocido para importación')
        return
      }

      file.rows.forEach((row, i) => {
        const rowNumber = i + 2
        const errs = []

        if (file.colName === 'config') {
          if (!row.id) errs.push('Falta id de categoría')
          if (!row.nombre) errs.push('Falta nombre de categoría')
          const pct = Number(row.porcentaje)
          if (Number.isNaN(pct) || pct < 0 || pct > 1) errs.push('Porcentaje inválido (debe ser 0 a 1)')
          if (errs.length) {
            reject(file.fileName, rowNumber, 'categorias', errs.join(' · '), row)
          } else {
            validCategorias.push({ ...row, porcentaje: pct })
          }
          return
        }

        let docId = file.idField ? row[file.idField] : null
        if (file.colName === 'ventas') docId = `${row.IDVenta}_${row.IDProducto}`
        if (file.colName === 'pagos')  docId = `${row.id}_${row.idProducto}`

        if (!docId) errs.push('No se pudo construir el ID del registro')
        const uniqueKey = `${file.colName}:${docId}`
        if (docId && seenDocIds.has(uniqueKey)) errs.push('Registro duplicado en los archivos seleccionados')

        if (file.colName === 'proveedores') {
          if (!row.id) errs.push('Falta id')
          if (!row.nombre) errs.push('Falta nombre')
        }

        if (file.colName === 'productos') {
          if (!row.id) errs.push('Falta id')
          if (row.proveedorID && !refProvIds.has(String(row.proveedorID))) errs.push('Proveedor no existe')
        }

        if (file.colName === 'ventas') {
          if (!row.IDVenta) errs.push('Falta IDVenta')
          if (!row.IDProducto) errs.push('Falta IDProducto')
          if (row.IDProducto && !refProdIds.has(String(row.IDProducto))) errs.push('Producto no existe')
          if (row.PrecioVentaFinal === '' || row.PrecioVentaFinal === undefined || Number(row.PrecioVentaFinal) < 0) errs.push('PrecioVentaFinal inválido')
        }

        if (file.colName === 'cobros') {
          if (!row.id) errs.push('Falta id')
          if (!row.idVenta) errs.push('Falta idVenta')
          if (row.idVenta && !refVentaIds.has(String(row.idVenta))) errs.push('Venta no existe')
          if (!row.fecha) errs.push('Falta fecha')
          if (!(Number(row.monto) > 0)) errs.push('Monto inválido (debe ser mayor a 0)')
        }

        if (file.colName === 'pagos') {
          if (!row.id) errs.push('Falta id')
          if (!row.idVenta) errs.push('Falta idVenta')
          if (!row.idProducto) errs.push('Falta idProducto')
          if (row.idVenta && !refVentaIds.has(String(row.idVenta))) errs.push('Venta no existe')
          if (row.idProducto && !refProdIds.has(String(row.idProducto))) errs.push('Producto no existe')
          if (!(Number(row.monto) >= 0)) errs.push('Monto inválido')
        }

        if (file.colName === 'cuentasCorrientes') {
          if (!row.id) errs.push('Falta id')
          if (!row.cliente) errs.push('Falta cliente')
          if (row.idVenta && !refVentaIds.has(String(row.idVenta))) errs.push('Venta no existe')
          if (row.totalAdeudado === undefined || row.totalAdeudado === '' || Number(row.totalAdeudado) < 0) errs.push('totalAdeudado inválido')
        }

        if (file.colName === 'gastos') {
          if (!row.id) errs.push('Falta id')
          if (!row.descripcion) errs.push('Falta descripción')
          if (!row.fecha) errs.push('Falta fecha')
          if (!(Number(row.monto) >= 0)) errs.push('Monto inválido')
        }

        if (errs.length) {
          reject(file.fileName, rowNumber, file.colName, errs.join(' · '), row)
        } else {
          seenDocIds.add(uniqueKey)
          validOps.push({ colName: file.colName, docId, data: row })
        }
      })
    })

    const acceptedByType = validOps.reduce((acc, op) => {
      acc[op.colName] = (acc[op.colName] || 0) + 1
      return acc
    }, { categorias: validCategorias.length })

    return {
      files: parsedFiles.length,
      totalRows,
      validOps,
      validCategorias,
      rejected,
      acceptedByType,
    }
  }

  const confirmarImportacion = async () => {
    if (!importPreview) return
    setImportando(true)
    setProgress('Importando…')

    try {
      await commitEnLotes(importPreview.validOps)

      if (importPreview.validCategorias.length) {
        await setDoc(doc(db, 'config', 'settings'), { categorias: importPreview.validCategorias }, { merge: true })
      }

      const safeMax = (arr, fallback) => arr.length ? Math.max(...arr) : fallback
      const validByType = (name) => importPreview.validOps.filter(op => op.colName === name)

      const importedProd = validByType('productos').map(op => parseInt(String(op.docId).slice(1) || 0)).filter(n => !Number.isNaN(n))
      const importedVentas = validByType('ventas').map(op => parseInt(String(op.data.IDVenta || '').slice(1) || 0)).filter(n => !Number.isNaN(n))
      const importedCobros = validByType('cobros').map(op => parseInt(String(op.docId).slice(1) || 0)).filter(n => !Number.isNaN(n))
      const importedPagos = validByType('pagos').map(op => parseInt(String(op.data.id || '').slice(2) || 0)).filter(n => !Number.isNaN(n))
      const importedProv = validByType('proveedores').map(op => parseInt(String(op.docId).slice(2) || 0)).filter(n => !Number.isNaN(n))
      const importedCC = validByType('cuentasCorrientes').map(op => parseInt(String(op.docId).slice(2) || 0)).filter(n => !Number.isNaN(n))
      const importedGastos = validByType('gastos').map(op => parseInt(String(op.docId).slice(1) || 0)).filter(n => !Number.isNaN(n))

      await setDoc(doc(db, 'meta', 'counters'), {
        lastIDProducto:  safeMax([...productos.map(p => parseInt(p.id?.slice(1)  || 0)), ...importedProd], 2824),
        lastIDVenta:     safeMax([...ventas.map(v    => parseInt(v.IDVenta?.slice(1) || 0)), ...importedVentas], 348),
        lastIDCobro:     safeMax([...cobros.map(c    => parseInt(c.id?.slice(1)  || 0)), ...importedCobros], 396),
        lastIDPago:      safeMax([...pagos.map(p     => parseInt(p.id?.slice(2)  || 0)), ...importedPagos], 701),
        lastIDProveedor: safeMax([...proveedores.map(p => parseInt(p.id?.slice(2) || 0)), ...importedProv], 237),
        lastIDCC:        safeMax([...cuentasCorrientes.map(c => parseInt(c.id?.slice(2) || 0)), ...importedCC], 7),
        lastIDGasto:     safeMax([...gastos.map(g => parseInt(g.id?.slice(1) || 0)), ...importedGastos], 0),
      }, { merge: true })

      showToast(`✅ Importados ${importPreview.validOps.length + importPreview.validCategorias.length} registros. Rechazados: ${importPreview.rejected.length}`)
      setImportPreview(null)
    } catch (err) {
      showToast(`Error al importar: ${err.message}`, 'error')
    } finally {
      setImportando(false)
      setProgress('')
      setImportInputKey(k => k + 1)
    }
  }

  const cancelarImportacion = () => {
    setImportPreview(null)
    setImportInputKey(k => k + 1)
  }

  const descargarDiagnosticoRechazados = () => {
    if (!importPreview?.rejected?.length) {
      showToast('No hay registros rechazados para descargar', 'error')
      return
    }

    const rows = importPreview.rejected.map((r, idx) => ({
      item: idx + 1,
      archivo: r.fileName,
      fila: r.rowNumber,
      modulo: r.entity,
      motivo: r.reason,
    }))

    const dateTag = today().replace(/[^0-9]/g, '')
    const ok = downloadCSV(`diagnostico_importacion_${dateTag}.csv`, rows)
    if (ok) showToast('Diagnóstico de rechazados descargado ✅')
  }

  const descargarCSVParaCorregir = () => {
    if (!importPreview?.rejected?.length) {
      showToast('No hay registros rechazados para corregir', 'error')
      return
    }

    const byFile = new Map()
    importPreview.rejected.forEach(r => {
      if (!r.rowData || !r.fileName || r.rowNumber === '-') return
      if (!byFile.has(r.fileName)) byFile.set(r.fileName, [])
      byFile.get(r.fileName).push(r)
    })

    if (!byFile.size) {
      showToast('No hay filas rechazadas corregibles en CSV', 'error')
      return
    }

    let files = 0
    byFile.forEach((rows, fileName) => {
      const cleanRows = rows.map(r => ({ ...r.rowData }))
      const safeName = String(fileName).replace(/\s+/g, '_')
      const ok = downloadCSV(`reparar_${safeName}`, cleanRows)
      if (ok) files += 1
    })

    showToast(`Descargados ${files} CSV para corrección ✅`)
  }

  const descargarCSVValidos = () => {
    if (!importPreview) {
      showToast('No hay una prevalidación activa', 'error')
      return
    }

    const dateTag = today().replace(/[^0-9]/g, '')
    let files = 0

    const validosPorModulo = importPreview.validOps.reduce((acc, op) => {
      if (!acc[op.colName]) acc[op.colName] = []
      acc[op.colName].push(op.data)
      return acc
    }, {})

    Object.entries(validosPorModulo).forEach(([modulo, rows]) => {
      const ok = downloadCSV(`validos_${modulo}_${dateTag}.csv`, rows)
      if (ok) files += 1
    })

    if (importPreview.validCategorias.length) {
      const ok = downloadCSV(`validos_categorias_${dateTag}.csv`, importPreview.validCategorias)
      if (ok) files += 1
    }

    if (!files) {
      showToast('No hay registros válidos para descargar', 'error')
      return
    }

    showToast(`Descargados ${files} CSV con registros válidos ✅`)
  }

  const importarCSV = async (e) => {
    const files = Array.from(e.target.files)
    if (!files.length) return

    try {
      const preview = await buildImportPreview(files)
      setImportPreview(preview)
      showToast(`Prevalidación lista: ${preview.validOps.length + preview.validCategorias.length} válidos, ${preview.rejected.length} rechazados`)
    } catch (err) {
      showToast(`Error al importar: ${err.message}`, 'error')
    } finally {
      e.target.value = ''
    }
  }

  return (
    <div>
      <SectionHeader title="Configuración" />

      {/* Tabs modulares */}
      <div className="mb-4 -mx-1 px-1 overflow-x-auto scrollbar-hide">
        <div className="flex gap-2 min-w-max">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors whitespace-nowrap ${activeTab === t.id ? 'bg-brand-700 text-white' : 'bg-cream border border-border text-text2'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Categorías */}
      {activeTab === 'categorias' && <div className="card p-4 mb-4">
        <div className="text-sm font-semibold text-text2 uppercase tracking-wide mb-3">Categorías</div>
        <div className="text-xs text-text3 mb-3">Definen el % que le corresponde al proveedor por cada prenda.</div>
        <div className="space-y-2 mb-4">
          {draftCategorias.map(c => (
            <div key={c.id} className="flex items-center gap-2 bg-cream rounded-xl px-3 py-2">
              <span className="font-bold text-brand-700 w-8">{c.id}</span>
              <div className="flex-1 min-w-0">
                <input
                  value={c.nombre}
                  onChange={e => updateDraftCategoria(c.id, { nombre: e.target.value })}
                  className="text-sm text-text1 bg-transparent w-full focus:outline-none focus:bg-white focus:px-1 rounded"
                />
              </div>
              <input
                type="number" step="0.05" min="0" max="1"
                value={c.porcentaje}
                onChange={e => updateDraftCategoria(c.id, { porcentaje: e.target.value })}
                className="w-16 input-base text-right text-sm px-2 py-1"
              />
              <span className="text-xs text-text3">%: {(c.porcentaje * 100).toFixed(0)}</span>
              {categoriaDirty(c.id) && (
                <button
                  onClick={() => guardarCategoria(c.id)}
                  className="w-8 h-8 rounded-full bg-green-100 border border-green-300 text-green-800 hover:bg-green-200 font-bold text-sm flex items-center justify-center flex-shrink-0"
                  title="Confirmar cambios"
                >
                  ✓
                </button>
              )}
              {categorias.length > 1 && (
                <button
                  onClick={() => setPendingDelete({ type: 'categoria', id: c.id, label: c.nombre || c.id })}
                  className="text-red-400 hover:text-red-600 text-lg"
                  title="Eliminar categoría"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="border-t border-border pt-3">
          <div className="text-xs text-text3 mb-2">Agregar categoría</div>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <input value={nueva.id} onChange={e => setNueva(f => ({ ...f, id: e.target.value.toUpperCase() }))} placeholder="ID" className="input-base text-sm" maxLength={4} />
            <input value={nueva.nombre} onChange={e => setNueva(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre" className="input-base text-sm col-span-1" />
            <input type="number" step="0.05" min="0" max="1" value={nueva.porcentaje} onChange={e => setNueva(f => ({ ...f, porcentaje: e.target.value }))} placeholder="0.50" className="input-base text-sm" />
          </div>
          <Button variant="ghost" size="sm" onClick={agregarCat} className="w-full">+ Agregar categoría</Button>
        </div>
      </div>}

      {/* Medios de pago */}
      {activeTab === 'medios' && <div className="card p-4 mb-4">
        <div className="text-sm font-semibold text-text2 uppercase tracking-wide mb-1">Medios de pago</div>
        <div className="text-xs text-text3 mb-3">Definí los medios disponibles para cobros. BNA y CC tienen comportamiento especial.</div>

        <div className="space-y-2 mb-4">
          {draftMediosPago.map((m) => (
            <div key={m.id} className="flex items-center gap-2 bg-cream rounded-xl px-3 py-2">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: m.color }} />
              <div className="flex-1 min-w-0">
                <input
                  value={m.label}
                  onChange={e => updateDraftMedio(m.id, { label: e.target.value })}
                  className="text-sm font-medium text-text1 bg-transparent w-full focus:outline-none focus:bg-white focus:px-1 rounded"
                />
              </div>
              <span className="text-xs text-text3 bg-white border border-border px-2 py-0.5 rounded-full flex-shrink-0">{m.id}</span>
              {m.esBNA && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full flex-shrink-0">BNA</span>}
              {m.esCC  && <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full flex-shrink-0">CC</span>}
              <input type="color" value={m.color}
                onChange={e => updateDraftMedio(m.id, { color: e.target.value })}
                className="w-7 h-7 rounded cursor-pointer border-0 p-0 flex-shrink-0"
                title="Color del medio"
              />
              {medioDirty(m.id) && (
                <button
                  onClick={() => guardarMedio(m.id)}
                  className="w-8 h-8 rounded-full bg-green-100 border border-green-300 text-green-800 hover:bg-green-200 font-bold text-sm flex items-center justify-center flex-shrink-0"
                  title="Confirmar cambios"
                >
                  ✓
                </button>
              )}
              {!m.esCC && !m.esBNA && (
                <button
                  onClick={() => setPendingDelete({ type: 'medio', id: m.id, label: m.label || m.id })}
                  className="text-red-400 hover:text-red-600 flex-shrink-0 text-lg"
                  title="Eliminar medio de pago"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Agregar nuevo medio */}
        <div className="border-t border-border pt-3">
          <div className="text-xs text-text3 mb-2">Agregar nuevo medio</div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input value={nuevoMedio.id} onChange={e => setNuevoM(f => ({ ...f, id: e.target.value.toUpperCase().replace(/\s/g,'') }))}
              placeholder="ID (ej: MPJ)" className="input-base text-sm" maxLength={6} />
            <input value={nuevoMedio.label} onChange={e => setNuevoM(f => ({ ...f, label: e.target.value }))}
              placeholder="Nombre (ej: Mercado Pago Juan)" className="input-base text-sm" />
          </div>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center gap-1.5">
              <input type="color" value={nuevoMedio.color} onChange={e => setNuevoM(f => ({ ...f, color: e.target.value }))}
                className="w-8 h-8 rounded cursor-pointer border border-border" />
              <span className="text-xs text-text3">Color</span>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-text2 cursor-pointer">
              <input type="checkbox" checked={nuevoMedio.esBNA} onChange={e => setNuevoM(f => ({ ...f, esBNA: e.target.checked, esCC: false }))}
                className="w-3.5 h-3.5 accent-brand-700" />
              Acreditación diferida (BNA)
            </label>
          </div>
          <Button variant="ghost" size="sm" className="w-full"
            disabled={!nuevoMedio.id || !nuevoMedio.label}
            onClick={() => {
              if (!nuevoMedio.id || !nuevoMedio.label) return
              if (mediosPago.find(m => m.id === nuevoMedio.id)) { showToast('Ya existe un medio con ese ID', 'error'); return }
              saveMediosPago([...mediosPago, nuevoMedio])
              setNuevoM({ id: '', label: '', color: '#2563eb', esBNA: false, esCC: false })
            }}>
            + Agregar medio de pago
          </Button>
        </div>
      </div>}

      {/* Umbral prendas paradas */}
      {activeTab === 'stock' && <div className="card p-4 mb-4">
        <div className="text-sm font-semibold text-text2 uppercase tracking-wide mb-3">Umbral "prenda parada"</div>
        <div className="text-xs text-text3 mb-3">Días desde el ingreso para alertar en el dashboard.</div>
        <div className="flex items-center gap-3">
          <input type="number" min="7" max="365" value={diasParada} onChange={e => setDias(Number(e.target.value))} className="input-base w-24 text-center" />
          <span className="text-sm text-text2">días</span>
          <Button size="sm" onClick={() => saveConfig({ ...config, diasParada })}>Guardar</Button>
        </div>
      </div>}

      {/* Archivo mensual */}
      {activeTab === 'archivo' && <div className="card p-4 mb-4">
        <div className="text-sm font-semibold text-text2 uppercase tracking-wide mb-1">Archivo mensual</div>
        <div className="text-xs text-text3 mb-3">Exportá en Excel (backup legible) o CSV reimportable antes de limpiar registros.</div>
        <div className="bg-cream border border-border rounded-xl p-3 mb-3 space-y-1.5">
          <div className="text-xs text-text2"><span className="font-semibold">⬇️ Exportar Excel:</span> genera un backup legible para control humano.</div>
          <div className="text-xs text-text2"><span className="font-semibold">📦 Exportar CSV (reimportable):</span> genera archivos para volver a importar si necesitás restaurar datos.</div>
          <div className="text-xs text-text2"><span className="font-semibold">🗑️ Archivar y limpiar:</span> mueve datos cerrados del mes al archivo y los quita de la operación diaria.</div>
        </div>
        <select value={mesArchivo} onChange={e => setMesArch(e.target.value)} className="input-base mb-3 text-sm">
          <option value="">— Seleccioná un mes —</option>
          {meses.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setPendingArchivoAction('excel')} disabled={!mesArchivo}>
            ⬇️ Exportar Excel
          </Button>
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setPendingArchivoAction('csv')} disabled={!mesArchivo}>
            📦 Exportar CSV (reimportable)
          </Button>
          <Button variant="danger" size="sm" className="w-full" onClick={() => setPendingArchivoAction('archive')} disabled={!mesArchivo}>
            🗑️ Archivar y limpiar
          </Button>
        </div>
      </div>}

      {/* Importar CSV */}
      {activeTab === 'importar' && <div className="card p-4 mb-4">
        <div className="text-sm font-semibold text-text2 uppercase tracking-wide mb-1">Importar datos (CSV)</div>
        <div className="text-xs text-text3 mb-3">Cargá los archivos seed_*.csv. Primero se valida todo y luego confirmás si querés procesar la importación.</div>
        {importando ? (
          <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 text-center">
            <div className="w-8 h-8 border-[3px] border-brand-100 border-t-brand-700 rounded-full animate-spin mx-auto mb-2" />
            <div className="text-sm font-medium text-brand-700">{importProgress || 'Preparando importación…'}</div>
            <div className="text-xs text-text3 mt-1">No cerrés esta pantalla</div>
          </div>
        ) : (
          <label className="btn-primary block text-center cursor-pointer text-sm py-3 rounded-xl font-semibold">
            📂 Seleccionar archivos CSV
            <input key={importInputKey} type="file" accept=".csv" multiple onChange={importarCSV} className="hidden" />
          </label>
        )}
      </div>}

      {/* Cerrar sesión */}
      {activeTab === 'sesion' && <div className="card border-red-200 p-4">
        <div className="text-sm font-semibold text-red-700 mb-3">Sesión</div>
        <Button variant="danger" size="md" className="w-full" onClick={() => signOut(auth)}>
          Cerrar sesión
        </Button>
      </div>}

      {pendingDelete && (
        <Modal
          title={pendingDelete.type === 'categoria' ? 'Eliminar categoría' : 'Eliminar medio de pago'}
          onClose={() => setPendingDelete(null)}
          footer={
            <>
              <Button variant="ghost" size="md" className="flex-1" onClick={() => setPendingDelete(null)}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                size="md"
                className="flex-1"
                onClick={() => {
                  if (pendingDelete.type === 'categoria') eliminarCat(pendingDelete.id)
                  if (pendingDelete.type === 'medio') eliminarMedio(pendingDelete.id)
                  setPendingDelete(null)
                }}
              >
                Sí, eliminar
              </Button>
            </>
          }
        >
          <div className="text-sm text-text2">
            ¿Seguro que querés eliminar <span className="font-semibold text-text1">{pendingDelete.label}</span>? Esta acción no se puede deshacer.
          </div>
        </Modal>
      )}

      {pendingArchivoAction && (
        <Modal
          title="Confirmar acción"
          onClose={() => setPendingArchivoAction(null)}
          footer={
            <>
              <Button variant="ghost" size="md" className="flex-1" onClick={() => setPendingArchivoAction(null)}>
                Cancelar
              </Button>
              <Button
                variant={pendingArchivoAction === 'archive' ? 'danger' : 'primary'}
                size="md"
                className="flex-1"
                onClick={ejecutarAccionArchivo}
              >
                Confirmar
              </Button>
            </>
          }
        >
          {pendingArchivoAction === 'excel' && (
            <div className="text-sm text-text2">
              Se va a exportar un backup en Excel del mes <span className="font-semibold text-text1">{monthLabel(mesArchivo)}</span>. ¿Querés continuar?
            </div>
          )}
          {pendingArchivoAction === 'csv' && (
            <div className="text-sm text-text2">
              Se van a exportar CSVs reimportables del mes <span className="font-semibold text-text1">{monthLabel(mesArchivo)}</span>. ¿Querés continuar?
            </div>
          )}
          {pendingArchivoAction === 'archive' && (
            <div className="text-sm text-text2">
              Se archivarán y limpiarán ventas cerradas, cobros y pagos del mes <span className="font-semibold text-text1">{monthLabel(mesArchivo)}</span>. Asegurate de exportar antes. ¿Querés continuar?
            </div>
          )}
        </Modal>
      )}

      {importPreview && (
        <Modal
          title="Revisión de importación CSV"
          onClose={cancelarImportacion}
          footer={
            <>
              <Button variant="ghost" size="md" className="flex-1" onClick={cancelarImportacion}>
                Cancelar
              </Button>
              <Button
                size="md"
                className="flex-1"
                disabled={(importPreview.validOps.length + importPreview.validCategorias.length) === 0}
                onClick={confirmarImportacion}
              >
                Confirmar importación
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-green-50 border border-green-200 rounded-lg p-2">
                <div className="text-xs text-green-700">Válidos</div>
                <div className="text-lg font-bold text-green-700">{importPreview.validOps.length + importPreview.validCategorias.length}</div>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-2">
                <div className="text-xs text-red-700">Rechazados</div>
                <div className="text-lg font-bold text-red-700">{importPreview.rejected.length}</div>
              </div>
              <div className="bg-brand-50 border border-brand-200 rounded-lg p-2">
                <div className="text-xs text-brand-700">Filas leídas</div>
                <div className="text-lg font-bold text-brand-700">{importPreview.totalRows}</div>
              </div>
            </div>

            <div className="bg-cream border border-border rounded-lg p-3">
              <div className="text-xs font-semibold text-text2 uppercase tracking-wide mb-2">Válidos por módulo</div>
              <div className="grid grid-cols-2 gap-y-1 text-xs text-text2">
                {Object.entries(importPreview.acceptedByType).map(([k, v]) => (
                  <div key={k} className="flex justify-between pr-3">
                    <span>{k}</span>
                    <span className="font-semibold">{v}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  disabled={(importPreview.validOps.length + importPreview.validCategorias.length) === 0}
                  onClick={descargarCSVValidos}
                >
                  Descargar CSV de válidos
                </Button>
              </div>
            </div>

            {importPreview.rejected.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <div className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2">Registros rechazados (muestra)</div>
                <div className="max-h-40 overflow-auto space-y-1">
                  {importPreview.rejected.slice(0, 20).map((r, i) => (
                    <div key={i} className="text-xs text-red-700">
                      {r.fileName} · fila {r.rowNumber} · {r.entity}: {r.reason}
                    </div>
                  ))}
                </div>
                {importPreview.rejected.length > 20 && (
                  <div className="text-[11px] text-red-600 mt-2">+{importPreview.rejected.length - 20} rechazados más</div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                  <Button variant="ghost" size="sm" onClick={descargarDiagnosticoRechazados}>
                    Descargar diagnóstico de errores
                  </Button>
                  <Button variant="ghost" size="sm" onClick={descargarCSVParaCorregir}>
                    Descargar CSV para corregir
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
