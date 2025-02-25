"use strict";

const fs = require("fs");
const { join } = require("path");
const JSONStream = require("jsonstream-next");
const stream = require("node:stream");
const { promisify } = require("node:util");

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

exports.up = function (db) {
  return db.addColumn("cartobio_operators", "mixite", {
    type: "string",
    notNull: false,
  });
};

exports.down = function (db) {
  return db.removeColumn("cartobio_operators", "mixite");
};

exports._meta = {
  version: 1,
};
