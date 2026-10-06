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
  await db.runSql('ALTER TABLE "cartobio_parcelles" ALTER COLUMN from_parcelles TYPE TEXT[] USING case when from_parcelles is null then null else ARRAY[from_parcelles] end;')
};

exports.down = async function (db) {
  await db.runSql('ALTER TABLE "cartobio_parcelles" ALTER COLUMN from_parcelles TYPE VARCHAR(255) USING case when from_parcelles is null then null else from_parcelles[0] end;')
  
};

exports._meta = {
  version: 1,
};