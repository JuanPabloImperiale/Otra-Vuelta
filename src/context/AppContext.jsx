import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc,
  writeBatch, getDoc, increment, serverTimestamp, deleteField,
} from 'firebase/firestore'
import { db } from '../firebase'
import { CAT_DEFAULTS, META_DEFAULTS, CONFIG_DEFAULTS, MEDIOS_PAGO_DEFAULTS } from '../constants'
import { today, fmt$ } from '../utils/formatters'
import { calcAcreditadoPorVenta, calcTotalPorVenta } from '../utils/calculos'
import { getProductoIssues, hasText, isPositiveNumber, toFiniteNumber, withoutTransientFields } from '../utils/dataQuality'
import {
  canAddCobroToCuentaCorriente,
  canAddCobroToVenta,
  canCancelVenta,
  getActiveVentaItems,
  hasActiveVentaForProducto,
  hasProviderPaymentForVenta as hasProviderPaymentForVentaRule,
} from '../utils/businessRules'

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)
const EPSILON = 0.0001

const SECTION_COLLECTIONS = {
  dashboard: ['productos', 'ventas', 'cobros', 'pagos', 'gastos', 'cuentasCorrientes'],
  inventario: ['productos', 'proveedores', 'ventas'],
  ventas: ['ventas', 'cobros', 'pagos', 'productos'],
  cobros: ['ventas', 'cobros', 'pagos'],
  proveedores: ['proveedores', 'productos', 'ventas', 'cobros', 'pagos', 'cuentasCorrientes'],
  pagos: ['ventas', 'cobros', 'pagos', 'proveedores', 'cuentasCorrientes'],
  gastos: ['gastos', 'ventas', 'cobros', 'pagos', 'cuentasCorrientes'],
  cuentas: ['cuentasCorrientes', 'ventas', 'cobros'],
  config: [],
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const col = (name) => collection(db, name)
const ref = (name, id) => doc(db, name, id)

async function nextID(field, prefix) {
  const metaRef = ref('meta', 'counters')
  await updateDoc(metaRef, { [field]: increment(1) })
  const snap = await getDoc(metaRef)
  return `${prefix}${snap.data()[field]}`
}

async function ensureCounterAtLeast(field, value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return
  const metaRef = ref('meta', 'counters')
  const snap = await getDoc(metaRef)
  const current = Number(snap.data()?.[field]) || 0
  if (parsed > current) {
    await setDoc(metaRef, { [field]: parsed }, { merge: true })
  }
}

const normalizeClienteName = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
const uniqueVentaIds = (...groups) => [...new Set(groups.flat().filter(Boolean))]

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    if (['true', '1', 'si', 'sí', 'yes'].includes(v)) return true
    if (['false', '0', 'no', ''].includes(v)) return false
  }
  return fallback
}

function normalizeProductoStatus(producto = {}) {
  const vendido = normalizeBoolean(producto.vendido, false)
  const devolucionRaw = normalizeBoolean(producto.devolucion, false)
  const devolucion = vendido ? false : devolucionRaw
  const enStockRaw = normalizeBoolean(producto.enStock, !vendido && !devolucion)
  const enStock = (vendido || devolucion) ? false : enStockRaw
  return { vendido, devolucion, enStock }
}

function nextMonthSameDay(dateISO) {
  const base = new Date(`${dateISO}T00:00:00`)
  if (Number.isNaN(base.getTime())) return ''
  const targetYear = base.getFullYear()
  const targetMonth = base.getMonth() + 1
  const originalDay = base.getDate()
  const lastDayTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate()
  const safeDay = Math.min(originalDay, lastDayTargetMonth)
  const out = new Date(targetYear, targetMonth, safeDay)
  return out.toISOString().split('T')[0]
}

// ── Provider ─────────────────────────────────────────────────────────────────
export function AppProvider({ children }) {
  const [productos,         setProductos]         = useState([])
  const [ventas,            setVentas]            = useState([])
  const [cobros,            setCobros]            = useState([])
  const [pagos,             setPagos]             = useState([])
  const [proveedores,       setProveedores]       = useState([])
  const [gastos,            setGastos]            = useState([])
  const [categorias,        setCategorias]        = useState(CAT_DEFAULTS)
  const [cuentasCorrientes, setCuentasCorrientes] = useState([])
  const [config,            setConfig]            = useState(CONFIG_DEFAULTS)
  const [mediosPago,        setMediosPago]        = useState(MEDIOS_PAGO_DEFAULTS)
  const [loading,           setLoading]           = useState(true)
  const [working,           setWorking]           = useState(false) // overlay async
  const [toast,             setToast]             = useState(null)
  const [activeSection,     setActiveSection]     = useState('dashboard')
  const [isVisible,         setIsVisible]         = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'
  )
  const [configReady,       setConfigReady]       = useState(false)
  const [sectionReady,      setSectionReady]      = useState(false)
  const [bootstrapped,      setBootstrapped]      = useState(false)
  const statusRepairInFlight = useRef(new Set())

  // ── Control de visibilidad (pausa listeners en segundo plano) ───────────
  useEffect(() => {
    const onVisibilityChange = () => setIsVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  // ── Listener fijo de configuración ───────────────────────────────────────
  useEffect(() => {
    let markedReady = false
    const markReady = () => {
      if (!markedReady) {
        markedReady = true
        setConfigReady(true)
      }
    }

    const unsub = onSnapshot(ref('config', 'settings'), snap => {
      if (snap.exists()) {
        const d = snap.data()
        if (d.config)      setConfig(d.config)
        if (d.categorias)  setCategorias(d.categorias)
        if (d.mediosPago)  setMediosPago(d.mediosPago)
      }
      markReady()
    }, () => markReady())

    return () => unsub()
  }, [])

  // ── Listeners por sección activa ─────────────────────────────────────────
  useEffect(() => {
    if (!isVisible) {
      setSectionReady(true)
      return undefined
    }

    const collectionsToWatch = SECTION_COLLECTIONS[activeSection] || []
    if (!collectionsToWatch.length) {
      setSectionReady(true)
      return undefined
    }

    setSectionReady(false)
    const readySet = new Set()
    const markCollectionReady = (colName) => {
      if (readySet.has(colName)) return
      readySet.add(colName)
      if (readySet.size >= collectionsToWatch.length) setSectionReady(true)
    }

    const setByCollection = {
      productos: setProductos,
      ventas: setVentas,
      cobros: setCobros,
      pagos: setPagos,
      proveedores: setProveedores,
      gastos: setGastos,
      cuentasCorrientes: setCuentasCorrientes,
    }

    const unsubs = collectionsToWatch
      .map((colName) => {
        const setter = setByCollection[colName]
        if (!setter) {
          markCollectionReady(colName)
          return null
        }
        return onSnapshot(col(colName), snap => {
          const rows = snap.docs.map(d => ({ ...d.data(), _docId: d.id }))
          if (colName === 'productos') {
            setter(rows.map((p) => ({ ...p, ...normalizeProductoStatus(p) })))
          } else {
            setter(rows)
          }
          markCollectionReady(colName)
        }, () => markCollectionReady(colName))
      })
      .filter(Boolean)

    return () => unsubs.forEach(u => u())
  }, [activeSection, isVisible])

  // ── Loading inicial ──────────────────────────────────────────────────────
  useEffect(() => {
    const ready = configReady && sectionReady
    if (ready && !bootstrapped) {
      setBootstrapped(true)
      setLoading(false)
      return
    }
    if (!bootstrapped) setLoading(!ready)
  }, [configReady, sectionReady, bootstrapped])

  const changeActiveSection = useCallback((sectionId) => {
    setActiveSection(sectionId || 'dashboard')
  }, [])

  // ── Toast helper ─────────────────────────────────────────────────────────
  const showToast = useCallback((msg, type = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  // Auto-repara estados inconsistentes o mal tipados de productos.
  // En caso de conflicto prevalece vendido.
  useEffect(() => {
    const inconsistentes = productos.filter((p) => {
      if (!p?.id || statusRepairInFlight.current.has(p.id)) return false
      const normalized = normalizeProductoStatus(p)
      return (
        typeof p.vendido !== 'boolean' ||
        typeof p.devolucion !== 'boolean' ||
        typeof p.enStock !== 'boolean' ||
        p.vendido !== normalized.vendido ||
        p.devolucion !== normalized.devolucion ||
        p.enStock !== normalized.enStock
      )
    })
    if (!inconsistentes.length) return

    inconsistentes.forEach((p) => {
      statusRepairInFlight.current.add(p.id)
      const normalized = normalizeProductoStatus(p)
      updateDoc(ref('productos', p.id), normalized)
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error('No se pudo reconciliar estado de producto:', p.id, err)
        })
        .finally(() => {
          statusRepairInFlight.current.delete(p.id)
        })
    })
  }, [productos])

  // Si existe una venta activa para una prenda, el estado de producto debe ser vendido.
  useEffect(() => {
    if (!productos.length || !ventas.length) return

    const ventaActivaPorProducto = {}
    ventas.forEach((v) => {
      if (!v?.IDProducto || v?.cancelada) return
      if (!ventaActivaPorProducto[v.IDProducto]) ventaActivaPorProducto[v.IDProducto] = v
    })

    const inconsistentes = productos.filter((p) => {
      if (!p?.id || statusRepairInFlight.current.has(p.id)) return false
      const venta = ventaActivaPorProducto[p.id]
      if (!venta) return false
      return (
        p.vendido !== true ||
        p.devolucion !== false ||
        p.enStock !== false ||
        (venta.IDVenta && p.IDVenta !== venta.IDVenta) ||
        (venta.FechaVenta && p.FechaVenta !== venta.FechaVenta)
      )
    })

    inconsistentes.forEach((p) => {
      const venta = ventaActivaPorProducto[p.id]
      if (!venta) return
      statusRepairInFlight.current.add(p.id)
      updateDoc(ref('productos', p.id), {
        vendido: true,
        devolucion: false,
        enStock: false,
        IDVenta: venta.IDVenta || p.IDVenta || '',
        FechaVenta: venta.FechaVenta || p.FechaVenta || '',
      })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error('No se pudo sincronizar producto con venta activa:', p.id, err)
        })
        .finally(() => {
          statusRepairInFlight.current.delete(p.id)
        })
    })
  }, [productos, ventas])

  // Report unexpected runtime errors without dropping the current screen.
  useEffect(() => {
    const onError = () => showToast('Ocurrió un error inesperado. Revisá la última acción.', 'error')
    const onRejection = () => showToast('Se produjo un error de proceso. Intentá nuevamente.', 'error')
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [showToast])

  // ── Wrapper async con loading overlay ────────────────────────────────────
  const run = useCallback(async (fn) => {
    setWorking(true)
    try { return await fn() }
    catch (err) {
      const message = err?.message || 'Error inesperado'
      showToast(message, 'error')
      // eslint-disable-next-line no-console
      console.error('App action failed:', err)
      return null
    }
    finally { setWorking(false) }
  }, [showToast])

  const hasProviderPaymentForVenta = useCallback((idVenta) =>
    hasProviderPaymentForVentaRule(ventas, pagos, idVenta)
  , [ventas, pagos])

  const getCCSnapshot = useCallback((ccId, cobrosSource = cobros, excludeCobroId = null) => {
    const cc = cuentasCorrientes.find(x => x.id === ccId)
    if (!cc) return null
    const pagosCC = cobrosSource.filter(c => c.idCuentaCorriente === ccId && (!excludeCobroId || c.id !== excludeCobroId))
    const totalPagado = pagosCC.reduce((s, c) => s + toFiniteNumber(c.monto, 0), 0)
    const totalAdeudado = toFiniteNumber(cc.totalAdeudado, 0)
    const rawSaldo = totalAdeudado - totalPagado
    return {
      cc,
      totalAdeudado,
      totalPagado,
      rawSaldo,
      saldo: Math.max(rawSaldo, 0),
    }
  }, [cuentasCorrientes, cobros])

  const ensureProductoValido = useCallback((data, base = {}) => {
    const payload = { ...base, ...data }
    const { _new, ...cleanPayload } = payload
    const issues = getProductoIssues(cleanPayload)
    if (issues.length) throw new Error(`Producto invalido: ${issues[0]}`)
    return {
      ...cleanPayload,
      notas: cleanPayload.notas.trim(),
      precio: toFiniteNumber(cleanPayload.precio, 0),
    }
  }, [])

  const ensureVentaValida = useCallback((items, fecha) => {
    if (!fecha) throw new Error('La fecha de venta es obligatoria')
    if (!items?.length) throw new Error('Agrega al menos una prenda para registrar la venta')

    items.forEach((item, index) => {
      if (!item?.id) throw new Error(`La prenda ${index + 1} no tiene ID`) 
      const producto = productos.find(p => p.id === item.id)
      if (!producto) throw new Error(`La prenda ${item.id} no existe en inventario`)
      const issues = getProductoIssues({ ...producto, ...item, precio: item.precioVenta ?? producto.precio })
      if (issues.length) throw new Error(`La prenda ${item.id} no se puede vender: ${issues[0]}`)
      if (!hasText(item.notas || item.Descripcion)) {
        throw new Error(`La prenda ${item.id} debe tener descripcion para venderse`)
      }
      if (!(toFiniteNumber(item.precioVenta, NaN) > 0)) {
        throw new Error(`La prenda ${item.id} debe tener un precio de venta valido`)
      }
    })
  }, [productos])

  const ensureCobroValido = useCallback((data, currentVentaId = null) => {
    const payload = { ...data }
    const idVenta = payload.idVenta || currentVentaId
    if (!idVenta) throw new Error('La venta es obligatoria para registrar el cobro')
    if (!payload.fecha) throw new Error('La fecha de cobro es obligatoria')
    if (!payload.medio) throw new Error('El medio de cobro es obligatorio')
    
    // Permitir monto 0 solo si es CC (para asociar sin pago inicial)
    const monto = toFiniteNumber(payload.monto, NaN)
    const esCC = payload.medio === 'CC' || payload.idCuentaCorriente
    const montoValido = esCC ? monto >= 0 : monto > 0
    
    if (!Number.isFinite(monto) || !montoValido) {
      if (esCC) {
        throw new Error('El monto del cobro debe ser ≥ 0')
      }
      throw new Error('El monto del cobro debe ser mayor a 0')
    }

    const ventaItems = ventas.filter(v => v.IDVenta === idVenta && !v.cancelada)
    if (!ventaItems.length) throw new Error('La venta no existe o fue cancelada')

    const totalVenta = ventaItems.reduce((sum, item) => sum + toFiniteNumber(item.PrecioVentaFinal, 0), 0)
    if (!(totalVenta > 0)) throw new Error('La venta tiene datos invalidos y no admite cobros hasta ser reparada')

    return {
      ...payload,
      idVenta,
      monto: toFiniteNumber(payload.monto, 0),
    }
  }, [ventas])

  const syncCCFromCobros = useCallback(async (ccId, cobrosSource) => {
    if (!ccId) return
    let cc = cuentasCorrientes.find(x => x.id === ccId)
    if (!cc) {
      const ccSnap = await getDoc(ref('cuentasCorrientes', ccId))
      if (!ccSnap.exists()) return
      cc = { id: ccId, ...ccSnap.data() }
    }

    const pagosCC = cobrosSource.filter(c => c.idCuentaCorriente === ccId)
    const totalPagado = pagosCC.reduce((s, c) => s + (Number(c.monto) || 0), 0)
    const totalAdeudado = Number(cc.totalAdeudado) || 0
    const saldo = Math.max(totalAdeudado - totalPagado, 0)
    const cancelada = saldo <= 0
    const fechaCancelacion = cancelada
      ? (pagosCC.map(c => c.fecha).filter(Boolean).sort().at(-1) || today())
      : null

    await updateDoc(ref('cuentasCorrientes', ccId), {
      totalPagado,
      saldo,
      estado: cancelada ? 'Cancelada' : 'Activa',
      ...(cancelada ? { fechaCancelacion } : { fechaCancelacion: deleteField() }),
    })
  }, [cuentasCorrientes])

  // ── Config / Categorías ──────────────────────────────────────────────────
  const saveConfig = (newConfig) => run(async () => {
    await setDoc(ref('config', 'settings'), { config: newConfig, categorias, mediosPago }, { merge: true })
    showToast('Configuración guardada')
  })

  const saveCategorias = (newCats) => run(async () => {
    await setDoc(ref('config', 'settings'), { config, categorias: newCats, mediosPago }, { merge: true })
    showToast('Categorías guardadas')
  })

  const saveMediosPago = (nuevos) => run(async () => {
    await setDoc(ref('config', 'settings'), { config, categorias, mediosPago: nuevos }, { merge: true })
    showToast('Medios de pago guardados')
  })

  // ── PROVEEDORES ──────────────────────────────────────────────────────────
  const addProveedor = (data) => run(async () => {
    const id = await nextID('lastIDProveedor', 'IP')
    const clean = withoutTransientFields(data)
    await setDoc(ref('proveedores', id), { ...clean, id, creadoEn: serverTimestamp() })
    showToast(`Proveedor ${id} creado`)
    return id
  })
  const updateProveedor = (id, data) => run(async () => {
    await updateDoc(ref('proveedores', id), { ...withoutTransientFields(data), _new: deleteField() })
    showToast('Proveedor actualizado')
  })
  const deleteProveedor = (id) => run(async () => {
    const tieneProductos = productos.some(p => p.proveedorID === id)
    if (tieneProductos) { showToast('No se puede eliminar: tiene productos asociados', 'error'); return false }
    await deleteDoc(ref('proveedores', id))
    showToast('Proveedor eliminado')
    return true
  })

  // ── PRODUCTOS ────────────────────────────────────────────────────────────
  const addProducto = (data) => run(async () => {
    const id = await nextID('lastIDProducto', 'P')
    const clean = ensureProductoValido(data)
    const cat = categorias.find(c => c.id === clean.categoria)
    const porcProveedor = cat?.porcentaje ?? 0.5
    await setDoc(ref('productos', id), {
      ...clean, id, porcProveedor,
      vendido: false, enStock: true, devolucion: false,
      creadoEn: serverTimestamp(),
    })
    showToast(`Producto ${id} agregado`)
    return id
  })
  const updateProducto = (id, data) => run(async () => {
    const current = productos.find(x => x.id === id) || {}
    const clean = ensureProductoValido(data, current)
    if (clean.vendido) {
      clean.devolucion = false
      clean.enStock = false
    }
    if (clean.devolucion) {
      clean.vendido = false
      clean.enStock = false
    }
    const cat = categorias.find(c => c.id === clean.categoria)
    if (cat) clean.porcProveedor = cat.porcentaje
    await updateDoc(ref('productos', id), { ...clean, _new: deleteField() })
    showToast('Producto actualizado')
  })
  const deleteProducto = (id) => run(async () => {
    const p = productos.find(x => x.id === id)
    const asociadoAVenta = hasActiveVentaForProducto(ventas, id)
    if (asociadoAVenta) { showToast('No se puede eliminar: la prenda está asociada a una venta', 'error'); return false }
    if (p?.vendido) { showToast('No se puede eliminar: ya está vendido', 'error'); return false }
    if (!p?.enStock && !p?.devolucion) { showToast('No se puede eliminar: la prenda no está en stock ni marcada como devuelta', 'error'); return false }
    await deleteDoc(ref('productos', id))
    showToast('Producto eliminado')
    return true
  })
  const devolverProducto = (id) => run(async () => {
    const p = productos.find(x => x.id === id)
    const asociadoAVenta = hasActiveVentaForProducto(ventas, id)
    if (asociadoAVenta) throw new Error('No se puede devolver: la prenda está asociada a una venta')
    if (p?.vendido) throw new Error('No se puede devolver: la prenda ya fue vendida')
    if (p?.devolucion) throw new Error('La prenda ya fue marcada como devuelta')
    if (!p?.enStock) throw new Error('No se puede devolver: la prenda no está en stock')
    await updateDoc(ref('productos', id), { devolucion: true, enStock: false })
    showToast('Prenda devuelta al proveedor')
  })

  const repairVentaItem = (payload) => run(async () => {
    const {
      idVenta,
      idProducto,
      descripcion,
      precioVenta,
      sincronizarProducto = true,
      crearProductoSiNoExiste = false,
    } = payload || {}

    if (!idVenta || !idProducto) throw new Error('No se pudo identificar la venta a reparar')
    if (!hasText(descripcion)) throw new Error('La descripcion es obligatoria para reparar la venta')
    if (!isPositiveNumber(precioVenta)) throw new Error('El precio debe ser mayor a 0 para reparar la venta')

    const venta = ventas.find(v => v.IDVenta === idVenta && v.IDProducto === idProducto)
    if (!venta || venta.cancelada) throw new Error('La linea de venta ya no existe o fue cancelada')

    const precio = toFiniteNumber(precioVenta, 0)
    const cat = categorias.find(c => c.id === venta.Categoria) || { porcentaje: Number(venta.PorcProveedor) || 0.5 }
    const costo = Math.round(precio * cat.porcentaje)

    await updateDoc(ref('ventas', `${idVenta}_${idProducto}`), {
      Descripcion: descripcion.trim(),
      PrecioVentaFinal: precio,
      CostoProveedor: costo,
      GananciaNegocio: precio - costo,
    })

    const producto = productos.find(p => p.id === idProducto)
    if (!producto) {
      if (!crearProductoSiNoExiste) {
        throw new Error('El producto no existe en inventario. Activá la creacion para completar la reparacion')
      }

      await setDoc(ref('productos', idProducto), {
        id: idProducto,
        notas: descripcion.trim(),
        precio,
        categoria: venta.Categoria || 'B',
        porcProveedor: cat.porcentaje,
        proveedorID: venta.ProveedorID || '',
        proveedorNombre: venta.ProveedorNombre || '',
        fechaIngreso: venta.FechaVenta || today(),
        foto: '',
        vendido: true,
        enStock: false,
        devolucion: false,
        FechaVenta: venta.FechaVenta || '',
        IDVenta: venta.IDVenta,
        creadoEn: serverTimestamp(),
      })

      const numericId = parseInt(String(idProducto).replace(/^[^0-9]*/, ''), 10)
      await ensureCounterAtLeast('lastIDProducto', numericId)
      showToast(`Venta ${idVenta} reparada y producto ${idProducto} agregado al inventario`)
      return true
    }

    if (sincronizarProducto) {
      const patch = {
        notas: descripcion.trim(),
        precio,
        vendido: true,
        enStock: false,
        devolucion: false,
        FechaVenta: venta.FechaVenta || producto.FechaVenta || '',
        IDVenta: venta.IDVenta,
      }
      if (!producto.categoria && venta.Categoria) patch.categoria = venta.Categoria
      if (!producto.proveedorID && venta.ProveedorID) patch.proveedorID = venta.ProveedorID
      if (!producto.proveedorNombre && venta.ProveedorNombre) patch.proveedorNombre = venta.ProveedorNombre
      if (!producto.porcProveedor && cat.porcentaje) patch.porcProveedor = cat.porcentaje
      await updateDoc(ref('productos', idProducto), patch)
    }

    showToast(`Venta ${idVenta} reparada`)
    return true
  })

  // ── VENTAS ───────────────────────────────────────────────────────────────
  // addVenta: esCuentaCorriente=true crea además la CC automáticamente
  const addVenta = (items, fecha, ccData = null) => run(async () => {
    ensureVentaValida(items, fecha)
    const idVenta = await nextID('lastIDVenta', 'V')
    const esCc    = !!ccData
    const batch   = writeBatch(db)
    const totalVenta = items.reduce((s, i) => s + toFiniteNumber(i.precioVenta, 0), 0)

    for (const item of items) {
      const cat   = categorias.find(c => c.id === item.categoria) || { porcentaje: 0.5 }
      const precioVenta = toFiniteNumber(item.precioVenta, 0)
      const costo = Math.round(precioVenta * cat.porcentaje)
      batch.set(ref('ventas', `${idVenta}_${item.id}`), {
        IDVenta: idVenta, IDProducto: item.id,
        Descripcion: item.notas || item.id,
        PrecioVentaFinal: precioVenta,
        FechaVenta: fecha,
        ProveedorID: item.proveedorID,
        ProveedorNombre: item.proveedorNombre,
        Categoria: item.categoria,
        PorcProveedor: cat.porcentaje,
        CostoProveedor: costo,
        GananciaNegocio: precioVenta - costo,
        PagoProveedor: false,
        FechaPagoProveedor: '',
        LotePagoProveedor: '',
        EsCuentaCorriente: esCc,
        cancelada: false,
      })
      batch.update(ref('productos', item.id), {
        vendido: true,
        enStock: false,
        devolucion: false,
        FechaVenta: fecha,
        IDVenta: idVenta,
      })
    }

    // Si es CC → crear el registro de CC automáticamente
    if (esCc) {
      const idCC = await nextID('lastIDCC', 'CC')
      batch.set(ref('cuentasCorrientes', idCC), {
        id: idCC,
        cliente: ccData.cliente,
        idVenta,
        ventasAsociadas: [idVenta],
        totalAdeudado: totalVenta,
        totalPagado: 0,
        saldo: totalVenta,
        estado: 'Activa',
        fechaInicio: fecha,
        notas: ccData.notas || '',
        creadoEn: serverTimestamp(),
      })
    }

    await batch.commit()
    showToast(`Venta ${idVenta} registrada${esCc ? ' (Cuenta Corriente)' : ''} — ${items.length} prenda(s)`)
    return idVenta
  })

  const cancelarVenta = (idVenta) => run(async () => {
    const decision = canCancelVenta({ idVenta, ventas, pagos, cobros })
    if (!decision.ok) {
      const byReason = {
        provider_payment_exists: 'No se puede cancelar: hay al menos una prenda ya pagada a proveedor',
        sale_missing_or_canceled: 'La venta no existe o ya fue cancelada',
        sale_fully_collected: 'No se puede cancelar: venta 100% cobrada',
      }
      showToast(byReason[decision.reason] || 'No se puede cancelar la venta', 'error')
      return false
    }

    const ventaItems = getActiveVentaItems(ventas, idVenta)
    const cobrosDe = cobros.filter(c => decision.cobrosToDelete.includes(c.id))
    const batch = writeBatch(db)
    const idsCobrosEliminados = new Set(cobrosDe.map(c => c.id))
    const ccAfectadas = [...new Set(cobrosDe.map(c => c.idCuentaCorriente).filter(Boolean))]
    ventaItems.forEach(v => {
      batch.update(ref('ventas', `${idVenta}_${v.IDProducto}`), { cancelada: true })
      batch.update(ref('productos', v.IDProducto), { vendido: false, enStock: true, FechaVenta: '', IDVenta: '' })
    })
    cobrosDe.forEach(c => batch.delete(ref('cobros', c._docId || c.id)))
    await batch.commit()

    if (ccAfectadas.length) {
      const projectedCobros = cobros.filter(c => !idsCobrosEliminados.has(c.id))
      for (const ccId of ccAfectadas) {
        await syncCCFromCobros(ccId, projectedCobros)
      }
    }

    showToast(`Venta ${idVenta} cancelada y ${cobrosDe.length} cobro(s) eliminados`)
    return true
  })

  const cancelarVentaPorFalla = (idVenta, { idsProducto = [], nota = '' } = {}) => run(async () => {
    const notaLimpia = String(nota || '').trim()
    if (!hasText(notaLimpia)) {
      throw new Error('Debes indicar una nota explicando la falla')
    }

    const ventaItemsActivos = getActiveVentaItems(ventas, idVenta)
    if (!ventaItemsActivos.length) {
      throw new Error('La venta no existe o ya fue cancelada')
    }

    if (hasProviderPaymentForVenta(idVenta)) {
      showToast('No se puede cancelar por falla: la venta ya tiene pago a proveedor', 'error')
      return false
    }

    const idsDisponibles = new Set(ventaItemsActivos.map(v => v.IDProducto))
    const idsSeleccionados = idsProducto?.length
      ? [...new Set(idsProducto.filter(id => idsDisponibles.has(id)))]
      : ventaItemsActivos.map(v => v.IDProducto)

    if (!idsSeleccionados.length) {
      throw new Error('Debes seleccionar al menos una prenda para cancelar')
    }

    const seleccionSet = new Set(idsSeleccionados)
    const itemsCancelados = ventaItemsActivos.filter(v => seleccionSet.has(v.IDProducto))
    const itemsRestantes = ventaItemsActivos.filter(v => !seleccionSet.has(v.IDProducto))
    const cobrosVenta = cobros.filter(c => c.idVenta === idVenta)

    const batch = writeBatch(db)
    const fechaCancelacion = today()

    itemsCancelados.forEach((v) => {
      batch.update(ref('ventas', `${idVenta}_${v.IDProducto}`), {
        cancelada: true,
        canceladaPorFalla: true,
        canceladaFecha: fechaCancelacion,
        canceladaNota: notaLimpia,
      })
      batch.update(ref('productos', v.IDProducto), {
        vendido: false,
        enStock: true,
        FechaVenta: '',
        IDVenta: '',
      })
    })

    const ccAfectadas = [...new Set(cobrosVenta.map(c => c.idCuentaCorriente).filter(Boolean))]
    let projectedVentaCobros = []

    if (!itemsRestantes.length) {
      cobrosVenta.forEach(c => batch.delete(ref('cobros', c._docId || c.id)))
    } else {
      const totalRestante = itemsRestantes.reduce((s, v) => s + toFiniteNumber(v.PrecioVentaFinal, 0), 0)
      let restantePorAsignar = totalRestante
      const cobrosOrdenados = [...cobrosVenta].sort((a, b) => {
        const fa = a.fecha || ''
        const fb = b.fecha || ''
        if (fa !== fb) return fa.localeCompare(fb)
        return String(a.id || '').localeCompare(String(b.id || ''))
      })

      cobrosOrdenados.forEach((c) => {
        const montoActual = toFiniteNumber(c.monto, 0)
        const montoNuevo = Math.max(0, Math.min(montoActual, restantePorAsignar))

        if (montoNuevo <= EPSILON) {
          batch.delete(ref('cobros', c._docId || c.id))
        } else {
          if (Math.abs(montoNuevo - montoActual) > EPSILON) {
            batch.update(ref('cobros', c._docId || c.id), { monto: Number(montoNuevo.toFixed(2)) })
          }
          projectedVentaCobros.push({ ...c, monto: Number(montoNuevo.toFixed(2)) })
          restantePorAsignar -= montoNuevo
        }
      })
    }

    await batch.commit()

    if (ccAfectadas.length) {
      const projectedCobros = [
        ...cobros.filter(c => c.idVenta !== idVenta),
        ...projectedVentaCobros,
      ]
      for (const ccId of ccAfectadas) {
        await syncCCFromCobros(ccId, projectedCobros)
      }
    }

    const cancelacionTotal = itemsRestantes.length === 0
    showToast(
      cancelacionTotal
        ? `Venta ${idVenta} cancelada por falla. Prendas devueltas a stock.`
        : `Venta ${idVenta} ajustada por falla (${itemsCancelados.length} prenda(s) devueltas y cobros ajustados).`
    )
    return true
  })

  // ── COBROS ───────────────────────────────────────────────────────────────
  const addCobro = (data) => run(async () => {
    const clean = ensureCobroValido(data)
    if (hasProviderPaymentForVenta(clean.idVenta)) {
      showToast('No se puede registrar cobro: la venta ya tiene pago a proveedor', 'error')
      return false
    }

    const saleDecision = canAddCobroToVenta({
      idVenta: clean.idVenta,
      monto: clean.monto,
      ventas,
      cobros,
      allowZero: clean.medio === 'CC' || !!clean.idCuentaCorriente,
    })
    if (!saleDecision.ok) {
      if (saleDecision.reason === 'over_sale_balance') {
        throw new Error(`El cobro supera el saldo pendiente de la venta (${fmt$(saleDecision.pending || 0)})`)
      }
      throw new Error('La venta no admite nuevos cobros')
    }

    if (clean.idCuentaCorriente) {
      let cuentasCorrientesSource = cuentasCorrientes
      const ccLocal = cuentasCorrientes.find(x => x.id === clean.idCuentaCorriente)
      if (!ccLocal) {
        const ccSnap = await getDoc(ref('cuentasCorrientes', clean.idCuentaCorriente))
        if (!ccSnap.exists()) {
          throw new Error('La cuenta corriente asociada no existe')
        }
        cuentasCorrientesSource = [...cuentasCorrientes, { id: clean.idCuentaCorriente, ...ccSnap.data() }]
      }

      const ccDecision = canAddCobroToCuentaCorriente({
        ccId: clean.idCuentaCorriente,
        monto: clean.monto,
        cuentasCorrientes: cuentasCorrientesSource,
        cobros,
      })
      if (!ccDecision.ok) {
        if (ccDecision.reason === 'cc_missing') throw new Error('La cuenta corriente asociada no existe')
        if (ccDecision.reason === 'cc_settled') {
          throw new Error('La cuenta corriente ya está saldada y no admite más cobros')
        }
        if (ccDecision.reason === 'over_cc_balance') {
          throw new Error(`El cobro supera el saldo de la cuenta corriente (${fmt$(ccDecision.pending || 0)})`)
        }
        throw new Error('La cuenta corriente ya está saldada y no admite más cobros')
      }
    }

    const id = await nextID('lastIDCobro', 'C')
    await setDoc(ref('cobros', id), { ...clean, id, creadoEn: serverTimestamp() })

    if (clean.idCuentaCorriente) {
      const projectedCobros = [...cobros, { ...clean, id }]
      await syncCCFromCobros(clean.idCuentaCorriente, projectedCobros)
    }

    showToast(`Cobro ${id} registrado — ${clean.medio}`)
    return id
  })
  const deleteCobro = (id) => run(async () => {
    const c = cobros.find(x => x.id === id)
    if (!c) return false

    if (hasProviderPaymentForVenta(c.idVenta)) {
      showToast('No se puede eliminar: la venta ya tiene pago a proveedor', 'error')
      return false
    }

    const totalVenta = ventas.filter(v => v.IDVenta === c.idVenta).reduce((s, v) => s + (v.PrecioVentaFinal || 0), 0)
    const totalCobrado = cobros.filter(x => x.idVenta === c.idVenta).reduce((s, x) => s + (x.monto || 0), 0)
    const saldo = totalVenta - totalCobrado
    const estaExactamenteCobrada = totalVenta > 0 && Math.abs(saldo) <= EPSILON
    if (estaExactamenteCobrada) {
      showToast('No se puede eliminar: venta ya cobrada al 100%', 'error')
      return false
    }

    const projectedCobros = cobros.filter(x => x.id !== id)
    await deleteDoc(ref('cobros', id))

    if (c.idCuentaCorriente) {
      await syncCCFromCobros(c.idCuentaCorriente, projectedCobros)
    }

    showToast('Cobro eliminado')
    return true
  })
  const updateCobro = (id, data) => run(async () => {
    const current = cobros.find(x => x.id === id)
    if (!current) return false
    const clean = ensureCobroValido({ ...current, ...data }, current.idVenta)
    const projectedCobros = cobros.map(x => x.id === id ? { ...x, ...clean } : x)

    if (hasProviderPaymentForVenta(current.idVenta) || hasProviderPaymentForVenta(clean.idVenta)) {
      showToast('No se puede editar: la venta ya tiene pago a proveedor', 'error')
      return false
    }

    const saleDecision = canAddCobroToVenta({
      idVenta: clean.idVenta,
      monto: clean.monto,
      ventas,
      cobros: projectedCobros,
      excludeCobroId: id,
      allowZero: clean.medio === 'CC' || !!clean.idCuentaCorriente,
    })
    if (!saleDecision.ok) {
      if (saleDecision.reason === 'over_sale_balance') {
        throw new Error(`La edición supera el saldo pendiente de la venta (${fmt$(saleDecision.pending || 0)})`)
      }
      throw new Error('La venta no admite la edición del cobro')
    }

    if (clean.idCuentaCorriente) {
      let cuentasCorrientesSource = cuentasCorrientes
      const ccLocal = cuentasCorrientes.find(x => x.id === clean.idCuentaCorriente)
      if (!ccLocal) {
        const ccSnap = await getDoc(ref('cuentasCorrientes', clean.idCuentaCorriente))
        if (!ccSnap.exists()) {
          throw new Error('La cuenta corriente asociada no existe')
        }
        cuentasCorrientesSource = [...cuentasCorrientes, { id: clean.idCuentaCorriente, ...ccSnap.data() }]
      }

      const ccDecision = canAddCobroToCuentaCorriente({
        ccId: clean.idCuentaCorriente,
        monto: clean.monto,
        cuentasCorrientes: cuentasCorrientesSource,
        cobros: projectedCobros,
        excludeCobroId: id,
      })
      if (!ccDecision.ok) {
        if (ccDecision.reason === 'cc_missing') throw new Error('La cuenta corriente asociada no existe')
        if (ccDecision.reason === 'cc_settled') {
          throw new Error('La cuenta corriente ya está saldada y no admite más cobros')
        }
        if (ccDecision.reason === 'over_cc_balance') {
          throw new Error(`La edición supera el saldo de la cuenta corriente (${fmt$(ccDecision.pending || 0)})`)
        }
        throw new Error('La edición deja la cuenta corriente con sobrepago')
      }
    }

    await updateDoc(ref('cobros', id), clean)

    const ccAfectadas = [...new Set([current.idCuentaCorriente, clean.idCuentaCorriente].filter(Boolean))]
    for (const ccId of ccAfectadas) {
      await syncCCFromCobros(ccId, projectedCobros)
    }

    showToast('Cobro actualizado')
    return true
  })

  // ── PAGOS PROVEEDORES ────────────────────────────────────────────────────
  const addPago = ({ proveedorID, prendas, obs }) => run(async () => {
    if (!prendas?.length) {
      showToast('No hay prendas para pagar', 'error')
      return false
    }

    const hoy = today()
    const acreditadoPorVenta = calcAcreditadoPorVenta(cobros, cuentasCorrientes, hoy, mediosPago)
    const totalPorVenta = calcTotalPorVenta(ventas)
    const pagosSet = new Set(pagos.map(p => `${p.idVenta}-${p.idProducto}`))

    const invalidas = []
    for (const v of prendas) {
      const key = `${v.IDVenta}-${v.IDProducto}`
      const linea = ventas.find(x => x.IDVenta === v.IDVenta && x.IDProducto === v.IDProducto)
      const acred = acreditadoPorVenta[v.IDVenta]?.acreditado || 0
      const total = totalPorVenta[v.IDVenta] || 0

      if (!linea || linea.cancelada) {
        invalidas.push(`${v.IDProducto}: venta inexistente/cancelada`)
        continue
      }
      if ((linea.ProveedorID || proveedorID) !== proveedorID) {
        invalidas.push(`${v.IDProducto}: proveedor inconsistente`)
        continue
      }
      if (linea.PagoProveedor === true || pagosSet.has(key)) {
        invalidas.push(`${v.IDProducto}: ya pagada`)
        continue
      }
      if (total <= 0 || acred < total) {
        invalidas.push(`${v.IDProducto}: venta no cerrada/acreditada`) // incluye cobros diferidos no acreditados
      }
    }

    if (invalidas.length) {
      showToast(`No se puede confirmar pago: ${invalidas[0]}`, 'error')
      return false
    }

    const id = await nextID('lastIDPago', 'PP')
    const batch = writeBatch(db)
    const fecha = today()
    prendas.forEach(v => {
      batch.set(ref('pagos', `${id}_${v.IDProducto}`), {
        id, fecha, proveedorID,
        idProducto: v.IDProducto,
        idVenta: v.IDVenta,
        monto: v.CostoProveedor,
        obs: obs || 'Pago desde app',
      })
      batch.update(ref('ventas', `${v.IDVenta}_${v.IDProducto}`), {
        PagoProveedor: true, FechaPagoProveedor: fecha, LotePagoProveedor: id,
      })
    })
    await batch.commit()
    showToast(`Pago ${id} confirmado`)
    return id
  })

  // ── GASTOS ───────────────────────────────────────────────────────────────
  const addGasto = (data) => run(async () => {
    const descripcion = String(data?.descripcion || '').trim()
    if (!descripcion) throw new Error('La descripción del gasto es obligatoria')

    const monto = toFiniteNumber(data?.monto, NaN)
    if (!(monto > 0)) throw new Error('El monto del gasto debe ser mayor a 0')

    // Nuevo formato: mes es YYYY-MM
    const mes = data?.mes || data?.fecha?.slice(0, 7) || today().slice(0, 7)
    const fecha = data?.fecha || (mes + '-01')
    const recurrente = !!data?.recurrente

    const id = await nextID('lastIDGasto', 'G')
    await setDoc(ref('gastos', id), {
      descripcion,
      monto,
      mes,
      fecha,
      recurrente,
      id,
      creadoEn: serverTimestamp(),
    })

    showToast('Gasto registrado')
    return id
  })
  const updateGasto = (id, data) => run(async () => {
    const current = gastos.find(g => g.id === id) || {}
    const descripcion = String(data?.descripcion ?? current.descripcion ?? '').trim()
    if (!descripcion) throw new Error('La descripción del gasto es obligatoria')

    const monto = toFiniteNumber(data?.monto ?? current.monto, NaN)
    if (!(monto > 0)) throw new Error('El monto del gasto debe ser mayor a 0')

    // Nuevo formato: mes es YYYY-MM
    const mes = data?.mes ?? current.mes ?? (data?.fecha ?? current.fecha ?? today()).slice(0, 7)
    const fecha = data?.fecha ?? current.fecha ?? (mes + '-01')
    const recurrente = data?.recurrente ?? current.recurrente ?? false

    await updateDoc(ref('gastos', id), {
      descripcion,
      monto,
      mes,
      fecha,
      recurrente,
    })
    showToast('Gasto actualizado')
  })
  const deleteGasto = (id) => run(async () => {
    await deleteDoc(ref('gastos', id))
    showToast('Gasto eliminado')
  })

  // ── CUENTAS CORRIENTES ───────────────────────────────────────────────────
  const addCC = (data) => run(async () => {
    const cliente = String(data?.cliente || '').trim()
    if (!cliente) throw new Error('El nombre de la clienta es obligatorio')

    const clienteNormalizado = normalizeClienteName(cliente)
    const duplicada = cuentasCorrientes.find(cc =>
      cc.estado !== 'Cancelada' && normalizeClienteName(cc.cliente) === clienteNormalizado
    )
    if (duplicada) {
      throw new Error(`Ya existe una cuenta corriente activa para ${cliente} (${duplicada.id})`)
    }

    const id = await nextID('lastIDCC', 'CC')
    await setDoc(ref('cuentasCorrientes', id), {
      ...data,
      cliente,
      id,
      ventasAsociadas: uniqueVentaIds(data?.ventasAsociadas, data?.idVenta),
      creadoEn: serverTimestamp(),
    })
    showToast(`Cuenta corriente ${id} creada`)
    return id
  })
  const updateCC = (id, data) => run(async () => {
    const current = cuentasCorrientes.find(cc => cc.id === id)
    if (!current) throw new Error('La cuenta corriente no existe')

    const nextCliente = String(data?.cliente ?? current.cliente ?? '').trim()
    if (!nextCliente) throw new Error('El nombre de la clienta es obligatorio')

    const clienteNormalizado = normalizeClienteName(nextCliente)
    const duplicada = cuentasCorrientes.find(cc =>
      cc.id !== id && cc.estado !== 'Cancelada' && normalizeClienteName(cc.cliente) == clienteNormalizado
    )
    if (duplicada) {
      throw new Error(`Ya existe una cuenta corriente activa para ${nextCliente} (${duplicada.id})`)
    }

    await updateDoc(ref('cuentasCorrientes', id), {
      ...data,
      cliente: nextCliente,
      ventasAsociadas: uniqueVentaIds(current.ventasAsociadas, current.idVenta, data?.ventasAsociadas, data?.idVenta),
    })
    showToast('Cuenta corriente actualizada')
  })
  const deleteCC = (id) => run(async () => {
    const cc = cuentasCorrientes.find(x => x.id === id)
    if (!cc) return false

    const tieneCobros = cobros.some(c => c.idCuentaCorriente === id)
    if (tieneCobros) {
      showToast('No se puede eliminar: la cuenta corriente tiene cobros asociados', 'error')
      return false
    }

    await deleteDoc(ref('cuentasCorrientes', id))
    showToast('Cuenta corriente eliminada')
    return true
  })

  // Registrar pago parcial de CC → crea cobro real + actualiza CC
  const pagarCC = (ccId, { idVenta, medio, monto, fecha, obs }) => run(async () => {
    const cc = cuentasCorrientes.find(x => x.id === ccId)
    if (!cc) throw new Error('La cuenta corriente no existe')

    const montoPago = toFiniteNumber(monto, NaN)
    if (!(montoPago > 0)) throw new Error('El monto del pago debe ser mayor a 0')
    if (!fecha) throw new Error('La fecha de pago es obligatoria')
    if (!medio) throw new Error('El medio de pago es obligatorio')
    const medioDef = mediosPago.find(m => m.id === medio)
    if (medioDef?.esBNA) throw new Error('Los pagos de cuenta corriente no admiten acreditación diferida')
    if (!idVenta) throw new Error('Debes indicar a qué venta se aplica este cobro de cuenta corriente')

    const ventasAsociadas = uniqueVentaIds(cc.ventasAsociadas, cc.idVenta, cobros.filter(c => c.idCuentaCorriente === ccId).map(c => c.idVenta))
    if (!ventasAsociadas.includes(idVenta)) {
      throw new Error('La venta seleccionada no está asociada a esta cuenta corriente')
    }

    const ventaItems = getActiveVentaItems(ventas, idVenta)
    if (!ventaItems.length) throw new Error('La venta asociada no existe o fue cancelada')

    const saleDecision = canAddCobroToVenta({ idVenta, monto: montoPago, ventas, cobros })
    if (!saleDecision.ok) {
      if (saleDecision.reason === 'over_sale_balance') {
        throw new Error(`El cobro supera el saldo pendiente de la venta (${fmt$(saleDecision.pending || 0)})`)
      }
      throw new Error('La venta seleccionada no admite más cobros')
    }

    const ccDecision = canAddCobroToCuentaCorriente({
      ccId,
      monto: montoPago,
      cuentasCorrientes,
      cobros,
    })
    if (!ccDecision.ok) {
      if (ccDecision.reason === 'cc_settled') {
        throw new Error('La cuenta corriente ya está saldada y no admite más cobros')
      }
      if (ccDecision.reason === 'over_cc_balance') {
        throw new Error(`El pago supera el saldo pendiente (${fmt$(ccDecision.pending || 0)})`)
      }
      throw new Error('No se pudo leer el estado de la cuenta corriente')
    }

    const ccSnap = getCCSnapshot(ccId)
    if (!ccSnap) throw new Error('No se pudo leer el estado de la cuenta corriente')

    const batch = writeBatch(db)
    const idCobro = await nextID('lastIDCobro', 'C')
    const nuevoPagado = ccSnap.totalPagado + montoPago
    const nuevoSaldo  = ccSnap.totalAdeudado - nuevoPagado
    const cancelada   = nuevoSaldo <= 0

    // 1. Crear cobro real vinculado a la venta y a la CC
    batch.set(ref('cobros', idCobro), {
      id: idCobro,
      idVenta,
      idCuentaCorriente: ccId,
      fecha,
      medio,
      monto: montoPago,
      fechaReal: fecha,
      obs: obs || '',
      creadoEn: serverTimestamp(),
    })

    // 2. Actualizar CC
    batch.update(ref('cuentasCorrientes', ccId), {
      totalPagado: nuevoPagado,
      saldo: Math.max(nuevoSaldo, 0),
      estado: cancelada ? 'Cancelada' : 'Activa',
      ventasAsociadas: uniqueVentaIds(cc.ventasAsociadas, cc.idVenta, idVenta),
      ...(cancelada ? { fechaCancelacion: fecha } : { fechaCancelacion: deleteField() }),
    })

    await batch.commit()
    showToast(cancelada
      ? `✅ CC cancelada — ${cc.cliente} saldó su deuda`
      : `Pago registrado en ${idVenta} — quedan ${fmt$(Math.max(nuevoSaldo, 0))} pendientes`
    )
    return { idCobro, cancelada }
  })

  // ── ARCHIVO MENSUAL ──────────────────────────────────────────────────────
  const archivarMes = (mes) => run(async () => {
    const ventasMes = ventas.filter(v => v.FechaVenta?.startsWith(mes) && !v.cancelada)
    const idVentasMes = new Set(ventasMes.map(v => v.IDVenta))
    const cobrosMes = cobros.filter(c => idVentasMes.has(c.idVenta))
    const pagosMes = pagos.filter(p => p.fecha?.startsWith(mes))
    const ventasCompletas = ventasMes.filter(v => v.PagoProveedor === true)
    if (!ventasCompletas.length) {
      showToast('No hay ventas completamente cerradas en ese mes', 'error')
      return null
    }
    const batch = writeBatch(db)
    const archiveRef = (type, id) => ref(`archivo_${mes}_${type}`, id)
    ventasCompletas.forEach(v => {
      batch.set(archiveRef('ventas', `${v.IDVenta}_${v.IDProducto}`), v)
      batch.delete(ref('ventas', `${v.IDVenta}_${v.IDProducto}`))
    })
    const idsVentasCompletas = new Set(ventasCompletas.map(v => v.IDVenta))
    cobrosMes.filter(c => idsVentasCompletas.has(c.idVenta)).forEach(c => {
      batch.set(archiveRef('cobros', c.id), c)
      batch.delete(ref('cobros', c.id))
    })
    pagosMes.forEach(p => {
      batch.set(archiveRef('pagos', `${p.id}_${p.idProducto}`), p)
      batch.delete(ref('pagos', `${p.id}_${p.idProducto}`))
    })
    await batch.commit()
    showToast(`Mes ${mes} archivado — ${ventasCompletas.length} ventas eliminadas`)
    return ventasCompletas.length
  })

  return (
    <Ctx.Provider value={{
      // Data
      productos, ventas, cobros, pagos, proveedores,
      gastos, categorias, cuentasCorrientes, config,
      loading, working, toast, showToast,
      // Proveedores
      addProveedor, updateProveedor, deleteProveedor,
      // Productos
      addProducto, updateProducto, deleteProducto, devolverProducto,
      // Ventas
      addVenta, cancelarVenta, cancelarVentaPorFalla, repairVentaItem,
      // Cobros
      addCobro, deleteCobro, updateCobro,
      // Pagos
      addPago,
      // Gastos
      addGasto, updateGasto, deleteGasto,
      // CC
      addCC, updateCC, deleteCC, pagarCC,
      // Config
      mediosPago, saveConfig, saveCategorias, saveMediosPago,
      // Data loading controls
      setActiveSection: changeActiveSection,
      // Archivo
      archivarMes,
    }}>
      {children}
    </Ctx.Provider>
  )
}
