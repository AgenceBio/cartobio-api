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
  await db.addColumn("cartobio_operators", "certification_date_debut", {
    type: "date",
  });

  await db.addColumn("cartobio_operators", "certification_date_fin", {
    type: "date",
  });
};
exports.down = async function (db) {
  await db.removeColumn("cartobio_operators", "certification_date_debut");
  await db.removeColumn("cartobio_operators", "certification_date_fin");
};

exports._meta = {
  version: 1,
};
