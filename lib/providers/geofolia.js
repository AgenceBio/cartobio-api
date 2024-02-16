const AdmZip = require('adm-zip')
const { parse } = require('wkt')
const { featureCollection, feature: Feature } = require('@turf/helpers')
const { toWgs84 } = require('reproject')
const { getRandomFeatureId } = require('../outputs/features.js')
const { fromCodeGeofolia } = require('@agencebio/rosetta-cultures')

const IN_HECTARES = 10000

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

    return Feature(
      parse(Field.Geography),
      {
        id,
        remoteId: Field.Id,
        COMMUNE: Field.CityNumber,
        NOM: Field.Name,
        cultures: [
          cultureFromField(Field),
          ...(secondaryCultures
            .filter(({ MainPlotId }) => MainPlotId === Field.Id)
            .map(cultureFromField)
          )
        ].filter(d => d),
        NUMERO_I: Field.IsletNum,
        NUMERO_P: Field.Code,
        conversion_niveau: '',
        commentaires: Field.Comment || ''
      },
      { id }
    )
  }))
}

async function parseGeofoliaArchive (file) {
  const FieldFileEntry = await file
    .then(data => data.toBuffer())
    .then(buffer => new AdmZip(buffer))
    .then(zip => zip.getEntry('Field.Json'))

  const lambert93 = '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'

  const parsedJSON = JSON.parse(stripBOM(FieldFileEntry.getData().toString('utf8')))
  const geojson = convertGeofoliaFieldsToGeoJSON(parsedJSON)

  return toWgs84(geojson, lambert93)
}

module.exports = {
  parseGeofoliaArchive
}
