#!/usr/bin/env node

const db = require('../lib/db.js')
const QueryStream = require('pg-query-stream')
const JSONStream = require('jsonstream-next')
const { pipeline } = require('node:stream/promises')

const query = new QueryStream(`-- pg
-- https://postgis.net/docs/ST_AsGeoJSON.html
SELECT 'FeatureCollection' as type, json_agg(ST_AsGeoJSON(properties)::json) features
FROM (
  SELECT
    feature->'properties'->'conversion_niveau' AS conversion_niveau,
    -- https://gis.stackexchange.com/a/297289
    -- ST_Area(ST_Transform(ST_GeomFromGeoJSON(feature->'geometry'), 4326)::geography) / 10000 as surface_ha,
    -- ST_Area(ST_Transform(ST_GeomFromGeoJSON(feature->'geometry'), 4326)::geography) as surface_m2,
    -- https://www.postgresql.org/docs/9.1/functions-datetime.html
    created_at AS certification_date_debut,
    created_at + '18 months' AS certification_date_fin,
    -- quand on aura la colonne 'certification_date'
    -- cf. https://trello.com/c/KLblWZ4H
    -- (certification_date OR created_at) AS certification_date_debut,
    -- (certification_date OR created_at) + '18 months' AS certification_date_fin,
    --
    -- on ne gère pas encore les déclassements
    CASE WHEN feature->'properties'->'declassement' IS NULL THEN '{}'::jsonb else feature->'properties'->'declassement' END AS declassement,
    -- on ne gère pas encore cette distinction
    -- false as maraichage_diversifie,
    ST_Transform(ST_GeomFromGeoJSON(feature->'geometry'), 4326) AS geom
    FROM (
      SELECT
        jsonb_array_elements("cartobio_operators"."parcelles" -> 'features') AS feature,
        "cartobio_operators"."numerobio",
        "cartobio_operators"."created_at"
      FROM "cartobio_operators"
      WHERE certification_state IN (/*'OPERATOR_DRAFT', */'AUDITED', 'CERTIFIED')
    ) features
  LEFT JOIN correspondance_pac_cpf ON (feature->'properties'->>'TYPE' = correspondance_pac_cpf.pac)
) properties;`, [], { singleRowMode: true, rowMode: 'one' })

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
    JSONStream.stringify(),
    process.stdout
  ])
})()
