import type {
  AddGeometryResponse,
  BorderCutResponse,
  GeometryEqualsBody,
  GeometryEqualsResponse
} from '@agencebio/cartobio-types'
import * as repository from './geometry.repository.js'
import { compareParcellaires, feature, label } from './geometry.utils.js'
import { InvalidRequestApiError } from '../../shared/errors.js'

export async function verifyGeometry(
  inputGeomGeoJSON: unknown,
  recordId: string,
  id: string | number = ''
): Promise<AddGeometryResponse> {
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

export async function getGeometryEquals(input: GeometryEqualsBody['payload']): Promise<GeometryEqualsResponse> {
  const records = await repository.findParcellairesComparables([input.old, input.new])

  const r1 = records.find(({ recordId }) => recordId === input.old)
  const r2 = records.find(({ recordId }) => recordId === input.new)

  if (!r1 || !r2 || r1.numeroBio !== r2.numeroBio) return []

  const comparisonResult = compareParcellaires(r1, r2)
  const [oldRecordId, newRecordId] =
    comparisonResult === 'r1_old_r2_new' ? [input.old, input.new] : [input.new, input.old]

  const { modified, deleted, added } = await repository.findParcellesComparees(oldRecordId, newRecordId)

  return [
    {
      comparison_result: comparisonResult,
      geojson: {
        type: 'FeatureCollection',
        features: [
          ...modified.map(({ geometry, ancienne, nouvelle }) =>
            feature(geometry, {
              status: 'modified',
              new_id: nouvelle.id,
              old_id: ancienne.id,
              label: label(nouvelle),
              old_label: label(ancienne)
            })
          ),
          ...deleted.map(({ geometry, ...parcelle }) =>
            feature(geometry, {
              status: 'deleted',
              new_id: null,
              old_id: parcelle.id,
              label: label(parcelle),
              old_label: null
            })
          ),
          ...added.map(({ geometry, ...parcelle }) =>
            feature(geometry, {
              status: 'added',
              new_id: parcelle.id,
              old_id: null,
              label: label(parcelle),
              old_label: null
            })
          )
        ]
      }
    }
  ]
}

export async function calculateParcelBorder(
  geometry: unknown,
  distance: number,
  allBorder: boolean,
  isInverted: boolean,
  startBorderPoint?: number[],
  endBorderPoint?: number[]
): Promise<BorderCutResponse | undefined> {
  if (allBorder) {
    return repository.findParcelBorder(geometry, distance)
  }

  if (!startBorderPoint || !endBorderPoint) {
    throw new InvalidRequestApiError('Les deux points sont requis')
  }

  return repository.findParcelBorderBetweenPoints(geometry, distance, startBorderPoint, endBorderPoint, isInverted)
}
