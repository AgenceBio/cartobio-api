const geo = require('verrazzano')
const getStream = require('get-stream')
const { toWgs84 } = require('reproject')
const { Readable } = require('stream')
const { getRandomFeatureId } = require('../outputs/features.js')
const { obj } = require('through2')
const { randomUUID } = require('crypto')
const { EtatProduction } = require('../outputs/record.js')
const { fromCodePacStrict } = require('@agencebio/rosetta-cultures')
const intersect = require('@turf/intersect').default

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

async function parseShapefileArchive (file) {
  const data = await file
  const buffer = await data.toBuffer()

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

  const geojson = await getStream(Readable.from(buffer)
    .pipe(geo.from('shp'))
    .pipe(obj((feature, _, next) => {
      const id = getRandomFeatureId()
      feature.id = id

      const { AGRIBIO, CAMPAGNE, COMMUNE, NUMERO_I, NUMERO_P, PACAGE, TYPE } = feature.properties

      feature.properties = {
        id: id,
        BIO: AGRIBIO,
        CAMPAGNE,
        COMMUNE,
        cultures: [
          {
            id: randomUUID(),
            CPF: fromCodePacStrict(TYPE/*, CODE_VAR */)?.code_cpf,
            TYPE
          }
        ],
        conversion_niveau: AGRIBIO === 1 ? 'AB?' : EtatProduction.NB,
        NUMERO_I,
        NUMERO_P,
        PACAGE
      }

      next(null, feature)
    }))
    .pipe(geo.to('geojson')))

  // We try to convert with each projection until we find one that intersects the output with the region
  return Object.entries(regions).map(([region, regionGeojson]) => {
    const projection = projections[region]
    const output = toWgs84(JSON.parse(geojson), projection)

    if (output.features.some(feature => intersect(feature, regionGeojson))) {
      return output
    }

    return null
  }).find(a => a)
}

module.exports = {
  parseShapefileArchive
}
