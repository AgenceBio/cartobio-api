'use strict'

const { fetchCustomersByOperator } = require('./providers/agence-bio.js')
const { fetchParcelsBy } = require('./providers/ign.js')

async function getOperatorParcels ({ ocId }) {
  const customers = await fetchCustomersByOperator(ocId)
  const customersWithPacage = customers.filter(({ numeroPacage }) => numeroPacage)

  const c = customersWithPacage.map(({ numeroPacage }) => numeroPacage).slice(0, 60)
  const features = await fetchParcelsBy({ pacage: { $in: c } })

  return {
    type: 'FeatureCollection',
    features
  }
}

module.exports = { getOperatorParcels }
