import * as repository from './geometry.repository.js'

async function verifyGeometry (inputGeomGeoJSON: unknown, recordId: string, id: string | number = '') {
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

async function getRpg (extent: number[], surface: number, codeCulture: string) {
  return (await repository.findRpg(extent, surface, codeCulture))[0] ?? null
}

function getGeometryEquals (input: { old: string; new: string }) {
  return repository.findGeometryEquals(input)
}

async function calculateParcelBorder (geometry: string, distance: number, allBorder: boolean, isInverted: boolean, startBorderPoint?: number[], endBorderPoint?: number[]) {
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

export { getRpg, verifyGeometry, getGeometryEquals, calculateParcelBorder }
