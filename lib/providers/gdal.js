const gdal = require('gdal-async')
const getStream = require('get-stream')
const { mkdtemp, rm } = require('node:fs/promises')
const { extname, join } = require('node:path')
const { tmpdir } = require('node:os')
const AdmZip = require('adm-zip')
const FileType = require('file-type')
const { getRandomFeatureId } = require('../outputs/features.js')
const { InvalidRequestApiError } = require('../errors.js')

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
 * Unzip geographical files into a temporary directory
 *
 * @param {Buffer} buffer
 * @returns {Promise<FileAnalysisResult>}
 */
async function unzipGeographicalContent (buffer) {
  const zip = new AdmZip(buffer)

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
      const reprojectFn = new gdal.CoordinateTransformation(
        layer.srs || wgs84,
        wgs84
      )

      for await (const feature of layer.features) {
        const names = feature.fields.getNames()
        const geometry = feature.getGeometry()
        await geometry.transformAsync(reprojectFn)
        const id = names.includes('id') ? feature.fields.get('id') : getRandomFeatureId()

        if (geometry.name === 'POLYGON') {
          featureCollection.features.push({
            type: 'Feature',
            id,
            geometry: geometry.toObject(),
            properties: {
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
  parseAnyGeographicalArchive,
  unzipGeographicalContent,
  wgs84
}
