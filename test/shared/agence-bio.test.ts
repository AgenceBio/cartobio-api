import {
  parsePacDetailsFromComment,
  fetchOperatorByNumeroBio,
  fetchCustomersByOc
} from '../../src/clients/agence-bio.client.js'
import { get } from '../got-mock.js'
import agencebioOperator from '../fixtures/providers/agence-bio-operateur.json' with { type: 'json' }

describe('parsePacDetailsFromComment', () => {
  test('detect Ilot et Parcelle from explicit naming', async () => {
    expect(parsePacDetailsFromComment('parcelle 5 ilot 12')).toEqual({ numeroIlot: '12', numeroParcelle: '5' })
    expect(parsePacDetailsFromComment('ilot 12 parcelle 5')).toEqual({ numeroIlot: '12', numeroParcelle: '5' })
  })

  test('detect Ilot et Parcelle from compact naming', async () => {
    expect(parsePacDetailsFromComment('ilot-15-2')).toEqual({ numeroIlot: '15', numeroParcelle: '2' })
    expect(parsePacDetailsFromComment('ILOT-15-2')).toEqual({ numeroIlot: '15', numeroParcelle: '2' })
  })

  test('assume nothing', async () => {
    expect(parsePacDetailsFromComment('')).toEqual({ numeroIlot: null, numeroParcelle: null })
    expect(parsePacDetailsFromComment('ilot-15-a')).toEqual({ numeroIlot: null, numeroParcelle: null })
    expect(parsePacDetailsFromComment('ilot a parcelle 5')).toEqual({ numeroIlot: null, numeroParcelle: null })
    expect(parsePacDetailsFromComment('ilot 12 parcelle a')).toEqual({ numeroIlot: null, numeroParcelle: null })
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
          return { nbTotal: 14500, operateurs: [{ ...agencebioOperator, id: 2, numeroBio: '88888' }] }
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
