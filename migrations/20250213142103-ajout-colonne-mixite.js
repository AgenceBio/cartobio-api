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

  // await db.runSql(`UPDATE cartobio_operators co
  //         SET mixite = CASE
  //             WHEN parcelles_data.nombre_AB = parcelles_data.nombre_parcelles THEN 'AB'
  //             WHEN parcelles_data.total_non_conventionnel = parcelles_data.nombre_parcelles THEN 'ABCONV'
  //             WHEN (parcelles_data.nombre_conventionnel > 1) THEN 'MIXTE'
  //         END
  //         FROM (
  //             SELECT
  //                 co.record_id,
  //                 COUNT(cp.record_id) AS nombre_parcelles,
  //                 COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'CONV' THEN 1 ELSE NULL END), 0) AS nombre_conventionnel,
  //                 COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C1' THEN 1 ELSE NULL END), 0) AS nombre_C1,
  //                 COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C2' THEN 1 ELSE NULL END), 0) AS nombre_C2,
  //                 COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C3' THEN 1 ELSE NULL END), 0) AS nombre_C3,
  //                 COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'AB' THEN 1 ELSE NULL END), 0) AS nombre_AB,
  //                 (COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C1' THEN 1 ELSE NULL END), 0) +
  //                 COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C2' THEN 1 ELSE NULL END), 0) +
  //                 COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'C3' THEN 1 ELSE NULL END), 0) +
  //                 COALESCE(COUNT(CASE WHEN cp.conversion_niveau = 'AB' THEN 1 ELSE NULL END), 0)) AS total_non_conventionnel
  //             FROM cartobio_operators co
  //             LEFT JOIN cartobio_parcelles cp ON cp.record_id = co.record_id
  //             WHERE co.certification_state = 'CERTIFIED'
  //             GROUP BY co.record_id
  //         ) AS parcelles_data
  //         WHERE co.record_id = parcelles_data.record_id;
  // `);
};

exports.down = function (db) {
  return db.removeColumn("cartobio_operators", "mixite");
};

exports._meta = {
  version: 1,
};
