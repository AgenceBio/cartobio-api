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

exports.up = async function (db) {
  db.runSql(
    `CREATE TABLE region(
      code varchar(3) PRIMARY KEY,
      nom varchar(100),
      geometry geometry    )`
  );

  const pipeline = promisify(stream.pipeline);

  let inputFile = fs.createReadStream(
    join(__dirname, "..", "data", "regions.json")
  );

  await pipeline([
    inputFile,
    JSONStream.parse("*"),
    (source) =>
      stream.Readable.from(source).forEach((commune) => {
        const { code, nom, geometry } = commune;
        db.runSql(
          `
        INSERT INTO region (code, nom, geometry)
        VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))
        ON CONFLICT (code) DO UPDATE SET
          nom = $2,
          geometry = ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)
        `,
          [code, nom, JSON.stringify(geometry)]
        );
      }),
  ]);

  db.runSql(
    `CREATE TABLE departement (
      code varchar(3) PRIMARY KEY,
      nom varchar(100),
      geometry geometry
    )`
  );

  inputFile = fs.createReadStream(
    join(__dirname, "..", "data", "departements.json")
  );

  await pipeline([
    inputFile,
    JSONStream.parse("*"),
    (source) =>
      stream.Readable.from(source).forEach((commune) => {
        const { code, nom, geometry } = commune;
        db.runSql(
          `
        INSERT INTO departement (code, nom, geometry)
        VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))
        ON CONFLICT (code) DO UPDATE SET
          nom = $2,
          geometry = ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)
        `,
          [code, nom, JSON.stringify(geometry)]
        );
      }),
  ]);

  db.runSql(
    `
    ALTER TABLE departement ADD COLUMN code_region VARCHAR(3);
    `
  );

  db.runSql(
    `
    UPDATE departement d
    SET code_region = r.code
    FROM region r
    WHERE ST_Contains(r.geometry, d.geometry);
    `
  );

  db.runSql(
    `
    DELETE FROM departement
    WHERE code_region IS NULL;
    `
  );
};

exports.down = function (db) {
  return db.runSql("TRUNCATE departement");
};

exports._meta = {
  version: 1,
};
