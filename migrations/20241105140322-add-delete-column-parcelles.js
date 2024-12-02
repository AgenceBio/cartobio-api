"use strict";

var dbm;
var type;
var seed;

exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

exports.up = async function (db) {
  await db.addColumn("cartobio_parcelles", "deleted_at", {
    type: "datetime",
    notNull: false,
  });
  await db.addColumn("cartobio_parcelles", "from_parcelles", {
    type: "string",
    length: 255,
    notNull: false,
  });
};

exports.down = async function (db) {
  await db.removeColumn("cartobio_parcelles", "deleted_at");
  await db.removeColumn("cartobio_parcelles", "from_parcelles");
};

exports._meta = {
  version: 1,
};