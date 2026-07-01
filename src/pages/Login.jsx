import { useState } from 'react'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../firebase'
import { Input, Button } from '../components/ui'

export default function Login() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const login = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch {
      setError('Email o contraseña incorrectos')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-cream flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="text-6xl mb-4">👗</div>
          <h1 className="font-serif text-3xl font-bold tracking-widest text-brand-700">OTRA VUELTA</h1>
          <p className="text-sm text-text3 mt-2">Sistema de gestión</p>
        </div>

        <form onSubmit={login} className="card p-6 space-y-4">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="tu@email.com"
            autoComplete="username"
            required
          />
          <Input
            label="Contraseña"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
          {error && <p className="text-sm text-red-600 text-center">{error}</p>}
          <Button type="submit" size="lg" className="mt-2" disabled={loading}>
            {loading ? 'Entrando…' : 'Ingresar'}
          </Button>
        </form>
      </div>
    </div>
  )
}
