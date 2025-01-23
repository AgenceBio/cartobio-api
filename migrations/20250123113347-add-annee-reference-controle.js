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
    notNull: false,
    defaultValue:  new String("DATE_PART('year', CURRENT_TIMESTAMP)")
  });

  await db.runSql(`
    UPDATE cartobio_operators
    SET annee_reference_controle=(metadata->>'anneeReferenceControle')::int
    WHERE
      metadata->'anneeReferenceControle' is not null AND created_at > '2024-01-12' 
  `);
  await db.runSql(`
    UPDATE cartobio_operators
    SET annee_reference_controle=DATE_PART('year', created_at)
    WHERE
     annee_reference_controle is null;
  `);

  await db.runSql('ALTER TABLE "cartobio_operators" ALTER COLUMN "annee_reference_controle" SET NOT NULL')
};

exports.down = async function (db) {
  await db.removeColumn("cartobio_operators", "annee_reference_controle");
};

exports._meta = {
  version: 1,
};