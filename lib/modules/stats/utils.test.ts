import { getIndexesStreaksSuspectes } from './utils'

describe('getIndexesStreaksSuspectes', () => {
  it('retourne un ensemble vide pour une liste vide', () => {
    expect([...getIndexesStreaksSuspectes([])]).toEqual([])
  })

  it('identifie une série de trois succès', () => {
    const result = getIndexesStreaksSuspectes([
      { statut: 'VALID' },
      { statut: 'VALID' },
      { statut: 'VALID' },
      { statut: 'REJECTED' }
    ])

    expect([...result]).toEqual([0, 1, 2])
  })

  it('identifie une série de trois échecs, même si ERROR et REJECTED alternent', () => {
    const result = getIndexesStreaksSuspectes([
      { statut: 'REJECTED' },
      { statut: 'ERROR' },
      { statut: 'REJECTED' },
      { statut: 'VALID' }
    ])

    expect([...result]).toEqual([0, 1, 2])
  })

  it('ignore les séries de seulement deux éléments', () => {
    const result = getIndexesStreaksSuspectes([
      { statut: 'VALID' },
      { statut: 'VALID' },
      { statut: 'ERROR' },
      { statut: 'REJECTED' }
    ])

    expect([...result]).toEqual([])
  })

  it('ne considère pas un statut inconnu comme un succès ou un échec', () => {
    const result = getIndexesStreaksSuspectes([
      { statut: 'PENDING' },
      { statut: 'VALID' },
      { statut: 'VALID' },
      { statut: 'VALID' }
    ])

    expect([...result]).toEqual([1, 2, 3])
  })

  it('retourne toutes les séries suspectes distinctes', () => {
    const result = getIndexesStreaksSuspectes([
      { statut: 'VALID' },
      { statut: 'VALID' },
      { statut: 'VALID' },
      { statut: 'ERROR' },
      { statut: 'REJECTED' },
      { statut: 'ERROR' }
    ])

    expect([...result]).toEqual([0, 1, 2, 3, 4, 5])
  })
})