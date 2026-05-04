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
  await db.runSql("ALTER TABLE attestations_productions ADD COLUMN type TEXT NOT NULL DEFAULT 'complet'");
  await db.runSql("ALTER TABLE attestations_productions DROP CONSTRAINT attestations_productions_pkey;");
  await db.runSql("ALTER TABLE attestations_productions ADD CONSTRAINT attestations_productions_record_id_type_key UNIQUE (record_id, type)");

};

exports.down = function(db) {
  return null;
};

exports._meta = {
  "version": 1
};
