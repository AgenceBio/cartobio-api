'use strict'

const { get } = require('got')

const WGS_84 = 4326
const IGN_PAGINATION_LIMIT = 500

const {
  ESPACE_COLLABORATIF_ENDPOINT,
  ESPACE_COLLABORATIF_BASIC_AUTH
} = require('../app.js').env()

/**
 * As documented on https://espacecollaboratif.ign.fr/api/doc/transaction#operations-WFS_Transaction-get_gcms_wfs__databaseName_
 *
 * @param  {Object} [searchParams] [description]
 * @return {[type]}                   [description]
 */
async function * paginate (searchParams) {
  let features = await fetchFeatures(searchParams)
  yield features

  while (features.length === IGN_PAGINATION_LIMIT) {
    searchParams.offset = searchParams.offset + IGN_PAGINATION_LIMIT
    features = await fetchFeatures(searchParams)
    yield features
  }
}

function fetchFeatures (searchParams) {
  return get(`${ESPACE_COLLABORATIF_ENDPOINT}/gcms/wfs/cartobio`, {
    headers: {
      Authorization: `Basic ${ESPACE_COLLABORATIF_BASIC_AUTH}`
    },
    searchParams: {
      ...searchParams,
      filter: JSON.stringify(searchParams.filter),
      maxFeatures: IGN_PAGINATION_LIMIT,
      service: 'WFS',
      version: '1.1.0',
      request: 'GetFeature',
      outputFormat: 'GeoJSON',
      srsname: WGS_84
    }
  })
    .json()
    .then(({ features }) => features)
}

async function fetchParcelsBy (filter, typeName = 'rpgbio2019v4') {
  const allFeatures = []

  for await (const features of paginate({ filter, typeName, offset: 0 })) {
    allFeatures.push(...features)
  }

  return allFeatures
}

module.exports = { fetchParcelsBy }
