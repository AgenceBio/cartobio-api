"use strict";

var dbm;
var type;
var seed;

/**
 * We receive the dbmigrate dependency from dbmigrate initially.
 * This enables us to not have to rely on NODE_PATH.
 */
exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

exports.up = async function (db) {
  // create a function for projecting a geometry in correct legal projection
  await db.runSql(/* sql */ `
    CREATE OR REPLACE FUNCTION public.to_legal_projection(
      geom geometry
    ) RETURNS geometry AS $$
      BEGIN
        RETURN ST_Transform(geom, COALESCE((
          SELECT legal_projection
          FROM (
            VALUES 
              (2154, ST_MakeEnvelope(-5.1412, 41.334, 9.5597, 51.0888, 4326)), /* METROPOLE */
              (5490, ST_MakeEnvelope(-61.8098, 14.3947, -60.8106, 16.511, 4326)), /* ANTILLES */
              (2975, ST_MakeEnvelope(-54.6023, 2.1111, -51.619, 5.7487, 4326)), /* REUNION */
              (2972, ST_MakeEnvelope(55.2166, -21.3891, 55.8366, -20.8721, 4326)), /* GUYANE */
              (4471, ST_MakeEnvelope(45.0185, -13.0001, 45.298, -12.6366, 4326)) /* MAYOTTE */
          ) AS t(legal_projection, region_bounds)
          WHERE ST_Intersects(geom, region_bounds)
        ), 2154));    
      END;
    $$ LANGUAGE plpgsql;
  `);
};

exports.down = async function (db) {
  await db.runSql(/* sql */ `
    DROP FUNCTION public.to_legal_projection(geometry);
  `);
};

exports._meta = {
  version: 1,
};
