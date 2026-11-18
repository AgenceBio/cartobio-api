import config from '../../../src/config/env.js'
import { pageUrl } from '../../../src/modules/imports/imports.utils.js'

const base = config.get('frontendUrl')

describe('pageUrl', () => {
  test('construit une url absolue sur le front en conservant les paramètres existants', () => {
    expect(pageUrl('/api/v3/import/parcellaire-imports?from=2026-10-26&to=2026-11-01', { page: 2 })).toBe(
      new URL('/api/v3/import/parcellaire-imports?from=2026-10-26&to=2026-11-01&page=2', base).toString()
    )
  })

  test('remplace un paramètre déjà présent', () => {
    expect(pageUrl('/imports?page=1&limit=10', { page: 3 })).toBe(new URL('/imports?page=3&limit=10', base).toString())
  })

  test('supprime les paramètres à null', () => {
    expect(pageUrl('/imports?page=1&limit=10', { page: null })).toBe(new URL('/imports?limit=10', base).toString())
  })

  test('fonctionne sans paramètres initiaux', () => {
    expect(pageUrl('/imports', { page: 0 })).toBe(new URL('/imports?page=0', base).toString())
  })
})
