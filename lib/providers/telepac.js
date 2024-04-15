const geo = require('verrazzano')
const getStream = require('get-stream')
const { toWgs84 } = require('reproject')
const { XMLParser } = require('fast-xml-parser')
const Ajv = require('ajv').default
const { getRandomFeatureId } = require('../outputs/features.js')
const { pipeline } = require('node:stream/promises')
const { randomUUID } = require('node:crypto')
const { EtatProduction } = require('../enums.js')
const { InvalidRequestApiError } = require('../errors.js')
const { fromCodePacStrict } = require('@agencebio/rosetta-cultures')
const { featureCollection, feature: Feature } = require('@turf/helpers')
const intersect = require('@turf/intersect').default

const ajv = new Ajv()
const parcellesSchema = {
  type: 'array',
  items: {
    $ref: '#/$defs/feature'
  },
  $defs: {
    feature: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          const: 'Feature'
        },
        geometry: {
          type: 'object'
        },
        properties: {
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
        }
      }
    }
  }
}

const validateSchema = ajv.compile(parcellesSchema)

// @ts-ignore
const metropole = require('../../data/metropole.json')
// @ts-ignore
const antilles = require('../../data/antilles.json')
// @ts-ignore
const guyane = require('../../data/guyane.json')
// @ts-ignore
const reunion = require('../../data/reunion.json')
// @ts-ignore
const mayotte = require('../../data/mayotte.json')
const regions = { metropole, antilles, guyane, reunion, mayotte }

const projections = {
  // https://epsg.io/2154
  metropole: '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  // https://epsg.io/5490
  antilles: '+proj=utm +zone=20 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  // https://epsg.io/2975
  reunion: '+proj=utm +zone=40 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  // https://epsg.io/2972
  guyane: '+proj=utm +zone=22 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  // https://epsg.io/4471
  mayotte: '+proj=utm +zone=38 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs'
}

const removeEmptyElements = (item) => item

/**
 * @typedef {import('geojson').FeatureCollection} FeatureCollection
 * @typedef {import('@fastify/multipart').MultipartFile} MultipartFile
 */

/**
 *
 * @param {Promise<MultipartFile>} file
 */
async function parseTelepacArchive (file) {
  const data = await file

  switch (data.mimetype) {
    case 'application/zip': return fromShapefileArchive(data)
    case 'text/xml':
    case 'application/xml': return fromXMLFile(data)
    default: throw new InvalidRequestApiError('Format de fichier non-reconnu.')
  }
}

/**
 * Parse a Telepac Shapefile archive to GeoJSON
 *
 * @param {MultipartFile} data
 * @returns {Promise<FeatureCollection>}
 */
async function fromShapefileArchive (data) {
  /**
   * @type {Promise<string>}
   */
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const stream = pipeline(
    data.file,
    geo.from('shp'),
    geo.to('geojson'),
    getStream
  )

  const geojson = await stream.catch(error => {
    throw new InvalidRequestApiError('Impossible de trouver l\'archive Telepac dans ce fichier.', { cause: error })
  }).then(geojsonString => JSON.parse(geojsonString))

  // We identify the shapefile as an ILOT export, and we don't want it
  if (!validateSchema(geojson.features)) {
    console.error(validateSchema.errors, geojson.features)
    throw new InvalidRequestApiError('Il ne s\'agit pas d\'un fichier Telepac "Parcelles déclarées" ou "Parcelles instruites".')
  }

  const featureCollection = {
    type: 'FeatureCollection',
    features: geojson.features.map(({ properties, geometry, type }) => {
      const id = getRandomFeatureId()

      const { AGRIBIO, CAMPAGNE, COMMUNE, NUMERO_I, NUMERO_P, PACAGE, TYPE, CODE_VAR } = properties

      return {
        id,
        type,
        geometry,
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
      }
    })
  }

  // We try to convert with each projection until we find one that intersects the output with the region
  return Object.entries(regions).map(([region, regionGeojson]) => {
    const projection = projections[region]
    const output = toWgs84(featureCollection, projection)

    if (output.features.some(feature => intersect(feature, regionGeojson))) {
      return output
    }

    return null
  }).find(removeEmptyElements)
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
 * @param {MultipartFile} data
 * @returns {Promise<FeatureCollection>}
 */
async function fromXMLFile (data) {
  const xmlContent = (await data.toBuffer()).toString()

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

  return toWgs84(geojson, projections.metropole)
}

module.exports = {
  parseTelepacArchive
}
