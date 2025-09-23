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
    `CREATE TABLE jobs_import (
        id SERIAL PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('ERROR', 'DONE', 'PENDING', 'CREATE')),
        payload JSONB NULL,
        result JSONB NULL,
        created TIMESTAMP default now(),
        ended TIMESTAMP NULL
        );`
  )

  await db.runSql(
    /* sql */`
    CREATE OR REPLACE FUNCTION update_communes() RETURNS trigger AS $$
    DECLARE
      validGeometry public.geometry(geometry, 4326);
      tmpValidGeometry public.geometry(geometry, 4326);
      initialArea float;
      makeValidArea float;
      difference float;
      i integer;
    BEGIN
        IF NEW.commune IS NOT NULL AND NEW.commune != '' THEN
          RETURN NEW;
        END IF;

        IF ST_IsValid(NEW.geometry) = false THEN
          validGeometry := ST_MakeValid(NEW.geometry, 'method=structure');
          IF ST_Geometrytype(validGeometry) = 'ST_MultiPolygon' THEN
            tmpValidGeometry := ST_GeometryN(validGeometry, 1);
            FOR i IN
              SELECT generate_series(1, ST_NumGeometries(validGeometry)) AS i
            LOOP
              IF ST_Area(ST_GeometryN(validGeometry, i), true) > ST_Area(tmpValidGeometry, true) THEN
                tmpValidGeometry := ST_GeometryN(validGeometry, i);
              END IF;
            END LOOP;
            validGeometry := tmpValidGeometry;
          END IF;
          initialArea := ST_Area(NEW.geometry, true);
          makeValidArea := ST_Area(validGeometry, true);
          difference := ABS(initialArea - makeValidArea);
          IF (difference / 1000) < 1 AND ABS(difference / (initialArea / 100)) < 1 THEN
            NEW.geometry = validGeometry;
          END IF;
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
            ), true
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

  await db.runSql(
    `
    CREATE TABLE parcellaire_imports (
    id SERIAL PRIMARY KEY,
    organisme_certificateur TEXT NOT NULL,
    started_at TIMESTAMP DEFAULT now(),
    objets_acceptes JSONB NOT NULL,
    objets_refuses JSONB NOT NULL
    );

    CREATE TABLE parcellaire_import_logs (
        id SERIAL PRIMARY KEY,
        import_id INT NOT NULL REFERENCES parcellaire_imports(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('error', 'warning')),
        message TEXT NOT NULL,
        numero_bio TEXT NULL
    );
`
  )
};

exports.down = function(db) {
  return null;
};

exports._meta = {
  "version": 1
};
