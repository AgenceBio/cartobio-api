import { fetchCustomersByOc, fetchUserOperators, fetchOperatorsForAdmin } from '../../clients/agence-bio.client.js'
import { applyOperatorTextSearch, filterOperatorForAutocomplete, sortRecord } from '../../shared/outputs/operator.js'

import * as repository from './operators.repository.js'
import { getHistoryUser } from '../auth/auth.service.js'
import type {
  ImportPacRow,
  OperatorRecordWithUser,
  AgenceBioNormalizedOperatorWithFilterData
} from './operators.types.js'
import type {
  OperatorAutocompleteResponse,
  OperatorFilterInput,
  AgenceBioNormalizedOperator,
  AgenceBioNormalizedOperatorWithRecord,
  AgenceBioNormalizedOperatorWithPinnedStatus,
  CartoBioUser,
  NormalizedRecordSummary
} from '@agencebio/cartobio-types'
import { getRecords } from '../../shared/parcellaires/parcellaires.service.js'
import { maskOcAgents } from '../../shared/outputs/history.js'
import { isOperatorUser } from '../auth/auth.utils.js'

type NumeroBio = string | number
type SortableOperator = Pick<AgenceBioNormalizedOperator, 'nom' | 'denominationCourante' | 'notifications'>

async function serializeUser(userId: string | null, userRole: string | null): Promise<string | null> {
  if (userId === null) {
    return null
  }

  return JSON.stringify(await getHistoryUser(userId, userRole))
}

async function withUser<T extends { user_id?: string | null; user_role?: string | null }>(
  record: T
): Promise<OperatorRecordWithUser<T>> {
  const { user_id: userId, user_role: userRole, ...rest } = record
  return { ...rest, user: await serializeUser(userId ?? null, userRole ?? null) }
}

async function addRecordData(operateur: AgenceBioNormalizedOperator): Promise<AgenceBioNormalizedOperatorWithRecord> {
  const {
    otherParcellaire,
    user_id: userId,
    user_role: userRole,
    ...record
  } = await repository.addRecordData(operateur)

  if (record.record_id === undefined) {
    return record
  }

  return {
    ...record,
    user: await serializeUser(userId ?? null, userRole ?? null),
    otherParcellaire: otherParcellaire ? await Promise.all(otherParcellaire.map(withUser)) : null
  }
}

async function pinOperator(numeroBio: NumeroBio, userId: number): Promise<void> {
  await repository.pinOperator(numeroBio, userId)
}

async function unpinOperator(numeroBio: NumeroBio, userId: number): Promise<void> {
  await repository.unpinOperator(numeroBio, userId)
}

async function consultOperator(numeroBio: NumeroBio, userId: number): Promise<void> {
  await repository.consultOperator(numeroBio, userId)
}

async function getImportPAC(numeroBio: NumeroBio): Promise<ImportPacRow | null> {
  return repository.findImportPac(numeroBio)
}

async function hideImport(numeroBio: NumeroBio): Promise<void> {
  await repository.hideImport(numeroBio)
}

const NOTIF_PRIORITY: Record<string, number> = {
  BROUILLON: 0,
  ARRETEE: 1,
  'NON ENGAGEE': 4,
  'ENGAGEE FUTUR': 5,
  SUSPENDUE: 3,
  ENGAGEE: 6,
  RETIREE: 2
}

const collator = new Intl.Collator('fr-FR', { usage: 'sort' })

function compareByName(a: SortableOperator, b: SortableOperator): number {
  const nameA = a.nom || a.denominationCourante || ''
  const nameB = b.nom || b.denominationCourante || ''

  const startsWithSpecial = (str: string): boolean => /^[^a-zA-Z]/.test(str)

  const isSpecialA = startsWithSpecial(nameA)
  const isSpecialB = startsWithSpecial(nameB)

  if (isSpecialA && !isSpecialB) return 1
  if (!isSpecialA && isSpecialB) return -1

  return collator.compare(nameA, nameB)
}

function compareByNotificationsDesc(a: SortableOperator, b: SortableOperator): number {
  const aNotif = a.notifications?.etatCertification || 'BROUILLON'
  const bNotif = b.notifications?.etatCertification || 'BROUILLON'

  if (aNotif === bNotif) {
    return collator.compare(a.nom || a.denominationCourante || '', b.nom || b.denominationCourante || '')
  }

  return (NOTIF_PRIORITY[bNotif] ?? 0) - (NOTIF_PRIORITY[aNotif] ?? 0)
}

async function findControlBodyOperators({
  ocId,
  userId,
  input,
  filter
}: {
  ocId: number
  userId: number
  input: string
  filter?: OperatorFilterInput
}): Promise<Array<AgenceBioNormalizedOperatorWithFilterData & { epingle: boolean }>> {
  let pinnedOperators: number[] | null = null

  if (filter?.pinned === true) {
    pinnedOperators = await getPinnedOperators(userId)
  }
  // we search by input — all operators comes hydrated from the Agence Bio API
  // all we have then to do is to recoup with record states
  // pagination is software-based
  return Promise.all([
    pinnedOperators ? Promise.resolve(pinnedOperators) : getPinnedOperators(userId),
    getCustomersByOcWithRecords(input, ocId, filter, pinnedOperators)
  ]).then(([numeroBioPinned, records]) => {
    records = records.filter((item) => {
      if (item.list_oc_id != null && item.list_oc_id.length > 0 && item.list_oc_id.includes(ocId)) {
        return true
      }

      if (
        item.notifications?.organismeCertificateurId === ocId &&
        ['ARRETEE', 'RETIREE'].includes(item.notifications.etatCertification ?? '')
      ) {
        return false
      }

      return item.notifications?.organismeCertificateurId === ocId
    })

    if (filter) {
      const temporisation = records.filter((item) => {
        if (filter.etatCertification != null && filter.etatCertification !== 'ALL') {
          const estCertifie =
            item.states &&
            item.states.length > 0 &&
            item.states.some(
              (state) =>
                state.certification_state === 'CERTIFIED' &&
                state.annee_reference_controle === filter.anneeReferenceCertification
            )

          if (filter.etatCertification === 'CERTIFIED' && !estCertifie) {
            return false
          }

          if (filter.etatCertification === 'NO_CERTIFIED' && estCertifie) {
            return false
          }
        }

        const statutParcellaire = filter.statutParcellaire
        if (statutParcellaire && statutParcellaire.length > 0) {
          let states = item.states ?? []

          if (states.length > 0 && filter.anneeReferenceCertification) {
            states = states.filter((state) => state.annee_reference_controle === filter.anneeReferenceCertification)
          }

          // Aucun parcellaire sur l'année de reference
          if (states.length === 0 && !statutParcellaire.includes('NONE')) {
            return false
          }

          if (states.length > 0 && !states.some((state) => statutParcellaire.includes(state.certification_state))) {
            return false
          }
        }

        if (filter.engagement && filter.engagement.length > 0) {
          if (!filter.engagement.includes(item.lastmixitestate as string)) return false
        }

        return true
      })
      return temporisation.map((r) => ({ ...r, epingle: numeroBioPinned.includes(+r.numeroBio) }))
    }

    return records.map((r) => ({ ...r, epingle: numeroBioPinned.includes(+r.numeroBio) }))
  })
}

async function searchControlBodyRecords({
  ocId,
  userId,
  input,
  page,
  filter,
  limit = 7
}: {
  ocId: number
  userId: number
  input: string
  page: number
  filter?: OperatorFilterInput
  limit?: number
}): Promise<{
  pagination: { page: number; total: number; page_max: number }
  records: AgenceBioNormalizedOperatorWithRecord[]
}> {
  const PER_PAGE = limit
  const records = await findControlBodyOperators({ ocId, userId, input, filter })

  const pagination = {
    page,
    total: records.length,
    page_max: Math.max(Math.ceil(records.length / PER_PAGE), 1)
  }

  const pageRecords = records
    .sort((a, b) => sortRecord(a, b, filter?.sort) || compareByName(a, b))
    .slice((pagination.page - 1) * PER_PAGE, pagination.page * PER_PAGE)
    .map((record) => addRecordData(record))
  return {
    pagination,
    records: await Promise.all(pageRecords)
  }
}

async function searchControlBodyRecordsAdmin({
  input,
  page,
  filter,
  limit = 7
}: {
  input: string
  page: number
  filter?: OperatorFilterInput
  limit?: number
}): Promise<{
  pagination: { page: number; total: number; page_max: number }
  records: AgenceBioNormalizedOperatorWithRecord[]
}> {
  const records = await getCustomersForAdmin({ input })

  const pagination = {
    page,
    total: records.length,
    page_max: Math.max(Math.ceil(records.length / limit), 1)
  }

  const pageRecords = records
    .sort((a, b) => sortRecord(a, b, filter?.sort))
    .slice((pagination.page - 1) * limit, pagination.page * limit)
    .map((record) => addRecordData(record))

  return {
    pagination,
    records: await Promise.all(pageRecords)
  }
}

async function searchForAutocomplete(
  ocId: number | undefined,
  userId: number,
  input?: string
): Promise<OperatorAutocompleteResponse> {
  const records = ocId
    ? (await fetchCustomersByOc(ocId)).filter((operator) => filterOperatorForAutocomplete(operator, ocId))
    : (await fetchUserOperators(userId)).operators

  return records
    .filter((record) => applyOperatorTextSearch(record, input))
    .map((record) => ({
      numeroBio: record.numeroBio,
      nom: record.nom,
      denominationCourante: record.denominationCourante,
      siret: record.siret,
      numeroClient: record.notifications?.numeroClient
    }))
}

async function getDashboardSummary(
  ocId: number,
  departements: string[],
  anneeReferenceControle: number
): Promise<{ countCertifiees: number; countEnAttentes: number; countNonAuditees: number }> {
  const records = await fetchCustomersByOc(ocId)

  const numeroBios = records
    .filter(
      (item) =>
        (departements.length === 0 || departements.includes(item.departement ?? '')) &&
        item.notifications &&
        item.notifications.certification_state !== 'ARRETEE' &&
        item.notifications.organismeCertificateurId === ocId &&
        ['ENGAGEE', 'ENGAGEE FUTUR'].includes(item.notifications.etatCertification ?? '') &&
        item.notifications.dateDemarrage &&
        new Date(item.notifications.dateDemarrage).getFullYear() <= anneeReferenceControle &&
        item.isProduction === true
    )
    .map((r) => String(r.numeroBio))

  const rows = await repository.findDashboardStates(numeroBios, anneeReferenceControle)

  const certifiees = rows.find((r) => r.certifie === true)?.numerobios ?? []
  const enAttentes = rows.find((r) => r.certifie === false)?.numerobios ?? []

  const countCertifiees = certifiees.length
  const certifieesSet = new Set(certifiees)
  const countEnAttentes = enAttentes.filter((e) => !certifieesSet.has(e)).length

  return {
    countCertifiees,
    countEnAttentes,
    countNonAuditees: numeroBios.length - countCertifiees - countEnAttentes
  }
}

async function getPinnedOperators(userId: number): Promise<number[]> {
  return repository.findPinnedOperators(userId)
}

async function getCustomersForAdmin({
  input = ''
}: {
  input?: string
}): Promise<AgenceBioNormalizedOperatorWithFilterData[]> {
  return repository.getFilterData(await fetchOperatorsForAdmin(input), false)
}

async function getCustomersByOcWithRecords(
  input: string,
  oc: number,
  filter: OperatorFilterInput = {},
  pinnedOperators: number[] | null = []
): Promise<AgenceBioNormalizedOperatorWithFilterData[]> {
  let operators = (await fetchCustomersByOc(oc)).filter((operator) => operator.notifications.status !== 'BROUILLON')

  if (input) {
    operators = operators.filter((operator) => applyOperatorTextSearch(operator, input))
  } else {
    operators = operators.filter((operator) => operator.isProduction === true)
  }

  // on filtre sur le status avant de recuperer les parcellaires
  const etatNotification = filter?.etatNotification
  if (etatNotification && etatNotification.length > 0) {
    operators = operators.filter(
      (item) =>
        (item.notifications.organismeCertificateurId === oc &&
          etatNotification.includes(item.notifications.etatCertification ?? '')) ||
        (item.notifications.organismeCertificateurId !== oc && etatNotification.includes('ARRETEE'))
    )
  }
  // on filtre sur les opérateurs qui n'étaient pas engagés sur l'année concernée
  const anneeReferenceCertification = filter?.anneeReferenceCertification
  if (anneeReferenceCertification) {
    operators = operators.filter(
      (item) =>
        item.notifications.dateDemarrage &&
        new Date(item.notifications.dateDemarrage).getFullYear() <= anneeReferenceCertification
    )
  }

  const departement = filter?.departement
  if (departement && departement.length > 0) {
    operators = operators.filter((item) => {
      if (!item.departement) return false

      if (item.departement === '97') {
        const domCode = item.codeCommune?.substring(0, 3)
        return domCode && departement.includes(domCode)
      }
      return departement.includes(item.departement)
    })
  }

  if (filter?.pinned === true && Array.isArray(pinnedOperators)) {
    operators = operators.filter((item) => pinnedOperators.includes(+item.numeroBio))
  }

  if (filter.engagement && filter.engagement.length > 0) {
    return repository.getFilterData(operators, true)
  }

  return repository.getFilterData(operators, false)
}

async function getConsultedOperators(userId: number): Promise<number[]> {
  return repository.findConsultedOperators(userId)
}

async function listUserOperators(
  userId: number,
  { search, limit, offset }: { search?: string; limit: number; offset: number }
): Promise<{ nbTotal: number; operators: AgenceBioNormalizedOperatorWithPinnedStatus[] }> {
  const [{ operators }, pinnedOperators] = await Promise.all([fetchUserOperators(userId), getPinnedOperators(userId)])

  const userInput = search?.toLowerCase().trim()
  const filteredOperators = userInput
    ? operators.filter(
        (e) =>
          e.denominationCourante?.toLowerCase().includes(userInput) ||
          e.numeroBio.toString().includes(userInput) ||
          e.nom?.toLowerCase().includes(userInput) ||
          e.siret?.toLowerCase().includes(userInput)
      )
    : operators

  const paginatedOperators = filteredOperators
    .toSorted(compareByNotificationsDesc)
    .slice(offset, offset + limit)
    .map((o) => ({
      ...o,
      epingle: pinnedOperators.includes(+o.numeroBio)
    }))

  return {
    nbTotal: filteredOperators.length,
    operators: paginatedOperators
  }
}

async function getOperatorsDashboard(
  userId: number,
  ocId: number
): Promise<{
  pinnedOperators: Array<AgenceBioNormalizedOperatorWithRecord & { epingle: boolean }>
  consultedOperators: Array<AgenceBioNormalizedOperatorWithRecord & { epingle: boolean }>
}> {
  const [pinnedNumerobios, consultedNumerobio] = await Promise.all([
    getPinnedOperators(userId),
    getConsultedOperators(userId)
  ])

  const uniqueNumerobios = [...new Set([...pinnedNumerobios, ...consultedNumerobio])]
  const operators = (await fetchCustomersByOc(ocId)).filter(
    (operator) =>
      uniqueNumerobios.includes(Number(operator.numeroBio)) &&
      operator.notifications.certification_state !== 'ARRETEE' &&
      operator.notifications.organismeCertificateurId === ocId &&
      ['ENGAGEE', 'ENGAGEE FUTUR'].includes(operator.notifications.etatCertification ?? '')
  )
  const operatorsWithData = await Promise.all(operators.map((o) => addRecordData(o)))
  const findOperator = (numeroBio: number): AgenceBioNormalizedOperatorWithRecord | undefined =>
    operatorsWithData.find((o) => Number(o.numeroBio) === numeroBio)

  return {
    pinnedOperators: pinnedNumerobios
      .filter((numeroBio) => findOperator(numeroBio))
      .map(
        (numeroBio) =>
          ({ ...findOperator(numeroBio), epingle: true }) as AgenceBioNormalizedOperatorWithRecord & {
            epingle: boolean
          }
      ),
    consultedOperators: consultedNumerobio
      .filter((numeroBio) => findOperator(numeroBio))
      .map(
        (numeroBio) =>
          ({
            ...findOperator(numeroBio),
            epingle: pinnedNumerobios.includes(numeroBio)
          }) as AgenceBioNormalizedOperatorWithRecord & { epingle: boolean }
      )
  }
}

async function getOperatorRecordsForUser(
  numeroBio: string | number,
  user: CartoBioUser,
  operator: AgenceBioNormalizedOperator
): Promise<NormalizedRecordSummary[]> {
  const records = await getRecords(numeroBio)
  const oc = user.organismeCertificateur
  const visibleRecords =
    !oc || oc.id === operator.organismeCertificateur.id ? records : records.filter((r) => r.oc_id === oc.id)

  return visibleRecords.map((record) => {
    const viewer = { user, ocId: oc?.id }
    const currentOcId = operator.organismeCertificateur.id
    if (isOperatorUser(user)) return maskOcAgents({ ...record, audit_notes: null }, viewer, currentOcId)
    if (oc && record.oc_id !== oc.id)
      return maskOcAgents({ ...record, audit_notes: null, audit_demandes: null }, viewer, currentOcId)
    return maskOcAgents(record, viewer, currentOcId)
  })
}

export { fetchUserOperators, fetchCustomersByOc }
export {
  findControlBodyOperators,
  searchControlBodyRecords,
  searchControlBodyRecordsAdmin,
  searchForAutocomplete,
  pinOperator,
  unpinOperator,
  consultOperator,
  getDashboardSummary,
  getImportPAC,
  hideImport,
  getPinnedOperators,
  getConsultedOperators,
  listUserOperators,
  getOperatorsDashboard,
  getOperatorRecordsForUser
}
