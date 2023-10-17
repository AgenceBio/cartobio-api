const { normalizeOperator, populateWithRecords } = require('./operator.js')
const pool = require('../db.js')

jest.mock('../db.js')

/**
 * @typedef {import('../providers/agence-bio.js').AgenceBioOperator} AgenceBioOperator
 * @typedef {import('../providers/agence-bio.js').OrganismeCertificateur} OrganismeCertificateur
 */

/** @type {OrganismeCertificateur} */
const organismeCertificateur = { id: 999, nom: 'CartoBiOC', numeroControleEu: 'FR-BIO-999' }

/** @type {AgenceBioOperator} */
const baseOperator = {
  id: 1,
  dateEngagement: '2023-01-01',
  flag: 'aaah',
  photos: [],
  nom: 'Opérateur test',
  numeroBio: '34857',
  certificats: [
    {
      organisme: 'CartoBiOC',
      organismeCertificateurId: 999,
      date: '2023-02-28'
    }
  ],
  notifications: [
    {
      id: 1,
      date: '2023-01-01'
    },
    {
      id: 2,
      date: '2023-01-01',
      organismeCertificateur
    }
  ]
}

describe('normalizeOperator()', () => {
  it('should derive organismeCertificateur from certificate', () => {
    const operator = baseOperator

    expect(normalizeOperator(operator)).toMatchObject({
      id: 1,
      numeroBio: '34857',
      codeCommune: null,
      numeroPacage: null,
      organismeCertificateur: { id: 999, nom: 'CartoBiOC' }
    })
  })

  it('should derive organismeCertificateur from a notification', () => {
    const operator = { ...baseOperator, certificats: null }

    expect(normalizeOperator(operator)).toMatchObject({
      id: 1,
      numeroBio: '34857',
      codeCommune: null,
      numeroPacage: null,
      organismeCertificateur: { id: 999, nom: 'CartoBiOC' }
    })
  })

  it('should ignore a notification without organismeCertificateur', () => {
    const operator = { ...baseOperator, certificats: null, notifications: [{ id: 1, date: '2023-01-01' }] }

    expect(normalizeOperator(operator)).toMatchObject({
      id: 1,
      numeroBio: '34857',
      codeCommune: null,
      numeroPacage: null,
      organismeCertificateur: {}
    })
  })

  it('should assume no organismeCertificateur otherwise (not super usual)', () => {
    expect(normalizeOperator({ ...baseOperator, certificats: null, notifications: null })).toMatchObject({
      id: 1,
      numeroBio: '34857',
      codeCommune: null,
      numeroPacage: null,
      organismeCertificateur: {}
    })
  })
})

describe('populateWithRecords()', () => {
  const normalizedOperator = normalizeOperator(baseOperator)
  const operators = [normalizedOperator]

  it('should expand an AgenceBioOperator with a matching database value', () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        numerobio: '1',
        certification_state: 'OPERATOR_DRAFT'
      }]
    })

    const result = populateWithRecords(operators)

    return expect(result).resolves.toMatchObject([
      {

      }
    ])
  })

  it('should deal with a database absentee (no record created yet)', () => {
    pool.query.mockResolvedValueOnce({ rows: [] })

    const result = populateWithRecords(operators)

    return expect(result).resolves.toMatchObject([normalizedOperator])
  })

  it('should deal with an empty object', () => {
    const result = populateWithRecords([])

    return expect(result).resolves.toEqual([])
  })
})
