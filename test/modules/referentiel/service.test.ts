import * as repository from '../../../src/modules/referentiel/referentiel.repository.js'
import { getDepartement } from '../../../src/modules/referentiel/referentiel.service.js'

vi.mock('../../../src/modules/referentiel/referentiel.repository.js')

describe('getDepartement', () => {
  test('regroupe les départements par région, triés par nom', async () => {
    vi.mocked(repository.findDepartements).mockResolvedValue([
      { nomRegion: 'Occitanie', code: '34', nom: 'Hérault' },
      { nomRegion: 'Bretagne', code: '56', nom: 'Morbihan' },
      { nomRegion: 'Occitanie', code: '09', nom: 'Ariège' },
      { nomRegion: 'Bretagne', code: '22', nom: "Côtes-d'Armor" }
    ])

    const result = await getDepartement()

    expect(Object.keys(result)).toEqual(['Bretagne', 'Occitanie'])
    expect(result).toEqual({
      Bretagne: [
        { code: '22', nom: "Côtes-d'Armor" },
        { code: '56', nom: 'Morbihan' }
      ],
      Occitanie: [
        { code: '09', nom: 'Ariège' },
        { code: '34', nom: 'Hérault' }
      ]
    })
  })

  test('retourne un objet vide sans départements', async () => {
    vi.mocked(repository.findDepartements).mockResolvedValue([])

    expect(await getDepartement()).toEqual({})
  })
})
