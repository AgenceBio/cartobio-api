'use strict'

const { writeFile } = require('fs').promises
const { join } = require('path')
const { get } = require('got')
const { default: centroid } = require('@turf/centroid')

const outFile = join(__dirname, '..', 'data', 'departements-cendroids.json')

async function fetchDepartementsBoundaries () {
  const FILENAME = 'departements-avec-outre-mer.geojson'
  const SOURCE = 'https://github.com/gregoiredavid/france-geojson/raw/v2.1.1/' + FILENAME

  return get(SOURCE)
    .json()
    .then(({ features }) => {
      return features.map(({ geometry, properties }) => ({
        code: properties.code,
        nom: properties.nom,
        centroid: centroid(geometry).geometry.coordinates
      }))
    })
}

fetchDepartementsBoundaries()
  .then(json => writeFile(outFile, JSON.stringify(json, null, 2)))
