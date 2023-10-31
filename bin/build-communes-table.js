'use strict'

const { promisify } = require('node:util')
const { createGunzip } = require('node:zlib')
const stream = require('node:stream')
const got = require('got')
const JSONStream = require('jsonstream-next')

const db = require('../lib/db.js')
const pipeline = promisify(stream.pipeline)

async function fetchCommunesBoundaries () {
  const FILENAME = 'communes-50m.geojson.gz'
  const SOURCE = 'http://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2022/geojson/' + FILENAME

  return pipeline([
    got.stream(SOURCE),
    createGunzip(),
    JSONStream.parse(['features', true]),
    (source) => stream.Readable.from(source).forEach(feature => {
      // Save to commune table
      const { code, nom } = feature.properties
      const geometry = feature.geometry

      db.query(`
        INSERT INTO communes (code, nom, geometry)
        VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))`
      , [code, nom, JSON.stringify(geometry)]
      )
    })
  ])
}

fetchCommunesBoundaries()
