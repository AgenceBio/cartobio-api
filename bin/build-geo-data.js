'use strict'

const { createWriteStream } = require('fs')
const { promisify } = require('node:util')
const { createGunzip } = require('node:zlib')
const stream = require('node:stream')
const { join } = require('path')
const got = require('got')
const JSONStream = require('jsonstream-next')
const fs = require('fs')
const union = require('@turf/union').default

const pipeline = promisify(stream.pipeline)

async function fetchCommunesBoundaries () {
  // Skip if file already exists
  const outFile = join(__dirname, '..', 'data', 'communes.json')
  if (fs.existsSync(outFile)) {
    console.log('Commune boundaries file already exists, skipping')
    return
  }

  const FILENAME = 'communes-50m.geojson.gz'
  const SOURCE = 'http://etalab-datasets.geo.data.gouv.fr/contours-administratifs/latest/geojson/' + FILENAME

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
  // Skip if file already exists
  const files = ['metropole', 'antilles', 'guyane', 'reunion', 'mayotte']
  if (files.every(name => fs.existsSync(join(__dirname, '..', 'data', `${name}.json`)))) {
    console.log('Region boundaries files already exist, skipping')
    return
  }

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

  const outputs = { metropole, antilles, guyane, reunion, mayotte }
  // Dump each file
  for (const output in outputs) {
    console.log(`Writing ${output}.json`, outputs[output]?.type)
    const outputFile = join(__dirname, '..', 'data', `${output}.json`)
    await pipeline([
      stream.Readable.from(JSON.stringify(outputs[output])),
      createWriteStream(outputFile)
    ])
  }
}

async function fetchDepartementBoundaries () {
  // Skip if file already exists
  const outFile = join(__dirname, '..', 'data', 'departements.json')
  if (fs.existsSync(outFile)) {
    console.log('Departement boundaries file already exists, skipping')
    return
  }

  const FILENAME = 'departements-50m.geojson.gz'
  const SOURCE = 'https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/latest/geojson/' + FILENAME

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

async function fetchAtOnceRegionsBoundaries () {
  // Skip if file already exists
  const outFile = join(__dirname, '..', 'data', 'regions.json')
  if (fs.existsSync(outFile)) {
    console.log('Departement boundaries file already exists, skipping')
    return
  }

  const FILENAME = 'regions-50m.geojson.gz'
  const SOURCE = 'https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/latest/geojson/' + FILENAME

  const goodCodes = ['11', '24', '27', '28', '32', '44', '52', '53', '75', '76', '84', '93', '94', '01', '02', '03', '04', '06']

  return pipeline([
    got.stream(SOURCE),
    createGunzip(),
    JSONStream.parse(['features', true]),
    (source) => stream.Readable.from(source).filter(feature => goodCodes.includes(feature.properties.code)).map(feature => ({
      code: feature.properties.code,
      nom: feature.properties.nom,
      geometry: feature.geometry
    })),
    JSONStream.stringify('[\n', ',\n', '\n]'),
    createWriteStream(outFile)
  ])
}

(async function () {
  await fetchCommunesBoundaries()
  await fetchRegionsBoundaries()
  await fetchDepartementBoundaries()
  await fetchAtOnceRegionsBoundaries()
})()
