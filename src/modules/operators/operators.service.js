'use strict'

const agenceBio = require('../../../src/clients/agence-bio.client.js')
const { escapeLiteral } = require('pg')
const { addRecordData, applyOperatorTextSearch, filterOperatorForAutocomplete, sortRecord, getConsultedOperators } = require('../../../src/shared/outputs/operator.js')

const repository = require('./operators.repository.js')
const { fetchCustomersByOc, fetchCustomersByOcWithRecords, fetchUserOperators, fetchCustomersByAdmin } = agenceBio

async function pinOperator (numeroBio, userId) {
  await repository.pinOperator(numeroBio, userId)
}

async function unpinOperator (numeroBio, userId) {
  await repository.unpinOperator(numeroBio, userId)
}

async function consultOperator (numeroBio, userId) {
  await repository.consultOperator(numeroBio, userId)
}

async function getImportPAC (numeroBio) {
  return repository.findImportPac(numeroBio)
}

async function hideImport (numeroBio) {
  await repository.hideImport(numeroBio)
}

const SORT = {
  ASCENDING: 1,
  DESCENDING: -1
}

const STATUS_PRIORITY = {
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

const NOTIF_PRIORITY = {
  BROUILLON: 0,
  ARRETEE: 1,
  'NON ENGAGEE': 4,
  'ENGAGEE FUTUR': 5,
  SUSPENDUE: 3,
  ENGAGEE: 6,
  RETIREE: 2
}

const RECORD_SORTS = {
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

        return collator.compare(a.audit_date, b.audit_date) * (order === 'asc' ? SORT.ASCENDING : SORT.DESCENDING)
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

        return collator.compare(aNotif.dateDemarrage, bNotif.dateDemarrage) * (order === 'asc' ? SORT.ASCENDING : SORT.DESCENDING)
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

        const startsWithSpecial = (str) => /^[^a-zA-Z]/.test(str)

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

        return (STATUS_PRIORITY[a.certification_state] - STATUS_PRIORITY[b.certification_state]) * (order === 'asc' ? SORT.ASCENDING : SORT.DESCENDING)
      }
    },
    psql (order) {
      return /* sql */`
        CASE certification_state
          ${Object.entries(STATUS_PRIORITY).map(([key, value]) => `WHEN ${escapeLiteral(key)} THEN ${value} `).join(' ')}
        END
        ${order === 'asc' ? 'ASC' : 'DESC'} NULLS LAST,
        audit_date DESC NULLS LAST
      `
    }
  }
}

function recordSorts (type, sort, order) {
  return RECORD_SORTS[sort][type](order)
}

/**
 * @param  {{ocId: number, userId: number, input: string, page: number, filter: OperatorFilter, limit?: number }} params
 * @returns {Promise<{pagination: { page: number, total: number, page_max: number }, records: AgenceBioNormalizedOperatorWithRecord[]}>}
 */
async function searchControlBodyRecords ({ ocId, userId, input, page, filter, limit = 7 }) {
  const PER_PAGE = limit
  let pinnedOperators = null

  if (filter?.pinned === true) {
    pinnedOperators = await getPinnedOperators(userId)
  }
  // we search by input — all operators comes hydrated from the Agence Bio API
  // all we have then to do is to recoup with record states
  // pagination is software-based
  const records = await Promise.all(
    [
      pinnedOperators ? Promise.resolve(pinnedOperators) : getPinnedOperators(userId),
      fetchCustomersByOcWithRecords(input, ocId, filter, pinnedOperators)
    ]
  )
    .then(([numeroBioPinned, records]) => {
      records = records.filter((item) => {
        if (item.list_oc_id != null && item.list_oc_id.length > 0 && item.list_oc_id.includes(ocId)) {
          return true
        }

        if (item.notifications.organismeCertificateurId === ocId && ['ARRETEE', 'RETIREE'].includes(item.notifications.etatCertification)) {
          return false
        }

        return item.notifications.organismeCertificateurId === ocId
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

          if (filter.statutParcellaire &&
            filter.statutParcellaire.length > 0) {
            let states = item.states ?? []

            if (states.length > 0 && filter.anneeReferenceCertification) {
              states = states.filter((state) => state.annee_reference_controle === filter.anneeReferenceCertification)
            }

            // Aucun parcellaire sur l'année de reference
            if (states.length === 0 && !filter.statutParcellaire.includes('NONE')) {
              return false
            }

            if (states.length > 0 && !states.some((state) => filter.statutParcellaire.includes(state.certification_state))) {
              return false
            }
          }

          if (filter.engagement && filter.engagement.length > 0) {
            if (!filter.engagement.includes(item.lastmixitestate)) return false
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

  const pageRecords = records.sort((a, b) => sortRecord(a, b, filter.sort)).slice(
    (pagination.page - 1) * PER_PAGE,
    (pagination.page) * PER_PAGE).map((record) => addRecordData(record))
  return {
    pagination,
    records: await Promise.all(pageRecords)
  }
}

/**
 * @param  {{ocId: number, userId: number, input: string, page: number, filter: any, limit?: number }} params
 * @returns {Promise<{pagination: { page: number, total: number, page_max: number }, records: AgenceBioNormalizedOperatorWithRecord[]}>}
 */
async function searchControlBodyRecordsAdmin ({ input, page, filter, limit = 7 }) {
  const records = await fetchCustomersByAdmin({ input, ...filter })

  const pagination = {
    page,
    total: records.length,
    page_max: Math.max(Math.ceil(records.length / limit), 1)
  }

  const pageRecords = records
    .sort((a, b) => sortRecord(a, b, filter.sort))
    .slice((pagination.page - 1) * limit, pagination.page * limit)
    .map((record) => addRecordData(record))

  return {
    pagination,
    records: await Promise.all(pageRecords)
  }
}

/**
 * @param {Number} ocId
 * @param {Number} userId
 * @param {String} input
 * @return {Promise<any []>}
 */
async function searchForAutocomplete (ocId, userId, input) {
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

/**
 * @param {Number} ocId
 * @param {String[]}departements
 * @param {Number} anneeReferenceControle
 * @return {Promise<{ countCertifiees: number, countEnAttentes: number, countNonAuditees: number}>}
 */
async function getDashboardSummary (ocId, departements, anneeReferenceControle) {
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


/**
 * @param userId
 * @return {Promise<number[]>}
 */
async function getPinnedOperators (userId) {
  return repository.findPinnedOperators(userId)
}

module.exports = {
  fetchUserOperators: agenceBio.fetchUserOperators,
  fetchCustomersByOc: agenceBio.fetchCustomersByOc,
  searchControlBodyRecords,
  searchControlBodyRecordsAdmin,
  searchForAutocomplete,
  recordSorts,
  pinOperator,
  unpinOperator,
  consultOperator,
  getDashboardSummary,
  getRecords: require('../../../src/shared/cartobio.service.js').getRecords,
  getImportPAC,
  hideImport,
  getPinnedOperators,
  getConsultedOperators,
  addRecordData
}
