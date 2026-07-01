export const fmt$ = (n) => {
  const parsed = Number(n)
  const safeValue = Number.isFinite(parsed) ? parsed : 0
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', minimumFractionDigits: 0,
  }).format(safeValue)
}

export const fmtDate = (d) => {
  if (!d) return '-'
  const p = d.split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d
}

export const fmtDateShort = (d) => {
  if (!d) return '-'
  const p = d.split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}` : d
}

export const today = () => new Date().toISOString().split('T')[0]

export const thisMonth = () => today().slice(0, 7)

export const nextMonthFirst = (d) => {
  const dt = new Date(d)
  dt.setMonth(dt.getMonth() + 1)
  dt.setDate(1)
  return dt.toISOString().split('T')[0]
}

export const monthLabel = (ym) => {
  if (!ym) return ''
  const [y, m] = ym.split('-')
  const names = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  return `${names[parseInt(m) - 1]} ${y}`
}

export const diffDays = (dateStr) => {
  if (!dateStr) return 0
  const diff = new Date() - new Date(dateStr)
  return Math.floor(diff / 86400000)
}

export const monthsRange = (data, field) => {
  const set = new Set(data.map(d => d[field]?.slice(0, 7)).filter(Boolean))
  set.add(thisMonth())
  return [...set].sort().reverse()
}
