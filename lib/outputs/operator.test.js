const { normalizeOperator, populateWithRecords, addRecordData } = require('./operator.js')
const pool = require('../db.js')

/**
 * @typedef {import('../providers/agence-bio.js').AgenceBioOperator} AgenceBioOperator
 * @typedef {import('../providers/agence-bio.js').OrganismeCertificateur} OrganismeCertificateur
 */

/** @type {AgenceBioOperator} */
const baseOperator = {
  id: 1,
  dateEngagement: '2023-01-01',
  flag: 'aaah',
  photos: [],
  nom: 'Opérateur test',
  numeroBio: '34857',
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
      dateDemarrage: '2023-01-01',
      activites: []
    },
    {
      id: 2,
      dateDemarrage: '2023-01-01',
      organismeCertificateurId: 999,
      organisme: 'FR-BIO-999',
      activites: []
    }
  ]
}

describe('normalizeOperator()', () => {
  it('should not be flagged has isProduction', () => {
    const operator = baseOperator

    expect(normalizeOperator(operator)).toMatchObject({
      id: 1,
      numeroBio: '34857',
      codeCommune: '42210',
      numeroPacage: null,
      organismeCertificateur: { },
      adressesOperateurs: [
        {
          lat: 45.470757,
          long: 4.63488839,
          codeCommune: '42210'
        }
      ],
      isProduction: false
    })
  })

  it('should be flagged has isProduction', () => {
    const operator = {
      ...baseOperator,
      notifications: [
        {
          id: 1,
          dateDemarrage: '2023-01-01',
          activites: [
            {
              id: 1
            }
          ]
        }
      ]
    }

    expect(normalizeOperator(operator)).toMatchObject({
      id: 1,
      numeroBio: '34857',
      codeCommune: '42210',
      numeroPacage: null,
      organismeCertificateur: { },
      adressesOperateurs: [
        {
          lat: 45.470757,
          long: 4.63488839,
          codeCommune: '42210'
        }
      ],
      isProduction: true
    })
  })

  it('should ignore a notification without organismeCertificateur', () => {
    const operator = { ...baseOperator, certificats: null, notifications: [{ id: 1, date: '2023-01-01', activites: [] }] }

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
    expect(normalizeOperator({ ...baseOperator, notifications: null })).toMatchObject({
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

    expect(result).toMatchObject([
      {
        ...normalizedOperator
      }
    ])

    const resultWithData = await Promise.all(result.map(async (res) => addRecordData(res)))

    expect(resultWithData).toMatchObject([
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
