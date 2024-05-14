const gdal = require('gdal-async')
const getStream = require('get-stream')
const { toWgs84 } = require('reproject')
const { XMLParser } = require('fast-xml-parser')
const Ajv = require('ajv').default
const { getRandomFeatureId } = require('../outputs/features.js')
const FileType = require('file-type')
const { randomUUID } = require('node:crypto')
const { EtatProduction, LegalProjections } = require('../enums.js')
const { InvalidRequestApiError } = require('../errors.js')
const { detectSrs, unzipGeographicalContent, wgs84 } = require('./gdal.js')
const { fromCodePacStrict } = require('@agencebio/rosetta-cultures')
const { featureCollection, feature: Feature } = require('@turf/helpers')

const ajv = new Ajv()
const validateSchema = ajv.compile({
  type: 'object',
  required: ['CAMPAGNE', 'NUMERO_I', 'NUMERO_P', 'PACAGE', 'TYPE'],
  additionalProperties: true,
  properties: {
    AGRIBIO: {
      type: 'integer',
      minimum: 0,
      maximum: 1
    },
    CAMPAGNE: { type: 'integer' },
    COMMUNE: { type: 'string' },
    NUMERO_I: { type: 'integer' },
    NUMERO_P: { type: 'integer' },
    PACAGE: {
      type: 'string',
      pattern: '^\\d{8,9}$'
    },
    TYPE: {
      type: 'string',
      pattern: '^[A-Z0-9]{3}$'
    }
  }
})

const removeEmptyElements = (item) => item

/**
 * @typedef {import('geojson').FeatureCollection} FeatureCollection
 * @typedef {import('geojson').Feature} Feature
 * @typedef {import('@fastify/multipart').MultipartFile} MultipartFile
 */

/**
 *
 * @param {Promise<MultipartFile>} file
 */
async function parseTelepacArchive (file) {
  const data = await file
  const stream = await FileType.stream(data.file)

  if (stream.fileType?.mime === 'application/zip') {
    return fromShapefileArchive(stream)
  }

  const content = await getStream(stream)
  if (content.includes('<rpg>')) {
    return fromXMLFile(content)
  }

  throw new InvalidRequestApiError('Format de fichier non-reconnu.')
}

/**
 * Parse a Telepac Shapefile archive to GeoJSON
 *
 * @param {FileType.ReadableStreamWithFileType} stream
 * @returns {Promise<FeatureCollection>}
 */
async function fromShapefileArchive (stream) {
  const { files, cleanup } = await unzipGeographicalContent(await getStream.buffer(stream))
  /** @type {FeatureCollection} */
  const featureCollection = {
    type: 'FeatureCollection',
    features: []
  }

  if (!files.length) {
    throw new InvalidRequestApiError('Il ne s\'agit pas d\'un fichier Telepac "Parcelles déclarées" ou "Parcelles instruites".')
  }

  // validateSchema(geojson.features)
  for await (const filepath of files) {
    const dataset = await gdal.openAsync(filepath)

    for await (const layer of dataset.layers) {
      const srs = await detectSrs(layer)
      const reprojectFn = new gdal.CoordinateTransformation(srs, wgs84)

      for await (const feature of layer.features) {
        const names = feature.fields.getNames()
        const geometry = feature.getGeometry()
        await geometry.transformAsync(reprojectFn)
        const id = names.includes('id') ? feature.fields.get('id') : getRandomFeatureId()
        const properties = feature.fields.toObject()

        if (!validateSchema(properties)) {
          await dataset.close()
          await cleanup()

          throw new InvalidRequestApiError('Il ne s\'agit pas d\'un fichier Telepac "Parcelles déclarées" ou "Parcelles instruites".')
        }

        // @ts-ignore
        const { AGRIBIO, CAMPAGNE, CODE_VAR, COMMUNE, NUMERO_I, NUMERO_P, PACAGE, TYPE } = properties

        featureCollection.features.push(/** @type {Feature} */{
          type: 'Feature',
          id,
          geometry: geometry.toObject(),
          properties: {
            id,
            BIO: AGRIBIO,
            CAMPAGNE,
            COMMUNE,
            cultures: [
              {
                id: randomUUID(),
                CPF: fromCodePacStrict(TYPE, CODE_VAR)?.code_cpf,
                TYPE
              }
            ],
            conversion_niveau: AGRIBIO === 1 ? 'AB?' : EtatProduction.NB,
            NUMERO_I,
            NUMERO_P,
            PACAGE
          }
        })
      }
    }

    await dataset.close()
  }

  await cleanup()

  return featureCollection
}

/**
 *
 * @param {string} gmlCoordinates
 * @return {import('geojson').Position[]}
 */
function toGeoJSONCoordinates (gmlCoordinates) {
  return gmlCoordinates.trim().replace(/\n/g, '').split(' ')
    // clean tabular spacing
    .filter(removeEmptyElements)
    // we split the single unit of X,Y into array pairs of [X, Y]
    .map(unit => unit.split(','))
    // turn them into floats
    .map(([X, Y]) => [parseFloat(X), parseFloat(Y)])
}

/**
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7946#section-3.1.6
 * @param {Object} gmlPolygon
 * @returns {import('geojson').Polygon}
 */
function gmlGeometryToGeoJSONGeometry (gmlPolygon) {
  return {
    type: 'Polygon',
    coordinates: [
      // exterior ring
      toGeoJSONCoordinates(gmlPolygon['gml:outerBoundaryIs']['gml:LinearRing']['gml:coordinates']),
      // optional interior rings
      ...(gmlPolygon['gml:innerBoundaryIs'] ?? []).map((boundary) => {
        return toGeoJSONCoordinates(boundary['gml:LinearRing']['gml:coordinates'])
      })
    ].filter(removeEmptyElements)
  }
}

/**
 * Parse a Telepac/MesParcelles XML export to GeoJSON
 * For now, it works only with Metropole projection
 *
 * @param {String} xmlContent
 * @returns {Promise<FeatureCollection>}
 */
async function fromXMLFile (xmlContent) {
  const xml = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    isArray: (name, jpath, isLeafNode, isAttribute) => ['ilot', 'parcelle', 'gml:innerBoundaryIs'].includes(name) && !isAttribute && !isLeafNode
  }).parse(xmlContent)

  const PACAGE = xml.producteurs.producteur['@_numero-pacage']
  const ilots = xml.producteurs.producteur.rpg.ilot ?? xml.producteurs.producteur.rpg.ilots.ilot

  const geojson = featureCollection(ilots.flatMap(ilot => {
    const { '@_numero-ilot': NUMERO_I, commune: COMMUNE } = ilot

    return ilot.parcelles.parcelle.map(parcelle => {
      const id = getRandomFeatureId()
      const props = parcelle['descriptif-parcelle']
      const { '@_numero-parcelle': NUMERO_P } = props
      const { '@_conduite-bio': AGRIBIO } = props['agri-bio'] ?? {}
      const TYPE = props['culture-principale']['code-culture']
      const CODE_VAR = props['culture-principale'].precision

      return Feature(
        gmlGeometryToGeoJSONGeometry(parcelle.geometrie['gml:Polygon']),
        {
          id,
          remoteId: `${NUMERO_I}.${NUMERO_P}`,
          COMMUNE,
          cultures: [
            {
              id: randomUUID(),
              CPF: fromCodePacStrict(TYPE, CODE_VAR)?.code_cpf,
              TYPE
            }
          ],
          NUMERO_I,
          NUMERO_P,
          PACAGE,
          conversion_niveau: AGRIBIO === 'true' ? 'AB?' : EtatProduction.NB
        },
        { id }
      )
    })
  }))

  return toWgs84(geojson, LegalProjections.metropole)
}

module.exports = {
  parseTelepacArchive
}
