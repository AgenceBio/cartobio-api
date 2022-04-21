const { get, post } = require('got')
const { toWgs84 } = require('reproject')
const FormData = require('form-data')
const { featureCollection, feature } = require('@turf/helpers')

const lambert93 = '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'
const CAS_SERVER = 'https://cas.mesparcelles.fr/cas/oauth2.0/accessToken?grant_type=password&client_id=sigaweb'

const getBaseUrl = (server) => `https://${server}.mesparcelles.fr/api`

async function getDangerousPasswordToken ({ email, password }) {
  const body = new FormData()
  body.append('username', email)
  body.append('password', password)

  const { access_token: token } = await post(CAS_SERVER, { body }).json()

  return token
}

async function getExploitationDetails ({ httpOptions }) {
  const { exploitations } = await get('exploitations', httpOptions).json()

  return exploitations[0].exploitation
}

async function getExploitationParcelles ({ httpOptions, exploitation }) {
  const { parcelles } = await get('parcelles', {
    ...httpOptions,
    searchParams: {
      idexploitation: exploitation.identification.identifiant,
      millesime: new Date().getUTCFullYear()
    }
  }).json()

  return parcelles.map(({ parcelle }) => parcelle)
}

async function getComplementPac ({ httpOptions, parcelle }) {
  const { complementpac } = await get(`complementpac/${parcelle.identifiant}`, {
    ...httpOptions,
    searchParams: {
      numculture: 1
    }
  }).json()
  return complementpac
}

async function getIlot ({ httpOptions, parcelle }) {
  const { ilot } = await get(`ilots/${parcelle.idilot}`, httpOptions).json()

  return ilot
}

async function getGeomIlot ({ httpOptions, parcelle }) {
  const { geom_ilot } = await get(`geom/ilot/${parcelle.idilot}`, httpOptions).json()
  const { geom_parcelle } = geom_ilot.parcelles.find(p => p.geom_parcelle.identifiant === parcelle.identifiant)

  return geom_parcelle.geom
}

async function turnParcelleIntoFeature ({ httpOptions, exploitation, parcelle }) {
  const [complementpac, geom, ilot] = await Promise.all([
    getComplementPac({ httpOptions, parcelle }),
    getGeomIlot({ httpOptions, parcelle }),
    getIlot({ httpOptions, parcelle })
  ])

  return feature(geom, {
    id: parcelle.identifiant,
    remoteId: parcelle.cleparcelleculturaleuuid,
    PACAGE: exploitation.identification.pacage,
    COMMUNE: ilot.refNormeCommune,
    TYPE: complementpac.codeculturepaceffectif,
    BIO: parcelle.cultureenbio ? 1 : 0,
    SURF: parcelle.surfacemesuree,
    NOM: parcelle.nom,
    NUMERO_I: ilot.numero,
    NUMERO_P: parcelle.numero,
    MILLESIME: parcelle.millesime
  }, { id: parcelle.id })
}

async function getMesParcellesOperator ({ email, password, server }) {
  const token = await getDangerousPasswordToken({ email, password })
  const prefixUrl = getBaseUrl(server)

  const httpOptions = {
    prefixUrl,
    headers: {
      authorization: `Bearer ${token}`
    }
  }

  const exploitation = await getExploitationDetails({ httpOptions })
  const parcelles = await getExploitationParcelles({ httpOptions, exploitation })

  const features = await Promise.all(parcelles.map(parcelle => turnParcelleIntoFeature({ httpOptions, exploitation, parcelle })))
  const geojson = featureCollection(features)

  return toWgs84(geojson, lambert93)
}

module.exports = {
  getMesParcellesOperator
}
