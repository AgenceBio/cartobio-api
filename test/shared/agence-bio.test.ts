import {
  checkOcToken,
  fetchEmailForNumeroBio,
  parsePacDetailsFromComment,
  fetchOperatorByNumeroBio,
  fetchCustomersByOc,
  fetchOperatorsForAdmin
} from '../../src/clients/agence-bio.client.js'
import { get, post } from '../got-mock.js'
import agencebioOperator from '../fixtures/providers/agence-bio-operateur.json' with { type: 'json' }

describe('parsePacDetailsFromComment', () => {
  test('detect Ilot et Parcelle from explicit naming', async () => {
    expect(parsePacDetailsFromComment('parcelle 5 ilot 12')).toEqual({
      numeroIlot: '12',
      numeroParcelle: '5'
    })
    expect(parsePacDetailsFromComment('ilot 12 parcelle 5')).toEqual({
      numeroIlot: '12',
      numeroParcelle: '5'
    })
  })

  test('detect Ilot et Parcelle from compact naming', async () => {
    expect(parsePacDetailsFromComment('ilot-15-2')).toEqual({
      numeroIlot: '15',
      numeroParcelle: '2'
    })
    expect(parsePacDetailsFromComment('ILOT-15-2')).toEqual({
      numeroIlot: '15',
      numeroParcelle: '2'
    })
  })

  test('assume nothing', async () => {
    expect(parsePacDetailsFromComment('')).toEqual({ numeroIlot: null, numeroParcelle: null })
    expect(parsePacDetailsFromComment('ilot-15-a')).toEqual({
      numeroIlot: null,
      numeroParcelle: null
    })
    expect(parsePacDetailsFromComment('ilot a parcelle 5')).toEqual({
      numeroIlot: null,
      numeroParcelle: null
    })
    expect(parsePacDetailsFromComment('ilot 12 parcelle a')).toEqual({
      numeroIlot: null,
      numeroParcelle: null
    })
  })
})

describe('fetch function', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('check that a numerobio is fetched', async () => {
    get.mockReturnValue({
      async json() {
        return agencebioOperator
      }
    })
    const operator = await fetchOperatorByNumeroBio('1')

    expect(get).toHaveBeenCalledTimes(1)
    expect(get.mock.calls[0]![0]).toMatch(/\/api\/operateur\/1$/)
    expect(operator.numeroBio).toBe(String(agencebioOperator.numeroBio))
    expect(operator.nom).toBe(agencebioOperator.nom)
  })

  test('fetch with memoization', async () => {
    get.mockReturnValue({
      async json() {
        return { nbTotal: 1, operateurs: [agencebioOperator] }
      }
    })
    await fetchCustomersByOc(101)
    await fetchCustomersByOc(101)
    await fetchCustomersByOc(101)

    expect(get).toHaveBeenCalledTimes(1)
  })

  test('fetch without memoization', async () => {
    get.mockReturnValue({
      async json() {
        return { nbTotal: 1, operateurs: [agencebioOperator] }
      }
    })
    await fetchCustomersByOc(201)
    await fetchCustomersByOc(202)
    await fetchCustomersByOc(203)

    expect(get).toHaveBeenCalledTimes(3)
    expect(get.mock.calls.map(([url]) => url)).toEqual([
      expect.stringMatching(/\/api\/oc\/201\/operateurs$/),
      expect.stringMatching(/\/api\/oc\/202\/operateurs$/),
      expect.stringMatching(/\/api\/oc\/203\/operateurs$/)
    ])
  })

  test('fetch paginated', async () => {
    get
      .mockReturnValueOnce({
        async json() {
          return { nbTotal: 14500, operateurs: [agencebioOperator] }
        }
      })
      .mockReturnValueOnce({
        async json() {
          return {
            nbTotal: 14500,
            operateurs: [{ ...agencebioOperator, id: 2, numeroBio: '88888' }]
          }
        }
      })
    const operators = await fetchCustomersByOc(301)
    await fetchCustomersByOc(301)

    expect(get).toHaveBeenCalledTimes(2)
    expect(get.mock.calls[0]![1].searchParams).toMatchObject({ limit: 10000 })
    expect(get.mock.calls[0]![1].searchParams).not.toHaveProperty('page')
    expect(get.mock.calls[1]![1].searchParams).toMatchObject({ limit: 10000, page: 2 })
    expect(operators.map(({ numeroBio }) => String(numeroBio))).toEqual([String(agencebioOperator.numeroBio), '88888'])
  })
})

describe('fetchOperatorsForAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const pageWith = (...operateurs: object[]) => ({
    async json() {
      return { nbTotal: operateurs.length, operateurs }
    }
  })

  test('ne cherche que par nom pour une saisie textuelle', async () => {
    get.mockReturnValue(pageWith(agencebioOperator))

    const operators = await fetchOperatorsForAdmin('ferme')

    expect(get).toHaveBeenCalledTimes(1)
    expect(get.mock.calls[0]![0]).toMatch(/\/api\/operateurs\/cartobio$/)
    expect(get.mock.calls[0]![1].searchParams).toEqual({ limit: 10000, nom: 'ferme' })
    expect(operators).toHaveLength(1)
  })

  test('cherche aussi par numéro bio et siret pour une saisie numérique, sans doublons', async () => {
    const other = { ...agencebioOperator, id: 2, numeroBio: '88888' }
    get
      .mockReturnValueOnce(pageWith(agencebioOperator))
      .mockReturnValueOnce(pageWith(agencebioOperator, other))
      .mockReturnValueOnce(pageWith(other))

    const operators = await fetchOperatorsForAdmin('12345')

    expect(get.mock.calls.map(([, options]) => options.searchParams)).toEqual([
      { limit: 10000, nom: '12345' },
      { limit: 10000, numeroBio: '12345' },
      { limit: 10000, siret: '12345' }
    ])
    expect(operators.map(({ numeroBio }) => String(numeroBio))).toEqual([String(agencebioOperator.numeroBio), '88888'])
  })

  test('écarte les opérateurs sans notification', async () => {
    get.mockReturnValue(pageWith({ ...agencebioOperator, notifications: [] }))

    expect(await fetchOperatorsForAdmin('sans-notif')).toEqual([])
  })
})

describe('fetchOperatorsForAdmin : pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('récupère toutes les pages de la recherche', async () => {
    get
      .mockReturnValueOnce({
        async json() {
          return { nbTotal: 10001, operateurs: [agencebioOperator] }
        }
      })
      .mockReturnValueOnce({
        async json() {
          return {
            nbTotal: 10001,
            operateurs: [{ ...agencebioOperator, id: 3, numeroBio: '77777' }]
          }
        }
      })

    const operators = await fetchOperatorsForAdmin('pagination')

    expect(get.mock.calls.map(([, options]) => options.searchParams)).toEqual([
      { limit: 10000, nom: 'pagination' },
      { limit: 10000, nom: 'pagination', page: 2 }
    ])
    expect(operators.map(({ numeroBio }) => String(numeroBio))).toEqual([String(agencebioOperator.numeroBio), '77777'])
  })
})

describe('fetchEmailForNumeroBio', () => {
  test("retourne les emails des utilisateurs de l'opérateur", async () => {
    get.mockReturnValueOnce({
      async json() {
        return { numerobio: '99999', utilisateurs: [{ email: 'a@test.fr' }] }
      }
    })

    expect(await fetchEmailForNumeroBio('99 999')).toEqual({
      numerobio: '99999',
      utilisateurs: [{ email: 'a@test.fr' }]
    })
    expect(get.mock.lastCall![0]).toMatch(/\/api\/operateur\/99%20999\/utilisateurs-emails$/)
  })

  test('refuse une réponse inattendue', async () => {
    get.mockReturnValueOnce({
      async json() {
        return { utilisateurs: 'aucun' }
      }
    })

    await expect(fetchEmailForNumeroBio('99999')).rejects.toMatchObject({ statusCode: 502 })
  })
})

describe('checkOcToken', () => {
  test("vérifie le jeton auprès du portail et retourne l'OC", async () => {
    post.mockReturnValueOnce({
      async json() {
        return { id: 1, nom: 'OC' }
      }
    })

    expect(await checkOcToken('jeton')).toEqual({ id: 1, nom: 'OC' })
    expect(post.mock.lastCall![0]).toMatch(/\/api\/oc\/check-token$/)
    expect(post.mock.lastCall![1]).toMatchObject({ json: { token: 'jeton' } })
  })
})
