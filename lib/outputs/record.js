const { featureCollection } = require('@turf/helpers')
const { populateWithCentroid, populateWithMultipleCultures } = require('./features.js')

function normalizeRecord ({ record = null, operator }) {
  const output = {
    ...record,
    metadata: record?.metadata ?? {},
    operator,
    parcelles: featureCollection((record?.parcelles?.features ?? [])
      .map(populateWithCentroid)
      .map(populateWithMultipleCultures)
    )
  }

  delete output.record?.metadata
  delete output.record?.parcelles

  return output
}

module.exports = {
  normalizeRecord
}
