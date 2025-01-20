const { randomInt, randomUUID } = require('crypto')

/**
 * @type {Array<{code: String, nom: String, geometry: import('geojson').Polygon}>}
 */
let communes = []
try {
  communes = JSON.parse(
    require('fs').readFileSync(require('path').join(__dirname, '../../data/communes.json'), 'utf8')
  )
} catch (error) {
  // skip, this is probably the type package
}

const { fromCodePacStrict, fromCodeCpf } = require('@agencebio/rosetta-cultures')

const MAX_RANDOM_INT = Math.pow(2, 48)

/**
 * @typedef {import('./types/features').CartoBioFeatureCollection} CartoBioFeatureCollection
 * @typedef {import('./types/features').CartoBioFeature} CartoBioFeature
 * @typedef {import('./types/features').CartoBioFeatureProperties} CartoBioFeatureProperties
 * @typedef {import('./types/features').CartoBioGeoJson} CartoBioGeoJson
 * @typedef {import('../providers/types/cartobio').DBParcelle} DBParcelle
 */

/**
 * Returns a numeric value which serves as a GeoJSON Feature id
 * Up to maplibre-gl@3.3.1, only integer id works.
 *
 * @see https://github.com/maplibre/maplibre-gl-js/issues/1043
 * @returns {Number}
 */
function getRandomFeatureId () {
  return randomInt(1, MAX_RANDOM_INT)
}

/**
 * Soft migration from single culture to multi-cultures
 *
 * 1. If we have an array of cultures, it means the job is done.
 * 2. If we have TYPE or CPF, we merge them with a first cultures item
 *
 * Also, about CPF and TYPE
 * 1. Because they are explitly set from a controlled-list via the UI (the `is_selectable` crop attribute)
 * 2. Because they are translated from a PAC code (the `TYPE` feature property)
 * 3. Or because they are set from an external system (the crop may or may not be selectable via the UI)
 *
 * @param {CartoBioFeature} feature
 * @returns {CartoBioFeature}
 */
function populateWithMultipleCultures (feature) {
  // convert from single to multi
  if (!Array.isArray(feature.properties.cultures)) {
    const { CPF, TYPE = null, variete = null, SURF: surface = null } = feature.properties

    feature.properties.cultures = [
      {
        id: randomUUID(),
        CPF,
        TYPE,
        surface,
        variete
      }
    ]

    delete feature.properties.CPF
    delete feature.properties.variete
  }

  // populate with CPF until we do a database migration to align these data
  feature.properties.cultures = feature.properties.cultures.map(culture => {
    if (fromCodeCpf(culture.CPF || '')?.is_selectable) {
      return culture
    }

    if (culture.TYPE) {
      return {
        ...culture,
        CPF: fromCodePacStrict(culture.TYPE)?.code_cpf
      }
    }

    return culture
  })

  return feature
}

/**
 * @param {DBParcelle} parcelle
 * @return {CartoBioFeature}
 */
function normalizeParcelle (parcelle) {
  return {
    type: 'Feature',
    id: parcelle.id,
    properties: {
      id: parcelle.id,
      COMMUNE: parcelle.commune ?? null,
      COMMUNE_LABEL: communes.find(({ code }) => code === parcelle.commune)?.nom,
      cultures: parcelle.cultures ?? null,
      conversion_niveau: parcelle.conversion_niveau ?? null,
      engagement_date: parcelle.engagement_date ?? null,
      commentaires: parcelle.commentaire ?? null,
      auditeur_notes: parcelle.auditeur_notes ?? null,
      annotations: parcelle.annotations ?? null,
      NOM: parcelle.name ?? null,
      PACAGE: parcelle.numero_pacage ?? null,
      NUMERO_I: parcelle.numero_ilot_pac ?? null,
      NUMERO_P: parcelle.numero_parcelle_pac ?? null,
      cadastre: parcelle.reference_cadastre?.length && parcelle.reference_cadastre[0] ? parcelle.reference_cadastre : null,
      createdAt: parcelle.created ?? null,
      updatedAt: parcelle.updated ?? null
    },
    geometry: parcelle.geometry ?? null
  }
}

module.exports = {
  getRandomFeatureId,
  populateWithMultipleCultures,
  normalizeParcelle
}
