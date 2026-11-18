import { getStreaksSuspectes } from '../../../src/modules/tableau-de-bord/tableau-de-bord.utils.js'

const envois = (...statuts: Array<string | null>) => statuts.map((statut, index) => ({ index, statut }))

describe('getStreaksSuspectes', () => {
  it('retourne une liste vide pour une liste vide', () => {
    expect(getStreaksSuspectes([])).toEqual([])
  })

  it('identifie une série de quatre succès', () => {
    const result = getStreaksSuspectes(envois('VALID', 'VALID', 'VALID', 'VALID'))

    expect(result).toHaveLength(1)
    expect(result[0]!.type).toBe('envois')
    expect(result[0]!.envois.map(({ index }) => index)).toEqual([0, 1, 2, 3])
  })

  it('regroupe ERROR et REJECTED dans une même série de refus', () => {
    const result = getStreaksSuspectes(envois('REJECTED', 'ERROR', 'REJECTED', 'ERROR'))

    expect(result).toHaveLength(1)
    expect(result[0]!.type).toBe('refus')
    expect(result[0]!.envois).toHaveLength(4)
  })

  it('ignore les séries de trois éléments', () => {
    expect(getStreaksSuspectes(envois('VALID', 'VALID', 'VALID', 'ERROR', 'REJECTED', 'ERROR'))).toEqual([])
  })

  it("n'identifie pas de série quand succès et échecs alternent", () => {
    expect(getStreaksSuspectes(envois('VALID', 'ERROR', 'VALID', 'VALID', 'ERROR', 'VALID'))).toEqual([])
  })

  it('interrompt une série sur un statut inconnu et ne compte pas les statuts inconnus', () => {
    expect(getStreaksSuspectes(envois('VALID', 'VALID', null, 'VALID', 'VALID', null, null, null, null))).toEqual([])
  })

  it('retourne toutes les séries suspectes distinctes, dans l’ordre', () => {
    const result = getStreaksSuspectes(
      envois('VALID', 'VALID', 'VALID', 'VALID', 'VALID', 'REJECTED', 'ERROR', 'REJECTED', 'ERROR')
    )

    expect(result.map(({ type, envois }) => ({ type, indexes: envois.map(({ index }) => index) }))).toEqual([
      { type: 'envois', indexes: [0, 1, 2, 3, 4] },
      { type: 'refus', indexes: [5, 6, 7, 8] }
    ])
  })
})
