const { randomInt, randomUUID } = require('crypto')
const merge = require('deepmerge')

const communes = require('../../data/communes-with-centroids.json')
const { fromCodePacStrict, fromCodeCpf } = require('@agencebio/rosetta-cultures')

/**
 * Returns a numeric value which serves as a GeoJSON Feature id
 * Up to maplibre-gl@3.3.1, only integer id works.
 *
 * @see https://github.com/maplibre/maplibre-gl-js/issues/1043
 * @returns {Number}
 */
const MAX_RANDOM_INT = Math.pow(2, 48)

function getRandomFeatureId () {
  return randomInt(1, MAX_RANDOM_INT)
}

/**
 * @typedef {import('geojson').FeatureCollection} FeatureCollection
 * @typedef {import('geojson').Feature} Feature
 */

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

/**
 * @param {Feature|Feature[]} target
 * @param {Feature|Feature[]} source
 * @returns {Feature|Feature[]}
 */
function deepMergeObjects (target, source, strategy = null) {
  return merge(target, source, {
    // target = record.parcelles
    //          ^^^^^^^^^^^^
    // source = { features }
    // It can also be any array — so coordinates, cultures, and such
    arrayMerge (target, source, options) {
      let destination = structuredClone(target)
      const hasId = source.every(item => Object.hasOwn(item, 'id'))

      // ie: we add/remove/update cultures item from a feature
      // it means the destination (existing data) contains an id that does not exist in the source (new data)
      if (strategy && (strategy & deepMergeObjects.DROP_MISSING_IDS) && hasId) {
        destination = destination.filter(({ id: maybeRemovedId }) => {
          return source.some(({ id }) => id === maybeRemovedId)
        })
      }

      // we add new/replace existing ones
      source.forEach((item, index) => {
        // identifiable items strategy
        if (hasId) {
          const destinationIndex = destination.findIndex(({ id }) => id === item.id)

          // destination already contains an item identified by its id
          if (options.isMergeableObject(item) && destinationIndex !== -1) {
            destination[destinationIndex] = merge(destination[destinationIndex], item, options)
          // destination does not contain this item yet
          // we also have to find out if we need to get rid of this item
          } else if (options.isMergeableObject(item) && destinationIndex === -1) {
            destination.push(structuredClone(item))
          }
        // otherwise, we are in array vs. array type of situation
        // for example coordinates (can exist, vs upgrade or does not exist)
        } else {
          destination = [item]
          // we have no items in the destination but we do in source

          // we have items in the destination, but no data in the source
          // eg: we have sent a geometry-less object onto a with-geometry object
        }
      })

      return destination
    }
  })
}

deepMergeObjects.DROP_MISSING_IDS = 2

/**
 *
 * @param {FeatureCollection} featureCollection
 * @param {Feature[]} updatedFeatures
 * @returns
 */
function updateCollectionFeatures (featureCollection, updatedFeatures) {
  return {
    ...featureCollection,
    features: featureCollection.features.map(feature => {
      const matchingFeature = updatedFeatures.find(({ id }) => feature.id === id)

      if (matchingFeature) {
        feature.properties = {
          ...feature.properties,
          ...matchingFeature.properties
        }
      }

      return feature
    })
  }
}

module.exports = {
  deepMergeObjects,
  getRandomFeatureId,
  populateWithCentroid,
  populateWithMultipleCultures,
  updateCollectionFeatures
}
