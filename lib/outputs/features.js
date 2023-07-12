const { randomInt } = require('crypto')

const communes = require('../../data/communes-with-centroids.json')

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

module.exports = {
  getRandomFeatureId,
  populateWithCentroid
}
