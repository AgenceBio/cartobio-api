'use strict'

const pool = require('../db.js')

/**
 * @typedef {import('../providers/types/agence-bio').AgenceBioOperator} AgenceBioOperator
 * @typedef {import('../providers/types/agence-bio').OrganismeCertificateur} OrganismeCertificateur
 * @typedef {import('./types/record').NormalizedRecord} NormalizedRecord
 * @typedef {import('./types/operator').AgenceBioNormalizedOperator} AgenceBioNormalizedOperator
 * @typedef {import('./types/operator').AgenceBioNormalizedOperatorWithRecord} AgenceBioNormalizedOperatorWithRecord
 */

/* eslint-disable-next-line quotes */
const recordFields = /* sqlFragment */ `certification_state,audit_date,certification_date_debut,created_at,numerobio, metadata,record_id,updated_at,annee_reference_controle,version_name, (audit_history->jsonb_array_length(audit_history) - 1)->>'user' AS user `

/**
 * Populate third party information with our very own operators data
 *
 * @param  {AgenceBioNormalizedOperator[]} operators An array of objects fetched from the Agence Bio Notifications portal
 * @return {Promise<AgenceBioNormalizedOperatorWithRecord[]>}
 */
async function populateWithRecords (operators) {
  const ids = operators.map(({ numeroBio }) => String(numeroBio))

  if (ids.length === 0) {
    return []
  }
  const { rows } = await pool
    .query(/* sql */`
WITH latest_by_state AS (
    SELECT DISTINCT ON (numerobio) *
    FROM cartobio_operators
    WHERE numerobio = ANY ($1)
      AND deleted_at IS NULL
      AND certification_state IN ('AUDITED', 'PENDING_CERTIFICATION', 'CERTIFIED')
    ORDER BY numerobio, COALESCE(certification_date_debut, audit_date, created_at) DESC
),
latest_global AS (
    SELECT DISTINCT ON (numerobio) *
    FROM cartobio_operators
    WHERE numerobio = ANY ($1)
      AND deleted_at IS NULL
    ORDER BY numerobio, COALESCE(certification_date_debut, audit_date, created_at) DESC
),
last_certified_parcelle AS (
    SELECT DISTINCT ON (numerobio) numerobio, certification_date_debut AS lastCertifiedDate, mixite as lastMixiteState
    FROM cartobio_operators
    WHERE numerobio = ANY ($1)
      AND certification_state = 'CERTIFIED'
    ORDER BY numerobio, certification_date_debut DESC
),
all_parcellaire AS (
    SELECT  numerobio, JSON_AGG(JSON_BUILD_OBJECT('certification_state', certification_state, 'annee_reference_controle', annee_reference_controle)) as states
    FROM cartobio_operators
    WHERE numerobio = ANY ($1)
    GROUP BY numerobio
)
SELECT
    combined_results.*,
    last_certified_parcelle.lastCertifiedDate,
    last_certified_parcelle.lastMixiteState,
    all_parcellaire.states
FROM (
    SELECT ${recordFields} FROM latest_by_state
    UNION
    SELECT ${recordFields} FROM latest_global
) AS combined_results
LEFT JOIN last_certified_parcelle ON combined_results.numerobio = last_certified_parcelle.numerobio
JOIN all_parcellaire ON all_parcellaire.numerobio = combined_results.numerobio 
ORDER BY combined_results.numerobio, COALESCE(combined_results.certification_date_debut, combined_results.audit_date, combined_results.created_at) DESC;
    `,
    [ids])

  return operators.map(agenceBioOperatorData => {
    const matchingRows = rows.filter(({ numerobio }) => numerobio === String(agenceBioOperatorData.numeroBio))

    if (!Array.isArray(matchingRows) || matchingRows.length === 0) {
      return { ...agenceBioOperatorData, metadata: {} }
    }
    matchingRows.sort((a, b) => {
      return +(a.certification_state === 'OPERATOR_DRAFT') - +(b.certification_state === 'OPERATOR_DRAFT')
    })
    const [primaryRecord, ...otherRecords] = matchingRows
    const { metadata, ...record } = primaryRecord || { metadata: {} }

    return {
      ...agenceBioOperatorData,
      metadata,
      ...record,
      otherParcellaire: otherRecords.length > 0 ? otherRecords : null
    }
  })
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
    isProduction: notifications && notifications.some((n) => n.activites && n.activites.some(({ id }) => id === 1))
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
    'ARRETEE'
  ]

  const withOldOC = notifications.filter(obj => obj._oldOC)
  const withoutOldOC = notifications.filter(obj => !obj._oldOC)

  if (withoutOldOC.length > 0) {
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

    notifications = notifications.filter((n) => {
      const certificationDate = new Date(n.updatedAt)
      return !(n.etatCertification === 'NON ENGAGEE' && certificationDate < sixMonthsAgo)
    })

    notifications = notifications.sort((a, b) => {
      const priorityA = priorityOrder.indexOf(a.etatCertification)
      const priorityB = priorityOrder.indexOf(b.etatCertification)
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

module.exports = {
  populateWithRecords,
  normalizeOperator,
  getPinnedOperators,
  getConsultedOperators
}
