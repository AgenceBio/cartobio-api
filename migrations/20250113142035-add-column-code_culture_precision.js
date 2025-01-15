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
  await db.addColumn("cartobio_parcelles", "code_culture_pac", {
    type: "string",
    notNull: false,
  });
  await db.addColumn("cartobio_parcelles", "code_precision_pac", {
    type: "string",
    notNull: false,
  });
};

exports.down = async function (db) {
  await db.removeColumn("cartobio_parcelles", "code_culture_pac");
  await db.removeColumn("cartobio_parcelles", "code_precision_pac");
};

exports._meta = {
  version: 1,
};