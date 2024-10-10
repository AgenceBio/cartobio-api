"use strict";

let dbm;
let type;
let seed;

/**
 * We receive the dbmigrate dependency from dbmigrate initially.
 * This enables us to not have to rely on NODE_PATH.
 */
exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

exports.up = function (db) {
  return db.runSql(
    "UPDATE \"cartobio_operators\" SET numerobio = operator_id, created_at = CAST(metadata->>'sourceLastUpdate' AS timestamp), updated_at = CAST(metadata->>'sourceLastUpdate' AS timestamp)"
  );
};

exports.down = function (db) {
  return null;
};

exports._meta = {
  version: 1,
};
