#!/usr/bin/env node

const db = require('../lib/db.js')
const QueryStream = require('pg-query-stream')
const JSONStream = require('jsonstream-next')
const { pipeline } = require('node:stream/promises')

// @todo make it a CLI parameter
const MAX_DATE = new Date('2023-05-15T23:59:59Z').toISOString()

const query = new QueryStream(`-- pg
-- https://postgis.net/docs/ST_AsGeoJSON.html
SELECT 'FeatureCollection' as type, json_agg(ST_AsGeoJSON(properties)::json) features
FROM (
  SELECT
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
    ST_Transform(ST_GeomFromGeoJSON(feature->'geometry'), 4326) AS geom
  FROM (
    SELECT
      jsonb_array_elements("cartobio_operators"."parcelles" -> 'features') AS feature,
      jsonb_path_query_first("cartobio_operators"."audit_history", '$[*] ? (@.state == "CERTIFIED").date')::text::date AS certification_date,
      "cartobio_operators"."numerobio",
      "cartobio_operators"."created_at"
    FROM "cartobio_operators"
    WHERE certification_state = 'CERTIFIED'
          -- la date de certification est AVANT le 15 mai 20xx (inclus)
          AND audit_history @? '$[*] ? (@.state == "CERTIFIED" && @.date <= "${MAX_DATE}")'
  ) features
  WHERE feature->'properties'->>'conversion_niveau' IN ('C1', 'C2', 'C3', 'AB')
        AND (
          -- avec une date d'engagement inférieure au 15 mai 20xx (inclus)
          -- ou une date pas renseignée
          feature->'properties'->>'engagement_date' <= '${MAX_DATE}'
          OR feature->'properties'->>'engagement_date' = ''
          OR jsonb_path_exists(feature, '$.properties.engagement_date') = FALSE
        )
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
