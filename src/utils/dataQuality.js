export const hasText = (value) => typeof value === 'string' && value.trim().length > 0

export const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const isPositiveNumber = (value) => toFiniteNumber(value, NaN) > 0

export const withoutTransientFields = (record = {}) => Object.fromEntries(
  Object.entries(record).filter(([key]) => !key.startsWith('_'))
)

export const getProductoIssues = (producto = {}) => {
  const issues = []
  if (!hasText(producto.notas)) issues.push('Falta descripcion')
  if (!isPositiveNumber(producto.precio)) issues.push('Falta precio valido')
  return issues
}

export const productoEstaIncompleto = (producto = {}) => getProductoIssues(producto).length > 0

export const getVentaItemIssues = (item = {}, producto = null) => {
  const issues = []

  if (!producto) issues.push('Producto inexistente en inventario')
  else if (productoEstaIncompleto(producto)) issues.push(...getProductoIssues(producto).map(issue => `Producto: ${issue}`))

  if (!hasText(item.Descripcion)) issues.push('Linea de venta sin descripcion')
  if (!isPositiveNumber(item.PrecioVentaFinal)) issues.push('Linea de venta sin precio valido')

  return issues
}