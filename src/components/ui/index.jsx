import { useEffect, useMemo, useState } from 'react'

// ── Primitivos UI ─────────────────────────────────────────────────────────────

export function Input({ label, className = '', ...props }) {
  return (
    <div>
      {label && <label className="label">{label}</label>}
      <input className={`input-base ${className}`} {...props} />
    </div>
  )
}

export function Select({ label, children, className = '', ...props }) {
  return (
    <div>
      {label && <label className="label">{label}</label>}
      <select className={`input-base ${className}`} {...props}>{children}</select>
    </div>
  )
}

export function SearchableSelect({
  label,
  value,
  onChange,
  options = [],
  searchThreshold = 8,
  placeholder = 'Seleccionar…',
  searchPlaceholder = 'Buscar…',
  emptyOptionLabel,
  emptyMessage = 'Sin resultados',
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const useSimpleSelect = options.length <= searchThreshold

  const selected = options.find(o => String(o.value) === String(value)) || null
  const inputValue = open ? query : (selected?.label || '')

  useEffect(() => {
    setQuery(selected?.label || '')
  }, [selected])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => {
      const text = `${o.label || ''} ${o.value || ''} ${o.searchText || ''}`.toLowerCase()
      return text.includes(q)
    })
  }, [options, query])

  if (useSimpleSelect) {
    return (
      <div className={className}>
        {label && <label className="label">{label}</label>}
        <select
          className="input-base"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          {emptyOptionLabel && <option value="">{emptyOptionLabel}</option>}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={!!opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <div className={className}>
      {label && <label className="label">{label}</label>}
      <input
        className="input-base"
        value={inputValue}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        placeholder={selected ? selected.label : searchPlaceholder}
      />
      {open && (
        <div className="mt-2 border border-border rounded-xl bg-white max-h-52 overflow-y-auto">
          {emptyOptionLabel && (
            <button
              type="button"
              onClick={() => {
                onChange('')
                setQuery('')
                setOpen(false)
              }}
              className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 hover:bg-cream ${!value ? 'bg-brand-50 text-brand-700 font-medium' : 'text-text2'}`}
            >
              {emptyOptionLabel}
            </button>
          )}
          {filtered.slice(0, 60).map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={!!opt.disabled}
              onClick={() => {
                if (opt.disabled) return
                onChange(opt.value)
                setQuery(opt.label)
                setOpen(false)
              }}
              className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 last:border-0 ${opt.disabled ? 'opacity-50 cursor-not-allowed text-text3 bg-gray-50' : 'hover:bg-cream'} ${String(value) === String(opt.value) ? 'bg-brand-50 text-brand-700 font-medium' : 'text-text2'}`}
            >
              {opt.label}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-xs text-text3">{emptyMessage}</div>
          )}
        </div>
      )}
      {!open && !selected && !query && (
        <div className="text-xs text-text3 mt-1">{placeholder}</div>
      )}
    </div>
  )
}

export function Textarea({ label, className = '', ...props }) {
  return (
    <div>
      {label && <label className="label">{label}</label>}
      <textarea rows={3} className={`input-base resize-none ${className}`} {...props} />
    </div>
  )
}

export function Button({ children, variant = 'primary', size = 'md', className = '', ...props }) {
  const base = 'font-semibold rounded-xl transition-colors active:scale-95 flex items-center justify-center gap-2'
  const variants = {
    primary: 'bg-brand-700 text-white hover:bg-brand-800 disabled:bg-gray-200 disabled:text-gray-400',
    ghost:   'border border-border text-text2 hover:bg-cream disabled:opacity-50',
    danger:  'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100',
    success: 'bg-green-600 text-white hover:bg-green-700',
    gold:    'bg-gold text-white hover:opacity-90',
  }
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2.5 text-sm', lg: 'px-5 py-3.5 text-base w-full' }
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {children}
    </button>
  )
}

export function Modal({ title, onClose, children, footer }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <h3 className="font-serif text-lg font-semibold text-text1">{title}</h3>
          <button onClick={onClose} className="text-text3 hover:text-text1 transition-colors p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-border flex-shrink-0 flex gap-3">{footer}</div>}
      </div>
    </div>
  )
}

export function SearchBar({ value, onChange, placeholder = 'Buscar...', className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="input-base pl-9"
      />
      {value && (
        <button onClick={() => onChange('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text3 hover:text-text1">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}

export function Toast({ toast }) {
  if (!toast) return null
  return (
    <div className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-[999] px-5 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 whitespace-nowrap transition-all ${toast.type === 'error' ? 'bg-red-700 text-white' : 'bg-green-700 text-white'}`}>
      {toast.type === 'error' ? '❌' : '✅'} {toast.msg}
    </div>
  )
}

export function EmptyState({ icon = '📭', title, subtitle, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-4">
      <div className="text-5xl mb-4">{icon}</div>
      <div className="font-semibold text-text1 mb-1">{title}</div>
      {subtitle && <div className="text-sm text-text3 mb-4">{subtitle}</div>}
      {action}
    </div>
  )
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center h-full min-h-[200px]">
      <div className="w-8 h-8 border-[3px] border-brand-200 border-t-brand-700 rounded-full animate-spin" />
    </div>
  )
}

export function StatCard({ icon, label, value, sub, color = 'gold', onClick }) {
  const colors = {
    gold:   'border-yellow-200 bg-yellow-50',
    green:  'border-green-200 bg-green-50',
    red:    'border-red-200   bg-red-50',
    blue:   'border-blue-200  bg-blue-50',
    purple: 'border-purple-200 bg-purple-50',
    gray:   'border-gray-200  bg-gray-50',
  }
  const textColors = {
    gold: 'text-yellow-800', green: 'text-green-800', red: 'text-red-800',
    blue: 'text-blue-800', purple: 'text-purple-800', gray: 'text-gray-700',
  }
  return (
    <div onClick={onClick} className={`card border-2 ${colors[color]} p-4 ${onClick ? 'cursor-pointer active:scale-98' : ''}`}>
      <div className="text-2xl mb-2">{icon}</div>
      <div className="text-xs text-text3 uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-xl font-bold ${textColors[color]} mb-1`}>{value}</div>
      {sub && <div className="text-xs text-text3">{sub}</div>}
    </div>
  )
}

export function SectionHeader({ title, action }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h2 className="font-sans text-2xl sm:text-[28px] font-bold text-brand-700 tracking-wide truncate">{title}</h2>
        <div className="mt-1 h-1 w-20 rounded-full bg-gradient-to-r from-brand-700 via-brand-400 to-transparent" />
      </div>
      {action}
    </div>
  )
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-2 bg-white border border-brand-100 rounded-2xl p-1.5 mb-4 shadow-sm">
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={`flex-1 min-h-[44px] text-sm font-semibold py-2.5 px-3 rounded-xl transition-all border ${active === t.id ? 'bg-brand-700 border-brand-700 text-white shadow-md' : 'bg-transparent border-transparent text-text3 hover:bg-brand-50 hover:text-brand-700'}`}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function InfoRow({ label, value, valueClass = '' }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-sm text-text3">{label}</span>
      <span className={`text-sm font-medium text-text1 ${valueClass}`}>{value}</span>
    </div>
  )
}

export function Chip({ label, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${active ? 'bg-brand-700 text-white' : 'bg-cream text-text2 border border-border'}`}>
      {label}
    </button>
  )
}
