'use strict'

const pLimit = require('p-limit')
const memo = require('p-memoize')

const { fetchCustomersByOperator } = require('./providers/agence-bio.js')
const { fetchParcelsBy } = require('./providers/ign.js')
const { decorate: decorateOperatorFeatures } = require('./outputs/operator.js')

const batchSlice = (array, size = 70) => {
  const batchCount = Math.ceil(array.length / size)

  return (new Array(batchCount).fill('')).map((batch, i) => {
    return array.slice(i * size, (i + 1) * size)
  })
}

async function getOperatorParcels ({ ocId }) {
  const customers = await fetchCustomersByOperator(ocId)
  const customersWithPacage = customers.filter(({ numeroPacage }) => numeroPacage)

  const filteredCustomers = customersWithPacage.map(({ numeroPacage }) => numeroPacage)

  // we batch request data from IGN, by bunches of 10 simultaneous ones
  // more than 60 items will overrun the URL size limit
  const batches = batchSlice(filteredCustomers, 60)
  const limit = pLimit(10)
  const featureRequests = batches.map($in => {
    return limit(() => fetchParcelsBy({ pacage: { $in } }))
  })

  const features = await Promise
    .all(featureRequests)
    .then(features => features.flatMap(decorateOperatorFeatures({
      customerData: customersWithPacage,
      ocId
    })))

  return {
    type: 'FeatureCollection',
    features
  }
}

module.exports = {
  getOperatorParcels: memo(getOperatorParcels, { cacheKey: JSON.stringify }),
  batchSlice
}
