'use strict'

const pool = require('../db.js')

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
    .query(/* sql */`SELECT certification_state, audit_date, certification_date_debut, created_at, numerobio, metadata, record_id, updated_at, annee_reference_controle
      FROM cartobio_operators
      WHERE record_id IN (
        SELECT DISTINCT ON (numerobio) record_id
        FROM cartobio_operators
        WHERE numerobio = ANY ($1) AND deleted_at IS NULL
        ORDER BY numerobio, COALESCE(certification_date_debut, audit_date, created_at)::date DESC
      )`,
    [ids])

  return operators.map(agenceBioOperatorData => {
    const { metadata, ...record } = rows.find(({ numerobio }) => numerobio === String(agenceBioOperatorData.numeroBio)) || { metadata: {} }

    return {
      ...agenceBioOperatorData,
      metadata,
      ...record
    }
  })
}

/**
 * @param {AgenceBioOperator} operator
 * @return {OrganismeCertificateur|{}}
 */
function deriveOrganismeCertificateurFromOperator (operator) {
  if (Array.isArray(operator.notifications) && operator.notifications.length) {
    const { organismeCertificateurId, organisme } = operator.notifications
      .sort(({ dateDemarrage: dateA }, { dateDemarrage: dateB }) => (new Date(dateA)).getTime() - (new Date(dateB)).getTime())
      .find(n => n.organismeCertificateurId && n.etatCertification !== 'NON ENGAGEE' && n.etatCertification !== 'BROUILLON') ?? {}

    if (organismeCertificateurId) {
      return {
        id: organismeCertificateurId,
        nom: organisme
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
  const { id, nom, denominationCourante, siret, numeroBio, numeroPacage, notifications, email, dateEngagement, datePremierEngagement, adressesOperateurs = [] } = operator
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
    datePremierEngagement,
    organismeCertificateur,
    adressesOperateurs: adressesOperateurs.filter(({ active }) => active).map(({ lat, long, codeCommune }) => ({ lat, long, codeCommune })),
    codeCommune: adressesOperateurs[0]?.codeCommune ?? null,
    departement: adressesOperateurs[0]?.codeCommune?.slice(0, -3) ?? null,
    commune: adressesOperateurs[0]?.ville ?? null,
    codePostal: adressesOperateurs[0]?.codePostal ?? null,
    notifications,
    isProduction: notifications && notifications.some((n) => n.activites.some(({ id }) => id === 1))
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
      WHERE user_id = $1`,
    [userId])

  return rows.map((r) => r.numerobio)
}

module.exports = {
  populateWithRecords,
  normalizeOperator,
  getPinnedOperators
}
