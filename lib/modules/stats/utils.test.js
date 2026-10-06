const { getStreaksSuspectes } = require('./utils')

describe('getStreaksSuspectes', () => {
  it('retourne un ensemble vide pour une liste vide', () => {
    expect([...getStreaksSuspectes([])]).toEqual([])
  })

  it('identifie une série de trois succès', () => {
    const result = getStreaksSuspectes([
      { statut: 'VALID' },
      { statut: 'VALID' },
      { statut: 'VALID' },
      { statut: 'VALID' }
    ])

    expect([...result[0].envois]).toHaveLength(4)
  })

  it("n'identifie une série de quatre échecs, même si ERROR et VALID alternent", () => {
    const result = getStreaksSuspectes([
      { statut: 'VALID' },
      { statut: 'ERROR' },
      { statut: 'VALID' },
      { statut: 'VALID' }
    ])

    expect([...result]).toEqual([])
  })

  it('ignore les séries de seulement deux éléments', () => {
    const result = getStreaksSuspectes([
      { statut: 'VALID' },
      { statut: 'VALID' },
      { statut: 'ERROR' },
      { statut: 'REJECTED' }
    ])

    expect([...result]).toEqual([])
  })



  it('retourne toutes les séries suspectes distinctes', () => {
    const result = getStreaksSuspectes([
      { statut: 'VALID' },
      { statut: 'VALID' },
      { statut: 'VALID' },
      { statut: 'VALID' },
      { statut: 'REJECTED' },
      { statut: 'ERROR' }
    ])

    expect([...result[0].envois]).toHaveLength(4)
  })
})