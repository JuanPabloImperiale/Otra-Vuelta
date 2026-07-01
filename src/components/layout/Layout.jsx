import { useState } from 'react'
import { NAV } from '../../constants'
import { Toast } from '../ui'
import { useApp } from '../../context/AppContext'
import { today } from '../../utils/formatters'

export default function Layout({ section, setSection, children }) {
  const { toast, working, cobros, mediosPago, gastos } = useApp()
  const [menuOpen, setMenuOpen] = useState(false)
  const active = NAV.find(n => n.id === section)
  const hoy = today()
  const mediosDiferidos = new Set((mediosPago || []).filter(m => m.esBNA).map(m => m.id))
  const cobrosAcreditanHoy = (cobros || []).filter(c => {
    const isDiferido = mediosDiferidos.has(c.medio) || (!!c.fechaReal && c.fechaReal !== c.fecha)
    return isDiferido && c.fechaReal === hoy
  }).length
  const gastosRecordatorioPendiente = (gastos || []).filter(g =>
    g.recordatorioPendiente === true && g.recordatorioFecha && g.recordatorioFecha <= hoy
  ).length

  return (
    <div className="flex flex-col h-[100dvh] bg-cream overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-border px-4 py-3 flex items-center flex-shrink-0 shadow-sm relative">
        <div className="w-10 flex items-center justify-start">
          <button onClick={() => setMenuOpen(o => !o)} className="p-1.5 rounded-lg hover:bg-cream transition-colors">
            <svg className="w-5 h-5 text-text2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>

        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full border border-brand-200 bg-gradient-to-r from-brand-50 via-white to-brand-50 shadow-sm">
          <img src="/logo-otra-vuelta.svg" alt="Logo Otra Vuelta" className="w-7 h-7 rounded-full border border-brand-200 bg-white object-cover" />
          <div className="leading-tight">
            <div className="font-sans text-sm sm:text-base font-bold tracking-[0.14em] text-brand-700">OTRA VUELTA</div>
            <div className="hidden sm:block font-sans text-[10px] text-text3">Moda circular</div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5 text-xs sm:text-sm text-text3 bg-cream border border-border rounded-full px-2.5 py-1 max-w-[45%] sm:max-w-none truncate">
          <span>{active?.icon}</span>
          <span className="truncate">{active?.label}</span>
        </div>
      </header>

      {/* Sidebar overlay */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="w-64 bg-white shadow-2xl flex flex-col py-4 border-r border-border">
            <div className="px-5 pb-4 mb-2 border-b border-border">
              <div className="flex items-center gap-2">
                <img src="/logo-otra-vuelta.svg" alt="Logo Otra Vuelta" className="w-9 h-9 rounded-full border border-border bg-white object-cover" />
                <div className="font-serif text-xl font-bold text-indigo-700 tracking-widest">OTRA VUELTA</div>
              </div>
              <div className="text-xs text-text3 mt-0.5">Sistema de gestión</div>
            </div>
            {NAV.map(n => (
              <button key={n.id}
                onClick={() => { setSection(n.id); setMenuOpen(false) }}
                className={`flex items-center gap-3 px-5 py-3 text-sm font-medium transition-colors ${section === n.id ? 'bg-brand-50 text-brand-700 border-r-2 border-brand-700' : 'text-text2 hover:bg-cream'}`}>
                <span className="text-lg">{n.icon}</span>
                <span>{n.label}</span>
                {n.id === 'cobros' && cobrosAcreditanHoy > 0 && (
                  <span className="ml-auto bg-red-600 text-white text-[10px] font-bold min-w-[18px] h-[18px] px-1.5 rounded-full inline-flex items-center justify-center">
                    {cobrosAcreditanHoy}
                  </span>
                )}
                {n.id === 'gastos' && gastosRecordatorioPendiente > 0 && (
                  <span className="ml-auto bg-red-600 text-white text-[10px] font-bold min-w-[18px] h-[18px] px-1.5 rounded-full inline-flex items-center justify-center">
                    {gastosRecordatorioPendiente}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="flex-1 bg-black/40" onClick={() => setMenuOpen(false)} />
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 py-5 pb-24">
          {children}
        </div>
      </main>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-border z-40 shadow-lg">
        <div className="max-w-5xl mx-auto flex overflow-x-auto scrollbar-hide sm:justify-center px-1 py-1">
          {NAV.map(n => (
            <button key={n.id} onClick={() => setSection(n.id)}
              className={`relative flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl transition-all flex-shrink-0 min-w-[62px] sm:min-w-[76px] border ${section === n.id ? 'text-white bg-brand-700 border-brand-700 shadow-md -translate-y-1' : 'text-text3 border-transparent hover:bg-cream'}`}>
              {section === n.id && <span className="absolute -top-1.5 h-1.5 w-8 rounded-full bg-gold" />}
              {n.id === 'cobros' && cobrosAcreditanHoy > 0 && (
                <span className="absolute top-0.5 right-1.5 bg-red-600 text-white text-[10px] font-bold min-w-[16px] h-[16px] px-1 rounded-full inline-flex items-center justify-center">
                  {cobrosAcreditanHoy}
                </span>
              )}
              {n.id === 'gastos' && gastosRecordatorioPendiente > 0 && (
                <span className="absolute top-0.5 right-1.5 bg-red-600 text-white text-[10px] font-bold min-w-[16px] h-[16px] px-1 rounded-full inline-flex items-center justify-center">
                  {gastosRecordatorioPendiente}
                </span>
              )}
              <span className={`text-lg ${section === n.id ? 'scale-110' : ''}`}>{n.icon}</span>
              <span className={`text-[9px] font-semibold leading-tight text-center ${section === n.id ? 'tracking-wide' : ''}`}>{n.label}</span>
            </button>
          ))}
        </div>
      </nav>

      <Toast toast={toast} />

      {/* Loading overlay global */}
      {working && (
        <div className="fixed inset-0 bg-black/30 z-[999] flex items-center justify-center backdrop-blur-[2px]">
          <div className="bg-white rounded-2xl px-8 py-6 flex flex-col items-center gap-3 shadow-xl">
            <div className="w-10 h-10 border-[3px] border-brand-100 border-t-brand-700 rounded-full animate-spin" />
            <span className="text-sm font-medium text-text2">Guardando…</span>
          </div>
        </div>
      )}
    </div>
  )
}
