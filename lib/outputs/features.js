const communes = require('../../data/communes-with-centroids.json')

const NIVEAU_C0 = 'CONV'
const NIVEAU_C1 = 'C1'
const NIVEAU_C2 = 'C2'
const NIVEAU_C3 = 'C3'
const NIVEAU_AB = 'AB'

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
function populateWithConversionNiveau (feature) {
  if (!feature.properties.conversion_niveau) {
    feature.properties.conversion_niveau = NIVEAU_C0
  }

  return feature
}

module.exports = { populateWithCentroid, populateWithConversionNiveau, NIVEAU_C0, NIVEAU_C1, NIVEAU_C2, NIVEAU_C3, NIVEAU_AB }
