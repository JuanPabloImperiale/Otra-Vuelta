import { describe, expect, it } from 'vitest'
import { withoutTransientFields } from './dataQuality'

describe('dataQuality: transient fields', () => {
  it('removes UI-only fields before persisting records', () => {
    const result = withoutTransientFields({
      id: 'IP1',
      nombre: 'Proveedor',
      _new: true,
      _docId: 'firestore-doc',
    })

    expect(result).toEqual({ id: 'IP1', nombre: 'Proveedor' })
  })
})