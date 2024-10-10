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

exports.up = async function (db) {
  await db.addIndex("cartobio_operators", "cartobio_operators_operator_id_idx", ["operator_id"], true);
  await db.changeColumn("cartobio_operators", "operator_id", { notNull: false });
  await db.addIndex("cartobio_operators", "cartobio_operators_numerobio_idx", ["numerobio"], true);
};

exports.down = async function (db) {
  await db.removeIndex("cartobio_operators", "cartobio_operators_operator_id_idx");
  await db.changeColumn("cartobio_operators", "operator_id", { notNull: true });
  await db.removeIndex("cartobio_operators", "cartobio_operators_numerobio_idx");
};

exports._meta = {
  version: 1,
};
