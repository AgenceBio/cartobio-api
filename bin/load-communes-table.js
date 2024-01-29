'use strict'

const { promisify } = require('node:util')
const stream = require('node:stream')
const JSONStream = require('jsonstream-next')

const db = require('../lib/db.js')
const fs = require('fs')
const { join } = require('path')
const pipeline = promisify(stream.pipeline)

async function loadCommuneTable () {
  // Load commune boundaries from communes.json
  const inputFile = fs.createReadStream(join(__dirname, '..', 'data', 'communes.json'))

  return pipeline([
    inputFile,
    JSONStream.parse('*'),
    (source) => stream.Readable.from(source).forEach(commune => {
      // Save to commune table
      const { code, nom, geometry } = commune

      db.query(`
        INSERT INTO communes (code, nom, geometry)
        VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))
        ON CONFLICT (code) DO UPDATE SET
          nom = $2,
          geometry = ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)
        `
      , [code, nom, JSON.stringify(geometry)]
      )
    })
  ])
}

loadCommuneTable()
