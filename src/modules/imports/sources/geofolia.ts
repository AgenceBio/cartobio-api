import AdmZip from 'adm-zip'
import memo from 'p-memoize'
import gotModule from 'got'
import { parse } from 'wkt'
import { featureCollection, feature as Feature } from '@turf/helpers'
import reproject from 'reproject'
import { fromCodeGeofolia } from '@agencebio/rosetta-cultures'
import config from '../../../config/env.js'
import { getRandomFeatureId } from '../../../shared/outputs/features.js'
import { BadGatewayApiError, InvalidRequestApiError, getResponseStatusCode } from '../../../shared/errors.js'

const { get, post } = gotModule.default
const { toWgs84 } = reproject

interface GeofoliaField {
  Id: string
  Name?: string
  Area?: number
  Geography?: string | null
  MainPlotId?: string
  SowingDate?: string | null
  CityNumber?: string
  IsletNum?: string
  PlotKind: number
  Comment?: string | null
  RNCropCode: string
  VarietyName?: string | null
  Code?: string
}

const IN_HECTARES = 10000
const ONE_HOUR = 60 * 60 * 1000

/**
 * Strips a leading byte that breaks `JSON.parse()`, to name the least.
 *
 * @see https://github.com/sindresorhus/strip-bom/blob/main/index.js
 * @see https://en.wikipedia.org/wiki/Byte_order_mark
 */
const stripBOM = (string: string): string => string.charCodeAt(0) === 0xFEFF ? string.slice(1) : string

const excludeFieldsWithoutMainGeometry = ({ Geography, PlotKind }: GeofoliaField) => !(!Geography && PlotKind === PLOT_KIND_PRIMARY)

const PLOT_KIND_PRIMARY = 1
const PLOT_KIND_SECONDARY = 2

function cultureFromField (Field: GeofoliaField) {
  return {
    CPF: fromCodeGeofolia(Field.RNCropCode)?.code_cpf,
    GF: Field.RNCropCode,
    ...(Field.SowingDate ? { date_semis: Field.SowingDate.split('T').at(0) } : {}),
    ...(Field.VarietyName ? { variete: Field.VarietyName } : {}),
    ...(Field.Area ? { surface: Math.round((Field.Area / IN_HECTARES) * 100) / 100 } : {}),
    id: Field.Id
  }
}

function convertGeofoliaFieldsToGeoJSON (data: { Fields: GeofoliaField[] }) {
  const fields = data.Fields.filter(excludeFieldsWithoutMainGeometry)
  const mainFields = fields.filter((field): field is GeofoliaField & { Geography: string } => Boolean(field.Geography) && field.PlotKind === PLOT_KIND_PRIMARY)
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
 * @returns A JWT Auth Token
 */
function fetchAuthToken (): Promise<string> {
  return post(`${config.get('geofolia.oauth.tenant')}/oauth2/v2.0/token`, {
    prefixUrl: config.get('geofolia.oauth.host'),
    form: {
      client_id: config.get('geofolia.oauth.clientId'),
      client_secret: config.get('geofolia.oauth.clientSecret'),
      grant_type: 'client_credentials',
      scope: config.get('geofolia.api.scope')
    }
  })
    .json<{ access_token: string }>()
    .then(({ access_token: accessToken }) => accessToken)
}

/**
 * Authenticate a user based on environment variables
 * It is a good idea to memoize it for a few hours to save on API calls
 *
 * @returns A JWT Auth Token
 */
const auth = memo(() => fetchAuthToken(), { maxAge: 0.90 * ONE_HOUR })

async function geofoliaTriggerDataOrder (numeroSiret: string, year: number) {
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

async function geofoliaRequestDataOrder (numeroSiret: string) {
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
  }).json<Array<{ id: string; identificationCodes: string[] }>>()

  return orders.find(({ identificationCodes }) => identificationCodes.includes(numeroSiret))
}

async function geofoliaLookup (numeroSiret: string, year: number) {
  try {
    await geofoliaTriggerDataOrder(numeroSiret, year)
    return true
  } catch (error) {
    if (getResponseStatusCode(error) === 404) {
      return false
    } else {
      throw new BadGatewayApiError('Impossible de communiquer avec l\'API Geofolia.', { cause: error })
    }
  }
}

async function geofoliaFetchDataOrder (order: { id: string }) {
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

async function geofoliaParcellaire (numeroSiret: string) {
  const order = await geofoliaRequestDataOrder(numeroSiret)

  if (!order) {
    return null
  }

  const archive = await geofoliaFetchDataOrder(order)

  return parseGeofoliaArchive(archive)
}

async function parseGeofoliaArchive (buffer: Buffer) {
  const zip = new AdmZip(buffer)
  const FieldFileEntry = await zip.getEntry('Field.Json')

  const lambert93 = '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'

  if (!FieldFileEntry) throw new InvalidRequestApiError('L\'archive Geofolia ne contient pas de fichier Field.Json.')

  const parsedJSON = JSON.parse(stripBOM(FieldFileEntry.getData().toString('utf8')))
  const geojson = convertGeofoliaFieldsToGeoJSON(parsedJSON)

  return toWgs84(geojson, lambert93)
}

export { geofoliaLookup, geofoliaParcellaire, parseGeofoliaArchive }
