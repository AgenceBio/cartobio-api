'use strict'

const { get } = require('got')

const WGS_84 = 4326

const {
  ESPACE_COLLABORATIF_ENDPOINT,
  ESPACE_COLLABORATIF_BASIC_AUTH
} = require('../app.js').env()

function fetchParcelsBy (filter, typeName = 'rpgbio2019v4') {
  return get(`${ESPACE_COLLABORATIF_ENDPOINT}/gcms/wfs/cartobio`, {
    headers: {
      Authorization: `Basic ${ESPACE_COLLABORATIF_BASIC_AUTH}`
    },
    searchParams: {
      service: 'WFS',
      version: '1.1.0',
      request: 'GetFeature',
      outputFormat: 'GeoJSON',
      typeName,
      srsname: WGS_84,
      filter: JSON.stringify(filter)
    }
  })
    .json()
    .then(({ features }) => features)
}

module.exports = { fetchParcelsBy }
