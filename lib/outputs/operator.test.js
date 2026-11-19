const { normalizeOperator, getFilterData, addRecordData, applyOperatorTextSearch } = require('./operator.js')
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
  siret: '123456',
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

    const result = await getFilterData(operators, false)

    expect(result).toMatchObject([
      {
        ...normalizedOperator,
        states: [
          {
            certification_state: 'OPERATOR_DRAFT',
            annee_reference_controle: 2001
          }
        ]
      }
    ])
    expect(await getFilterData(operators, true)).toMatchObject([
      {
        ...normalizedOperator,
        states: [
          {
            certification_state: 'OPERATOR_DRAFT',
            annee_reference_controle: 2001
          }
        ],
        lastmixitestate: null
      }
    ])

    const resultWithData = await Promise.all(result.map(async (res) => addRecordData(res)))

    expect(resultWithData).toMatchObject([
      {
        ...normalizedOperator,
        certification_state: 'OPERATOR_DRAFT',
        lastmixitestate: null,
        annee_reference_controle: 2001
      }
    ])
  })

  it('should deal with a database absentee (no record created yet)', async () => {
    const result = await getFilterData(operators)

    return expect(result).toMatchObject([normalizedOperator])
  })

  it('should deal with an empty object', () => {
    const result = getFilterData([])

    return expect(result).resolves.toEqual([])
  })
})

describe('addRecordData()', () => {
  const operator = normalizeOperator(baseOperator)

  /**
   * @param {string} state
   * @param {object} dates
   * @param {string} dates.createdAt
   * @param {string|null} [dates.auditDate]
   * @param {string|null} [dates.certificationDateDebut]
   * @param {string|null} [dates.stateReachedAt]
   * @param {string} [versionName]
   */
  const insertRecord = (state, { createdAt, auditDate = null, certificationDateDebut = null, stateReachedAt = null }, versionName = state) => pool.query(
    `INSERT INTO cartobio_operators
      (numerobio, certification_state, version_name, created_at, updated_at, audit_date, certification_date_debut, audit_history)
      VALUES ($1, $2, $3, $4, $4, $5, $6, $7)`,
    [
      '34857', state, versionName, createdAt, auditDate, certificationDateDebut,
      JSON.stringify(stateReachedAt ? [{ type: 'CertificationStateChange', state, date: stateReachedAt }] : [])
    ]
  )

  it('should not flag a draft created before the certification, even if certification_date_debut is backdated', async () => {
    await insertRecord('OPERATOR_DRAFT', { createdAt: '2026-04-10T10:00:00Z' })
    await insertRecord('CERTIFIED', {
      createdAt: '2026-02-15T10:00:00Z',
      auditDate: '2026-02-20',
      certificationDateDebut: '2026-03-01',
      stateReachedAt: '2026-06-01T10:00:00Z'
    })

    const result = await addRecordData(operator)

    expect(result.certification_state).toBe('CERTIFIED')
    expect(result.otherParcellaire).toBeNull()
  })

  it('should flag a draft created after the certification', async () => {
    await insertRecord('CERTIFIED', {
      createdAt: '2026-02-15T10:00:00Z',
      auditDate: '2026-02-20',
      certificationDateDebut: '2026-03-01',
      stateReachedAt: '2026-06-01T10:00:00Z'
    })
    await insertRecord('OPERATOR_DRAFT', { createdAt: '2026-07-01T10:00:00Z' }, 'nouvelle version')

    const result = await addRecordData(operator)

    expect(result.certification_state).toBe('CERTIFIED')
    expect(result.otherParcellaire).toHaveLength(1)
    expect(result.otherParcellaire[0]).toMatchObject({ certification_state: 'OPERATOR_DRAFT', version_name: 'nouvelle version' })
  })

  it('should not flag two non-draft records sharing the same sort date', async () => {
    await insertRecord('CERTIFIED', { createdAt: '2026-02-15T10:00:00Z', auditDate: '2026-02-20', certificationDateDebut: '2026-03-01' }, 'v1')
    await insertRecord('AUDITED', { createdAt: '2026-02-16T10:00:00Z', auditDate: '2026-03-01' }, 'v2')

    const result = await addRecordData(operator)

    expect(result.version_name).toBe('v2')
    expect(result.otherParcellaire).toBeNull()
  })

  it('should return the latest draft without otherParcellaire when nothing is audited', async () => {
    await insertRecord('OPERATOR_DRAFT', { createdAt: '2026-02-15T10:00:00Z' }, 'v1')
    await insertRecord('OPERATOR_DRAFT', { createdAt: '2026-03-15T10:00:00Z' }, 'v2')

    const result = await addRecordData(operator)

    expect(result.version_name).toBe('v2')
    expect(result.otherParcellaire).toBeNull()
  })
})

describe('applyOperatorTextSearch()', () => {
  it('filter on info of operator', () => {
    const operator = baseOperator

    expect(applyOperatorTextSearch(operator, 'NOT_FOUND')).toEqual(false)

    expect(applyOperatorTextSearch(operator, '')).toEqual(true)
    expect(applyOperatorTextSearch(operator, 'test')).toEqual(true)
    expect(applyOperatorTextSearch(operator, 'Opérateur test')).toEqual(true)
    expect(applyOperatorTextSearch(operator, 'test')).toEqual(true)
    expect(applyOperatorTextSearch(operator, '34857')).toEqual(true)
    expect(applyOperatorTextSearch(operator, '34')).toEqual(true)
    expect(applyOperatorTextSearch(operator, 'Opérateur test')).toEqual(true)
    expect(applyOperatorTextSearch(operator, '123')).toEqual(true)
    expect(applyOperatorTextSearch(operator, '123456')).toEqual(true)
    expect(applyOperatorTextSearch(operator, '34')).toEqual(true)
  })
})
