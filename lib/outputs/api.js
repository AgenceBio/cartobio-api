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

/**
 * @param {CartoBioCulture} culture
 * @return {OutputApiCulture}
 */
function cultureToApi (culture) {
  return {
    cpf: culture.CPF,
    surface: Number(culture.surface),
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
      commune: parcelle.properties.COMMUNE,
      cultures: parcelle.properties.cultures.map(cultureToApi),
      niveauConversion: parcelle.properties.conversion_niveau,
      dateEngagement: parcelle.properties.engagement_date,
      commentaire: parcelle.properties.commentaire,
      annotations: parcelle.properties.annotations,
      dateAjout: parcelle.properties.createdAt,
      dateMiseAJour: parcelle.properties.updatedAt,
      nom: parcelle.properties.NOM,
      numeroPacage: parcelle.properties.PACAGE,
      numeroIlotPAC: parcelle.properties.NUMERO_I,
      numeroParcellePAC: parcelle.properties.NUMERO_P,
      referenceCadastrale: parcelle.properties.cadastre.join(' ')
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
