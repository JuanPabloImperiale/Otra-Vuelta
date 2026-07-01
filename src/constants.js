// Medios de pago por defecto — se pueden editar desde Config
export const MEDIOS_PAGO_DEFAULTS = [
  { id: 'EFE', label: 'Efectivo',             color: '#16a34a', esBNA: false, esCC: false },
  { id: 'MPG', label: 'Mercado Pago Gabi',    color: '#2563eb', esBNA: false, esCC: false },
  { id: 'MPF', label: 'Mercado Pago Flor',    color: '#2563eb', esBNA: false, esCC: false },
  { id: 'MPS', label: 'Mercado Pago Sole',    color: '#2563eb', esBNA: false, esCC: false },
  { id: 'BNA', label: 'Banco Nación',         color: '#7c3aed', esBNA: true,  esCC: false },
  { id: 'CC',  label: 'Cuenta Corriente',     color: '#d97706', esBNA: false, esCC: true  },
  { id: 'Otro',label: 'Otro',                 color: '#64748b', esBNA: false, esCC: false },
]

// Fallbacks estáticos para componentes que no tienen acceso al contexto
export const MEDIOS_PAGO  = MEDIOS_PAGO_DEFAULTS.map(m => m.id)
export const MEDIO_LABELS = Object.fromEntries(MEDIOS_PAGO_DEFAULTS.map(m => [m.id, m.label]))
export const MEDIO_COLORS = Object.fromEntries(MEDIOS_PAGO_DEFAULTS.map(m => [m.id, m.color]))

export const CAT_DEFAULTS = [
  { id: 'B',  nombre: 'Bien (usado buen estado)',  porcentaje: 0.5  },
  { id: 'N',  nombre: 'Nuevo sin etiqueta',         porcentaje: 0.5  },
  { id: 'OB', nombre: 'Otros Básico',               porcentaje: 0.8  },
  { id: 'OE', nombre: 'Otros Especial',             porcentaje: 0.85 },
  { id: 'R',  nombre: 'Ropa',                       porcentaje: 0.5  },
  { id: 'E',  nombre: 'Etiqueta',                   porcentaje: 0.5  },
]

export const META_DEFAULTS = {
  lastIDProducto:  2824,
  lastIDVenta:      348,
  lastIDCobro:      396,
  lastIDPago:       701,
  lastIDProveedor:  237,
  lastIDCC:           7,
  lastIDGasto:        0,
}

export const CONFIG_DEFAULTS = {
  diasParada: 60,
}

export const NAV = [
  { id: 'dashboard',   icon: '📊', label: 'Dashboard'  },
  { id: 'inventario',  icon: '👗', label: 'Inventario'  },
  { id: 'ventas',      icon: '🛍️', label: 'Ventas'      },
  { id: 'cobros',      icon: '💰', label: 'Cobros'      },
  { id: 'proveedores', icon: '🤝', label: 'Proveedores' },
  { id: 'pagos',       icon: '💸', label: 'Pagos'       },
  { id: 'cuentas',     icon: '💳', label: 'Ctas. Ctes.' },
  { id: 'gastos',      icon: '📋', label: 'Gastos'      },
  { id: 'config',      icon: '⚙️', label: 'Config'      },
]
