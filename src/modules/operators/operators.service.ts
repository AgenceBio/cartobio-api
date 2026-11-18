import { fetchCustomersByOc, fetchUserOperators, fetchOperatorsForAdmin } from '../../clients/agence-bio.client.js'
import { applyOperatorTextSearch, filterOperatorForAutocomplete, sortRecord } from '../../shared/outputs/operator.js'

import memo from 'p-memoize'
import gotModule from 'got'
import * as repository from './operators.repository.js'
import { getUserProfileById } from '../auth/auth.service.js'
import type { OperatorRecordWithUser } from './operators.types.js'
import type { OperatorFilter, AgenceBioNormalizedOperator, AgenceBioNormalizedOperatorWithRecord, AgenceBioNormalizedOperatorWithFilterData, AgenceBioNormalizedOperatorWithPinnedStatus, CartoBioOCUser } from '@agencebio/cartobio-types'
import { getRecords } from '../../shared/parcellaires/parcellaires.service.js'

type NumeroBio = string | number
type SortOrder = 'asc' | 'desc'
type SortableOperator = Pick<AgenceBioNormalizedOperator, 'nom' | 'denominationCourante' | 'notifications'> & {
  audit_date?: string | null
  certification_state?: string | null
}
type OperatorComparator = (a: SortableOperator, b: SortableOperator) => number
type RecordSort = { fn: (order: SortOrder) => OperatorComparator; psql: (order: SortOrder) => string }

type OperatorAutocompleteResult = {
  numeroBio: string
  nom: string
  denominationCourante: string
  siret: string
  numeroClient?: string
}

const getUserProfile = memo(getUserProfileById, { maxAge: 60 * 60 * 1000 })

const { HTTPError } = gotModule.default

async function serializeUser (userId: string | null, userRole: string | null): Promise<string | null> {
  if (userId === null) {
    return null
  }

  try {
    return JSON.stringify(await getUserProfile(Number(userId)))
  } catch (error) {
    if (error instanceof HTTPError && error.response.statusCode === 404) {
      return JSON.stringify({ id: Number(userId), nom: 'Utilisateur supprimé', prenom: '', groups: [], mainGroup: { nom: userRole } })
    }

    throw error
  }
}

async function withUser<T extends { user_id?: string | null; user_role?: string | null }> (record: T): Promise<OperatorRecordWithUser<T>> {
  const { user_id: userId, user_role: userRole, ...rest } = record
  return { ...rest, user: await serializeUser(userId ?? null, userRole ?? null) }
}

async function addRecordData (operateur: AgenceBioNormalizedOperator): Promise<AgenceBioNormalizedOperatorWithRecord> {
  const { otherParcellaire, ...record } = await repository.addRecordData(operateur)

  if (record.record_id === undefined) {
    return record
  }

  return {
    ...await withUser(record),
    otherParcellaire: otherParcellaire ? await Promise.all(otherParcellaire.map(withUser)) : null
  }
}

async function pinOperator (numeroBio: NumeroBio, userId: number): Promise<void> {
  await repository.pinOperator(numeroBio, userId)
}

async function unpinOperator (numeroBio: NumeroBio, userId: number): Promise<void> {
  await repository.unpinOperator(numeroBio, userId)
}

async function consultOperator (numeroBio: NumeroBio, userId: number): Promise<void> {
  await repository.consultOperator(numeroBio, userId)
}

async function getImportPAC (numeroBio: NumeroBio) {
  return repository.findImportPac(numeroBio)
}

async function hideImport (numeroBio: NumeroBio): Promise<void> {
  await repository.hideImport(numeroBio)
}

const SORT = {
  ASCENDING: 1,
  DESCENDING: -1
}

const STATUS_PRIORITY: Record<string, number> = {
  UNKNOWN: 0,
  undefined: 0,
  null: 0,
  '': 0,
  // Phase 2
  OPERATOR_DRAFT: 20,
  // Phase 3
  AUDITED: 30,
  // Phase 4
  PENDING_CERTIFICATION: 40,
  // Phase 5
  CERTIFIED: 50
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

const RECORD_SORTS: Record<'audit_date' | 'engagement_date' | 'notifications' | 'nom' | 'statut', RecordSort> = {
  audit_date: {
    fn (order) {
      const collator = new Intl.Collator('fr-FR', { usage: 'sort' })
      return function sortByAuditDate (a, b) {
        if (!a.audit_date && !!b.audit_date) {
          return (order === 'asc' ? SORT.DESCENDING : SORT.ASCENDING)
        } else if (!!a.audit_date && !b.audit_date) {
          return (order === 'asc' ? SORT.ASCENDING : SORT.DESCENDING)
        } if (!a.audit_date && !b.audit_date) {
          return collator.compare(a.nom || a.denominationCourante || '', b.nom || b.denominationCourante || '')
        }

        return collator.compare(a.audit_date ?? '', b.audit_date ?? '') * (order === 'asc' ? SORT.ASCENDING : SORT.DESCENDING)
      }
    },
    psql (order) {
      return /* sql */`
        audit_date ${order === 'asc' ? 'ASC NULLS FIRST' : 'DESC NULLS LAST'}
      `
    }
  },
  engagement_date: {
    fn (order) {
      const collator = new Intl.Collator('fr-FR', { usage: 'sort' })

      return function sortByEngagementDate (a, b) {
        const aNotif = a.notifications
        const bNotif = b.notifications

        if (aNotif?.dateDemarrage == null && bNotif?.dateDemarrage != null) {
          return (order === 'asc' ? SORT.DESCENDING : SORT.ASCENDING)
        } else if (bNotif?.dateDemarrage == null && aNotif?.dateDemarrage != null) {
          return (order === 'asc' ? SORT.ASCENDING : SORT.DESCENDING)
        } else if (bNotif?.dateDemarrage == null && aNotif?.dateDemarrage == null) {
          return collator.compare(a.nom || a.denominationCourante || '', b.nom || b.denominationCourante || '')
        }

        return collator.compare(aNotif?.dateDemarrage ?? '', bNotif?.dateDemarrage ?? '') * (order === 'asc' ? SORT.ASCENDING : SORT.DESCENDING)
      }
    },
    psql () {
      // we are not supposed to enter this case
      return 'audit_date DESC NULLS LAST'
    }
  },
  notifications: {
    fn (order) {
      const collator = new Intl.Collator('fr-FR', { usage: 'sort' })

      return function sortByNotifications (a, b) {
        const aNotif = a.notifications?.etatCertification || 'BROUILLON'
        const bNotif = b.notifications?.etatCertification || 'BROUILLON'

        if (aNotif === bNotif) {
          return collator.compare(a.nom || a.denominationCourante || '', b.nom || b.denominationCourante || '')
        }

        return (NOTIF_PRIORITY[aNotif] - NOTIF_PRIORITY[bNotif]) * (order === 'asc' ? SORT.ASCENDING : SORT.DESCENDING)
      }
    },
    psql () {
      // we are not supposed to enter this case
      return 'audit_date DESC NULLS LAST'
    }
  },
  nom: {
    fn (order) {
      const collator = new Intl.Collator('fr-FR', { usage: 'sort' })
      return function sortByName (a, b) {
        const nameA = a.nom || a.denominationCourante || ''
        const nameB = b.nom || b.denominationCourante || ''

        const startsWithSpecial = (str: string) => /^[^a-zA-Z]/.test(str)

        const isSpecialA = startsWithSpecial(nameA)
        const isSpecialB = startsWithSpecial(nameB)

        if (isSpecialA && !isSpecialB) return 1
        if (!isSpecialA && isSpecialB) return -1

        return collator.compare(nameA, nameB) * (order === 'asc' ? SORT.ASCENDING : SORT.DESCENDING)
      }
    },
    psql () {
      // we are not supposed to enter this case
      return 'audit_date DESC NULLS LAST'
    }
  },
  statut: {
    fn (order) {
      const collator = new Intl.Collator('fr-FR', { usage: 'sort' })

      return function sortByStatut (a, b) {
        if (a.certification_state === b.certification_state) {
          return collator.compare(a.nom || a.denominationCourante || '', b.nom || b.denominationCourante || '')
        }

        return (STATUS_PRIORITY[String(a.certification_state)] - STATUS_PRIORITY[String(b.certification_state)]) * (order === 'asc' ? SORT.ASCENDING : SORT.DESCENDING)
      }
    },
    psql (order) {
      return /* sql */`
        CASE certification_state
          ${Object.entries(STATUS_PRIORITY).map(([key, value]) => `WHEN '${key}' THEN ${value} `).join(' ')}
        END
        ${order === 'asc' ? 'ASC' : 'DESC'} NULLS LAST,
        audit_date DESC NULLS LAST
      `
    }
  }
}

function recordSorts (type: 'fn', sort: keyof typeof RECORD_SORTS, order: SortOrder): OperatorComparator
function recordSorts (type: 'psql', sort: keyof typeof RECORD_SORTS, order: SortOrder): string
function recordSorts (type: keyof RecordSort, sort: keyof typeof RECORD_SORTS, order: SortOrder): OperatorComparator | string {
  return RECORD_SORTS[sort][type](order)
}

async function searchControlBodyRecords ({ ocId, userId, input, page, filter, limit = 7 }: { ocId: number; userId: number; input: string; page: number; filter?: OperatorFilter; limit?: number }): Promise<{ pagination: { page: number; total: number; page_max: number }; records: AgenceBioNormalizedOperatorWithRecord[] }> {
  const PER_PAGE = limit
  let pinnedOperators: number[] | null = null

  if (filter?.pinned === true) {
    pinnedOperators = await getPinnedOperators(userId)
  }
  // we search by input — all operators comes hydrated from the Agence Bio API
  // all we have then to do is to recoup with record states
  // pagination is software-based
  const records = await Promise.all(
    [
      pinnedOperators ? Promise.resolve(pinnedOperators) : getPinnedOperators(userId),
      getCustomersByOcWithRecords(input, ocId, filter, pinnedOperators)
    ]
  )
    .then(([numeroBioPinned, records]) => {
      records = records.filter((item) => {
        if (item.list_oc_id != null && item.list_oc_id.length > 0 && item.list_oc_id.includes(ocId)) {
          return true
        }

        if (item.notifications?.organismeCertificateurId === ocId && ['ARRETEE', 'RETIREE'].includes(item.notifications.etatCertification)) {
          return false
        }

        return item.notifications?.organismeCertificateurId === ocId
      })

      if (filter) {
        const temporisation = records.filter(item => {
          if (filter.etatCertification != null && filter.etatCertification !== 'ALL') {
            const estCertifie = item.states &&
              item.states.length > 0 &&
              item.states.some(
                (state) => state.certification_state === 'CERTIFIED' && state.annee_reference_controle === filter.anneeReferenceCertification
              )

            if (filter.etatCertification === 'CERTIFIED' && !estCertifie) {
              return false
            }

            if (filter.etatCertification === 'NO_CERTIFIED' && estCertifie) {
              return false
            }
          }

          const statutParcellaire = filter.statutParcellaire
          if (statutParcellaire &&
            statutParcellaire.length > 0) {
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
    .then(records => records.toSorted(recordSorts('fn', 'nom', 'asc')))

  const pagination = {
    page,
    total: records.length,
    page_max: Math.max(Math.ceil(records.length / PER_PAGE), 1)
  }

  const pageRecords = records.sort((a, b) => sortRecord(a, b, filter?.sort)).slice(
    (pagination.page - 1) * PER_PAGE,
    (pagination.page) * PER_PAGE).map((record) => addRecordData(record))
  return {
    pagination,
    records: await Promise.all(pageRecords)
  }
}

async function searchControlBodyRecordsAdmin ({ input, page, filter, limit = 7 }: { input: string; page: number; filter?: OperatorFilter; limit?: number }): Promise<{ pagination: { page: number; total: number; page_max: number }; records: AgenceBioNormalizedOperatorWithRecord[] }> {
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

async function searchForAutocomplete (ocId: number, userId: number, input?: string): Promise<OperatorAutocompleteResult[]> {
  const records = ocId ? (await fetchCustomersByOc(ocId)).filter((operator) => filterOperatorForAutocomplete(operator, ocId)) : (await fetchUserOperators(userId)).operators

  return records.filter((record) => applyOperatorTextSearch(record, input))
    .map((record) => (
      {
        numeroBio: record.numeroBio,
        nom: record.nom,
        denominationCourante: record.denominationCourante,
        siret: record.siret,
        numeroClient: record.notifications?.numeroClient
      }))
}

async function getDashboardSummary (ocId: number, departements: string[], anneeReferenceControle: number): Promise<{ countCertifiees: number; countEnAttentes: number; countNonAuditees: number }> {
  const records = await fetchCustomersByOc(ocId)

  const numeroBios = records
    .filter(
      (item) => (departements.length === 0 || departements.includes(item.departement)) &&
      item.notifications &&
      item.notifications.certification_state !== 'ARRETEE' &&
      item.notifications.organismeCertificateurId === ocId &&
      ['ENGAGEE', 'ENGAGEE FUTUR'].includes(item.notifications.etatCertification) &&
      item.notifications.dateDemarrage && new Date(item.notifications.dateDemarrage).getFullYear() <= anneeReferenceControle &&
      item.isProduction === true
    )
    .map((r) => r.numeroBio)

  const rows = await repository.findDashboardStates(numeroBios, anneeReferenceControle)

  const certifiees = rows.find((r) => r.certifie === true)?.numerobios ?? []
  const enAttentes = rows.find((r) => r.certifie === false)?.numerobios ?? []

  const countCertifiees = certifiees.length
  const countEnAttentes = enAttentes.filter((e) => !certifiees.includes(e)).length

  return {
    countCertifiees,
    countEnAttentes,
    countNonAuditees: numeroBios.length - countCertifiees - countEnAttentes
  }
}


async function getPinnedOperators (userId: number): Promise<number[]> {
  return repository.findPinnedOperators(userId)
}

async function getCustomersForAdmin ({ input = '' }: { input?: string }): Promise<AgenceBioNormalizedOperatorWithFilterData[]> {
  return repository.getFilterData(await fetchOperatorsForAdmin(input), false)
}

async function getCustomersByOcWithRecords (input: string, oc: number, filter: OperatorFilter = {}, pinnedOperators: number[] | null = []): Promise<AgenceBioNormalizedOperatorWithFilterData[]> {
  let operators = (await fetchCustomersByOc(oc))
    .filter((operator) => operator.notifications.status !== 'BROUILLON')

  if (input) {
    operators = operators.filter((operator) => applyOperatorTextSearch(operator, input))
  } else {
    operators = operators.filter((operator) => operator.isProduction === true)
  }

  // on filtre sur le status avant de recuperer les parcellaires
  const etatNotification = filter?.etatNotification
  if (etatNotification && etatNotification.length > 0) {
    operators = operators.filter((item) =>
      (item.notifications.organismeCertificateurId === oc && etatNotification.includes(item.notifications.etatCertification)) ||
      (item.notifications.organismeCertificateurId !== oc && etatNotification.includes('ARRETEE')))
  }
  // on filtre sur les opérateurs qui n'étaient pas engagés sur l'année concernée
  const anneeReferenceCertification = filter?.anneeReferenceCertification
  if (anneeReferenceCertification) {
    operators = operators.filter((item) => item.notifications.dateDemarrage && new Date(item.notifications.dateDemarrage).getFullYear() <= anneeReferenceCertification)
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

async function getConsultedOperators (userId: number): Promise<number[]> {
  return repository.findConsultedOperators(userId)
}

async function listUserOperators (userId: number, { search, limit, offset }: { search?: string; limit?: number; offset?: number }): Promise<{ nbTotal: number; operators: AgenceBioNormalizedOperatorWithPinnedStatus[] }> {
  const [{ operators }, pinnedOperators] = await Promise.all([
    fetchUserOperators(userId),
    getPinnedOperators(userId)
  ])

  const userInput = search?.toLowerCase().trim()
  const filteredOperators = userInput
    ? operators.filter((e) =>
      e.denominationCourante.toLowerCase().includes(userInput) ||
      e.numeroBio.toString().includes(userInput) ||
      e.nom.toLowerCase().includes(userInput) ||
      e.siret.toLowerCase().includes(userInput))
    : operators

  const paginatedOperators = filteredOperators
    .toSorted(recordSorts('fn', 'notifications', 'desc'))
    .slice(offset, Number(offset) + Number(limit))
    .map((o) => ({
      ...o,
      epingle: pinnedOperators.includes(+o.numeroBio)
    }))

  return {
    nbTotal: filteredOperators.length,
    operators: paginatedOperators
  }
}

async function getOperatorsDashboard (userId: number, ocId: number): Promise<{ pinnedOperators: Array<AgenceBioNormalizedOperatorWithRecord & { epingle: boolean }>; consultedOperators: Array<AgenceBioNormalizedOperatorWithRecord & { epingle: boolean }> }> {
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
      ['ENGAGEE', 'ENGAGEE FUTUR'].includes(operator.notifications.etatCertification)
  )
  const operatorsWithData = await Promise.all(operators.map((o) => addRecordData(o)))
  const findOperator = (numeroBio: number): AgenceBioNormalizedOperatorWithRecord | undefined =>
    operatorsWithData.find((o) => Number(o.numeroBio) === numeroBio)

  return {
    pinnedOperators: pinnedNumerobios
      .filter((numeroBio) => findOperator(numeroBio))
      .map((numeroBio) => ({ ...findOperator(numeroBio), epingle: true }) as AgenceBioNormalizedOperatorWithRecord & { epingle: boolean }),
    consultedOperators: consultedNumerobio
      .filter((numeroBio) => findOperator(numeroBio))
      .map((numeroBio) => ({ ...findOperator(numeroBio), epingle: pinnedNumerobios.includes(numeroBio) }) as AgenceBioNormalizedOperatorWithRecord & { epingle: boolean })
  }
}

async function getOperatorRecordsForUser (numeroBio: string | number, user: CartoBioOCUser, operator: AgenceBioNormalizedOperator) {
  const records = await getRecords(numeroBio)

  if (!user.organismeCertificateur || user.organismeCertificateur.id === operator.organismeCertificateur.id) {
    return records
  }

  return records.filter((r) => r.oc_id === user.organismeCertificateur.id)
}

export { fetchUserOperators, fetchCustomersByOc }
export {
  searchControlBodyRecords,
  searchControlBodyRecordsAdmin,
  searchForAutocomplete,
  recordSorts,
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
