import gdal from 'gdal-async'
import { getStreamAsBuffer } from 'get-stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import reproject from 'reproject'
const { toWgs84 } = reproject
import bboxPolygon from '@turf/bbox-polygon'
import polygonInPolygon from '@turf/boolean-intersects'
import pointInPolygon from '@turf/boolean-point-in-polygon'
import AdmZip from 'adm-zip'
import { fileTypeFromBuffer } from 'file-type'
import { getRandomFeatureId } from '../outputs/features.js'
import { InvalidRequestApiError } from '../errors.js'
import { LegalProjections, RegionBounds } from '@agencebio/cartobio-types'
import { z } from 'zod'
import type { FeatureCollection, Geometry, MultiPolygon } from 'geojson'
import type { MultipartFile } from '@fastify/multipart'
import { jsonString } from '../validation.js'

const emptyToUndefined = (value: unknown): unknown => value || undefined

const featurePropertiesSchema = z.object({
  COMMUNE: z
    .string()
    .regex(/^[0-9]{5}$/u)
    .nullable()
    .optional(),
  COMMUNE_LABEL: z.string().nullable().optional(),
  cultures: z.preprocess(emptyToUndefined, jsonString(z.array(z.looseObject({}))).optional()),
  conversion_niveau: z.string().nullable().optional(),
  engagement_date: z
    .looseObject({ year: z.int(), month: z.int(), day: z.int() })
    .nullable()
    .optional()
    .transform((date) => (date ? `${date.year}-${date.month}-${date.day}` : undefined)),
  commentaires: z.string().nullable().optional(),
  auditeur_notes: z.string().nullable().optional(),
  annotations: z.preprocess(emptyToUndefined, jsonString(z.array(z.unknown())).optional()),
  NOM: z.string().nullable().optional(),
  PACAGE: z
    .string()
    .regex(/^([A-Z0-9]{8,9})|()$/u)
    .nullable()
    .optional(),
  NUMERO_I: z.preprocess((value) => (value ? Number(value) : undefined), z.int().optional()),
  NUMERO_P: z.preprocess((value) => (value ? Number(value) : undefined), z.int().optional()),
  cadastre: z.array(z.string()).nullable().optional()
})

interface FileAnalysisResult {
  path: string | null
  files: string[] | Buffer[]
  cleanup: () => Promise<unknown>
}

export const MAX_UNZIPPED_SIZE = 200 * 1024 * 1024

export const GEO_DRIVERS = ['ESRI Shapefile', 'GeoJSON', 'KML', 'GPKG']

export const wgs84 = gdal.SpatialReference.fromProj4('+init=epsg:4326')

export async function detectSrs(layer: gdal.Layer): Promise<gdal.SpatialReference> {
  if (layer.srs) {
    return layer.srs
  }

  const firstGeometry = (await layer.features.firstAsync())?.getGeometry()
  if (!firstGeometry)
    throw new InvalidRequestApiError(
      "Impossible de déterminer la projection : la première parcelle n'a pas de géométrie."
    )
  const geometry: Geometry = firstGeometry.toObject()

  // iterate over the various regions/projections to guess which one it is
  for await (const [code, bbox] of Object.entries(RegionBounds)) {
    const projection = LegalProjections[code as keyof typeof LegalProjections]
    const regionGeometry = bboxPolygon([bbox[0], bbox[1], bbox[2], bbox[3]])

    if (
      (geometry.type === 'Point' && pointInPolygon(toWgs84(geometry, projection), regionGeometry)) ||
      ((geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') &&
        polygonInPolygon(toWgs84(geometry, projection), regionGeometry))
    ) {
      return gdal.SpatialReference.fromProj4(projection)
    }
  }

  return wgs84
}

/**
 * Unzip geographical files into a temporary directory
 */
export async function unzipGeographicalContent(buffer: Buffer): Promise<FileAnalysisResult> {
  let zip

  try {
    zip = new AdmZip(buffer)
  } catch (error) {
    throw new InvalidRequestApiError(
      "L'archive ZIP ne peut pas être lue. Provient-elle d'une source de donnée authentique ?",
      { cause: error }
    )
  }

  const entries = zip
    .getEntries()
    .filter((entry) => /(.sh[xp]|.dbf|.kml|.geojson|.gpkg)$/.test(entry.entryName) && !entry.name.startsWith('.'))
  if (entries.reduce((total, entry) => total + entry.header.size, 0) > MAX_UNZIPPED_SIZE) {
    throw new InvalidRequestApiError("L'archive ZIP décompressée est trop volumineuse.")
  }
  const toDir = await mkdtemp(join(tmpdir(), 'cartobio-anygeo-'))

  // extracts geo files but keep only the root .shp (.shx will be read as a companion file anyway)
  let files: string[]
  try {
    files = entries
      .map((entry) => {
        zip.extractEntryTo(entry, toDir, false, true, false)
        return join(toDir, entry.name)
      })
      .filter((filename) => ['.dbf', '.shx'].includes(extname(filename)) === false)
  } catch (error) {
    await rm(toDir, { recursive: true, force: true })
    throw error
  }

  return {
    path: toDir,
    files,
    cleanup: async (): Promise<void> => rm(toDir, { recursive: true })
  }
}

/**
 * We deal with 3 scenarios:
 *
 * - files are not part of a Zip archive: Gdal can process them directly
 * - a file (single format) is located within a Zip file: Gdal can process them as a buffer
 * - a file (multi format, like Shapefile) is located within a Zip file: Gdal can process them only as extracted files
 */
async function identifyFiles(file: Promise<MultipartFile | undefined>): Promise<FileAnalysisResult> {
  const data = await file
  if (!data) throw new InvalidRequestApiError('Aucun fichier transmis.')
  const buffer = await getStreamAsBuffer(data.file)
  const fileType = await fileTypeFromBuffer(buffer)

  if (fileType?.mime === 'application/zip') {
    return unzipGeographicalContent(buffer)
  }

  if (['application/x-sqlite3', 'application/x-esri-shape', undefined, 'application/xml'].includes(fileType?.mime)) {
    if (fileType?.mime === 'application/xml') {
      const xmlContent = buffer.toString('utf-8')
      const kmlNamespacePattern = /<kml[^>]*xmlns\s*=\s*["']([^"']*)opengis\.net\/kml[^"']*["'][^>]*>/i

      if (!kmlNamespacePattern.test(xmlContent)) {
        throw new InvalidRequestApiError('Format de fichier non-reconnu.')
      }
    }
    return {
      path: null,
      files: [buffer],
      cleanup: async (): Promise<void> => {}
    }
  }

  throw new InvalidRequestApiError('Format de fichier non-reconnu.')
}

export async function parseAnyGeographicalArchive(
  file: Promise<MultipartFile | undefined>
): Promise<FeatureCollection> {
  const { files, cleanup } = await identifyFiles(file)
  const featureCollection: FeatureCollection = {
    type: 'FeatureCollection',
    features: []
  }

  try {
    if (!files.length) {
      throw new InvalidRequestApiError('Format de fichier non-reconnu.')
    }

    for await (const filePathOrBuffer of files) {
      let dataset

      try {
        dataset = await gdal.openAsync(filePathOrBuffer, 'r', GEO_DRIVERS)
      } catch (error) {
        throw new InvalidRequestApiError('Format de fichier non-reconnu.', { cause: error })
      }

      try {
        for await (const layer of dataset.layers) {
          if (
            layer.geomType &&
            ![gdal.wkbPolygon, gdal.wkbMultiPolygon, gdal.wkbPolygon25D, gdal.wkbMultiPolygon25D].includes(
              layer.geomType
            )
          ) {
            continue
          }

          const srs = await detectSrs(layer)
          const reprojectFn = new gdal.CoordinateTransformation(srs, wgs84)
          for await (const feature of layer.features) {
            const names = feature.fields.getNames()
            const geometry = stripZFromGeometry(feature.getGeometry())
            if (!geometry) {
              throw new InvalidRequestApiError('Le fichier contient une parcelle sans géométrie.')
            }
            await geometry.transformAsync(reprojectFn)
            const id = names.includes('id') ? feature.fields.get('id') : getRandomFeatureId()
            const properties = feature.fields.toObject()
            const parsedProperties = featurePropertiesSchema.safeParse(properties)

            if (!parsedProperties.success) {
              throw new InvalidRequestApiError('Le fichier contient des propriétés invalides', {
                cause: parsedProperties.error
              })
            }

            if (geometry.name === 'POLYGON') {
              featureCollection.features.push({
                type: 'Feature',
                id,
                geometry: geometry.toObject(),
                properties: {
                  ...parsedProperties.data,
                  id
                }
              })
              // some tools outputs features as single polygon
              // and we don't deal with multipolygon because we want to distinguish each of them
            } else if (geometry.name === 'MULTIPOLYGON') {
              ;(geometry.toObject() as MultiPolygon).coordinates.forEach((coordinates): void => {
                const id = getRandomFeatureId()

                featureCollection.features.push({
                  type: 'Feature',
                  id,
                  geometry: {
                    type: 'Polygon',
                    coordinates
                  },
                  properties: {
                    ...properties,
                    id
                  }
                })
              })
            }
          }
        }
      } finally {
        await dataset.close()
      }
    }
  } finally {
    await cleanup()
  }

  return featureCollection
}

function stripZFromGeometry(geometry: gdal.Geometry | null): gdal.Geometry | null {
  if (!geometry) return null
  switch (geometry.name) {
    case 'LINESTRING': {
      const line = geometry as gdal.LineString
      const cleanedLine = new gdal.LineString()
      for (let i = 0; i < line.points.count(); i++) {
        const pt = line.points.get(i)
        if (!isNaN(pt.x) && !isNaN(pt.y)) {
          cleanedLine.points.add({ x: pt.x, y: pt.y })
        }
      }
      return cleanedLine
    }

    case 'POLYGON': {
      const polygon = geometry as gdal.Polygon
      const cleanedPolygon = new gdal.Polygon()
      for (let i = 0; i < polygon.rings.count(); i++) {
        const oldRing = polygon.rings.get(i)
        const newRing = new gdal.LinearRing()
        for (let j = 0; j < oldRing.points.count(); j++) {
          const pt = oldRing.points.get(j)
          if (!isNaN(pt.x) && !isNaN(pt.y)) {
            newRing.points.add({ x: pt.x, y: pt.y })
          }
        }
        cleanedPolygon.rings.add(newRing)
      }
      return cleanedPolygon
    }
    case 'MULTIPOINT': {
      const collection = geometry as gdal.GeometryCollection
      const cleanedMultiPoint = new gdal.MultiPoint()
      for (let i = 0; i < collection.children.count(); i++) {
        const cleanedChild = stripZFromGeometry(collection.children.get(i))
        if (cleanedChild) {
          cleanedMultiPoint.children.add(cleanedChild)
        }
      }
      return cleanedMultiPoint
    }

    case 'MULTILINESTRING': {
      const collection = geometry as gdal.GeometryCollection
      const cleanedMultiLine = new gdal.MultiLineString()
      for (let i = 0; i < collection.children.count(); i++) {
        const cleanedChild = stripZFromGeometry(collection.children.get(i))
        if (cleanedChild) {
          cleanedMultiLine.children.add(cleanedChild)
        }
      }
      return cleanedMultiLine
    }
    case 'MULTIPOLYGON': {
      const collection = geometry as gdal.GeometryCollection
      const cleanedMultiPolygon = new gdal.MultiPolygon()
      for (let i = 0; i < collection.children.count(); i++) {
        const cleanedChild = stripZFromGeometry(collection.children.get(i))
        if (cleanedChild) {
          cleanedMultiPolygon.children.add(cleanedChild)
        }
      }
      return cleanedMultiPolygon
    }

    case 'GEOMETRYCOLLECTION': {
      const collection = geometry as gdal.GeometryCollection
      const cleanedCollection = new gdal.GeometryCollection()
      for (let i = 0; i < collection.children.count(); i++) {
        const cleanedChild = stripZFromGeometry(collection.children.get(i))
        if (cleanedChild) {
          cleanedCollection.children.add(cleanedChild)
        }
      }
      return cleanedCollection
    }

    default:
      return geometry.clone()
  }
}
