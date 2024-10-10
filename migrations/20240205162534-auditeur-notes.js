"use strict";

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
  await db.addColumn("cartobio_parcelles", "auditeur_notes", {
    type: "text",
  });

  await db.runSql(/*sql*/ `
    UPDATE cartobio_parcelles SET auditeur_notes = (
      SELECT auditeur_notes
      FROM cartobio_operators, jsonb_array_elements(parcelles)
      WHERE parcelles->>id = cartobio_parcelles.id
      AND cartobio_operators.record_id = cartobio_parcelles.record_id
    )
  `);
};

exports.down = function (db) {
  return db.removeColumn("cartobio_parcelles", "auditeur_notes");
};

exports._meta = {
  version: 1,
};
