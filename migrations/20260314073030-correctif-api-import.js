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
    `
   CREATE TABLE IF NOT EXISTS parcellaire_import (
    id SERIAL PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('ERROR', 'DONE', 'PENDING', 'CREATED')),
    organisme_certificateur TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT now(),
    started_at TIMESTAMP NULL,
    ended_at TIMESTAMP NULL,
    nb_objets_recu INT NULL,
    nb_objets_acceptes INT NULL,
    nb_objets_refuses INT NULL,
    result_job JSONB NULL
    );

    CREATE TABLE IF NOT EXISTS parcellaire_import_payload  (
        id SERIAL PRIMARY KEY,
        import_id INT NOT NULL REFERENCES parcellaire_import(id) ON DELETE CASCADE,
        payload JSONB
    );

    CREATE TABLE IF NOT EXISTS parcellaire_import_logs  (
        id SERIAL PRIMARY KEY,
        import_id INT NOT NULL REFERENCES parcellaire_import(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('error', 'warning')),
        message TEXT NOT NULL,
        numero_bio TEXT NULL
    );
    CREATE TYPE statut_type_geom AS ENUM ('ACCEPTENONCORRIGE', 'CORRIGE', 'ACCEPTE');
    ALTER TABLE cartobio_parcelles ADD COLUMN statut_import_geom statut_type_geom;
  `
  )
};

exports.down = function(db) {
  return null;
};

exports._meta = {
  "version": 1
};
