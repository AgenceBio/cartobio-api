const { randomInt, randomUUID } = require('crypto')

const communes = require('../../data/communes-with-centroids.json')
const { fromCodePacStrict, fromCodeCpf } = require('@agencebio/rosetta-cultures')

function getRandomFeatureId () {
  return randomInt(1, Math.pow(2, 48))
}

function populateWithCentroid (feature) {
  // determine COMMUNE by centroid
  // way too hungry to enable this
  // if (!feature.properties.COMMUNE) {
  //   const { code = '', nom = '' } = communes.find(({ geometry }) => intersects(geometry, feature)) ?? {}
  //   feature.properties.COMMUNE = code
  //   feature.properties.COMMUNE_LABEL = nom
  // }

  // determine COMMUNE label
  if (feature.properties.COMMUNE && !feature.properties.COMMUNE_LABEL) {
    feature.properties.COMMUNE_LABEL = communes.find(({ code }) => code === feature.properties.COMMUNE)?.nom ?? ''
  }

  return feature
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
 * @param {} feature
 * @returns
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

    delete feature.CPF
    delete feature.TYPE
    delete feature.variete
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

module.exports = {
  getRandomFeatureId,
  populateWithCentroid,
  populateWithMultipleCultures
}
