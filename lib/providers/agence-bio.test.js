const { parsePacDetailsFromComment, fetchOperatorByNumeroBio, fetchUserOperatorsForDashboard, fetchCustomersByOc } = require('./agence-bio.js')
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

  test('check that each numerobio is fetched', async () => {
    get.mockReturnValue({
      async json () {
        return agencebioOperator
      }
    })
    await fetchUserOperatorsForDashboard([1, 2, 3])

    expect(get).toHaveBeenCalledTimes(3)
  })

  test('fetch with memoization', async () => {
    get.mockReturnValue({
      async json () {
        return [agencebioOperator]
      }
    })
    await fetchCustomersByOc({ ocId: 1, siret: '', numeroBio: '', nom: '' })
    await fetchCustomersByOc({ ocId: 1, siret: '', numeroBio: '', nom: '' })
    await fetchCustomersByOc({ ocId: 1, siret: '', numeroBio: '', nom: '' })

    expect(get).toHaveBeenCalledTimes(1)
  })

  test('fetch without memoization', async () => {
    get.mockReturnValue({
      async json () {
        return [agencebioOperator]
      }
    })
    await fetchCustomersByOc({ ocId: 1, siret: '1', numeroBio: '', nom: '' })
    await fetchCustomersByOc({ ocId: 1, siret: '', numeroBio: '1', nom: '' })
    await fetchCustomersByOc({ ocId: 1, siret: '', numeroBio: '', nom: '1' })

    expect(get).toHaveBeenCalledTimes(3)
  })
})
