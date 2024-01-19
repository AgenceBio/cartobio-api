'use strict'

const pool = require('../db.js')

/**
 * @typedef {import('../providers/types/agence-bio').AgenceBioOperator} AgenceBioOperator
 * @typedef {import('../providers/types/agence-bio').OrganismeCertificateur} OrganismeCertificateur
 * @typedef {import('./types/record').NormalizedRecord} NormalizedRecord
 * @typedef {import('./types/record').NormalizedMayBeRecord} NormalizedMayBeRecord
 * @typedef {import('./types/operator').AgenceBioNormalizedOperator} AgenceBioNormalizedOperator
 */

/**
 * Populate third party information with our very own operators data
 *
 * @param  {AgenceBioNormalizedOperator[]} operators An array of objects fetched from the Agence Bio Notifications portal
 * @return {Promise<NormalizedMayBeRecord[]>}
 */
async function populateWithRecords (operators) {
  const ids = operators.map(({ numeroBio }) => String(numeroBio))

  if (ids.length === 0) {
    return []
  }

  return pool
    .query(/* sql */`SELECT certification_state, created_at, numerobio, metadata, record_id, updated_at
      FROM cartobio_operators
      WHERE numerobio = ANY ($1)`,
    [ids])
    .then(({ rows }) => {
      return operators.map(agenceBioOperatorData => {
        const { metadata, ...record } = rows.find(({ numerobio }) => numerobio === String(agenceBioOperatorData.numeroBio)) || { metadata: {} }

        return {
          ...agenceBioOperatorData,
          metadata,
          ...record
        }
      })
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
  const { id, nom, denominationCourante, siret, numeroBio, numeroPacage, certificats, notifications, email, dateEngagement, datePremierEngagement, adressesOperateurs = [] } = operator
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
    codeCommune: adressesOperateurs[0]?.codeCommune ?? null,
    departement: adressesOperateurs[0]?.codeCommune?.slice(0, -3) ?? null,
    commune: adressesOperateurs[0]?.ville ?? null,
    codePostal: adressesOperateurs[0]?.codePostal ?? null,
    notifications
  }
}

module.exports = {
  populateWithRecords,
  normalizeOperator
}
