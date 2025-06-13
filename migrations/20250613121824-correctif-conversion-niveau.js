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

exports.up = async function (db) {
  //Biologique → AB
  // Conversion 1ère année → C1
  // Conversion 2ème année → C2
  // Conversion 3ème année → C3
  // Non biologique → CONV
  await db.runSql(/* sql */ `
  UPDATE cartobio_parcelles
  SET conversion_niveau =
    CASE conversion_niveau
        WHEN 'Biologique' THEN 'AB'
        WHEN 'Conversion 1ère année' THEN 'C1'
        WHEN 'Conversion 2ème année' THEN 'C2'
        WHEN 'Conversion 3ème année' THEN 'C3'
        WHEN 'Non biologique' THEN 'CONV'
        ELSE conversion_niveau
    END;
  `);
};

exports.down = function (db) {
  return null;
};

exports._meta = {
  version: 1,
};
