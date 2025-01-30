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
  await db.addColumn("cartobio_operators", "annee_reference_controle", {
    type: 'int',
    unsigned: true,
    notNull: false
  });

  await db.runSql(`
    UPDATE cartobio_operators
    SET annee_reference_controle=(metadata->>'anneeReferenceControle')::int
    WHERE
      metadata->'anneeReferenceControle' is not null AND created_at > '2024-01-12' 
  `);
};

exports.down = async function (db) {
  await db.removeColumn("cartobio_operators", "annee_reference_controle");
};

exports._meta = {
  version: 1,
};