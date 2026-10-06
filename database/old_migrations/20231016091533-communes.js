'use strict'

let dbm
let type
let seed

/**
  * We receive the dbmigrate dependency from dbmigrate initially.
  * This enables us to not have to rely on NODE_PATH.
  */
exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate
  type = dbm.dataType
  seed = seedLink
}

exports.up = function (db) {
  // Create the communes centroids table
  db.runSql(
    `CREATE TABLE communes (
      code varchar(5) PRIMARY KEY,
      nom varchar(100),
      geometry geometry
    )`
  )

  // Create a gist index on the geometry column
  db.runSql('CREATE INDEX communes_geometry_idx ON communes USING GIST (geometry)')

  // Create function which update an operator record parcelles, so each
  // parcelles COMMUNE property are updated based on the
  // parcelle geometry intersection with the communes table
  db.runSql(
    /* sql */`
    CREATE OR REPLACE FUNCTION update_communes() RETURNS trigger AS $$
    BEGIN
        NEW.parcelles = jsonb_set(
            NEW.parcelles,
            '{features}',
            (
                SELECT
                    jsonb_agg(
                        (
                            SELECT CASE
                                WHEN feature.value->'properties'->>'COMMUNE' IS NULL THEN
                                    jsonb_set(
                                        feature.value,
                                        '{properties}',
                                        feature.value->'properties' || jsonb_build_object(
                                            'COMMUNE',
                                            (
                                                SELECT code
                                                FROM communes
                                                WHERE ST_Intersects(
                                                    ST_SetSRID(ST_GeomFromGeoJSON(feature.value->>'geometry'), 4326),
                                                    geometry
                                                ) LIMIT 1
                                            )::text
                                        ),
                                        true
                                    )
                                ELSE
                                    feature.value
                                END
                        )
                    )
                FROM jsonb_array_elements(NEW.parcelles->'features') AS feature
            )
        );
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)

  // Create a trigger which call the function above on each operator update
  db.runSql(/* sql */`
    CREATE TRIGGER update_communes
    BEFORE UPDATE OF parcelles ON cartobio_operators
    FOR EACH ROW
    EXECUTE FUNCTION update_communes()
  `)
  return null
}

exports.down = function (db) {
  db.dropTable('communes')
  db.runSql('DROP TRIGGER update_communes ON cartobio_operators')
  db.runSql('DROP FUNCTION update_communes()')
  return null
}

exports._meta = {
  version: 1
}
