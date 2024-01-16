const { randomInt, randomUUID } = require('crypto')
const merge = require('deepmerge')

/**
 * @type {Array<{code: String, nom: String, geometry: import('geojson').Polygon}>}
 */
// @ts-ignore
const communes = require('../../data/communes.json')
const { fromCodePacStrict, fromCodeCpf } = require('@agencebio/rosetta-cultures')

const MAX_RANDOM_INT = Math.pow(2, 48)

/**
 * @typedef {import('./types/features').CartoBioFeatureCollection} CartoBioFeatureCollection
 * @typedef {import('./types/features').CartoBioFeature} CartoBioFeature
 * @typedef {import('./types/features').CartoBioFeatureProperties} CartoBioFeatureProperties
 * @typedef {import('./types/features').CartoBioGeoJson} CartoBioGeoJson
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
 * @param {CartoBioFeature} feature
 * @return {CartoBioFeature}
 */
function populateWithCommunesLabels (feature) {
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
    delete feature.properties.TYPE
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
 * @template {CartoBioGeoJson} T - the type of the target and source
 * @param {T} target
 * @param {T} source
 * @param {Number} strategy - strategy flags
 * @property {Number} strategy.DROP_MISSING_IDS - drop items from target that do not exist in source
 * @returns {T}
 */
function deepMergeObjects (target, source, strategy = null) {
  // @ts-ignore - actually returns T but TS does not like it
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
      source.forEach((item) => {
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

deepMergeObjects.DROP_MISSING_IDS = 1

/**
 * We replace the source collection by its matching updated features properties
 *
 * @param {CartoBioFeatureCollection} featureCollection
 * @param {CartoBioFeature[]} updatedFeatures
 * @returns {CartoBioFeatureCollection}
 */
function updateCollectionFeatures (featureCollection, updatedFeatures) {
  return {
    ...featureCollection,
    features: featureCollection.features.map(feature => {
      const matchingFeature = updatedFeatures.find(({ id }) => feature.id === id)

      if (!matchingFeature) {
        return feature
      }

      return {
        ...feature,
        properties: {
          ...feature.properties,
          ...matchingFeature.properties
        },
        geometry: matchingFeature.geometry || feature.geometry
      }
    })
  }
}

module.exports = {
  deepMergeObjects,
  getRandomFeatureId,
  populateWithCommunesLabels,
  populateWithMultipleCultures,
  updateCollectionFeatures
}
