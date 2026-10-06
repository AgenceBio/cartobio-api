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
  return await db.runSql(`
  UPDATE cartobio_operators co
  SET date_derniere_notif = co.updated_at
  WHERE co.certification_state = 'CERTIFIED' and co.date_derniere_notif IS NULL
`);
};

exports.down = function (db) {
  return null;
};

exports._meta = {
  version: 1,
};
