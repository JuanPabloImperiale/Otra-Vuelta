# Otra Vuelta — App de gestión

React + Firebase · Light mode · Mobile-first

---

## Setup (primera vez)

### 1. Crear proyecto Firebase

1. Ir a [console.firebase.google.com](https://console.firebase.google.com)
2. **Crear proyecto** → nombre: `otra-vuelta` (o el que quieras)
3. En **Firestore Database** → Crear base de datos → Modo producción → Elegir región (southamerica-east1)
4. En **Authentication** → Comenzar → Método: Email/contraseña → Habilitar
5. Crear usuario: Authentication → Usuarios → Agregar usuario → tu email + contraseña
6. En **Configuración del proyecto** (ícono ⚙️) → Tus apps → Agregar app Web → Copiar `firebaseConfig`

### 2. Configurar credenciales

```bash
cp .env.example .env
```

Editar `.env` con los valores de tu `firebaseConfig`.

### 3. Reglas de Firestore

En Firebase Console → Firestore → Reglas, reemplazar con:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### 4. Instalar dependencias y correr

```bash
npm install
npm run dev
```

Abrir [http://localhost:5173](http://localhost:5173)

---

## Migración de datos del Excel

1. Ir a la app → menú ☰ → **Config**
2. En "Importar datos (CSV)" → seleccionar todos los archivos `seed_*.csv`
3. Los datos se cargan automáticamente en Firestore

Archivos a importar (están en la carpeta raíz del proyecto):
- `seed_proveedores.csv`
- `seed_categorias.csv`
- `seed_productos.csv`
- `seed_ventas.csv`
- `seed_cobros.csv`
- `seed_pagos.csv`
- `seed_cuentas_corrientes.csv`

---

## Deploy en Firebase Hosting

```bash
# Instalar Firebase CLI (una sola vez)
npm install -g firebase-tools

# Login
firebase login

# Inicializar hosting
firebase init hosting
# → Seleccionar proyecto: otra-vuelta
# → Public dir: dist
# → Single page app: YES
# → No overwrite index.html

# Build + deploy
npm run build
firebase deploy --only hosting
```

La app queda disponible en `https://tu-proyecto.web.app`

---

## Estructura del proyecto

```
src/
├── App.jsx              # Routing principal + auth guard
├── firebase.js          # Configuración Firebase
├── constants.js         # Medios de pago, categorías, nav
├── context/
│   └── AppContext.jsx   # Estado global + todas las operaciones Firestore
├── utils/
│   ├── formatters.js    # Fechas, números, helpers
│   └── exporters.js     # Excel export, PDF proveedor, texto WhatsApp
├── components/
│   ├── ui/index.jsx     # Componentes reutilizables (Modal, Button, etc.)
│   └── layout/Layout.jsx
└── pages/
    ├── Login.jsx
    ├── Dashboard.jsx    # Métricas + 5 gráficos Recharts
    ├── Inventario.jsx   # CRUD completo con foto
    ├── Ventas.jsx       # Nueva venta → cobro automático
    ├── Cobros.jsx       # CRUD cobros + BNA diferido
    ├── Proveedores.jsx  # Ficha completa + reporte WA + PDF
    ├── Pagos.jsx        # Cierre mensual + historial
    ├── Gastos.jsx       # Gastos + recurrentes + balance
    └── Configuracion.jsx # Categorías, umbral, archivo mensual, import CSV
```



 desplegar app 
 cd "/Users/juanpabloimperiale/Documents/Claude/Projects/Otra Vuelta/otra-vuelta"
 npm run build && firebase deploy --only hosting
