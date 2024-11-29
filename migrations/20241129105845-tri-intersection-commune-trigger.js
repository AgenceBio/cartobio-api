'use strict';

var dbm;
var type;
var seed;

/**
  * We receive the dbmigrate dependency from dbmigrate initially.
  * This enables us to not have to rely on NODE_PATH.
  */
exports.setup = function(options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

exports.up = async function(db) {
  await db.runSql(
    /* sql */`
    CREATE OR REPLACE FUNCTION update_communes() RETURNS trigger AS $$
    BEGIN
        NEW.commune = (SELECT CASE
          WHEN NEW.commune IS NULL AND ST_IsValid(NEW.geometry)
          THEN (
              SELECT code
              FROM communes
              WHERE ST_Intersects(
                  NEW.geometry,
                  communes.geometry
              )
              ORDER BY ST_Area(
                ST_Intersection(
                  NEW.geometry,
                  communes.geometry
                )
              )
              LIMIT 1
          )::text
          ELSE NEW.commune
          END
        );
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)
};

exports.down = async function(db) {
  await db.runSql(
    /* sql */`
    CREATE OR REPLACE FUNCTION update_communes() RETURNS trigger AS $$
    BEGIN
        NEW.commune = (SELECT CASE
          WHEN NEW.commune IS NULL AND ST_IsValid(NEW.geometry)
          THEN (
              SELECT code
              FROM communes
              WHERE ST_Intersects(
                  NEW.geometry,
                  communes.geometry
              ) LIMIT 1
          )::text
          ELSE NEW.commune
          END
        );
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)
};

exports._meta = {
  "version": 1
};
