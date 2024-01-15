'use strict'

const { createWriteStream } = require('fs')
const { promisify } = require('node:util')
const { createGunzip } = require('node:zlib')
const stream = require('node:stream')
const { join } = require('path')
const got = require('got')
const JSONStream = require('jsonstream-next')
const union = require('@turf/union').default

const pipeline = promisify(stream.pipeline)

async function fetchCommunesBoundaries () {
  const FILENAME = 'communes-50m.geojson.gz'
  const SOURCE = 'http://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2022/geojson/' + FILENAME

  const outFile = join(__dirname, '..', 'data', 'communes.json')

  return pipeline([
    got.stream(SOURCE),
    createGunzip(),
    JSONStream.parse(['features', true]),
    (source) => stream.Readable.from(source).map(feature => ({
      code: feature.properties.code,
      nom: feature.properties.nom,
      geometry: feature.geometry
    })),
    JSONStream.stringify('[\n', ',\n', '\n]'),
    createWriteStream(outFile)
  ])
}

async function fetchRegionsBoundaries () {
  const FILENAME = 'regions-100m.geojson'
  const SOURCE = 'http://etalab-datasets.geo.data.gouv.fr/contours-administratifs/latest/geojson/' + FILENAME

  // Get content
  const response = await got(SOURCE)
  const content = response.body

  // Parse content
  const regions = JSON.parse(content)

  // Get metropole
  const metropoleCodes = ['11', '24', '27', '28', '32', '44', '52', '53', '75', '76', '84', '93', '94']
  const metropoleRegions = regions.features.filter(({ properties }) => metropoleCodes.includes(properties.code))
  const metropole = metropoleRegions.reduce((acc, region) => union(acc, region))

  // Get Antilles
  const guadeloupe = regions.features.find(({ properties }) => properties.code === '01')
  const martinique = regions.features.find(({ properties }) => properties.code === '02')
  const antilles = union(guadeloupe, martinique)

  // Get other droms
  const guyane = regions.features.find(({ properties }) => properties.code === '03')
  const reunion = regions.features.find(({ properties }) => properties.code === '04')
  const mayotte = regions.features.find(({ properties }) => properties.code === '06')

  // Dump each file
  const outputs = { metropole, antilles, guyane, reunion, mayotte }
  for (const output in outputs) {
    console.log(`Writing ${output}.json`, outputs[output]?.type)
    const outputFile = join(__dirname, '..', 'data', `${output}.json`)
    await pipeline([
      stream.Readable.from(JSON.stringify(outputs[output])),
      createWriteStream(outputFile)
    ])
  }
}

(async function () {
  await fetchCommunesBoundaries()
  await fetchRegionsBoundaries()
})()
