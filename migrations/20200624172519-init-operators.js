"use strict";

var dbm;
var type;

exports.setup = function (options) {
  dbm = options.dbmigrate;
  type = dbm.datatype;
};

exports.up = function (db) {
  return db.createTable("cartobio_operators", {
    numerobio: {
      type: "int",
      primaryKey: true,
      autoIncrement: false,
      unique: true,
      unsigned: true,
      notNull: true,
    },
    metadata: {
      type: "jsonb",
      /* eslint-disable-next-line no-new-wrappers,quotes */
      defaultValue: new String(`'{}'::jsonb`),
    },
  });
};

exports.down = function (db) {
  return db.dropTable("cartobio_operators");
};
