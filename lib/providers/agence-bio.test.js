const { parsePacDetailsFromComment, fetchOperatorByNumeroBio, fetchCustomersByOc } = require('./agence-bio.js')
const { get } = require('got')
const agencebioOperator = require('./__fixtures__/agence-bio-operateur.json')

describe('parsePacDetailsFromComment', () => {
  test('detect Ilot et Parcelle from explicit naming', async () => {
    expect(parsePacDetailsFromComment('parcelle 5 ilot 12')).toEqual({ numeroIlot: '12', numeroParcelle: '5' })
    expect(parsePacDetailsFromComment('ilot 12 parcelle 5')).toEqual({ numeroIlot: '12', numeroParcelle: '5' })
  })

  test('detect Ilot et Parcelle from compact naming', async () => {
    expect(parsePacDetailsFromComment('ilot-15-2')).toEqual({ numeroIlot: '15', numeroParcelle: '2' })
    expect(parsePacDetailsFromComment('ilot-15-2')).toEqual({ numeroIlot: '15', numeroParcelle: '2' })
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
    jest.clearAllMocks()
  })

  test('check that a numerobio is fetched', async () => {
    get.mockReturnValue({
      async json () {
        return agencebioOperator
      }
    })
    await fetchOperatorByNumeroBio(1)

    expect(get).toHaveBeenCalledTimes(1)
  })

  test('fetch with memoization', async () => {
    get.mockReturnValue({
      async json () {
        return { nbTotal: 1, operateurs: [agencebioOperator] }
      }
    })
    await fetchCustomersByOc(1)
    await fetchCustomersByOc(1)
    await fetchCustomersByOc(1)

    expect(get).toHaveBeenCalledTimes(1)
  })

  test('fetch without memoization', async () => {
    get.mockReturnValue({
      async json () {
        return { nbTotal: 1, operateurs: [agencebioOperator] }
      }
    })
    await fetchCustomersByOc(1)
    await fetchCustomersByOc(2)
    await fetchCustomersByOc(3)

    expect(get).toHaveBeenCalledTimes(2)
  })

  test('fetch paginated', async () => {
    get.mockReturnValue({
      async json () {
        return { nbTotal: 14500, operateurs: [agencebioOperator] }
      }
    })
    await fetchCustomersByOc(4)
    await fetchCustomersByOc(4)

    expect(get).toHaveBeenCalledTimes(2)
  })
})
