const AdmZip = require('adm-zip')
const memo = require('p-memoize')
// @ts-ignore
const { get, post } = require('got')
const config = require('../config.js')
const { parse } = require('wkt')
const { featureCollection, feature: Feature } = require('@turf/helpers')
const { toWgs84 } = require('reproject')
const { getRandomFeatureId } = require('../outputs/features.js')
const { fromCodeGeofolia } = require('@agencebio/rosetta-cultures')

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
    ...(Field.Area ? { surface: Field.Area / IN_HECTARES } : {}),
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
    if (error.response?.statusCode === 404) {
      return false
    } else {
      throw error
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

module.exports = {
  geofoliaLookup,
  geofoliaParcellaire,
  parseGeofoliaArchive
}
