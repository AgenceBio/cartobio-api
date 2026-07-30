'use strict';

var dbm;
var type;
var seed;

exports.setup = function(options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

exports.up = function(db) {
  return db.runSql(`
    DO $$ BEGIN
      CREATE TYPE result_job_enum AS ENUM ('REJECTED', 'VALID', 'ERROR');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;

    DO $$ BEGIN
      CREATE TYPE etat_enum AS ENUM ('UNKNOWN', 'UPDATED', 'CREATED');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;

    ALTER TABLE parcellaire_import
        DROP COLUMN IF EXISTS nb_objets_recu,
        DROP COLUMN IF EXISTS nb_objets_acceptes,
        DROP COLUMN IF EXISTS nb_objets_refuses,
        ADD COLUMN IF NOT EXISTS numerobio TEXT NULL,
        ADD COLUMN IF NOT EXISTS numeroclient TEXT NULL,
        ADD COLUMN IF NOT EXISTS audit_date DATE NULL,
        ADD COLUMN IF NOT EXISTS statut_job result_job_enum NULL,
        ADD COLUMN IF NOT EXISTS etat etat_enum NOT NULL DEFAULT 'UNKNOWN';
  `)
  .then(function() {
    return db.runSql(`
      UPDATE parcellaire_import pi
      SET numerobio = pip.payload -> 0 ->> 'numeroBio',
          numeroclient = pip.payload -> 0 ->> 'numeroClient',
          audit_date = (pip.payload -> 0 ->> 'dateAudit')::DATE
      FROM parcellaire_import_payload pip
      WHERE pip.import_id = pi.id;
    `);
  })
  .then(function() {
    return db.runSql(`
UPDATE parcellaire_import pi
SET statut_job =
  CASE
    WHEN COALESCE(jsonb_array_length(pi.result_job -> 'numeroBioError'), 0) > 0
      THEN 'REJECTED'::result_job_enum

    WHEN COALESCE(jsonb_array_length(pi.result_job -> 'numeroBioValid'), 0) > 0
      THEN 'VALID'::result_job_enum

    ELSE 'ERROR'::result_job_enum
  END;
    `);
  });
};

exports.down = function(db) {
  return db.runSql(`
    ALTER TABLE parcellaire_import
        ADD COLUMN IF NOT EXISTS nb_objets_recu INT NULL,
        ADD COLUMN IF NOT EXISTS nb_objets_acceptes INT NULL,
        ADD COLUMN IF NOT EXISTS nb_objets_refuses INT NULL,
        DROP COLUMN IF EXISTS numerobio,
        DROP COLUMN IF EXISTS numeroclient,
        DROP COLUMN IF EXISTS audit_date,
        DROP COLUMN IF EXISTS statut_job,
        DROP COLUMN IF EXISTS etat;

    DROP TYPE IF EXISTS result_job_enum;
    DROP TYPE IF EXISTS etat_enum;
  `);
};

exports._meta = {
  version: 1
};