/**
 * @typedef {import('./types/record').NormalizedRecord} NormalizedRecord
 * @typedef {import('./types/features').CartoBioFeature} CartoBioFeature
 * @typedef {import('./types/features').CartoBioCulture} CartoBioCulture
 * @typedef {import('./types/api').OutputApiRecord} OutputApiRecord
 * @typedef {import('./types/api').OutputApiCulture} OutputApiCulture
 * @typedef {import('./types/api').OutputApiParcelle} OutputApiParcelle
 * @typedef {import('./types/api').OutputApiFeatureCollection} OutputApiFeatureCollection
 */

const { featureCollection } = require('@turf/helpers')
const area = require('@turf/area').default

/**
 * @param {CartoBioCulture} culture
 * @return {OutputApiCulture}
 */
function cultureToApi (culture) {
  return {
    cpf: culture.CPF,
    surface: (culture.surface && !Number.isNaN(culture.surface)) ? Number(culture.surface) : null,
    unite: culture.unit === '%' ? '%' : 'ha',
    variete: culture.variete,
    dateSemis: culture.date_semis
  }
}

/**
 * @param {CartoBioFeature} parcelle
 * @return {OutputApiParcelle}
 */
function parcelleToApi (parcelle) {
  return {
    ...parcelle,
    properties: {
      id: String(parcelle.id),
      surface: area(parcelle.geometry) / 10000,
      commune: parcelle.properties.COMMUNE,
      cultures: parcelle.properties.cultures.map(cultureToApi),
      niveauConversion: parcelle.properties.conversion_niveau,
      dateEngagement: parcelle.properties.engagement_date,
      commentaire: parcelle.properties.auditeur_notes,
      annotations: parcelle.properties.annotations,
      dateAjout: parcelle.properties.createdAt,
      dateMiseAJour: parcelle.properties.updatedAt,
      nom: parcelle.properties.NOM,
      numeroPacage: parcelle.properties.PACAGE,
      numeroIlotPAC: parcelle.properties.NUMERO_I,
      numeroParcellePAC: parcelle.properties.NUMERO_P,
      referenceCadastrale: parcelle.properties.cadastre?.join(' ') ?? null
    }
  }
}

/**
 * @param {NormalizedRecord} record
 * @return {OutputApiRecord}
 */
function recordToApi (record) {
  const features = record.parcelles.features.map(parcelleToApi)

  return {
    numeroBio: record.numerobio,
    certification: {
      statut: record.certification_state,
      dateAudit: record.audit_date,
      dateDebut: record.certification_date_debut,
      dateFin: record.certification_date_fin,
      demandesAudit: record.audit_demandes,
      notesAudit: record.audit_notes
    },
    parcellaire: featureCollection(features)
  }
}

module.exports = {
  recordToApi
}
