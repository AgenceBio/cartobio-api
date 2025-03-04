const { normalizeOperator, populateWithRecords } = require('./operator.js')
const pool = require('../db.js')

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
  adressesOperateurs: [
    {
      active: true,
      lat: 45.470757,
      long: 4.63488839,
      codeCommune: '42210',
      ville: 'Sainte-Croix-en-Jarez'
    },
    {
      active: false,
      lat: 45.47151,
      long: 4.5885,
      codeCommune: '42271',
      ville: 'Saint-Paul-en-Jarez'
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
      codeCommune: '42210',
      numeroPacage: null,
      organismeCertificateur: { id: 999, nom: 'CartoBiOC' },
      adressesOperateurs: [
        {
          lat: 45.470757,
          long: 4.63488839,
          codeCommune: '42210'
        }
      ]
    })
  })

  it('should derive organismeCertificateur from a notification', () => {
    const operator = { ...baseOperator, certificats: null }

    expect(normalizeOperator(operator)).toMatchObject({
      id: 1,
      numeroBio: '34857',
      codeCommune: '42210',
      numeroPacage: null,
      organismeCertificateur: { id: 999, nom: 'CartoBiOC' },
      adressesOperateurs: [
        {
          lat: 45.470757,
          long: 4.63488839,
          codeCommune: '42210'
        }
      ]
    })
  })

  it('should ignore a notification without organismeCertificateur', () => {
    const operator = { ...baseOperator, certificats: null, notifications: [{ id: 1, date: '2023-01-01' }] }

    expect(normalizeOperator(operator)).toMatchObject({
      id: 1,
      numeroBio: '34857',
      codeCommune: '42210',
      numeroPacage: null,
      organismeCertificateur: {},
      adressesOperateurs: [
        {
          lat: 45.470757,
          long: 4.63488839,
          codeCommune: '42210'
        }
      ]
    })
  })

  it('should assume no organismeCertificateur otherwise (not super usual)', () => {
    expect(normalizeOperator({ ...baseOperator, certificats: null, notifications: null })).toMatchObject({
      id: 1,
      numeroBio: '34857',
      codeCommune: '42210',
      numeroPacage: null,
      organismeCertificateur: {},
      adressesOperateurs: [
        {
          lat: 45.470757,
          long: 4.63488839,
          codeCommune: '42210'
        }
      ]
    })
  })
})

describe('populateWithRecords()', () => {
  const normalizedOperator = normalizeOperator(baseOperator)
  const operators = [normalizedOperator]

  it('should expand an AgenceBioOperator with a matching database value', async () => {
    await pool.query(
      'INSERT INTO cartobio_operators (numerobio, certification_state, version_name, annee_reference_controle) VALUES ($1, $2, $3, $4)',
      ['34857', 'OPERATOR_DRAFT', 'v1', 2001]
    )

    const result = await populateWithRecords(operators)

    return expect(result).toMatchObject([
      {
        ...normalizedOperator,
        certification_state: 'OPERATOR_DRAFT',
        annee_reference_controle: 2001
      }
    ])
  })

  it('should deal with a database absentee (no record created yet)', async () => {
    const result = await populateWithRecords(operators)

    return expect(result).toMatchObject([normalizedOperator])
  })

  it('should deal with an empty object', () => {
    const result = populateWithRecords([])

    return expect(result).resolves.toEqual([])
  })
})
