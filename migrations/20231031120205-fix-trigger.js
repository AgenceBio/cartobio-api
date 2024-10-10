"use strict";

let dbm;
let type;
let seed;

/**
 * We receive the dbmigrate dependency from dbmigrate initially.
 * This enables us to not have to rely on NODE_PATH.
 */
exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

exports.up = function (db) {
  // Add validity check on parcelle geometry
  db.runSql(/* sql */ `
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
                                WHEN feature.value->'properties'->>'COMMUNE' IS NULL
                                    AND ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON(feature.value->>'geometry'), 4326)) 
                                THEN
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
  `);

  return null;
};

exports.down = function (db) {
  return null;
};

exports._meta = {
  version: 1,
};
