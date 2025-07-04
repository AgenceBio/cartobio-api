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
    DECLARE
      validGeometry public.geometry(geometry, 4326);
    BEGIN
        IF NEW.commune IS NOT NULL AND NEW.commune != '' THEN
          RETURN NEW;
        END IF;

        IF ST_IsValid(NEW.geometry) = false THEN
          validGeometry := ST_MakeValid(NEW.geometry, 'method=structure');
        ELSE
          validGeometry := NEW.geometry;
        END IF;

        NEW.etranger = 
          EXISTS(
            SELECT fid
            FROM territoires
            WHERE ST_Intersects(
                validGeometry,
                territoires.geom
            )
          ) = false;

        IF NEW.etranger = true THEN
          RETURN NEW;
        END IF;

        NEW.commune = (
          SELECT code
          FROM communes
          WHERE communes.active = true
          ORDER BY ST_Area(
            ST_Intersection(
              validGeometry,
              communes.geometry
            )
          ) DESC,
          ST_Distance(
            validGeometry,
            communes.geometry
          ) ASC
          LIMIT 1
        )::text;

        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)
};

exports.down = async function(db) {
  await db.runSql(
    /* sql */`
    CREATE OR REPLACE FUNCTION update_communes() RETURNS trigger AS $$
    DECLARE
      validGeometry public.geometry(geometry, 4326);
    BEGIN
        IF NEW.commune IS NOT NULL AND NEW.commune != '' THEN
          RETURN NEW;
        END IF;

        IF ST_IsValid(NEW.geometry) = false THEN
          validGeometry := ST_MakeValid(NEW.geometry, 'method=structure');
        ELSE
          validGeometry := NEW.geometry;
        END IF;

        NEW.etranger = 
          EXISTS(
            SELECT fid
            FROM territoires
            WHERE ST_Intersects(
                validGeometry,
                territoires.geom
            )
          ) = false;

        IF NEW.etranger = true THEN
          RETURN NEW;
        END IF;

        NEW.commune = (
          SELECT code
          FROM communes
          ORDER BY ST_Area(
            ST_Intersection(
              validGeometry,
              communes.geometry
            )
          ) DESC,
          ST_Distance(
            validGeometry,
            communes.geometry
          ) ASC
          LIMIT 1
        )::text;

        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)
};

exports._meta = {
  "version": 1
};
