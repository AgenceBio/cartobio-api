import { CertificationState } from '@agencebio/cartobio-types'
import type { AgenceBioNormalizedOperator, HistoryEntry, NormalizedRecordSummary } from '@agencebio/cartobio-types'
import { fetchCustomersByOc, fetchUserOperators } from '../../../src/clients/agence-bio.client.js'
import type { AgenceBioNotification } from '../../../src/clients/agence-bio.types.js'
import * as repository from '../../../src/modules/operators/operators.repository.js'
import { getRecords } from '../../../src/shared/parcellaires/parcellaires.service.js'
import {
  getDashboardSummary,
  getOperatorRecordsForUser,
  listUserOperators
} from '../../../src/modules/operators/operators.service.js'
import { buildOcUser, buildOperator, buildUser } from '../../factories.js'

vi.mock('../../../src/clients/agence-bio.client.js')
vi.mock('../../../src/modules/operators/operators.repository.js')
vi.mock('../../../src/shared/parcellaires/parcellaires.service.js')

const mockedRepo = vi.mocked(repository)
type OperatorWithNotification = AgenceBioNormalizedOperator & {
  notifications: AgenceBioNotification
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getOperatorRecordsForUser', () => {
  const ocAgent = (ocId: number) => ({
    id: 99,
    nom: 'Agent',
    prenom: 'X',
    groups: [],
    mainGroup: { nom: 'Auditeur' },
    organismeCertificateur: { id: ocId, nom: `OC ${ocId}` }
  })
  const record = (ocId: number): NormalizedRecordSummary =>
    ({
      record_id: `r-${ocId}`,
      oc_id: ocId,
      audit_notes: 'notes',
      audit_demandes: 'demandes',
      certification_state: CertificationState.AUDITED,
      audit_history: [{ type: 'CertificationStateChange', date: '2025-01-01T00:00:00.000Z', user: ocAgent(ocId) }]
    }) as unknown as NormalizedRecordSummary
  const operator = buildOperator({ organismeCertificateur: { id: 1, nom: 'OC 1' } })
  const agentOf = (summary: NormalizedRecordSummary) => (summary.audit_history as HistoryEntry[])[0]!.user

  beforeEach(() => {
    vi.mocked(getRecords).mockResolvedValue([record(1), record(2)])
  })

  test("l'OC actuel voit tous les parcellaires mais l'agent d'un ancien OC est anonymisé", async () => {
    const records = await getOperatorRecordsForUser('99999', buildOcUser(), operator)

    expect(records.map(({ record_id }) => record_id)).toEqual(['r-1', 'r-2'])
    expect(records[0]).toMatchObject({ audit_notes: 'notes', audit_demandes: 'demandes' })
    expect(agentOf(records[0]!)).toMatchObject({ id: 99, nom: 'Agent' })
    expect(records[1]).toMatchObject({ audit_notes: null, audit_demandes: null })
    expect(agentOf(records[1]!)).toMatchObject({ id: 0, nom: 'OC 2', prenom: '' })
  })

  test('un ancien OC ne voit que ses propres parcellaires', async () => {
    const user = buildOcUser({ organismeCertificateur: { id: 2, nom: 'OC 2' } })

    const records = await getOperatorRecordsForUser('99999', user, operator)

    expect(records.map(({ record_id }) => record_id)).toEqual(['r-2'])
    expect(records[0]).toMatchObject({ audit_notes: 'notes', audit_demandes: 'demandes' })
  })

  test("l'opérateur voit tous ses parcellaires sans les notes d'audit", async () => {
    const records = await getOperatorRecordsForUser('99999', buildUser(), operator)

    expect(records.map(({ record_id }) => record_id)).toEqual(['r-1', 'r-2'])
    expect(records.every(({ audit_notes }) => audit_notes === null)).toBe(true)
    expect(records[0]).toMatchObject({ audit_demandes: 'demandes' })
    expect(agentOf(records[1]!)).toMatchObject({ id: 0 })
  })

  test("l'administrateur voit tout sans anonymisation", async () => {
    const admin = buildUser({
      groups: [{ id: '1', nom: 'Admin' }],
      mainGroup: { id: '1', nom: 'Admin' }
    })

    const records = await getOperatorRecordsForUser('99999', admin, operator)

    expect(records[1]).toMatchObject({ audit_notes: 'notes', audit_demandes: 'demandes' })
    expect(agentOf(records[1]!)).toMatchObject({ id: 99 })
  })
})

describe('listUserOperators', () => {
  const notified = (nom: string, numeroBio: string, etatCertification: string | null): AgenceBioNormalizedOperator =>
    buildOperator({
      nom,
      numeroBio,
      siret: `siret-${numeroBio}`,
      notifications: { etatCertification } as AgenceBioNormalizedOperator['notifications']
    })

  beforeEach(() => {
    vi.mocked(fetchUserOperators).mockResolvedValue({
      operators: [
        notified('Brouillon', '1', null),
        notified('Zèbre', '2', 'ENGAGEE'),
        notified('Arrêtée', '3', 'ARRETEE'),
        notified('Abeille', '4', 'ENGAGEE'),
        notified('Futur', '5', 'ENGAGEE FUTUR')
      ]
    })
    mockedRepo.findPinnedOperators.mockResolvedValue([4])
  })

  test("trie par état d'engagement puis par nom et marque les épinglés", async () => {
    const { nbTotal, operators } = await listUserOperators(1, { limit: 10, offset: 0 })

    expect(nbTotal).toBe(5)
    expect(operators.map(({ nom }) => nom)).toEqual(['Abeille', 'Zèbre', 'Futur', 'Arrêtée', 'Brouillon'])
    expect(operators.map(({ epingle }) => epingle)).toEqual([true, false, false, false, false])
  })

  test('pagine après le tri', async () => {
    const { nbTotal, operators } = await listUserOperators(1, { limit: 2, offset: 2 })

    expect(nbTotal).toBe(5)
    expect(operators.map(({ nom }) => nom)).toEqual(['Futur', 'Arrêtée'])
  })

  test.each([
    ['nom', '  ZÈB ', ['Zèbre']],
    ['numéro bio', '4', ['Abeille']],
    ['siret', 'SIRET-5', ['Futur']]
  ])('filtre par %s sans tenir compte de la casse', async (_, search, expected) => {
    const { nbTotal, operators } = await listUserOperators(1, { search, limit: 10, offset: 0 })

    expect(nbTotal).toBe(expected.length)
    expect(operators.map(({ nom }) => nom)).toEqual(expected)
  })
})

describe('getDashboardSummary', () => {
  const customer = (
    numeroBio: string,
    overrides: Partial<AgenceBioNotification> = {},
    operatorOverrides: Partial<AgenceBioNormalizedOperator> = {}
  ): OperatorWithNotification =>
    buildOperator({
      numeroBio,
      departement: '26',
      ...operatorOverrides,
      notifications: {
        organismeCertificateurId: 1,
        etatCertification: 'ENGAGEE',
        dateDemarrage: '2024-03-01',
        ...overrides
      } as AgenceBioNotification
    }) as OperatorWithNotification

  test('ne compte que les opérateurs engagés en production chez cet OC et à cette date', async () => {
    vi.mocked(fetchCustomersByOc).mockResolvedValue([
      customer('1'),
      customer('2', { etatCertification: 'ENGAGEE FUTUR' }),
      customer('3', { organismeCertificateurId: 2 }),
      customer('4', { etatCertification: 'SUSPENDUE' }),
      customer('5', { dateDemarrage: '2026-01-01' }),
      customer('6', { dateDemarrage: undefined }),
      customer('7', {}, { isProduction: false }),
      customer('8', {}, { departement: '07' })
    ])
    mockedRepo.findDashboardStates.mockResolvedValue([])

    const summary = await getDashboardSummary(1, ['26'], 2025)

    expect(mockedRepo.findDashboardStates).toHaveBeenCalledWith(['1', '2'], 2025)
    expect(summary).toEqual({ countCertifiees: 0, countEnAttentes: 0, countNonAuditees: 2 })
  })

  test('ne compte pas en attente un opérateur déjà certifié', async () => {
    vi.mocked(fetchCustomersByOc).mockResolvedValue(['1', '2', '3', '4'].map((n) => customer(n)))
    mockedRepo.findDashboardStates.mockResolvedValue([
      { certifie: true, numerobios: ['1'] },
      { certifie: false, numerobios: ['1', '2'] }
    ])

    expect(await getDashboardSummary(1, [], 2025)).toEqual({
      countCertifiees: 1,
      countEnAttentes: 1,
      countNonAuditees: 2
    })
  })
})
