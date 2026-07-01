import { useState, useEffect } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from './firebase'
import { useApp } from './context/AppContext'
import Layout from './components/layout/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Inventario from './pages/Inventario'
import Ventas from './pages/Ventas'
import Cobros from './pages/Cobros'
import Proveedores from './pages/Proveedores'
import Pagos from './pages/Pagos'
import Gastos from './pages/Gastos'
import CuentasCorrientes from './pages/CuentasCorrientes'
import Configuracion from './pages/Configuracion'

export default function App() {
  const [user, setUser] = useState(undefined) // undefined = loading
  const [section, setSection] = useState('dashboard')
  const [sectionContext, setSectionContext] = useState(null)
  const { loading, setActiveSection } = useApp()

  const handleSectionChange = (nextSection) => {
    setSection(nextSection)
    setSectionContext(null)
  }

  const navigateToSection = (nextSection, context = null) => {
    setSection(nextSection)
    setSectionContext(context ? { ...context, target: nextSection, nonce: Date.now() } : null)
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => setUser(u || null))
    return unsub
  }, [])

  useEffect(() => {
    setActiveSection(section)
  }, [section, setActiveSection])

  // Auth loading
  if (user === undefined) return (
    <div className="fixed inset-0 bg-cream flex flex-col items-center justify-center gap-4">
      <span className="text-5xl">👗</span>
      <span className="font-serif text-2xl font-bold tracking-widest text-brand-700">OTRA VUELTA</span>
      <div className="w-8 h-8 border-2 border-brand-200 border-t-brand-700 rounded-full animate-spin mt-2" />
    </div>
  )

  if (!user) return <Login />

  // Data loading
  if (loading) return (
    <div className="fixed inset-0 bg-cream flex flex-col items-center justify-center gap-4">
      <span className="text-5xl">👗</span>
      <span className="font-serif text-2xl font-bold tracking-widest text-brand-700">OTRA VUELTA</span>
      <div className="text-sm text-text3 mt-1">Cargando datos…</div>
      <div className="w-8 h-8 border-2 border-brand-200 border-t-brand-700 rounded-full animate-spin mt-2" />
    </div>
  )

  const pages = {
    dashboard:   <Dashboard   setSection={navigateToSection} />,
    inventario:  <Inventario  setSection={navigateToSection} navigation={sectionContext?.target === 'inventario' ? sectionContext : null} />,
    ventas:      <Ventas      setSection={navigateToSection} navigation={sectionContext?.target === 'ventas' ? sectionContext : null} />,
    cobros:      <Cobros      navigation={sectionContext?.target === 'cobros' ? sectionContext : null} setSection={navigateToSection} />,
    proveedores: <Proveedores />,
    pagos:       <Pagos       />,
    gastos:      <Gastos      />,
    cuentas:     <CuentasCorrientes setSection={navigateToSection} />,
    config:      <Configuracion />,
  }

  return (
    <Layout section={section} setSection={handleSectionChange}>
      {pages[section] || pages.dashboard}
    </Layout>
  )
}
