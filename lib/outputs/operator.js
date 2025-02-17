'use strict'

const { match } = require('assert')
const pool = require('../db.js')
const { verifyNotificationAuthorization } = require('../providers/agence-bio.js')

/**
 * @typedef {import('../providers/types/agence-bio').AgenceBioOperator} AgenceBioOperator
 * @typedef {import('../providers/types/agence-bio').OrganismeCertificateur} OrganismeCertificateur
 * @typedef {import('./types/record').NormalizedRecord} NormalizedRecord
 * @typedef {import('./types/operator').AgenceBioNormalizedOperator} AgenceBioNormalizedOperator
 * @typedef {import('./types/operator').AgenceBioNormalizedOperatorWithRecord} AgenceBioNormalizedOperatorWithRecord
 */

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
)
SELECT
    combined_results.*,
    last_certified_parcelle.lastCertifiedDate,
    last_certified_parcelle.lastMixiteState
FROM (
    SELECT certification_state,audit_date,certification_date_debut,created_at,numerobio, metadata,record_id,updated_at,annee_reference_controle,version_name, (audit_history->jsonb_array_length(audit_history) - 1)->>'user' AS user  FROM latest_by_state
    UNION
    SELECT certification_state,audit_date,certification_date_debut,created_at,numerobio, metadata,record_id,updated_at,annee_reference_controle,version_name, (audit_history->jsonb_array_length(audit_history) - 1)->>'user' AS user FROM latest_global
) AS combined_results
LEFT JOIN last_certified_parcelle ON combined_results.numerobio = last_certified_parcelle.numerobio
ORDER BY combined_results.numerobio, COALESCE(combined_results.certification_date_debut, combined_results.audit_date, combined_results.created_at) DESC;

    `,
    [ids])

  return operators.map(agenceBioOperatorData => {
    const matchingRows = rows.filter(({ numerobio }) => numerobio === String(agenceBioOperatorData.numeroBio))
    matchingRows.sort((a, b) => {
      return (a.certification_state === 'OPERATOR_DRAFT') - (b.certification_state === 'OPERATOR_DRAFT');
    })
    if (!Array.isArray(matchingRows) || matchingRows.length === 0) {
      return { ...agenceBioOperatorData, metadata: {} }
    }
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
 * @param {AgenceBioOperator} operator
 * @return {OrganismeCertificateur|{}}
 */
function deriveOrganismeCertificateurFromOperator (operator) {
  // we have a valid certificate, let's use it
  if (Array.isArray(operator.certificats) && operator.certificats.at(0)?.organismeCertificateurId) {
    const { organismeCertificateurId: id, organisme: nom } = operator.certificats.at(0)
    return { id, nom }
    // we have only a notification (notified, but not yet certified)
  }

  if (Array.isArray(operator.notifications) && operator.notifications.length) {
    const { organismeCertificateur } = operator.notifications
      .sort(({ date: dateA }, { date: dateB }) => (new Date(dateA)).getTime() - (new Date(dateB)).getTime())
      .find(n => n.organismeCertificateur) ?? {}

    if (organismeCertificateur) {
      return {
        id: organismeCertificateur.id,
        nom: organismeCertificateur.nom
      }
    }

    return {}
  }

  return {}
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
  const { id, nom, denominationCourante, siret, numeroBio, numeroPacage, certificats, notifications, email, dateEngagement, datePremierEngagement, adressesOperateurs = [], activites = [] } = operator
  const organismeCertificateur = deriveOrganismeCertificateurFromOperator(operator)

  return {
    id,
    nom,
    denominationCourante,
    siret,
    numeroBio,
    numeroPacage: formatPacage(numeroPacage),
    email,
    dateEngagement,
    certificats,
    datePremierEngagement,
    organismeCertificateur,
    adressesOperateurs: adressesOperateurs.filter(({ active }) => active).map(({ lat, long, codeCommune }) => ({ lat, long, codeCommune })),
    codeCommune: adressesOperateurs[0]?.codeCommune ?? null,
    departement: adressesOperateurs[0]?.codeCommune?.slice(0, -3) ?? null,
    commune: adressesOperateurs[0]?.ville ?? null,
    codePostal: adressesOperateurs[0]?.codePostal ?? null,
    notifications: notifications ? getNotification(notifications) : null,
    isProduction: activites.some(({ id }) => id === 1)
  }
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
    'ARRETEE',
    'NON ENGAGEE'
  ]

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
        if (a.etatCertification === 'ENGAGEE' || a.etatCertification === 'ARRÊTÉE') {
          return new Date(b.dateDemarrage || b.dateArret) - new Date(a.dateDemarrage || a.dateArret)
        }
        return new Date(b.createdAt) - new Date(a.createdAt)
      }
    })
  })

  return Object.values(groupedNotifications).flat()[0]
}

module.exports = {
  populateWithRecords,
  normalizeOperator
}
