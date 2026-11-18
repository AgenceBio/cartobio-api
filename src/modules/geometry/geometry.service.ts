import type { AddGeometryResponse, BorderCutResponse, GeometryEqualsBody, GeometryEqualsResponse } from '@agencebio/cartobio-types'
import * as repository from './geometry.repository.js'

async function verifyGeometry (inputGeomGeoJSON: unknown, recordId: string, id: string | number = ''): Promise<AddGeometryResponse> {
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

function getGeometryEquals (input: GeometryEqualsBody['payload']): Promise<GeometryEqualsResponse> {
  return repository.findGeometryEquals(input)
}

async function calculateParcelBorder (geometry: unknown, distance: number, allBorder: boolean, isInverted: boolean, startBorderPoint?: number[], endBorderPoint?: number[]): Promise<BorderCutResponse | undefined> {
  if (allBorder) {
    return repository.findParcelBorder(geometry, distance)
  }

  if (!startBorderPoint || !endBorderPoint) {
    throw new Error('Les deux points sont requis')
  }

  return repository.findParcelBorderBetweenPoints(geometry, distance, startBorderPoint, endBorderPoint, isInverted)
}

export { verifyGeometry, getGeometryEquals, calculateParcelBorder }
