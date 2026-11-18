import { normalizeOperator, applyOperatorTextSearch } from '../../src/shared/outputs/operator.js'
import { getFilterData, addRecordData } from '../../src/modules/operators/operators.repository.js'
import { db } from '../../src/database/database.js'
import { parcellaires } from '../../src/database/schema/index.js'

import { buildAdresse, buildAgenceBioOperator, buildNotification } from '../factories.js'

const baseOperator = buildAgenceBioOperator({
  id: 1,
  flag: 'aaah',
  nom: 'Opérateur test',
  numeroBio: '34857',
  siret: '123456',
  numeroPacage: '',
  adressesOperateurs: [
    buildAdresse({
      active: true,
      lat: 45.470757,
      long: 4.63488839,
      codeCommune: '42210',
      ville: 'Sainte-Croix-en-Jarez'
    }),
    buildAdresse({
      active: false,
      lat: 45.47151,
      long: 4.5885,
      codeCommune: '42271',
      ville: 'Saint-Paul-en-Jarez'
    })
  ],
  notifications: [
    buildNotification({
      id: 1,
      dateDemarrage: '2023-01-01',
      activites: []
    }),
    buildNotification({
      id: 2,
      dateDemarrage: '2023-01-01',
      organismeCertificateurId: 999,
      organisme: 'FR-BIO-999',
      activites: []
    })
  ]
})

describe('normalizeOperator()', () => {
  it('should not be flagged has isProduction', () => {
    expect(normalizeOperator(baseOperator)).toMatchObject({
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
        buildNotification({
          id: 1,
          dateDemarrage: '2023-01-01',
          activites: [
            {
              id: 1,
              nom: 'Production'
            }
          ]
        })
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
    const operator = { ...baseOperator, notifications: [buildNotification({ id: 1, activites: [] })] }

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
    expect(normalizeOperator({ ...baseOperator, notifications: undefined })).toMatchObject({
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
    await db
      .insert(parcellaires)
      .values({ numeroBio: 34857, certificationEtat: 'OPERATOR_DRAFT', versionNom: 'v1', anneeReferenceControle: 2001 })

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
    const result = await getFilterData(operators, undefined)

    return expect(result).toMatchObject([normalizedOperator])
  })

  it('should deal with an empty object', () => {
    const result = getFilterData([], undefined)

    return expect(result).resolves.toEqual([])
  })
})

describe('applyOperatorTextSearch()', () => {
  it('filter on info of operator', () => {
    const operator = normalizeOperator(baseOperator)

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
