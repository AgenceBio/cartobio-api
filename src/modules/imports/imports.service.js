'use strict'

const geofolia = (() => {
const AdmZip = require('adm-zip')
const memo = require('p-memoize')
// @ts-ignore
const { get, post } = require('got')
const config = require('../../../src/config/env.js')
const { parse } = require('wkt')
const { featureCollection, feature: Feature } = require('@turf/helpers')
const { toWgs84 } = require('reproject')
const { getRandomFeatureId } = require('../../../src/shared/outputs/features.js')
const { fromCodeGeofolia } = require('@agencebio/rosetta-cultures')
const { BadGatewayApiError } = require('../../../src/shared/errors.js')

const IN_HECTARES = 10000
const ONE_HOUR = 60 * 60 * 1000

/**
 * Strips a leading byte that breaks `JSON.parse()`, to name the least.
 *
 * @param {string} string
 * @see https://github.com/sindresorhus/strip-bom/blob/main/index.js
 * @see https://en.wikipedia.org/wiki/Byte_order_mark
 * @returns {string}
 */
const stripBOM = (string) => string.charCodeAt(0) === 0xFEFF ? string.slice(1) : string

const excludeFieldsWithoutMainGeometry = ({ Geography, PlotKind }) => !(!Geography && PlotKind === PLOT_KIND_PRIMARY)

const PLOT_KIND_PRIMARY = 1
const PLOT_KIND_SECONDARY = 2

function cultureFromField (Field) {
  return {
    CPF: fromCodeGeofolia(Field.RNCropCode)?.code_cpf,
    GF: Field.RNCropCode,
    ...(Field.SowingDate ? { date_semis: Field.SowingDate.split('T').at(0) } : {}),
    ...(Field.VarietyName ? { variete: Field.VarietyName } : {}),
    ...(Field.Area ? { surface: Math.round((Field.Area / IN_HECTARES) * 100) / 100 } : {}),
    id: Field.Id
  }
}

function convertGeofoliaFieldsToGeoJSON (data) {
  const fields = data.Fields.filter(excludeFieldsWithoutMainGeometry)
  const mainFields = fields.filter(({ PlotKind, Geography }) => Geography && PlotKind === PLOT_KIND_PRIMARY)
  const secondaryCultures = data.Fields.filter(({ PlotKind }) => PlotKind === PLOT_KIND_SECONDARY)

  return featureCollection(mainFields.map(Field => {
    const id = getRandomFeatureId()
    const secondaryFields = secondaryCultures.filter(({ MainPlotId }) => MainPlotId === Field.Id)

    return Feature(
      parse(Field.Geography),
      {
        id,
        remoteId: Field.Id,
        COMMUNE: Field.CityNumber,
        NOM: Field.Name,
        cultures: [
          cultureFromField(Field),
          ...secondaryFields.map(cultureFromField)
        ].filter(d => d),
        NUMERO_I: Field.IsletNum,
        NUMERO_P: Field.Code,
        conversion_niveau: '',
        commentaires: [Field, ...secondaryFields]
          .map(({ Comment }) => Comment)
          .filter(d => d)
          .join('\n\n')
      },
      { id }
    )
  }))
}

/**
 * @returns {Promise<String>} A JWT Auth Token
 */
function fetchAuthToken () {
  return post(`${config.get('geofolia.oauth.tenant')}/oauth2/v2.0/token`, {
    prefixUrl: config.get('geofolia.oauth.host'),
    form: {
      client_id: config.get('geofolia.oauth.clientId'),
      client_secret: config.get('geofolia.oauth.clientSecret'),
      grant_type: 'client_credentials',
      scope: config.get('geofolia.api.scope')
    }
  })
    .json()
    .then(({ access_token: accessToken }) => accessToken)
}

/**
 * Authenticate a user based on environment variables
 * It is a good idea to memoize it for a few hours to save on API calls
 *
 * @returns {String}            A JWT Auth Token
 */
const auth = memo(() => fetchAuthToken(), { maxAge: 0.90 * ONE_HOUR })

async function geofoliaTriggerDataOrder (numeroSiret, year) {
  const token = await auth()

  return post('flow/api/v1/data-orders', {
    prefixUrl: config.get('geofolia.api.host'),
    headers: {
      Authorization: `Bearer ${token}`,
      'Ocp-Apim-Subscription-Key': config.get('geofolia.api.subscriptionKey')
    },
    json: {
      serviceCode: config.get('geofolia.api.serviceCode'),
      dataFilter: {
        year,
        identificationCodes: [numeroSiret]
      }
    }
  }).json()
}

async function geofoliaRequestDataOrder (numeroSiret) {
  const token = await auth()

  const orders = await get('flow/api/v1/flow-attributes', {
    prefixUrl: config.get('geofolia.api.host'),
    headers: {
      Authorization: `Bearer ${token}`,
      'Ocp-Apim-Subscription-Key': config.get('geofolia.api.subscriptionKey')
    },
    searchParams: {
      serviceCode: config.get('geofolia.api.serviceCode')
    }
  }).json()

  return orders.find(({ identificationCodes }) => identificationCodes.includes(numeroSiret))
}

async function geofoliaLookup (numeroSiret, year) {
  try {
    await geofoliaTriggerDataOrder(numeroSiret, year)
    return true
  } catch (error) {
    // @ts-ignore
    if (error.response?.statusCode === 404) {
      return false
    } else {
      throw new BadGatewayApiError('Impossible de communiquer avec l\'API Geofolia.', { cause: error })
    }
  }
}

async function geofoliaFetchDataOrder (order) {
  const token = await auth()

  return get(`flow/api/v1/flows/${order.id}`, {
    prefixUrl: config.get('geofolia.api.host'),
    headers: {
      Authorization: `Bearer ${token}`,
      'Ocp-Apim-Subscription-Key': config.get('geofolia.api.subscriptionKey')
    },
    searchParams: {
      serviceCode: config.get('geofolia.api.serviceCode')
    }
  }).buffer()
}

async function geofoliaParcellaire (numeroSiret) {
  const order = await geofoliaRequestDataOrder(numeroSiret)

  if (!order) {
    return null
  }

  const archive = await geofoliaFetchDataOrder(order)

  return parseGeofoliaArchive(archive)
}

async function parseGeofoliaArchive (buffer) {
  const zip = new AdmZip(buffer)
  const FieldFileEntry = await zip.getEntry('Field.Json')

  const lambert93 = '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'

  const parsedJSON = JSON.parse(stripBOM(FieldFileEntry.getData().toString('utf8')))
  const geojson = convertGeofoliaFieldsToGeoJSON(parsedJSON)

  return toWgs84(geojson, lambert93)
}

return {
  geofoliaLookup,
  geofoliaParcellaire,
  parseGeofoliaArchive
}
})()

const telepac = (() => {
const gdal = require('gdal-async')
const getStream = require('get-stream')
const { toWgs84 } = require('reproject')
const { XMLParser } = require('fast-xml-parser')
const Ajv = require('ajv').default
const { getRandomFeatureId } = require('../../../src/shared/outputs/features.js')
const FileType = require('file-type')
const { randomUUID } = require('node:crypto')
const { EtatProduction, LegalProjections } = require('../../../src/shared/enums.js')
const { InvalidRequestApiError } = require('../../../src/shared/errors.js')
const { detectSrs, unzipGeographicalContent, wgs84 } = require('../../../src/shared/geo/gdal.js')
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
      pattern: '^[A-Z0-9]{8,9}$'
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
            conversion_niveau: AGRIBIO === 1 ? EtatProduction.BIO : EtatProduction.NB,
            NUMERO_I,
            NUMERO_P,
            PACAGE,
            ...(TYPE ? { TYPE } : {}),
            ...(CODE_VAR ? { CODE_VAR } : {})
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
          conversion_niveau: AGRIBIO === 'true' ? EtatProduction.BIO : EtatProduction.NB,
          TYPE,
          CODE_VAR
        },
        { id }
      )
    })
  }))

  return toWgs84(geojson, LegalProjections.metropole)
}

return {
  parseTelepacArchive
}
})()


const api = (() => {
'use strict'

const { feature, featureCollection, polygon } = require('@turf/helpers')
const JSONStream = require('jsonstream-next')
const repository = require('./imports.repository.js')
const pool = repository
const {
  EtatProduction,
  CertificationState,
  RegionBounds
} = require('../../../src/shared/enums.js')
const {
  parsePacDetailsFromComment,
  fetchOperatorByNumeroBio
} = require('../../../src/clients/agence-bio.client.js')
const { normalizeEtatProduction } = require('../../../src/shared/outputs/record.js')
const { randomUUID } = require('crypto')
const { fromCodeCpf } = require('@agencebio/rosetta-cultures')
// @ts-ignore
const { InvalidRequestApiError } = require('../../../src/shared/errors.js')
const { getRandomFeatureId } = require('../../../src/shared/outputs/features.js')
const bboxPolygon = require('@turf/bbox-polygon').default
const polygonInPolygon = require('@turf/boolean-intersects').default

const { createOrUpdateOperatorRecord } = require('../../../src/shared/cartobio.service.js')

/**
 * @typedef {import('geojson').Feature} Feature
 * @typedef {import('geojson').FeatureCollection} FeatureCollection
 * @typedef {import('geojson').GeoJsonProperties} FeatureProperties
 * @typedef {import('geojson').Polygon} Polygon
 * @typedef {import('./types/cartobio').CartoBioUser} CartoBioUser
 * @typedef {import('./types/cartobio').DBOperatorRecord} DBOperatorRecord
 * @typedef {import('./types/cartobio').DBOperatorRecordWithParcelles} DBOperatorRecordWithParcelles
 * @typedef {import('./types/cartobio').DBParcelle} DBParcelle
 * @typedef {import('./types/cartobio').OperatorFilter} OperatorFilter
 * @typedef {import('./types/agence-bio').OrganismeCertificateur} OrganismeCertificateur
 * @typedef {import('../outputs/types/api').InputApiRecord} InputApiRecord
 * @typedef {import('../outputs/types/features').CartoBioFeature} CartoBioFeature
 * @typedef {import('../outputs/types/features').CartoBioFeatureCollection} CartoBioFeatureCollection
 * @typedef {import('../outputs/types/features').CartoBioFeatureProperties} CartoBioFeatureProperties
 * @typedef {import('../outputs/types/record').NormalizedRecord} NormalizedRecord
 * @typedef {import('../outputs/types/record').NormalizedRecordSummary} NormalizedRecordSummary
 * @typedef {import('../outputs/types/history').HistoryEntry} HistoryEntry
 * @typedef {import('../outputs/types/operator').AgenceBioNormalizedOperator} AgenceBioNormalizedOperator
 * @typedef {import('../outputs/types/operator').AgenceBioNormalizedOperatorWithRecord} AgenceBioNormalizedOperatorWithRecord
 */

/**
 * Enumération des codes de log pour les imports parcellaires.
 * Permet de requêter et filtrer les logs par type d'erreur ou d'avertissement.
 *
 * @enum {string}
 */
const ImportLogType = {
  // Errors - validation basique
  MISSING_NUMERO_BIO: 'MISSING_NUMERO_BIO',
  MISSING_NUMERO_CLIENT: 'MISSING_NUMERO_CLIENT',
  // Errors - opérateur
  UNKNOWN_NUMERO_BIO: 'UNKNOWN_NUMERO_BIO',
  NOT_PRODUCTION: 'NOT_PRODUCTION',
  NO_OC: 'NO_OC',
  OC_MISMATCH: 'OC_MISMATCH',
  // Errors - dates du record
  INVALID_DATE_CERTIFICATION_DEBUT: 'INVALID_DATE_CERTIFICATION_DEBUT',
  INVALID_DATE_CERTIFICATION_FIN: 'INVALID_DATE_CERTIFICATION_FIN',
  INVALID_DATE_AUDIT: 'INVALID_DATE_AUDIT',
  // Errors - parcelle
  INVALID_ETAT_PRODUCTION: 'INVALID_ETAT_PRODUCTION',
  MISSING_DATE_ENGAGEMENT: 'MISSING_DATE_ENGAGEMENT',
  INVALID_DATE_ENGAGEMENT: 'INVALID_DATE_ENGAGEMENT',
  MISSING_CULTURES: 'MISSING_CULTURES',
  INVALID_CPF: 'INVALID_CPF',
  INVALID_GEOM: 'INVALID_GEOM',
  // Errors - BDD
  DB_ERROR: 'DB_ERROR',
  // Warnings
  MISSING_GEOM: 'MISSING_GEOM',
  GEOM_OUT_OF_BOUNDS: 'GEOM_OUT_OF_BOUNDS',
  GEOM_CORRECTED: 'GEOM_CORRECTED',
  GEOM_INVALID_NOT_CORRECTED: 'GEOM_INVALID_NOT_CORRECTED',
  PAC_PENDING_WITH_ILOT: 'PAC_PENDING_WITH_ILOT'
}

/**
 * @typedef {{ numeroBio: string, message: string, code: string }} ImportWarning
 * @typedef {{ record: Partial<NormalizedRecord>, numeroBio: string, warnings: ImportWarning[] }} ValidItem
 * @typedef {{ numeroBio?: string, error: Error, errorType: string }} ErrorItem
 */

/**
 * @generator
 * @param {any} stream - a Json Stream
 * @param {{ organismeCertificateur: OrganismeCertificateur }} options
 * @yields {{ record?: Partial<NormalizedRecord>, numeroBio?: string, error?: Error, errorType?: string, warnings?: ImportWarning[] }}
 */
async function * parseAPIParcellaireStream (stream, { organismeCertificateur }) {
  /**
   * @type {Promise<InputApiRecord>[]}
   */
  const streamRecords = stream

  for await (const record of streamRecords) {
    const parcelleWarnings = []

    const operator = await fetchOperator(String(record.numeroBio))

    if (operator == null) {
      yield {
        numeroBio: String(record.numeroBio),
        error: new Error('Numéro bio inconnu du portail de notification'),
        errorType: ImportLogType.UNKNOWN_NUMERO_BIO,
        json: record
      }
      continue
    } else if (!operator.isProduction) {
      yield {
        numeroBio: String(record.numeroBio),
        error: new Error(
          'Numéro bio sans notification liée à une activité de production'
        ),
        errorType: ImportLogType.NOT_PRODUCTION,
        json: record
      }
      continue
    }

    if (!operator.organismeCertificateur) {
      yield {
        numeroBio: String(record.numeroBio),
        error: new Error('Aucun organisme certificateur pour ce numéro bio.'),
        errorType: ImportLogType.NO_OC,
        json: record
      }
      continue
    }

    if (
      !('numeroClient' in operator.organismeCertificateur) ||
      operator.organismeCertificateur.numeroClient !== String(record.numeroClient)
    ) {
      yield {
        numeroBio: String(record.numeroBio),
        error: new Error('Numéro client différent'),
        errorType: ImportLogType.OC_MISMATCH,
        json: record
      }
      continue
    }

    if (
      record.dateCertificationDebut &&
      isNaN(Date.parse(record.dateCertificationDebut))
    ) {
      yield {
        numeroBio: String(record.numeroBio),
        error: new Error('champ dateCertificationDebut incorrect'),
        errorType: ImportLogType.INVALID_DATE_CERTIFICATION_DEBUT,
        json: record
      }
      continue
    }

    if (
      record.dateCertificationFin &&
      isNaN(Date.parse(record.dateCertificationFin))
    ) {
      yield {
        numeroBio: String(record.numeroBio),
        error: new Error('champ dateCertificationFin incorrect'),
        errorType: ImportLogType.INVALID_DATE_CERTIFICATION_FIN,
        json: record
      }
      continue
    }

    if (isNaN(Date.parse(record.dateAudit))) {
      yield {
        numeroBio: String(record.numeroBio),
        error: new Error('champ dateAudit incorrect'),
        errorType: ImportLogType.INVALID_DATE_AUDIT,
        json: record
      }
      continue
    }

    let hasFeatureError = null
    let hasFeatureErrorType = null

    const features = await Promise.all(
      record.parcelles.map(async (parcelle) => {
        const id = String(parcelle.id ?? getRandomFeatureId())
        const cultures = parcelle.culture ?? parcelle.cultures
        const pac = parsePacDetailsFromComment(parcelle.commentaire)
        const numeroIlot = parseInt(String(parcelle.numeroIlot), 10)
        const numeroParcelle = parseInt(String(parcelle.numeroParcelle), 10)

        if (!Number.isNaN(numeroIlot) && numeroIlot !== 0 && parcelle.enAttentePac === true) {
          parcelle.enAttentePac = false
          parcelleWarnings.push({
            numeroBio: String(record.numeroBio),
            message: `Parcelle ${id ?? ''} acceptée mais ne peut être en attente PAC car un ilôt PAC est renseigné`,
            code: ImportLogType.PAC_PENDING_WITH_ILOT
          })
        }

        let conversionNiveau
        try {
          conversionNiveau =
            parcelle.etatProduction &&
            normalizeEtatProduction(parcelle.etatProduction, { strict: true })
          if (
            conversionNiveau !== null &&
            [EtatProduction.C1, EtatProduction.C2, EtatProduction.C3].includes(
              conversionNiveau
            ) &&
            !Date.parse(parcelle.dateEngagement)
          ) {
            hasFeatureError = new Error(
              "Champ date d'engagement obligatoire lorsque que la parcelle est en conversion")
            hasFeatureErrorType = ImportLogType.MISSING_DATE_ENGAGEMENT
            return null
          }
        } catch (error) {
          hasFeatureError = new Error('champ etatProduction incorrect')
          hasFeatureErrorType = ImportLogType.INVALID_ETAT_PRODUCTION
          console.log(error)
          return null
        }
        const properties = {
          id,
          cultures: cultures?.map(
            ({ codeCPF, quantite, variete = '', dateSemis = '', unite }) => ({
              id: randomUUID(),
              CPF: codeCPF,
              date_semis: dateSemis,
              surface: parseFloat(String(quantite)),
              unit: unite,
              variete
            })
          ),
          NUMERO_I: Number.isNaN(numeroIlot)
            ? pac
              ? pac.numeroIlot ?? null
              : null
            : String(numeroIlot),
          NUMERO_P: Number.isNaN(numeroParcelle)
            ? pac
              ? pac.numeroParcelle ?? null
              : null
            : String(numeroParcelle),
          PACAGE: record.numeroPacage ? String(record.numeroPacage) : null,
          conversion_niveau: conversionNiveau,
          engagement_date: parcelle.dateEngagement ?? null,
          auditeur_notes: parcelle.commentaire ?? null,
          TYPE: parcelle.codeCulture ?? null,
          CODE_VAR: parcelle.codePrecision ?? null,
          COMMUNE: parcelle.commune ?? null,
          NOM: parcelle.nom ?? null,
          en_attente_pac: parcelle.enAttentePac ?? false
        }

        if (parcelle.dateEngagement && !Date.parse(parcelle.dateEngagement)) {
          hasFeatureError = new Error('champ dateEngagement incorrect')
          hasFeatureErrorType = ImportLogType.INVALID_DATE_ENGAGEMENT
          return null
        }
        if (!cultures?.length) {
          hasFeatureError = new Error('cultures absentes')
          hasFeatureErrorType = ImportLogType.MISSING_CULTURES
          return null
        }

        const invalidCodes = cultures
          .filter((c) => !fromCodeCpf(c.codeCPF))
          .map((c) => c.codeCPF)

        if (invalidCodes.length > 0) {
          hasFeatureError = new Error(
            `cultures inconnues: ${invalidCodes.join(', ')}`
          )
          hasFeatureErrorType = ImportLogType.INVALID_CPF
          return null
        }

        let coordinates = []

        if (
          parcelle.geom === null ||
          parcelle.geom === undefined ||
          parcelle.geom === '' ||
          parcelle.geom === 'null'
        ) {
          parcelleWarnings.push({
            numeroBio: String(record.numeroBio),
            message: `Parcelle ${id ?? ''} n'a pas de géométrie`,
            code: ImportLogType.MISSING_GEOM
          })
          return feature(null, properties, { id })
        }

        try {
          coordinates = JSON.parse(parcelle.geom.replace(/}$/, ''))
          coordinates.forEach((ring) =>
            ring.forEach(([x, y]) => {
              if (!Number.isFinite(x) || !Number.isFinite(y)) {
                throw new Error('les coordonnées doivent être des nombres finis')
              }
              if (y > 90 || y < -90) {
                throw new Error(
                  'la latitude doit être comprise entre 90 et -90'
                )
              }

              if (x > 180 || x < -180) {
                throw new Error(
                  'la longitude doit être comprise entre 180 et -180'
                )
              }
            })
          )
        } catch (error) {
          // @ts-ignore
          hasFeatureError = new Error('champ geom incorrect : ' + error.message)
          hasFeatureErrorType = ImportLogType.INVALID_GEOM
          return null
        }

        let resPolygon

        try {
          resPolygon = polygon(coordinates, properties, { id })
        } catch (error) {
          // @ts-ignore
          hasFeatureError = new Error('champ geom incorrect : ' + error.message)
          hasFeatureErrorType = ImportLogType.INVALID_GEOM
          return null
        }

        for (const [, bbox] of Object.entries(RegionBounds)) {
          // @ts-ignore BBox and number[] error is confusing
          const regionGeometry = bboxPolygon(bbox)

          if (polygonInPolygon(resPolygon, regionGeometry)) {
            return resPolygon
          }
        }

        parcelleWarnings.push({
          numeroBio: String(record.numeroBio),
          message: `Parcelle ${id ?? ''} en dehors des régions autorisées`,
          code: ImportLogType.GEOM_OUT_OF_BOUNDS
        })
        return resPolygon
      })
    )

    if (hasFeatureError) {
      yield {
        numeroBio: String(record.numeroBio),
        error: hasFeatureError,
        errorType: hasFeatureErrorType,
        json: record
      }
      continue
    }

    yield {
      record: {
        numerobio: String(record.numeroBio),
        certification_state: CertificationState.CERTIFIED,
        oc_id: organismeCertificateur.id,
        oc_label: organismeCertificateur.nom,
        parcelles: featureCollection(features),
        audit_notes: record.commentaire,
        certification_date_debut: record.dateCertificationDebut,
        certification_date_fin: record.dateCertificationFin,
        audit_date: new Date(record.dateAudit).toISOString(),
        annee_reference_controle: record.anneeReferenceControle,
        metadata: {
          source: 'API Parcellaire',
          sourceLastUpdate: new Date().toISOString(),
          anneeAssolement: record.anneeAssolement
        }
      },
      numeroBio: String(record.numeroBio),
      warnings: parcelleWarnings,
      json: record
    }
  }
}

/**
 * Consomme intégralement le générateur parseAPIParcellaireStream et sépare
 * les enregistrements valides des erreurs. C'est la seule passe de validation :
 * les validItems retournés contiennent les records déjà parsés et prêts pour l'insert.
 *
 * @async
 * @param {NodeJS.ReadableStream} stream - Flux JSON contenant des enregistrements parcellaire.
 * @param {{ organismeCertificateur: OrganismeCertificateur }} options
 * @param {number} jobId - Id du job en cours
 * @returns {Promise<{ errors: ErrorItem[], validItems: ValidItem[] }>}
 * @throws {InvalidRequestApiError} - Si le JSON est invalide.
 */
async function collectFullValidationResults (stream, { organismeCertificateur }, jobId) {
  /** @type {ErrorItem[]} */
  const errors = []
  /** @type {ValidItem[]} */
  const validItems = []
  const items = []
  try {
    const jsonStream = stream.pipe(JSONStream.parse([true]))
    for await (const { record, numeroBio, error, errorType, warnings, json } of parseAPIParcellaireStream(jsonStream, { organismeCertificateur })) {
      if (error) {
        errors.push({ numeroBio, error, errorType })
      } else {
        validItems.push({ record, numeroBio, warnings: warnings ?? [] })
      }
      items.push(json)
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith('Invalid JSON') ||
        error.message.startsWith('Unexpected '))
    ) {
      throw new InvalidRequestApiError('Le fichier JSON est invalide.')
    }
    throw error
  }
  await addPayload(items, jobId)

  return { errors, validItems }
}

/**
 * Insère en base de données les enregistrements déjà validés.
 * Ne refait aucune validation métier : collecte uniquement les warnings post-insert
 * (corrections géométriques) et met à jour le job.
 *
 * @async
 * @param {ValidItem[]} validItems - Records déjà validés par collectFullValidationResults.
 * @param {ErrorItem[]} errors - Erreurs déjà collectées lors de la validation.
 * @param {number} jobId - Id du job en cours.
 * @returns {Promise<{
 *   count: number,
 *   errors: Array<{numeroBio:string, code: string, message: string}>,
 *   warning: Array<[string, ImportWarning[]]>,
 *   numeroBioValid: Array<{ numeroBio: string, nbParcelles: number }>,
 *   numeroBioError: Array<string>
 * }>}
 */
async function parcellaireValidItemsToDb (validItems, errors, jobId) {
  const count = validItems.length + errors.length
  /** @type {Array<{numeroBio:string, code: string, message: string}>} */
  const dbErrors = errors.map(({ numeroBio, error, errorType }) => { return { numeroBio: numeroBio, message: error.message, code: errorType } })
  /** @type {Array<[String, ImportWarning[]]>} */
  const warning = []
  /** @type {Array<String>} */
  const numeroBioError = errors.map(({ numeroBio }) => numeroBio)
  /** @type {Array<{numeroBio: String, nbParcelles: number}>} */
  const numeroBioValid = []

  const client = await pool.connect()
  await client.query('BEGIN;')

  try {
    for (const { record, numeroBio, warnings } of validItems) {
      if (warnings?.length > 0) {
        warning.push([numeroBio, warnings])
      }

      try {
        const { parcelles } = await createOrUpdateOperatorRecord(record, null, client)
        const parcellesCorrigees = parcelles
          .filter(f => f.statut_import_geom === 'CORRIGE')
          .map(f => f.id)
          .filter(Boolean)

        const parcellesNonCorrigees = parcelles
          .filter(f => f.statut_import_geom === 'ACCEPTENONCORRIGE')
          .map(f => f.id)
          .filter(Boolean)

        const correctionWarnings = []
        if (parcellesCorrigees.length > 0) {
          correctionWarnings.push({
            numeroBio,
            message: `Ces parcelles ont été corrigées : ${parcellesCorrigees.join(', ')}`,
            code: ImportLogType.GEOM_CORRECTED
          })
        }

        if (parcellesNonCorrigees.length > 0) {
          correctionWarnings.push({
            numeroBio,
            message: `Ces parcelles n'ont pas été corrigées mais sont invalides : ${parcellesNonCorrigees.join(', ')}`,
            code: ImportLogType.GEOM_INVALID_NOT_CORRECTED
          })
        }

        if (correctionWarnings.length > 0) {
          warning.push([numeroBio, correctionWarnings])
        }

        numeroBioValid.push({
          numeroBio: record.numerobio,
          nbParcelles: record.parcelles.features.length
        })
      } catch (e) {
        // @ts-ignore
        if (e.code === 'INVALID_API_REQUEST') {
          // @ts-ignore
          dbErrors.push({ numeroBio: record.numerobio, message: e.message, code: ImportLogType.DB_ERROR })
          numeroBioError.push(record.numerobio)
          continue
        }
        // noinspection ExceptionCaughtLocallyJS
        throw e
      }
    }
  } catch (error) {
    await client.query('ROLLBACK;')
    client.release()
    throw error
  }

  await client.query('COMMIT;')
  client.release()

  const importResult = await pool.query(
    `
    UPDATE parcellaire_import SET
    nb_objets_acceptes = $1,
    nb_objets_refuses = $2,
    nb_objets_recu = $3,
    result_job = $4,
    status = $5,
    ended_at = NOW()
    WHERE id = $6
    RETURNING id`,
    [
      numeroBioValid.length,
      numeroBioError.length,
      count,
      JSON.stringify({ count, errors: dbErrors, warning, numeroBioValid, numeroBioError }),
      'DONE',
      jobId
    ]
  )
  const importId = importResult.rows[0].id

  for (const { numeroBio, message, code } of dbErrors) {
    await pool.query(
      `INSERT INTO parcellaire_import_logs
       (import_id, numero_bio, type, code, message)
       VALUES ($1, $2, 'error', $3, $4)`,
      [importId, numeroBio, code, message]
    )
  }

  for (const [numeroBio, ws] of warning) {
    for (const w of ws) {
      await pool.query(
        `INSERT INTO parcellaire_import_logs
         (import_id, numero_bio, type, code, message)
         VALUES ($1, $2, 'warning', $3, $4)`,
        [importId, numeroBio, w.code, w.message]
      )
    }
  }

  return { count, errors: dbErrors, warning, numeroBioValid, numeroBioError }
}

/**
 * Crée un job d'import dans la table parcellaire_import pour tracer un import à exécuter.
 * Doit être appelé dès la réception du JSON, avant toute validation.
 *
 * @async
 * @param {number} organismeCertificateurId - Id de l'organisme certificateur.
 * @returns {Promise<number>} - ID du job créé.
 */
async function createImportJob (organismeCertificateurId) {
  return repository.createImportJob(organismeCertificateurId)
}

/**
 * Stocke le payload d'un job
 *
 * @async
 * @param {any} json - Paylaod a stocker.
 * @param {number} jobId - Id de l'organisme certificateur.
 */
async function addPayload (json, jobId) {
  await repository.insertPayload(jobId, json)
  return json
}

/**
 * Crée un log pour une erreur de l'API
 *
 * @async
 * @param {number} jobId - Id du job en question.
 * @param {ErrorItem} error - erreur a sauvegarder.
 */
async function addErrorJob (jobId, error) {
  await repository.insertImportLog(jobId, { numeroBio: error.numeroBio, type: 'error', code: error.errorType, message: error.error.message })
}

/**
 * Met à jour le résultat d’un job d’import dans la table `parcellaire_import`.
 *
 * @async
 * @function updateJobError
 * @param {Array<string|number>} numeroBioValid - Liste des identifiants `numeroBio` valides.
 * @param {Array<Object>} numeroBioError - Liste des objets en erreur (doivent contenir au moins `numeroBio`).
 * @param {number} count - Nombre total d’objets traités.
 * @param {Array<Object>|null} warning - Liste des avertissements éventuels.
 * @param {string|number} jobId - Identifiant du job à mettre à jour.
 *
 * @returns {Promise<string|number>} Retourne l’identifiant du job mis à jour.
 *
 */
async function updateJobError (numeroBioValid, numeroBioError, count, warning, jobId) {
  return repository.completeImportJob({
    accepted: numeroBioValid.length,
    rejected: numeroBioError.length,
    total: count,
    result: { count, errors: numeroBioError, warning, numeroBioValid, numeroBioError: numeroBioError.map(e => e.numeroBio) },
    jobId
  })
}

/**
 * Récupère l'état courant d'un job d'import.
 *
 * @async
 * @param {number} id - Identifiant du job.
 * @returns {Promise<{ status: string,nbObjetsRecus? : number, nbObjetsAcceptes?:number,nbObjetsRefuses?:number, result?: any, error?: string, ended?: Date, created?: Date }>} - Statut du job.
 */
async function getCurrentStatusJobs (id) {
  const job = await repository.findImportJob(id)

  if (!job) {
    return { status: 'error', error: "Aucun job n'a cet id" }
  }

  if (job.status === 'PENDING' || job.status === 'CREATED') {
    return { status: job.status, created: job.created_at }
  }

  if (job.status === 'DONE') {
    return {
      status: job.status,
      nbObjetsRecus: job.nb_objets_recu,
      nbObjetsAcceptes: job.nb_objets_acceptes,
      nbObjetsRefuses: job.nb_objets_refuses,
      result: job.result_job,
      ended: job.ended_at
    }
  }

  if (job.status === 'ERROR') {
    return {
      status: job.status,
      error: job.result_job,
      ended: job.ended_at
    }
  }
  return { status: 'error', error: `Statut inconnu : ${job.status}` }
}

/**
 * Met à jour le statut et le résultat d'un job d'import.
 *
 * @async
 * @param {number} jobId - Identifiant du job.
 * @param {'CREATE' | 'PENDING' | 'DONE' | 'ERROR'} status - Nouveau statut du job.
 * @param {any} [result] - Résultat ou détails associés au job.
 * @returns {Promise<void>}
 */
async function updateImportJobStatus (jobId, status, result) {
  await repository.updateImportJobStatus(jobId, status, result)
}

/**
 * Exécute la phase d'insert d'un job : reçoit les validItems déjà validés,
 * fait uniquement l'insert en base et collecte les warnings post-insert.
 * Appelé en fire-and-forget après la réponse au client.
 *
 * @async
 * @param {number} jobId - Identifiant du job.
 * @param {ValidItem[]} validItems - Records déjà validés par collectFullValidationResults.
 * @param {ErrorItem[]} errors - Erreurs déjà collectées lors de la validation.
 * @returns {Promise<void>}
 */
async function processFullJob (jobId, validItems, errors) {
  await updateImportJobStatus(jobId, 'PENDING')
  try {
    await parcellaireValidItemsToDb(validItems, errors, jobId)
  } catch (error) {
    console.error(error)
    // @ts-ignore
    await updateImportJobStatus(jobId, 'ERROR', { name: error.name, message: error.message })
  }
}

/**
 * Return operator data from agencebio api
 *
 * @param {string} numeroBio - The NumeroBio to be fetched.
 * @returns {Promise<AgenceBioNormalizedOperator>} - A promise that return operator data if it exists or null.
 */
async function fetchOperator (numeroBio) {
  try {
    return await fetchOperatorByNumeroBio(numeroBio)
  } catch (error) {
    console.error(error)
    return null
  }
}

/**
 * @param {{ status?: string, organismeCertificateur?: string, from?: string, to?: string, payload?: string, withRejected?: string, logs?: 'error' | 'warning' | 'all' | 'none' | null, page: string , limit: string }} params
 * @returns {Promise<{ data: object[], meta: { total: number, page: number, limit: number } }>}
 */
async function getImportList ({ status, organismeCertificateur, from, to, payload, withRejected, page, limit }) {
  const conditions = []
  const params = []
  let idx = 1

  if (status) {
    const statusList = status.split(',').map(s => s.trim().toUpperCase())
    conditions.push(`pi.status = ANY($${idx}::text[])`)
    params.push(statusList)
    idx++
  }

  if (from) {
    conditions.push(`pi.created_at >= $${idx}`)
    params.push(new Date(from))
    idx++
  }

  if (organismeCertificateur) {
    conditions.push(`pi.organisme_certificateur = $${idx}`)
    params.push(parseInt(organismeCertificateur))
    idx++
  }

  if (to) {
    conditions.push(`pi.created_at <= $${idx}`)
    const toDate = new Date(to)
    toDate.setHours(23, 59, 59, 999)
    params.push(toDate)
    idx++
  }

  if (withRejected === 'true') {
    conditions.push('pi.nb_objets_refuses >= 1')
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const payloadSelect = payload === 'true'
    ? ', json_build_object(\'id\', pip.id, \'payload\', pip.payload) AS payload'
    : ', NULL AS payload'
  const payloadJoin = payload === 'true'
    ? 'LEFT JOIN parcellaire_import_payload pip ON pip.import_id = pi.id'
    : ''
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const [rows, countResult] = await Promise.all([
    pool.query(`
      SELECT
        pi.id as jobId,
        pi.status,
        pi.created_at,
        pi.ended_at,
        pi.nb_objets_recu,
        pi.nb_objets_acceptes,
        pi.nb_objets_refuses,
        pi.result_job
        ${payloadSelect}
      FROM parcellaire_import pi
      ${payloadJoin}
      ${whereClause}
      ORDER BY pi.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `, [...params, parseInt(limit), offset]),
    pool.query(`
      SELECT COUNT(*) AS total
      FROM parcellaire_import pi
      ${whereClause}
    `, params)
  ])

  return {
    data: rows.rows.map(normalizeJobReturn),
    meta: {
      total: parseInt(countResult.rows[0].total),
      page: parseInt(page),
      limit: parseInt(limit)
    }
  }
}

/**
 * @param {{ id: string | number, payload?: string, logs?: 'error' | 'warning' | 'all' | 'none' | null }} params
 * @returns {Promise<object | null>}
 */
async function getImportById ({ id, payload }) {
  const payloadSelect = payload === 'true'
    ? ', json_build_object(\'id\', pip.id, \'payload\', pip.payload) AS payload'
    : ', NULL AS payload'
  const payloadJoin = payload === 'true'
    ? 'LEFT JOIN parcellaire_import_payload pip ON pip.import_id = pi.id'
    : ''

  const { rows } = await pool.query(`
    SELECT
      pi.id,
      pi.status,
      pi.created_at,
      pi.started_at,
      pi.ended_at,
      pi.nb_objets_recu,
      pi.nb_objets_acceptes,
      pi.nb_objets_refuses,
      pi.result_job
      ${payloadSelect}
    FROM parcellaire_import pi
    ${payloadJoin}
    WHERE pi.id = $1
  `, [id])

  return normalizeJobReturn(rows[0]) ?? null
}

// Décommenter si les utilisateurs en font la demande
// /**
//  * @param {{ id: string | number, type: string }} params
//  * @returns {Promise<object[]>}
//  */
// async function getImportLogs ({ id, type }) {
//   const conditions = ['import_id = $1']
//   const params = [id]
//   let idx = 2

//   if (type !== 'all') {
//     conditions.push(`type = $${idx}`)
//     params.push(type)
//     idx++
//   }

//   const { rows } = await pool.query(`
//     SELECT id, type, code, message, numero_bio
//     FROM parcellaire_import_logs
//     WHERE ${conditions.join(' AND ')}
//     ORDER BY id ASC
//   `, params)

//   return rows
// }

function normalizeJobReturn (row) {
  return {
    jobId: row.jobid,
    status: row.status,
    createdAt: row.created_at,
    endedAt: row.ended_at,
    nbObjetsRecus: row.nb_objets_recu,
    nbObjetsAcceptes: row.nb_objets_acceptes,
    nbObjetsRefuses: row.nb_objets_refuses,
    result: row.result_job,
    payload: row.payload
  }
}

return {
  ImportLogType,
  parseAPIParcellaireStream,
  collectFullValidationResults,
  parcellaireValidItemsToDb,
  updateImportJobStatus,
  createImportJob,
  processFullJob,
  getCurrentStatusJobs,
  fetchOperator,
  getImportList,
  getImportById,
  addErrorJob,
  updateJobError
  // getImportLogs
}
})()
const cartobio = require('../../../src/shared/cartobio.service.js')
const { parseAnyGeographicalArchive } = require('../../../src/shared/geo/gdal.js')
const { parseTelepacArchive } = telepac
const { recordToApi } = require('../../../src/shared/outputs/api.js')

const { feature: importFeature, featureCollection: importFeatureCollection } = require('@turf/helpers')
const { toWgs84: importToWgs84 } = require('reproject')
const { extend: extendHttp, HTTPError: ImportHTTPError } = require('got')
const { XMLParser: ImportXMLParser } = require('fast-xml-parser')
const { SocksProxyAgent: ImportSocksProxyAgent } = require('socks-proxy-agent')
const importRepository = require('./imports.repository.js')
const importPool = importRepository
const importConfig = require('../../../src/config/env.js')
const { EtatProduction: ImportEtatProduction } = require('../../../src/shared/enums.js')
const { randomUUID: importRandomUUID } = require('node:crypto')
const { fromCodePacStrict: importFromCodePacStrict } = require('@agencebio/rosetta-cultures')
const { fromCepageCode: importFromCepageCode } = require('@agencebio/rosetta-cultures/cepages')
const { BadGatewayApiError: ImportBadGatewayApiError } = require('../../../src/shared/errors.js')
const { getRandomFeatureId: getImportFeatureId } = require('../../../src/shared/outputs/features.js')

const evvClient = extendHttp({
  http2: false,
  https: { rejectUnauthorized: false },
  timeout: { lookup: 200, connect: 500 },
  ...(importConfig.get('douanes.socksProxy') ? {
    agent: {
      http: new ImportSocksProxyAgent(importConfig.get('douanes.socksProxy')),
      https: new ImportSocksProxyAgent(importConfig.get('douanes.socksProxy'))
    }
  } : {}),
  prefixUrl: importConfig.get('douanes.baseUrl')
})

async function pacageLookup ({ numeroPacage }) {
  const rows = await importRepository.findPacageParcelles(numeroPacage)

  return importToWgs84({
    type: 'FeatureCollection',
    features: rows.map(({ geometry, fid: id, NUMERO_I, NUMERO_P, TYPE, BIO, CODE_VAR }) => ({
      type: 'Feature', id, remoteId: id, geometry,
      properties: {
        id, BIO,
        cultures: [{ id: importRandomUUID(), CPF: importFromCodePacStrict(TYPE, CODE_VAR)?.code_cpf, TYPE }],
        NUMERO_I, NUMERO_P, PACAGE: numeroPacage,
        conversion_niveau: BIO === 1 ? ImportEtatProduction.BIO : ImportEtatProduction.NB
      }
    }))
  }, 'EPSG:3857')
}

async function evvLookup ({ numeroEvv }) {
  try {
    const response = await evvClient.get(`evv/${numeroEvv}`).text()
    const { numero, siret, libelle } = new ImportXMLParser({ parseTagValue: false }).parse(response).evv
    return { numero, siret, libelle }
  } catch (error) {
    if (error instanceof ImportHTTPError && (error?.response?.statusCode === 404 || !Object.hasOwn(error, 'code'))) {
      return { siret: undefined, numero: numeroEvv, libelle: '' }
    }
    throw new ImportBadGatewayApiError("Impossible de communiquer avec l'API CVI.", { cause: error })
  }
}

async function evvParcellaire ({ numeroEvv }) {
  const response = await evvClient.get(`parcellaire/${numeroEvv}`).text()
  const xml = new ImportXMLParser({
    parseTagValue: false,
    isArray: (name, jpath, isLeafNode, isAttribute) => ['pcv', 'spcv'].includes(name) && !isAttribute && !isLeafNode
  }).parse(response)
  if (!Array.isArray(xml.parcellaire.listePcv.pcv)) return importFeatureCollection([])

  return importFeatureCollection(xml.parcellaire.listePcv.pcv.map(p => {
    const id = getImportFeatureId()
    return importFeature(null, {
      id,
      cadastre: [`${p.codeDepartement}${p.codeInseeCommune}${p.prefixe || '000'}${p.section.padStart('2', 0)}${p.plan.padStart(4, '0')}`],
      cultures: (Array.isArray(p.listeSpcv.spcv) ? p.listeSpcv.spcv : [])
        .filter(({ etatGestion }) => etatGestion === 'PL')
        .map(sp => ({
          CPF: importFromCepageCode(sp.codeCepage)?.code_cpf ?? '01.21.1',
          variete: importFromCepageCode(sp.codeCepage)?.libelle,
          surface: parseFloat(sp.superficieSPCV ?? '0')
        }))
    }, { id })
  }))
}
const { NotFoundApiError: ImportNotFoundApiError } = require('../../../src/shared/errors.js')
const { normalizeRecord: normalizeImportRecord } = require('../../../src/shared/outputs/record.js')
const importRecordFields = 'cartobio_operators.record_id, numerobio, version_name, annee_reference_controle, certification_date_debut, certification_date_fin, certification_state, created_at, updated_at, oc_id, metadata, audit_date, audit_history, audit_notes, audit_demandes, mixite'

async function getOperatorLastRecord (numeroBio, { anneeAudit = null, statut = null } = {}) {
  const record = await importRepository.findLastOperatorRecord(numeroBio, { anneeAudit, statut })

  if (!record) {
    throw new ImportNotFoundApiError('Aucun parcellaire trouvé')
  }

  // @ts-ignore
  return normalizeImportRecord(await cartobio.joinRecordParcelles(record))
}

/**
 * @param {number} ocId - Identifiant de l'organisme certificateur
 * @param {Object} [options]
 * @param {number|null} [options.anneeAudit=null] - Filtre par année d'audit
 * @param {string|null} [options.statut=null] - Filtre par statut de certification
 * @param {string|null} [options.anneeReferenceControle=null] - Filtre par anneeReferenceControle
 * @param {number|null} [options.limit=null] - Numéro de page (1-based)
 * @param {number|null} [options.start=null] - Taille de page
 * @return {Promise<NormalizedRecord[]>}
 */
async function iterateOperatorLastRecords (
  ocId,
  { anneeAudit = null, statut = null, anneeReferenceControle = null, limit = null, start = null } = {}
) {
  const conditions = []
  /** @type {(string|number)[]} */
  const values = [ocId]
  let paramIndex = 2

  if (anneeAudit) {
    conditions.push(`EXTRACT('year' FROM audit_date) = $${paramIndex}`)
    values.push(anneeAudit)
    paramIndex++
  }

  if (statut) {
    conditions.push(`certification_state = $${paramIndex}`)
    values.push(statut)
    paramIndex++
  }

  if (anneeReferenceControle) {
    conditions.push(`annee_reference_controle = $${paramIndex}`)
    values.push(anneeReferenceControle)
    paramIndex++
  }

  let paginationClause = ''
  if (limit !== null) {
    paginationClause = `LIMIT $${paramIndex}`
    values.push(limit)
    paramIndex++
  }
  if (start !== null) {
    paginationClause += ` OFFSET $${paramIndex}`
    values.push(start)
    paramIndex++
  }

  const sql = `
  SELECT DISTINCT ON (numerobio) ${importRecordFields}
  FROM cartobio_operators
  WHERE oc_id = $1 AND deleted_at IS NULL
  ${conditions.length ? `AND ${conditions.join(' AND ')}` : ''}
  ORDER BY numerobio ASC, updated_at DESC
  ${paginationClause}
`

  const { rows } = await importPool.query(sql, values)

  return Promise.all(rows.map(async row => normalizeImportRecord(await cartobio.joinRecordParcelles(row))))
}

/**
 * @param {String} recordId
 * @param {CartoBioUser|null} user
 *
 * @return {Promise<NormalizedRecord|null>}
 */

module.exports = {
  parseAPIParcellaireStream: api.parseAPIParcellaireStream,
  updateImportJobStatus: api.updateImportJobStatus,
  parcellaireValidItemsToDb: api.parcellaireValidItemsToDb,
  ImportLogType: api.ImportLogType,
  parseAnyGeographicalArchive,
  parseTelepacArchive,
  parseGeofoliaArchive: geofolia.parseGeofoliaArchive,
  geofoliaLookup: geofolia.geofoliaLookup,
  geofoliaParcellaire: geofolia.geofoliaParcellaire,
  pacageLookup,
  evvLookup,
  evvParcellaire,
  iterateOperatorLastRecords,
  getOperatorLastRecord,
  collectFullValidationResults: api.collectFullValidationResults,
  createImportJob: api.createImportJob,
  processFullJob: api.processFullJob,
  getCurrentStatusJobs: api.getCurrentStatusJobs,
  getImportList: api.getImportList,
  getImportById: api.getImportById,
  getImportLogs: api.getImportLogs,
  getImportPayload: api.getImportPayload,
  addErrorJob: api.addErrorJob,
  updateJobError: api.updateJobError,
  recordToApi,
  ...(process.env.NODE_ENV === 'test' ? { evvClient } : {})
}
