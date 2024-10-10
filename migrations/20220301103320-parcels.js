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

exports.up = function (db) {
  // we do like this to prototype quickly for now
  // in the future we will create features as individual PostGIS records
  return db.addColumn("cartobio_operators", "parcelles", {
    type: "jsonb",
    /* eslint-disable-next-line no-new-wrappers,quotes */
    defaultValue: new String(`'{"type": "FeatureCollection", "features": []}'::jsonb`),
  });
};

exports.down = function (db) {
  return db.removeColumn("cartobio_operators", "parcelles");
};

exports._meta = {
  version: 1,
};
