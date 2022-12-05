'use strict'

const { point, featureCollection } = require('@turf/helpers')

const { fetchCustomersByOperator, getDepartementFromId } = require('./providers/agence-bio.js')

const batchSlice = (array, size) => {
  const batchCount = Math.ceil(array.length / size)

  return (new Array(batchCount).fill('')).map((batch, i) => {
    return array.slice(i * size, (i + 1) * size)
  })
}

/**
 * [getOperatorSummary description]
 * @param  {[type]} ocId [description]
 * @return {[type]}      [description]
 */
async function getOperatorSummary ({ ocId, numeroBio }) {
  const customers = await fetchCustomersByOperator({ ocId, numeroBio })

  const features = customers
    // we keep either a specific operator (one in a list), or geolocated operators (list)
    .filter(({ departementId }) => numeroBio || departementId)
    .map((operator) => {
      const { numeroBio, numeroPacage, gerant, active } = operator
      const { nom, denominationCourante, dateEngagement, dateMaj } = operator
      const { code: departement, centroid } = getDepartementFromId(operator.departementId)

      const mainName = denominationCourante || nom || gerant || `Opérateur·ice n°${numeroBio}`

      return point(centroid, {
        nom: mainName,
        identity: { nom, denominationCourante, gerant },
        numerobio: numeroBio,
        pacage: numeroPacage,
        date_engagement: dateEngagement,
        date_maj: dateMaj,
        departement,
        active
      })
    })

  return featureCollection(features)
}

/**
 * [getOperatorParcels description]
 * @param  {[type]} ocId [description]
 * @return {[type]}      [description]
 */
async function getOperatorParcels () {
  return featureCollection([])
}

module.exports = {
  getOperatorParcels,
  getOperatorSummary,
  batchSlice
}
