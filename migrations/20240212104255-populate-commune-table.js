'use strict';

const fs = require("fs");
const { join } = require("path");
const JSONStream = require("jsonstream-next");
const stream = require("node:stream");
const { promisify} = require("node:util");

let dbm;
let type;
let seed;

/**
  * We receive the dbmigrate dependency from dbmigrate initially.
  * This enables us to not have to rely on NODE_PATH.
  */
exports.setup = function(options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

exports.up = async function(db) {
  const pipeline = promisify(stream.pipeline)
  const inputFile = fs.createReadStream(join(__dirname, '..', 'data', 'communes.json'))

  return pipeline([
    inputFile,
    JSONStream.parse('*'),
    (source) => stream.Readable.from(source).forEach(commune => {
      // Save to commune table
      const { code, nom, geometry } = commune

      db.runSql(`
        INSERT INTO communes (code, nom, geometry)
        VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))
        ON CONFLICT (code) DO UPDATE SET
          nom = $2,
          geometry = ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)
        `
        , [code, nom, JSON.stringify(geometry)]
      )
    })
  ])
};

exports.down = function(db) {
  db.truncate('communes')
};

exports._meta = {
  "version": 1
};
