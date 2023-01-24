'use strict'

const { createWriteStream } = require('fs')
const { promisify } = require('node:util')
const { createGunzip } = require('node:zlib')
const stream = require('node:stream')
const { join } = require('path')
const got = require('got')
const { default: centroid } = require('@turf/centroid')
const JSONStream = require('jsonstream-next')

const outFile = join(__dirname, '..', 'data', 'communes-with-centroids.json')
const pipeline = promisify(stream.pipeline)

async function fetchCommunesBoundaries () {
  const FILENAME = 'communes-50m.geojson.gz'
  const SOURCE = 'http://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2022/geojson/' + FILENAME

  return pipeline([
    got.stream(SOURCE),
    createGunzip(),
    JSONStream.parse(['features', true]),
    (source) => stream.Readable.from(source).map(feature => ({
      code: feature.properties.code,
      nom: feature.properties.nom,
      centroid: centroid(feature).geometry.coordinates,
      geometry: feature.geometry
    })),
    JSONStream.stringify('[\n', ',\n', '\n]'),
    createWriteStream(outFile)
  ])
}

fetchCommunesBoundaries()
