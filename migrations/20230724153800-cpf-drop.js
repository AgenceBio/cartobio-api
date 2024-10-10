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

// it is a one way migration
exports.up = async function (db) {
  return db.dropTable("correspondance_pac_cpf", { ifExists: true });
};

exports._meta = {
  version: 1,
};
