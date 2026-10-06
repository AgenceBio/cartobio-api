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
  await db.runSql(`
      CREATE TABLE IF NOT EXISTS import_pac (
      id SERIAL PRIMARY KEY,
      numerobio VARCHAR NOT NULL,
      pacage VARCHAR NOT NULL,
      siret VARCHAR NOT NULL,
      nb_parcelles VARCHAR NOT NULL,
      size VARCHAR NOT NULL,
      record JSONB NOT NULL,
      imported BOOLEAN NOT NULL DEFAULT FALSE,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(numerobio, pacage, siret)
    );
    `);
};

exports.down = async function (db) {
  await db.runSql(`
  DROP TABLE import_pac
  `);
};

exports._meta = {
  version: 1,
};
