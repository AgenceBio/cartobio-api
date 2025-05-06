const gdal = require('gdal-async')
const getStream = require('get-stream')
const { mkdtemp, rm } = require('node:fs/promises')
const { extname, join } = require('node:path')
const { tmpdir } = require('node:os')
const { toWgs84 } = require('reproject')
const bboxPolygon = require('@turf/bbox-polygon').default
const polygonInPolygon = require('@turf/boolean-intersects').default
const pointInPolygon = require('@turf/boolean-point-in-polygon').default
const AdmZip = require('adm-zip')
const FileType = require('file-type')
const { getRandomFeatureId } = require('../outputs/features.js')
const { InvalidRequestApiError } = require('../errors.js')
const { LegalProjections, RegionBounds } = require('../enums.js')
const Ajv = require('ajv').default

const ajv = new Ajv()
const validateSchema = ajv.compile({
  type: 'object',
  required: [],
  additionalProperties: true,
  properties: {
    cultures: {
      type: 'array',
      required: ['CPF'],
      items: {
        type: 'object'
      },
      nullable: true
    },
    conversion_niveau: {
      type: 'string',
      nullable: true
    },
    engagement_date: {
      type: 'object',
      nullable: true,
      required: ['year', 'month', 'day'],
      properties:
        {
          year: {
            type: 'integer'
          },
          month: {
            type: 'integer'
          },
          day: {
            type: 'integer'
          }
        }

    },
    commentaires: {
      type: 'string',
      nullable: true
    },
    auditeur_notes: {
      type: 'string',
      nullable: true
    },
    annotations: {
      type: 'array',
      nullable: true
    },
    NOM: {
      type: 'string',
      nullable: true
    },
    PACAGE: {
      type: 'string',
      pattern: '^([A-Z0-9]{8,9})|()$',
      nullable: true
    },
    NUMERO_I: {
      type: 'integer',
      nullable: true
    },
    NUMERO_P: {
      type: 'integer',
      nullable: true
    },
    cadastre: {
      type: 'array',
      items: {
        type: 'string'
      },
      nullable: true
    }
  }
})

/**
 * @typedef {import('geojson').Feature} Feature
 * @typedef {import('geojson').FeatureCollection} FeatureCollection
 * @typedef {import('geojson').GeoJsonProperties} FeatureProperties
 * @typedef {import('@fastify/multipart').MultipartFile} MultipartFile
 */

/**
 * @typedef {Object} FileAnalysisResult
 * @property {string} path
 * @property {string[]|Buffer[]} files
 * @property {() => Promise} cleanup
 */

const wgs84 = gdal.SpatialReference.fromProj4('+init=epsg:4326')

/**
 *
 * @param {gdal.Layer} layer
 * @returns {Promise<gdal.SpatialReference>}
 */
async function detectSrs (layer) {
  if (layer.srs) {
    return layer.srs
  }

  const feature = await layer.features.firstAsync()
  const geometry = feature.getGeometry().toObject()
  const geomType = feature.getGeometry().wkbType

  // iterate over the various regions/projections to guess which one it is
  for await (const [code, bbox] of Object.entries(RegionBounds)) {
    const projection = LegalProjections[code]
    // @ts-ignore BBox and number[] error is confusing
    const regionGeometry = bboxPolygon(bbox)

    if (
      ([gdal.wkbPoint].includes(geomType) && pointInPolygon(toWgs84(geometry, projection), regionGeometry)) ||
      ([gdal.wkbPolygon, gdal.wkbMultiPolygon].includes(geomType) && polygonInPolygon(toWgs84(geometry, projection), regionGeometry))
    ) {
      return gdal.SpatialReference.fromProj4(projection)
    }
  }

  return wgs84
}

/**
 * Unzip geographical files into a temporary directory
 *
 * @param {Buffer} buffer
 * @returns {Promise<FileAnalysisResult>}
 */
async function unzipGeographicalContent (buffer) {
  let zip

  try {
    zip = new AdmZip(buffer)
  } catch (error) {
    throw new InvalidRequestApiError('L\'archive ZIP ne peut pas être lue. Provient-elle d\'une source de donnée authentique ?', { cause: error })
  }

  const entries = zip.getEntries().filter(entry => /(.sh[xp]|.dbf|.kml|.geojson|.gpkg)$/.test(entry.entryName) && !entry.name.startsWith('.'))
  const toDir = await mkdtemp(join(tmpdir(), 'cartobio-anygeo-'))

  // extracts geo files but keep only the root .shp (.shx will be read as a companion file anyway)
  const files = entries.map(entry => {
    zip.extractEntryTo(entry, toDir, false, true, false)
    return join(toDir, entry.name)
  }).filter(filename => ['.dbf', '.shx'].includes(extname(filename)) === false)

  return {
    path: toDir,
    files,
    cleanup: async () => rm(toDir, { recursive: true })
  }
}

/**
 * We deal with 3 scenarios:
 *
 * - files are not part of a Zip archive: Gdal can process them directly
 * - a file (single format) is located within a Zip file: Gdal can process them as a buffer
 * - a file (multi format, like Shapefile) is located within a Zip file: Gdal can process them only as extracted files
 *
 * @param {Promise<MultipartFile>} file
 * @returns {Promise<FileAnalysisResult>}
 */
async function identifyFiles (file) {
  const data = await file
  const stream = await FileType.stream(data.file)

  if (stream.fileType?.mime === 'application/zip') {
    return unzipGeographicalContent(await getStream.buffer(stream))
  }

  if (['application/x-sqlite3', undefined].includes(stream.fileType?.mime)) {
    return {
      path: null,
      files: [await getStream.buffer(stream)],
      cleanup: async () => {}
    }
  }

  throw new InvalidRequestApiError('Format de fichier non-reconnu.')
}

/**
 * @param {Promise<MultipartFile>} file
 */
async function parseAnyGeographicalArchive (file) {
  const { files, cleanup } = await identifyFiles(file)
  /** @type {FeatureCollection} */
  const featureCollection = {
    type: 'FeatureCollection',
    features: []
  }

  if (!files.length) {
    throw new InvalidRequestApiError('Format de fichier non-reconnu.')
  }

  for await (const filePathOrBuffer of files) {
    let dataset

    try {
      dataset = await gdal.openAsync(filePathOrBuffer)
    } catch (error) {
      throw new InvalidRequestApiError('Format de fichier non-reconnu.', { cause: error })
    }

    for await (const layer of dataset.layers) {
      if (layer.geomType && ![gdal.wkbPolygon, gdal.wkbMultiPolygon].includes(layer.geomType)) {
        continue
      }

      const srs = await detectSrs(layer)
      const reprojectFn = new gdal.CoordinateTransformation(srs, wgs84)

      for await (const feature of layer.features) {
        const names = feature.fields.getNames()
        const geometry = feature.getGeometry()
        await geometry.transformAsync(reprojectFn)
        const id = names.includes('id') ? feature.fields.get('id') : getRandomFeatureId()
        const properties = feature.fields.toObject()

        // eslint-disable-next-line camelcase
        const { cultures, conversion_niveau, engagement_date, commentaires, auditeur_notes, annotations, NOM, PACAGE, NUMERO_I, NUMERO_P, cadastre } = properties

        const parsedProperties = {
          cultures: cultures ? JSON.parse(cultures) : undefined,
          conversion_niveau,
          // eslint-disable-next-line camelcase
          engagement_date: engagement_date,
          commentaires,
          auditeur_notes,
          annotations: annotations ? JSON.parse(annotations) : undefined,
          NOM,
          PACAGE,
          NUMERO_I: NUMERO_I ? +NUMERO_I : undefined,
          NUMERO_P: NUMERO_P ? +NUMERO_P : undefined,
          cadastre
        }

        if (!validateSchema(parsedProperties)) {
          await dataset.close()
          await cleanup()
          throw new InvalidRequestApiError('Le fichier contient des propriétés invalides')
        }

        if (geometry.name === 'POLYGON') {
          featureCollection.features.push({
            type: 'Feature',
            id,
            geometry: geometry.toObject(),
            properties: {
              ...parsedProperties,
              engagement_date: parsedProperties.engagement_date ? `${engagement_date.year}-${engagement_date.month}-${engagement_date.day}` : undefined,
              id
            }
          })
        // some tools outputs features as single polygon
        // and we don't deal with multipolygon because we want to distinguish each of them
        } else if (geometry.name === 'MULTIPOLYGON') {
          geometry.toObject().coordinates.forEach(coordinates => {
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

    await dataset.close()
  }

  await cleanup()

  return featureCollection
}

module.exports = {
  detectSrs,
  parseAnyGeographicalArchive,
  unzipGeographicalContent,
  wgs84
}
