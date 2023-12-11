'use strict'

const pool = require('../db.js')

const { format: formatPacage } = require('../pacage.js')

/** @typedef {import('../providers/agence-bio.js').AgenceBioOperator} AgenceBioOperator */

/**
 * An operator record from Agence Bio, normalized to be used in Cartobio
 * @typedef {Object} AgenceBioNormalizedOperator
 * @property {Number} id
 * @property {String} nom
 * @property {String} denominationCourante
 * @property {String} siret
 * @property {String} numeroBio
 * @property {String} numeroPacage
 * @property {String} email
 * @property {Date}   dateEngagement
 * @property {Date}   datePremierEngagement
 * @property {Object[]} certificats
 * @property {OrganismeCertificateur} organismeCertificateur
 * @property {String} codeCommune
 * @property {String} departement
 * @property {String} commune
 * @property {String} codePostal
 * @property {Object[]} notifications
 */

/**
 * @typedef {Object} OrganismeCertificateur
 * @property {String} id
 * @property {String} nom
 * @property {String=} numeroControleEu
 */

/**
 * Populate third party information with our very own operators data
 *
 * @param  {AgenceBioNormalizedOperator[]} operators An array of objects fetched from the Agence Bio Notifications portal
 * @return {NormalizedRecord[]} Not exactly normalized, as we don't populate parcelles with extra data like in normalizeRecord
 */
async function populateWithRecords (operators) {
  const ids = operators.map(({ numeroBio }) => String(numeroBio))

  if (ids.length === 0) {
    return operators
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
 * @return {OrganismeCertificateur}
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
      .sort(({ date: dateA }, { date: dateB }) => dateB < dateA)
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
