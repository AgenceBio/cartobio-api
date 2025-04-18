'use strict'

const pool = require('../db.js')

/**
 * @typedef {import('../providers/types/agence-bio').AgenceBioOperator} AgenceBioOperator
 * @typedef {import('../providers/types/agence-bio').OrganismeCertificateur} OrganismeCertificateur
 * @typedef {import('./types/record').NormalizedRecord} NormalizedRecord
 * @typedef {import('./types/operator').AgenceBioNormalizedOperator} AgenceBioNormalizedOperator
 * @typedef {import('./types/operator').AgenceBioNormalizedOperatorWithRecord} AgenceBioNormalizedOperatorWithRecord
 * @typedef {import('./types/operator').AgenceBioNormalizedOperatorWithFilterData} AgenceBioNormalizedOperatorWithFilterData
 */

/* eslint-disable-next-line quotes */
const recordFields = /* sqlFragment */ `certification_state,audit_date,certification_date_debut,created_at,numerobio, metadata,record_id,updated_at,annee_reference_controle,version_name, (audit_history->jsonb_array_length(audit_history) - 1)->>'user' AS user `

/**
 * Populate third party information with our very own operators data
 *
 * @param  {AgenceBioNormalizedOperator[]} operators An array of objects fetched from the Agence Bio Notifications portal
 * @param  {boolean} mixite
 * @return {Promise<import('./types/operator').AgenceBioNormalizedOperatorWithFilterData[]>}
 */
async function getFilterData (operators, mixite) {
  operators = operators.sort((a, b) => (+a.numeroBio - +b.numeroBio))
  const ids = operators.map(({ numeroBio }) => String(numeroBio))

  if (ids.length === 0) {
    return []
  }

  const CTE = []
  const select = []

  if (mixite === true) {
    CTE.push(`last_certified_parcelle AS (
    SELECT DISTINCT ON (numerobio) numerobio, certification_date_debut AS lastCertifiedDate, mixite as lastMixiteState
    FROM cartobio_operators
    WHERE numerobio = ANY ($1)
      AND certification_state = 'CERTIFIED'
      AND deleted_at IS NULL
    ORDER BY numerobio, certification_date_debut DESC NULLS LAST
    )`)
    select.push('last_certified_parcelle.lastMixiteState')
  }

  CTE.push(`all_parcellaire AS (
  SELECT numerobio,
  JSON_AGG(JSON_BUILD_OBJECT('certification_state', certification_state, 'annee_reference_controle', annee_reference_controle)) as states,
  JSON_AGG(oc_id) as list_oc_id,
  MAX(audit_date) as max_audit_date
  FROM cartobio_operators
  WHERE numerobio = ANY ($1)
  AND deleted_at IS NULL
  GROUP BY numerobio
  )`)
  select.push(' all_parcellaire.numerobio')
  select.push('all_parcellaire.states')
  select.push('all_parcellaire.list_oc_id')
  select.push('all_parcellaire.max_audit_date')
  const { rows } = await pool
    .query(/* sql */`
WITH 
  ${CTE.join(',')}
SELECT
  ${select.join(',')}
FROM all_parcellaire
  ${mixite === true ? 'LEFT JOIN last_certified_parcelle ON all_parcellaire.numerobio = last_certified_parcelle.numerobio' : ''}
ORDER BY all_parcellaire.numerobio::bigint ASC
`,
    [ids])

  const res = []
  let j = 0

  for (let i = 0; i < operators.length; i++) {
    if (j === rows.length || +operators[i].numeroBio !== +rows[j].numerobio) {
      res.push({
        ...operators[i],
        metadata: {}
      })

      continue
    }

    const { metadata, ...record } = rows[j]

    res.push({
      ...operators[i],
      metadata,
      ...record
    })
    j++
  }

  return res
}

/**
 * Populate third party information with our very own operators data
 *
 * @param  {AgenceBioNormalizedOperatorWithFilterData} operateur An array of objects fetched from the Agence Bio Notifications portal
 * @return {Promise<AgenceBioNormalizedOperatorWithRecord>}
 */
async function addRecordData (operateur) {
  const { rows } = await pool
    .query(/* sql */`
WITH latest_by_state AS (
    SELECT DISTINCT ON (numerobio) *
    FROM cartobio_operators
    WHERE numerobio = $1
      AND deleted_at IS NULL
      AND certification_state IN ('AUDITED', 'PENDING_CERTIFICATION', 'CERTIFIED')
    ORDER BY numerobio, COALESCE(certification_date_debut, audit_date, created_at) DESC
),
latest_global AS (
    SELECT DISTINCT ON (numerobio) *
    FROM cartobio_operators
    WHERE numerobio = $1
      AND deleted_at IS NULL
    ORDER BY numerobio, COALESCE(certification_date_debut, audit_date, created_at) DESC
),
last_certified_parcelle AS (
    SELECT DISTINCT ON (numerobio) numerobio, annee_reference_controle AS lastCertifiedDate, mixite as lastMixiteState
    FROM cartobio_operators
    WHERE numerobio = $1
      AND certification_state = 'CERTIFIED'
      AND deleted_at IS NULL
    ORDER BY numerobio, certification_date_debut DESC NULLS LAST
)
SELECT
    combined_results.*,
    last_certified_parcelle.lastCertifiedDate,
    last_certified_parcelle.lastMixiteState
FROM (
    SELECT ${recordFields} FROM latest_by_state
    UNION
    SELECT ${recordFields} FROM latest_global
) AS combined_results
LEFT JOIN last_certified_parcelle ON combined_results.numerobio = last_certified_parcelle.numerobio
ORDER BY combined_results.numerobio, COALESCE(combined_results.certification_date_debut, combined_results.audit_date, combined_results.created_at) DESC;
    `,
    [operateur.numeroBio])

  const matchingRows = rows.filter(({ numerobio }) => numerobio === String(operateur.numeroBio))

  if (!Array.isArray(matchingRows) || matchingRows.length === 0) {
    return { ...operateur, metadata: {} }
  }
  matchingRows.sort((a, b) => {
    return +(a.certification_state === 'OPERATOR_DRAFT') - +(b.certification_state === 'OPERATOR_DRAFT')
  })
  const [primaryRecord, ...otherRecords] = matchingRows
  const { metadata, ...record } = primaryRecord || { metadata: {} }

  return {
    ...operateur,
    metadata,
    ...record,
    otherParcellaire: otherRecords.length > 0 ? otherRecords : null
  }
}

/**
 * Populate third party information with our very own operators data
 *
 * @param  {AgenceBioNormalizedOperatorWithFilterData} a
 * @param  {AgenceBioNormalizedOperatorWithFilterData} b
 * @param  {string | null} sortKey
 * @return { number }
 */
function sortRecord (a, b, sortKey) {
  switch (sortKey) {
    case 'date-audit-ASC':
      // eslint-disable-next-line eqeqeq
      if (a.max_audit_date == b.max_audit_date) {
        break
      }
      if (a.max_audit_date == null) {
        return -1
      }
      if (b.max_audit_date == null) {
        return 1
      }

      return new Date(a.max_audit_date).getTime() - new Date(b.max_audit_date).getTime()

    case 'date-audit-DESC':
      // eslint-disable-next-line eqeqeq
      if (a.max_audit_date == b.max_audit_date) {
        break
      }
      if (a.max_audit_date == null) {
        return 1
      }
      if (b.max_audit_date == null) {
        return -1
      }

      return new Date(b.max_audit_date).getTime() - new Date(a.max_audit_date).getTime()
  }

  if (a.nom === b.nom) {
    return 0
  }

  let res = 0

  if (a.nom == null && b.nom != null) {
    res = 1
  } else if (a.nom != null && b.nom == null) {
    res = -1
  } else {
    const aIsAlphabetical = a.nom.localeCompare('a') >= 0
    const bIsAlphabetical = b.nom.localeCompare('a') >= 0

    if (!aIsAlphabetical && bIsAlphabetical) {
      res = 1
    } else if (aIsAlphabetical && !bIsAlphabetical) {
      res = -1
    } else {
      res = a.nom.localeCompare(b.nom)
    }
  }
  if (sortKey === 'nom-DESC') {
    return -res
  }

  return res
}

/**
 * Always returns 9 digits PACAGE identifier
 * @param {null|String|Number} [numeroPacage]
 * @returns {String|null}
 */
function formatPacage (numeroPacage) {
  return numeroPacage ? String(numeroPacage).padStart(9, '0') : null
}

/**
 * Normalize an operator to be used in Cartobio
 * @param {AgenceBioOperator} operator
 * @returns {AgenceBioNormalizedOperator}
 */
function normalizeOperator (operator) {
  const { id, nom, denominationCourante, siret, numeroBio, numeroPacage, notifications, email, dateEngagement, datePremierEngagement, adressesOperateurs = [] } = operator
  const currentNotifications = notifications ? getNotification(notifications) : null
  let organismeCertificateur = {}
  if (currentNotifications && currentNotifications.organismeCertificateurId) {
    organismeCertificateur = {
      id: currentNotifications.organismeCertificateurId,
      nom: currentNotifications.organisme
    }
  }

  return {
    id,
    nom,
    denominationCourante,
    siret,
    numeroBio,
    numeroPacage: formatPacage(numeroPacage),
    email,
    dateEngagement,
    datePremierEngagement,
    organismeCertificateur,
    adressesOperateurs: adressesOperateurs.filter(({ active }) => active).map(({ lat, long, codeCommune }) => ({ lat, long, codeCommune })),
    codeCommune: adressesOperateurs[0]?.codeCommune ?? null,
    departement: adressesOperateurs[0]?.codeCommune?.slice(0, -3) ?? null,
    commune: adressesOperateurs[0]?.ville ?? null,
    codePostal: adressesOperateurs[0]?.codePostal ?? null,
    notifications: currentNotifications,
    isProduction: !notifications || notifications.some((n) => !n.activites || n.activites.some(({ id }) => id === 1))
  }
}

/**
 * Get pinned operators for given user
 * @param {Number} userId
 * @returns {Promise<Number[]>}
 */
async function getPinnedOperators (userId) {
  const { rows } = await pool
    .query(/* sql */`SELECT numerobio
      FROM operateurs_epingles
      WHERE user_id = $1
      ORDER BY created_at`,
    [userId])

  return rows.map((r) => r.numerobio)
}

/**
 * Get consulted operators for given user
 * @param {Number} userId
 * @returns {Promise<Number[]>}
 */
async function getConsultedOperators (userId) {
  const { rows } = await pool
    .query(/* sql */`SELECT numerobio
      FROM operateurs_consultes
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 10`,
    [userId])

  return rows.map((r) => r.numerobio)
}

/**
 * Get the best notifications
 */
function getNotification (notifications) {
  const priorityOrder = [
    'RETIREE',
    'ENGAGEE',
    'SUSPENDUE',
    'ENGAGEE FUTUR',
    'NON ENGAGEE',
    'ARRETEE',
    'BROUILLON'
  ]

  const withOldOC = notifications.filter(obj => obj._oldOC)
  const withoutOldOC = notifications.filter(obj => !obj._oldOC)

  if (withoutOldOC.length > 0) {
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

    notifications = notifications.filter((n) => {
      const certificationDate = new Date(n.updatedAt)
      return n.etatCertification !== 'NON ENGAGEE' || certificationDate > sixMonthsAgo
    })

    notifications = notifications.sort((a, b) => {
      const priorityA = priorityOrder.indexOf(a.etatCertification || 'BROUILLON')
      const priorityB = priorityOrder.indexOf(b.etatCertification || 'BROUILLON')

      return priorityA - priorityB
    })

    const groupedNotifications = {}

    notifications.forEach((n) => {
      const key = `${n.numeroBio}-${n.organismeCertificateurId}`
      if (!groupedNotifications[key]) {
        groupedNotifications[key] = []
      }
      groupedNotifications[key].push(n)
    })

    Object.keys(groupedNotifications).forEach((key) => {
      const group = groupedNotifications[key]

      group.sort((a, b) => {
        if (a.etatCertification === b.etatCertification) {
          if (a.etatCertification === 'ENGAGEE' || a.etatCertification === 'NON ENGAGEE') {
            return new Date(b.dateDemarrage || b.dateArret).getTime() - new Date(a.dateDemarrage || a.dateArret).getTime()
          }
          if (a.etatCertification === 'ARRETEE') {
            return new Date(b.dateArret || b.dateDemarrage).getTime() - new Date(b.dateArret || b.dateDemarrage).getTime()
          }
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        }
        return 0
      })
    })
    return Object.values(groupedNotifications).flat()[0]
  } else if (withOldOC.length > 0) {
    const lastNotification = withOldOC.sort((a, b) => new Date(b.changementDate).getTime() - new Date(a.changementDate).getTime())[0]
    lastNotification.certification_state = 'ARRETEE'
    return lastNotification
  } else return null
}
/**
 * @param {AgenceBioNormalizedOperator} record
 * @param {string} input
 * @return {boolean}
 */
function applyOperatorTextSearch (record, input) {
  const recordNom = record.nom ? record.nom.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : ''
  const numClient = record.notifications && record.notifications.numeroClient ? record.notifications.numeroClient.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : ''
  const recordDenominationCourante = record.denominationCourante ? record.denominationCourante.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : ''
  const recordSiret = record.siret ? record.siret.replace(' ', '') : ''
  input = input ? input.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : ''

  if (!input) {
    return true
  }

  if (input &&
    (
      recordNom.includes(input) ||
      recordDenominationCourante.includes(input) ||
      numClient.includes(input) ||
      record.numeroBio.toString().includes(input) ||
      recordSiret.includes(input)
    )
  ) {
    return true
  }

  return false
}

/**
 * @param {AgenceBioNormalizedOperator} record
 * @return {boolean}
 */
function filterOperatorForAutocomplete (record, ocId) {
  if (!record.notifications) return false

  if (record.notifications.status === 'BROUILLON') {
    return false
  }

  if (record.notifications.etatCertification === 'NON ENGAGEE' ||
    record.notifications.etatCertification === 'ARRETEE' ||
    record.notifications.organismeCertificateurId !== ocId ||
    record.notifications.etatCertification === 'RETIREE') {
    return false
  }
  return true
}

module.exports = {
  getFilterData,
  addRecordData,
  sortRecord,
  normalizeOperator,
  getPinnedOperators,
  getConsultedOperators,
  applyOperatorTextSearch,
  filterOperatorForAutocomplete
}
