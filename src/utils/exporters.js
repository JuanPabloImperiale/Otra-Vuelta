import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { fmt$, fmtDate, today } from './formatters'
import { MEDIO_LABELS } from '../constants'

// ── EXCEL EXPORT (backup mensual) ────────────────────────────────────────────
export function exportarMesExcel({ mes, productos, ventas, cobros, pagos, proveedores, gastos, cuentasCorrientes }) {
  const wb = XLSX.utils.book_new()

  const prodsMes = productos.filter(p => p.fechaIngreso?.startsWith(mes) || p.FechaVenta?.startsWith(mes))
  const ventasMes = ventas.filter(v => v.FechaVenta?.startsWith(mes))
  const idVentasMes = new Set(ventasMes.map(v => v.IDVenta))
  const cobrosMes = cobros.filter(c => c.fecha?.startsWith(mes) || idVentasMes.has(c.idVenta))
  const pagosMes = pagos.filter(p => p.fecha?.startsWith(mes))

  const addSheet = (name, rows) => {
    if (!rows.length) return
    const ws = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, name)
  }

  addSheet('Productos', productos.filter(p => p.vendido && p.FechaVenta?.startsWith(mes)).map(p => ({
    ID: p.id, Proveedor: p.proveedorNombre, Categoria: p.categoria,
    FechaIngreso: p.fechaIngreso, FechaVenta: p.FechaVenta,
    Precio: p.precio, Descripcion: p.notas,
  })))

  addSheet('Ventas', ventasMes.map(v => ({
    IDVenta: v.IDVenta, IDProducto: v.IDProducto, Descripcion: v.Descripcion,
    PrecioVenta: v.PrecioVentaFinal, Fecha: v.FechaVenta,
    Proveedor: v.ProveedorID, Categoria: v.Categoria,
    CostoProveedor: v.CostoProveedor, Ganancia: v.GananciaNegocio,
    PagoProveedor: v.PagoProveedor,
  })))

  addSheet('Cobros', cobrosMes.map(c => ({
    ID: c.id, IDVenta: c.idVenta, Fecha: c.fecha,
    Medio: MEDIO_LABELS[c.medio] || c.medio, Monto: c.monto,
    FechaAcreditacion: c.fechaReal, Observacion: c.obs,
  })))

  addSheet('Pagos_Proveedores', pagosMes.map(p => ({
    ID: p.id, Fecha: p.fecha, Proveedor: p.proveedorID,
    IDProducto: p.idProducto, IDVenta: p.idVenta, Monto: p.monto, Obs: p.obs,
  })))

  addSheet('Gastos', gastos.filter(g => g.fecha?.startsWith(mes)).map(g => ({
    ID: g.id, Descripcion: g.descripcion, Monto: g.monto,
    Fecha: g.fecha, Recurrente: g.recurrente,
  })))

  // Meta: contadores para reimportación
  const metaSheet = XLSX.utils.json_to_sheet([{
    mes,
    exportado: today(),
    totalVentas: ventasMes.length,
    totalCobros: cobrosMes.length,
    totalPagos: pagosMes.length,
  }])
  XLSX.utils.book_append_sheet(wb, metaSheet, 'Meta')

  XLSX.writeFile(wb, `OtraVuelta_backup_${mes}.xlsx`)
}

// ── IMPORTAR CSVs SEED ────────────────────────────────────────────────────────
// Campos que son siempre string aunque parezcan números
const STRING_FIELDS = new Set(['id','idventa','idproducto','idproveedor','idcuentacorriente',
  'idpago','idventa','proveedorid','lotepagosproveedor','lotepagoproveedor',
  'nombre','descripcion','notas','obs','observacion','alias','telefono','estado',
  'cuentadestino','medio','categoria','proveedornombre'])

export function parsearCSV(text) {
  // Normalizar line endings (Windows \r\n → \n)
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n')
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
  const originalHeaders = lines[0].split(',').map(h => h.trim())

  return lines.slice(1).map(line => {
    // Parser simple que respeta comillas
    const vals = []
    let cur = '', inQuote = false
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote }
      else if (ch === ',' && !inQuote) { vals.push(cur); cur = '' }
      else cur += ch
    }
    vals.push(cur)

    const obj = {}
    originalHeaders.forEach((h, i) => {
      const hLow = h.trim().toLowerCase()
      let v = (vals[i] || '').trim().replace(/\r$/, '') // quitar \r residual

      if (v === 'true')       v = true
      else if (v === 'false') v = false
      else if (v === '')      v = ''
      else if (!isNaN(v) && v !== '' && !STRING_FIELDS.has(hLow) && !hLow.includes('fecha')) {
        v = Number(v)
      }
      obj[h.trim()] = v
    })
    return obj
  }).filter(r => Object.values(r).some(v => v !== '' && v !== null && v !== undefined))
}

// ── PDF REPORTE PROVEEDOR ────────────────────────────────────────────────────
export function generarPDFProveedor({ proveedor, stockItems = [], pendienteCobro = [], listosPagar = [], historialPagos = [], devueltosItems = [], productos = [] }) {
  const productosById = Object.fromEntries(productos.map(p => [p.id, p]))
  const devueltosSolo = devueltosItems.filter(p => !p.vendido)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210, margin = 14

  // Header
  doc.setFillColor(201, 169, 110)
  doc.rect(0, 0, W, 28, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('OTRA VUELTA', margin, 12)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text(`Estado de cuenta — ${proveedor.nombre}`, margin, 20)
  doc.text(`Fecha: ${fmtDate(today())}`, W - margin, 20, { align: 'right' })

  doc.setTextColor(28, 25, 22)
  let y = 36

  const sectionTitle = (title, color = [155, 107, 71]) => {
    doc.setFillColor(...color)
    doc.rect(margin, y, W - margin * 2, 7, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text(title, margin + 3, y + 5)
    doc.setTextColor(28, 25, 22)
    y += 10
  }

  // Resumen
  const totalListo   = listosPagar.reduce((s, v) => s + (v.CostoProveedor || 0), 0)
  const totalPendCob = pendienteCobro.reduce((s, v) => s + (v.CostoProveedor || 0), 0)
  const totalPagado  = historialPagos.reduce((s, p) => s + (p.monto || 0), 0)

  sectionTitle('RESUMEN')
  const summaryBody = [
    ['En stock (disponible)',                stockItems.length,     '—'],
    ['Vendido — pendiente de cobro',          pendienteCobro.length, fmt$(totalPendCob)],
    ['Listo para pagar (cobrado al 100%)',    listosPagar.length,   fmt$(totalListo)],
    ['Total pagado históricamente',           '—',                  fmt$(totalPagado)],
  ]
  if (devueltosSolo.length) {
    summaryBody.push(['Productos devueltos', devueltosSolo.length, '—'])
  }
  
  autoTable(doc, {
    startY: y,
    head: [['Concepto', 'Prendas', 'Monto']],
    body: summaryBody,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [232, 224, 214] , textColor: [28, 25, 22] },
    margin: { left: margin, right: margin },
  })
  y = doc.lastAutoTable.finalY + 8

  // Listos para pagar
  if (listosPagar.length) {
    sectionTitle(`A PAGAR AHORA — ${fmt$(totalListo)}`, [45, 106, 53])
    autoTable(doc, {
      startY: y,
      head: [['Producto', 'Venta', 'Fecha', 'Les corresponde']],
      body: listosPagar.map(v => [
        (v.Descripcion || v.IDProducto || '').slice(0, 45),
        v.IDVenta,
        fmtDate(v.FechaVenta),
        fmt$(v.CostoProveedor),
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [214, 237, 218], textColor: [28, 25, 22] },
      margin: { left: margin, right: margin },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  // Pendientes de cobro
  if (pendienteCobro.length) {
    if (y > 230) { doc.addPage(); y = 20 }
    sectionTitle(`VENDIDO — PENDIENTE DE COBRO — ${fmt$(totalPendCob)}`, [180, 140, 50])
    autoTable(doc, {
      startY: y,
      head: [['Producto', 'Venta', 'Fecha', 'Les corresponde']],
      body: pendienteCobro.map(v => [
        (v.Descripcion || v.IDProducto || '').slice(0, 45),
        v.IDVenta,
        fmtDate(v.FechaVenta),
        fmt$(v.CostoProveedor),
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [255, 243, 205], textColor: [28, 25, 22] },
      margin: { left: margin, right: margin },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  // Stock disponible
  if (stockItems.length) {
    if (y > 230) { doc.addPage(); y = 20 }
    sectionTitle(`EN STOCK (${stockItems.length} prendas)`, [80, 100, 140])
    autoTable(doc, {
      startY: y,
      head: [['Producto', 'Precio estimado', 'Días en local']],
      body: stockItems.map(p => [
        (p.notas || p.id || '').slice(0, 45),
        fmt$(p.precio),
        p.fechaIngreso ? Math.floor((new Date() - new Date(p.fechaIngreso)) / 86400000) + ' días' : '—',
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [214, 225, 242], textColor: [28, 25, 22] },
      margin: { left: margin, right: margin },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  // Productos devueltos
  if (devueltosSolo.length) {
    if (y > 230) { doc.addPage(); y = 20 }
    sectionTitle(`PRODUCTOS DEVUELTOS (${devueltosSolo.length} prendas)`, [220, 100, 100])
    autoTable(doc, {
      startY: y,
      head: [['Producto', 'Precio original', 'Motivo/Notas']],
      body: devueltosSolo.map(p => [
        (p.notas || p.id || '').slice(0, 40),
        fmt$(p.precio),
        p.motivoDevolucion || '—',
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [255, 225, 220], textColor: [28, 25, 22] },
      margin: { left: margin, right: margin },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  // Historial de pagos
  if (historialPagos.length) {
    if (y > 230) { doc.addPage(); y = 20 }
    sectionTitle('HISTORIAL DE PAGOS')

    // Build body: one header row per lote + detail rows per product
    const body = []
    const loteRowIndexes = []
    historialPagos.forEach(lote => {
      loteRowIndexes.push(body.length)
      body.push([`${lote.id} — ${fmtDate(lote.fecha)}`, fmt$(lote.monto), lote.obs || '', ''])
      lote.items.forEach(item => {
        const prod = productosById[item.idProducto]
        const desc = (prod?.notas || prod?.id || item.idProducto || '—').slice(0, 38)
        body.push([`  ${item.idProducto}`, desc, item.idVenta || '', fmt$(item.monto)])
      })
    })

    autoTable(doc, {
      startY: y,
      head: [['Lote / Producto', 'Descripción / Monto lote', 'Venta / Obs.', 'Monto']],
      body,
      styles: { fontSize: 7.5 },
      headStyles: { fillColor: [232, 224, 214], textColor: [28, 25, 22] },
      margin: { left: margin, right: margin },
      didParseCell: (data) => {
        if (data.section === 'body' && loteRowIndexes.includes(data.row.index)) {
          data.cell.styles.fillColor = [240, 234, 224]
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.fontSize = 8
        }
      },
    })
  }

  // Footer
  const pages = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(158, 144, 135)
    doc.text(`Otra Vuelta — ${fmtDate(today())} — Página ${i}/${pages}`, W / 2, 292, { align: 'center' })
  }

  return doc
}

// ── TEXTO WHATSAPP ────────────────────────────────────────────────────────────
export function generarTextoWA({ proveedor, stockItems, pendienteCobro, listosPagar }) {
  const totalListo   = listosPagar.reduce((s, v) => s + (v.CostoProveedor || 0), 0)
  const totalPendCob = pendienteCobro.reduce((s, v) => s + (v.CostoProveedor || 0), 0)

  let msg = `*OTRA VUELTA — Estado de cuenta*\n`
  msg += `*Proveedor:* ${proveedor.nombre}\n`
  msg += `*Fecha:* ${fmtDate(today())}\n\n`

  if (listosPagar.length) {
    msg += `✅ *PAGO LISTO: ${fmt$(totalListo)}*\n`
    msg += `${listosPagar.length} prenda(s) vendidas y cobradas al 100%\n`
    listosPagar.forEach(v => {
      msg += `  • ${(v.Descripcion || v.IDProducto || '').slice(0, 35)} → ${fmt$(v.CostoProveedor)}\n`
    })
    msg += '\n'
  }

  if (pendienteCobro.length) {
    msg += `⏳ *VENDIDO (pendiente de cobro): ${fmt$(totalPendCob)}*\n`
    msg += `${pendienteCobro.length} prenda(s) — cobraremos y te transferimos enseguida\n\n`
  }

  if (stockItems.length) {
    msg += `📦 *EN STOCK: ${stockItems.length} prenda(s)*\n`
    stockItems.forEach(p => {
      msg += `  • ${(p.notas || p.id || '').slice(0, 35)} — ${fmt$(p.precio)}\n`
    })
    msg += '\n'
  }

  return msg
}

// ── CSV EXPORT (reimportable) ───────────────────────────────────────────────
const csvEscape = (value) => {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

const rowsToCSV = (rows) => {
  if (!rows?.length) return ''
  const headers = Object.keys(rows[0])
  const headerLine = headers.join(',')
  const dataLines = rows.map(row => headers.map(h => csvEscape(row[h])).join(','))
  return [headerLine, ...dataLines].join('\n')
}

const downloadCSV = (filename, rows) => {
  if (!rows?.length) return false
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

export function exportarMesCSVReimportable({
  mes,
  productos,
  ventas,
  cobros,
  pagos,
  proveedores,
  cuentasCorrientes,
  gastos,
  categorias,
}) {
  const ventasMes = ventas.filter(v => v.FechaVenta?.startsWith(mes))
  const idVentasMes = new Set(ventasMes.map(v => v.IDVenta))

  const cobrosMes = cobros.filter(c => c.fecha?.startsWith(mes) || idVentasMes.has(c.idVenta))
  const pagosMes = pagos.filter(p => p.fecha?.startsWith(mes))

  const productosMes = productos.filter(p =>
    p.fechaIngreso?.startsWith(mes) || p.FechaVenta?.startsWith(mes) || idVentasMes.has(p.IDVenta)
  )

  const provIds = new Set([
    ...productosMes.map(p => p.proveedorID).filter(Boolean),
    ...ventasMes.map(v => v.ProveedorID).filter(Boolean),
  ])
  const proveedoresMes = proveedores.filter(p => provIds.has(p.id))

  const ccMes = cuentasCorrientes.filter(cc =>
    idVentasMes.has(cc.idVenta) || cc.fechaInicio?.startsWith(mes) || cc.fechaCancelacion?.startsWith(mes)
  )

  const gastosMes = gastos.filter(g => g.fecha?.startsWith(mes))

  let files = 0
  files += downloadCSV(`seed_proveedores_${mes}.csv`, proveedoresMes) ? 1 : 0
  files += downloadCSV(`seed_categorias_${mes}.csv`, categorias || []) ? 1 : 0
  files += downloadCSV(`seed_productos_${mes}.csv`, productosMes) ? 1 : 0
  files += downloadCSV(`seed_ventas_${mes}.csv`, ventasMes) ? 1 : 0
  files += downloadCSV(`seed_cobros_${mes}.csv`, cobrosMes) ? 1 : 0
  files += downloadCSV(`seed_pagos_${mes}.csv`, pagosMes) ? 1 : 0
  files += downloadCSV(`seed_cuentas_corrientes_${mes}.csv`, ccMes) ? 1 : 0
  files += downloadCSV(`seed_gastos_${mes}.csv`, gastosMes) ? 1 : 0

  return {
    files,
    counts: {
      proveedores: proveedoresMes.length,
      categorias: (categorias || []).length,
      productos: productosMes.length,
      ventas: ventasMes.length,
      cobros: cobrosMes.length,
      pagos: pagosMes.length,
      cuentasCorrientes: ccMes.length,
      gastos: gastosMes.length,
    },
  }
}

// ── PDF LOTE DE PAGOS PROVEEDORES ───────────────────────────────────────────
export function exportarLotePagosPDF({ fecha = today(), mesLabel = 'Todos los meses', proveedores = [] }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210
  const H = 297
  const margin = 14

  const totalGeneral = proveedores.reduce((s, p) => s + (p.total || 0), 0)
  const totalPrendas = proveedores.reduce((s, p) => s + (p.prendas?.length || 0), 0)

  // Header
  doc.setFillColor(201, 169, 110)
  doc.rect(0, 0, W, 30, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.text('OTRA VUELTA', margin, 12)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text('Lote de pagos a proveedores', margin, 20)
  doc.text(`Fecha: ${fmtDate(fecha)}`, W - margin, 14, { align: 'right' })
  doc.text(`Periodo: ${mesLabel}`, W - margin, 20, { align: 'right' })

  doc.setTextColor(28, 25, 22)
  let y = 38

  // Resumen
  autoTable(doc, {
    startY: y,
    head: [['Resumen', 'Valor']],
    body: [
      ['Proveedores a pagar', String(proveedores.length)],
      ['Prendas incluidas', String(totalPrendas)],
      ['Total a pagar', fmt$(totalGeneral)],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [232, 224, 214], textColor: [28, 25, 22] },
    margin: { left: margin, right: margin },
    theme: 'striped',
  })

  y = doc.lastAutoTable.finalY + 6

  // Detalle por proveedor
  proveedores.forEach((prov, index) => {
    const nombre = prov.nombre || prov.id || `Proveedor ${index + 1}`

    if (y > H - 40) {
      doc.addPage()
      y = 18
    }

    doc.setFillColor(67, 56, 202)
    doc.rect(margin, y, W - margin * 2, 7, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(`${nombre} (${prov.id || '-'})`, margin + 3, y + 5)
    doc.text(fmt$(prov.total || 0), W - margin - 3, y + 5, { align: 'right' })
    doc.setTextColor(28, 25, 22)
    y += 9

    autoTable(doc, {
      startY: y,
      head: [['Producto', 'Venta', 'ID Prenda', 'Precio venta', 'A pagar']],
      body: (prov.prendas || []).map(v => [
        (v.Descripcion || v.IDProducto || '').slice(0, 44),
        v.IDVenta || '-',
        v.IDProducto || '-',
        fmt$(v.PrecioVentaFinal || 0),
        fmt$(v.CostoProveedor || 0),
      ]),
      styles: { fontSize: 8, cellPadding: 1.8 },
      headStyles: { fillColor: [224, 231, 255], textColor: [28, 25, 22] },
      margin: { left: margin, right: margin },
      theme: 'grid',
    })

    y = doc.lastAutoTable.finalY + 5
  })

  // Footer
  const pages = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(158, 144, 135)
    doc.text(`Otra Vuelta — Lote de pagos — ${fmtDate(fecha)} — Pagina ${i}/${pages}`, W / 2, 292, { align: 'center' })
  }

  doc.save(`OtraVuelta_LotePagos_${fecha}.pdf`)
}
