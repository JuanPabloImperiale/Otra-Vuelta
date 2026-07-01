import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // Preserve stack details for debugging while preventing a blank screen.
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary captured an error:', error, info)
    this.setState({ info })
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, info: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-cream flex items-center justify-center p-6 z-[9999]">
          <div className="w-full max-w-lg bg-white border border-red-200 rounded-2xl shadow-lg p-6">
            <div className="text-2xl mb-2">⚠️</div>
            <h2 className="font-serif text-xl font-semibold text-red-700 mb-2">Ocurrió un error inesperado</h2>
            <p className="text-sm text-text2 mb-4">
              La pantalla no se cerró por completo para evitar perder el contexto. Podés reintentar sin recargar toda la app.
            </p>
            <div className="flex gap-2">
              <button
                onClick={this.handleRetry}
                className="flex-1 bg-brand-700 text-white font-semibold rounded-xl px-4 py-2.5 hover:bg-brand-800 transition-colors"
              >
                Reintentar
              </button>
              <button
                onClick={() => window.location.reload()}
                className="flex-1 border border-border text-text2 font-semibold rounded-xl px-4 py-2.5 hover:bg-cream transition-colors"
              >
                Recargar app
              </button>
            </div>
            {import.meta.env.DEV && this.state.error && (
              <pre className="mt-4 text-xs text-red-700 bg-red-50 border border-red-100 rounded-xl p-3 overflow-auto max-h-40">
                {String(this.state.error?.message || this.state.error)}
              </pre>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
