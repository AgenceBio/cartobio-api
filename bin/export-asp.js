#!/usr/bin/env node

const db = require('../lib/db.js')
const QueryStream = require('pg-query-stream')
const JSONStream = require('jsonstream-next')
const { feature } = require('@turf/helpers')
const { pipeline } = require('node:stream/promises')
const minimist = require('minimist')
const { createWriteStream } = require('fs')
const { resolve } = require('path')

const cliOptions = {
  alias: {
    numerobioPath: ['numerobio-path'],
    onlyC1: ['only-c1']
  },
  boolean: ['only-c1'],
  string: ['campagne', 'numerobio-path'],
  default: {
    campagne: new Date().getFullYear(),
    numerobioPath: null
  }
}

const { campagne, numerobioPath, onlyC1 } = minimist(process.argv.slice(2), cliOptions)

// nouvelles en C1 avant le 15/05/2023
const maxCampagneDate = new Date(`${campagne}-05-15T23:59:59Z`).toISOString()
// controlées et certifiées avant le 20/09/2023
const maxAuditDate = onlyC1 ? new Date(`${campagne}-09-20T23:59:59Z`).toISOString() : maxCampagneDate
const conversionLevels = onlyC1 ? ['C1'] : ['C1', 'C2', 'C3', 'AB']
// output numerobio list
const numerobioResolvedPath = numerobioPath ? resolve(process.cwd(), numerobioPath) : null
const numerobioStream = numerobioResolvedPath ? createWriteStream(numerobioResolvedPath) : null
const numerobioSet = new Set()

if (numerobioStream) {
  numerobioStream.write('numeroBio\n')
}

const query = new QueryStream(/* sql */`-- pg
SELECT
  numerobio,
  feature->'properties'->'conversion_niveau' AS conversion_niveau,
  feature->'properties'->'engagement_date' AS engagement_date,
  -- https://gis.stackexchange.com/a/297289
  -- ST_Area(ST_Transform(ST_GeomFromGeoJSON(feature->'geometry'), 4326)::geography) / 10000 as surface_ha,
  -- ST_Area(ST_Transform(ST_GeomFromGeoJSON(feature->'geometry'), 4326)::geography) as surface_m2,
  -- https://www.postgresql.org/docs/14/functions-datetime.html
  certification_date AS certification_date_debut,
  certification_date + interval '18 months' AS certification_date_fin,
  --
  -- on ne gère pas encore les déclassements
  CASE WHEN feature->'properties'->'declassement' IS NULL THEN '{}'::jsonb else feature->'properties'->'declassement' END AS declassement,
  -- on ne gère pas encore cette distinction
  -- false as maraichage_diversifie,
  feature->'geometry' AS geometry
FROM (
  SELECT
    jsonb_array_elements("cartobio_operators"."parcelles" -> 'features') AS feature,
    jsonb_path_query_first("cartobio_operators"."audit_history", '$[*] ? (@.state == "CERTIFIED").date')::text::date AS certification_date,
    "cartobio_operators"."numerobio",
    "cartobio_operators"."created_at"
  FROM "cartobio_operators"
  WHERE certification_state = 'CERTIFIED'
    -- la date de certification est AVANT le 15 mai 20xx (inclus)
    AND audit_history @? '$[*] ? (@.state == "CERTIFIED" && @.date <= "${maxAuditDate}")'
) features
WHERE
  feature->'properties'->>'conversion_niveau' = ANY ($1)
  AND (
    -- avec une date d'engagement inférieure au 15 mai 20xx (inclus)
    -- ou une date pas renseignée
    feature->'properties'->>'engagement_date' <= $2
    OR feature->'properties'->>'engagement_date' = ''
    OR jsonb_path_exists(feature, '$.properties.engagement_date') = FALSE
  );`, [conversionLevels, maxCampagneDate])

;(async function main () {
  const client = await db.connect()
  const stream = client.query(query)

  stream.on('error', (error) => {
    console.error(error)
    client.release(error)
    process.exit(1)
  })

  stream.on('end', () => client.release(true))

  await pipeline([
    stream,
    async function * (cursor) {
      for await (const record of cursor) {
        const { numerobio, geometry, ...properties } = record
        const f = feature(geometry, properties)

        if (numerobioStream && !numerobioSet.has(numerobio)) {
          numerobioSet.add(numerobio)
          numerobioStream.write(`${numerobio}\n`)
        }

        yield f
      }
    },
    JSONStream.stringify('{ "type": "FeatureCollection", "features": [\n', '\n,\n', '\n]}\n'),
    process.stdout
  ])
})()
