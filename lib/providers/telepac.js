const geo = require('verrazzano')
const getStream = require('get-stream')
const { toWgs84 } = require('reproject')
const { Readable } = require('stream')
const { randomInt } = require('crypto')
const { obj } = require('through2')

async function parseShapefileArchive (file) {
  const data = await file
  const buffer = await data.toBuffer()
  const lambert93 = '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'

  const geojson = await getStream(Readable.from(buffer)
    .pipe(geo.from('shp'))
    .pipe(obj((feature, _, next) => {
      const id = randomInt(1, Math.pow(2, 48))
      feature.id = id
      feature.properties.id = id
      next(null, feature)
    }))
    .pipe(geo.to('geojson')))

  return toWgs84(JSON.parse(geojson), lambert93)
}

module.exports = {
  parseShapefileArchive
}
