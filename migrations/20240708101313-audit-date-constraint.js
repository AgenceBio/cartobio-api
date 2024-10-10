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
  await db.removeIndex("cartobio_operators", "cartobio_operators_numerobio_audit_date_idx");
  await db.runSql(/* sql */ `
    CREATE UNIQUE INDEX cartobio_operators_numerobio_audit_date_idx
    ON "cartobio_operators" ("numerobio", "audit_date") WHERE cartobio_operators.deleted_at IS NULL
  `);
};

exports.down = async function (db) {
  await db.removeIndex("cartobio_operators", "cartobio_operators_numerobio_audit_date_idx");
  await db.addIndex(
    "cartobio_operators",
    "cartobio_operators_numerobio_audit_date_idx",
    ["numerobio", "audit_date"],
    true
  );
};

exports._meta = {
  version: 1,
};
