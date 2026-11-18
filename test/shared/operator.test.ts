import {
  normalizeOperator,
  applyOperatorTextSearch,
  filterOperatorForAutocomplete,
  sortRecord
} from '../../src/shared/outputs/operator.js'
import { findFilterData, findRecordData } from '../../src/modules/operators/operators.repository.js'
import { db } from '../../src/database/database.js'
import { parcellaires } from '../../src/database/schema/index.js'

import { buildAdresse, buildAgenceBioOperator, buildNotification, buildOperator } from '../factories.js'

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
      organismeCertificateur: {},
      adressesOperateurs: [
        {
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
      organismeCertificateur: {},
      adressesOperateurs: [
        {
          codeCommune: '42210'
        }
      ],
      isProduction: true
    })
  })

  it('should take the organismeCertificateur of the prioritary notification', () => {
    const operator = {
      ...baseOperator,
      notifications: [
        buildNotification({
          id: 1,
          etatCertification: 'SUSPENDUE',
          organismeCertificateurId: 2,
          organisme: 'Autre OC'
        }),
        buildNotification({
          id: 2,
          etatCertification: 'ENGAGEE',
          organismeCertificateurId: 999,
          organisme: 'FR-BIO-999',
          numeroClient: 'CLIENT-1'
        })
      ]
    }

    expect(normalizeOperator(operator)).toMatchObject({
      organismeCertificateur: { id: 999, nom: 'FR-BIO-999', numeroClient: 'CLIENT-1' },
      notifications: { etatCertification: 'ENGAGEE', organismeCertificateurId: 999, numeroClient: 'CLIENT-1' }
    })
  })

  it('should ignore a notification without organismeCertificateur', () => {
    const operator = {
      ...baseOperator,
      notifications: [
        buildNotification({ id: 1, etatCertification: 'ENGAGEE', organismeCertificateurId: null, organisme: 'OC' })
      ]
    }

    const normalized = normalizeOperator(operator)

    expect(normalized.organismeCertificateur).toEqual({})
    expect(normalized.notifications).toMatchObject({ etatCertification: 'ENGAGEE', organismeCertificateurId: null })
  })

  it('should assume no organismeCertificateur otherwise (not super usual)', () => {
    expect(normalizeOperator({ ...baseOperator, notifications: undefined })).toMatchObject({
      id: 1,
      numeroBio: '34857',
      codeCommune: '42210',
      numeroPacage: null,
      organismeCertificateur: {},
      notifications: null,
      isProduction: true,
      adressesOperateurs: [
        {
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

    const result = await findFilterData(operators, false)

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
    expect(await findFilterData(operators, true)).toMatchObject([
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

    const resultWithData = await Promise.all(result.map(async (res) => findRecordData(res)))

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
    const result = await findFilterData(operators, undefined)

    return expect(result).toMatchObject([normalizedOperator])
  })

  it('should deal with an empty object', () => {
    const result = findFilterData([], undefined)

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
    expect(applyOperatorTextSearch(operator, '34857')).toEqual(true)
    expect(applyOperatorTextSearch(operator, '34')).toEqual(true)
    expect(applyOperatorTextSearch(operator, '123')).toEqual(true)
    expect(applyOperatorTextSearch(operator, '123456')).toEqual(true)
  })
})

describe('normalizeOperator() : choix de la notification', () => {
  const recent = new Date().toISOString()
  const pick = (...notifications: ReturnType<typeof buildNotification>[]) =>
    normalizeOperator(buildAgenceBioOperator({ notifications })).notifications

  test('complète le numéro PACAGE sur 9 chiffres', () => {
    expect(normalizeOperator(buildAgenceBioOperator({ numeroPacage: '12345' })).numeroPacage).toBe('000012345')
  })

  test("privilégie l'état d'engagement le plus prioritaire", () => {
    expect(
      pick(
        buildNotification({ id: 1, etatCertification: 'ARRETEE', organismeCertificateurId: 1 }),
        buildNotification({ id: 2, etatCertification: 'ENGAGEE', organismeCertificateurId: 1 }),
        buildNotification({ id: 3, etatCertification: 'BROUILLON', organismeCertificateurId: 1 })
      )
    ).toMatchObject({ etatCertification: 'ENGAGEE' })
  })

  test('prend la notification engagée la plus récente', () => {
    expect(
      pick(
        buildNotification({
          id: 1,
          etatCertification: 'ENGAGEE',
          organismeCertificateurId: 1,
          dateDemarrage: '2022-01-01'
        }),
        buildNotification({
          id: 2,
          etatCertification: 'ENGAGEE',
          organismeCertificateurId: 1,
          dateDemarrage: '2024-01-01'
        })
      )
    ).toMatchObject({ dateDemarrage: '2024-01-01' })
  })

  test("prend l'arrêt le plus récent", () => {
    expect(
      pick(
        buildNotification({
          id: 1,
          etatCertification: 'ARRETEE',
          organismeCertificateurId: 1,
          dateArret: '2023-01-01'
        }),
        buildNotification({ id: 2, etatCertification: 'ARRETEE', organismeCertificateurId: 1, dateArret: '2024-06-01' })
      )
    ).toMatchObject({ dateArret: '2024-06-01' })
  })

  test('ignore une non-engagement de plus de six mois', () => {
    expect(
      pick(
        buildNotification({
          id: 1,
          etatCertification: 'NON ENGAGEE',
          organismeCertificateurId: 1,
          updatedAt: '2020-01-01'
        }),
        buildNotification({ id: 2, etatCertification: 'ARRETEE', organismeCertificateurId: 1 })
      )
    ).toMatchObject({ etatCertification: 'ARRETEE' })
    expect(
      pick(
        buildNotification({ id: 1, etatCertification: 'NON ENGAGEE', organismeCertificateurId: 1, updatedAt: recent }),
        buildNotification({ id: 2, etatCertification: 'ARRETEE', organismeCertificateurId: 1 })
      )
    ).toMatchObject({ etatCertification: 'NON ENGAGEE' })
  })

  test("marque arrêtée la dernière notification d'un ancien OC", () => {
    expect(
      pick(
        buildNotification({
          id: 1,
          etatCertification: 'ENGAGEE',
          organismeCertificateurId: 1,
          _oldOC: true,
          changementDate: '2022-01-01'
        }),
        buildNotification({
          id: 2,
          etatCertification: 'ENGAGEE',
          organismeCertificateurId: 2,
          _oldOC: true,
          changementDate: '2024-01-01'
        })
      )
    ).toMatchObject({ organismeCertificateurId: 2, certification_state: 'ARRETEE' })
  })

  test("n'a pas de notification sans notifications", () => {
    expect(pick()).toBeNull()
  })
})

describe('sortRecord()', () => {
  const op = (nom: string | null, max_audit_date: string | null = null) => ({
    ...buildOperator({ nom: nom as string }),
    max_audit_date
  })
  const sorted = (items: ReturnType<typeof op>[], key?: string) =>
    items.toSorted((a, b) => sortRecord(a, b, key)).map(({ nom, max_audit_date }) => max_audit_date ?? nom)

  test('trie par nom, les noms non alphabétiques puis absents en dernier', () => {
    expect(sorted([op(null), op('123 Ferme'), op('Zèbre'), op('abeille')])).toEqual([
      'abeille',
      'Zèbre',
      '123 Ferme',
      null
    ])
  })

  test('inverse le tri par nom', () => {
    expect(sorted([op('abeille'), op('Zèbre')], 'nom-DESC')).toEqual(['Zèbre', 'abeille'])
  })

  test("trie par date d'audit croissante, sans date en premier", () => {
    expect(sorted([op('a', '2024-05-01'), op('b'), op('c', '2023-01-01')], 'date-audit-ASC')).toEqual([
      'b',
      '2023-01-01',
      '2024-05-01'
    ])
  })

  test("trie par date d'audit décroissante, sans date en dernier", () => {
    expect(sorted([op('a', '2023-01-01'), op('b'), op('c', '2024-05-01')], 'date-audit-DESC')).toEqual([
      '2024-05-01',
      '2023-01-01',
      'b'
    ])
  })

  test('départage les dates égales par nom', () => {
    expect(
      [op('b', '2024-01-01'), op('a', '2024-01-01')].toSorted((a, b) => sortRecord(a, b, 'date-audit-ASC'))[0]!.nom
    ).toBe('a')
  })
})

describe('filterOperatorForAutocomplete()', () => {
  const withNotification = (notifications: object | null) =>
    buildOperator({ notifications: notifications as ReturnType<typeof buildOperator>['notifications'] })

  test("garde un opérateur engagé chez l'OC", () => {
    expect(
      filterOperatorForAutocomplete(withNotification({ etatCertification: 'ENGAGEE', organismeCertificateurId: 1 }), 1)
    ).toBe(true)
  })

  test.each([
    ['sans notification', null],
    ['en brouillon', { status: 'BROUILLON', etatCertification: 'ENGAGEE', organismeCertificateurId: 1 }],
    ['non engagé', { etatCertification: 'NON ENGAGEE', organismeCertificateurId: 1 }],
    ['arrêté', { etatCertification: 'ARRETEE', organismeCertificateurId: 1 }],
    ['retiré', { etatCertification: 'RETIREE', organismeCertificateurId: 1 }],
    ['chez un autre OC', { etatCertification: 'ENGAGEE', organismeCertificateurId: 2 }]
  ])('écarte un opérateur %s', (_, notifications) => {
    expect(filterOperatorForAutocomplete(withNotification(notifications), 1)).toBe(false)
  })
})
