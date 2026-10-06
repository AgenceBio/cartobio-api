'use strict'

const repository = require('./geometry.repository.js')

async function verifyGeometry (inputGeomGeoJSON, recordId, id = '') {
  const conflicts = await repository.findGeometryConflicts(inputGeomGeoJSON, recordId, id)

  if (conflicts.some(({ status }) => status === 'inclusion')) {
    return { valid: false }
  }

  const overlaps = conflicts.filter(({ status }) => status === 'overlap')
  if (overlaps.length === 0) return { valid: true }

  return {
    valid: false,
    corrections: await repository.findGeometryCorrections(
      inputGeomGeoJSON,
      recordId,
      overlaps.map(({ id }) => id)
    )
  }
}

async function getRpg (extent, surface, codeCulture) {
  return (await repository.findRpg(extent, surface, codeCulture))[0] ?? null
}

function getGeometryEquals (input) {
  return repository.findGeometryEquals(input)
}

async function calculateParcelBorder (geometry, distance, allBorder, isInverted, startBorderPoint, endBorderPoint) {
  if (!allBorder && (!startBorderPoint || !endBorderPoint)) {
    throw new Error('Les deux points sont requis')
  }

  const result = await repository.findParcelBorder(
    geometry,
    distance,
    allBorder,
    isInverted,
    startBorderPoint,
    endBorderPoint
  )
  if (!result) throw new Error('Aucun résultat retourné par la requête')

  return {
    parcelleSansBordure: result.parcelle_sans_bordure,
    bordure: result.bordure
  }
}

module.exports = { getRpg, verifyGeometry, getGeometryEquals, calculateParcelBorder }
