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
