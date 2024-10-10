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
  // Drop numerobio unique index and legacy index
  await db.removeIndex("cartobio_operators", "cartobio_operators_numerobio_idx");
  await db.removeIndex("cartobio_operators", "numerobio");

  // Create non unique index on numerobio
  await db.addIndex("cartobio_operators", "cartobio_operators_numerobio_idx", ["numerobio"], false);

  // Create column audit_date
  await db.addColumn("cartobio_operators", "audit_date", {
    type: "date",
    notNull: false,
  });

  // Fill audit_date with history data
  await db.runSql(`
    UPDATE cartobio_operators
    SET audit_date = NULLIF(SUBSTR(audit_history->0->>'date', 0, 11), '')::date
    WHERE metadata->>'source' = 'API Parcellaire'
    
  `);

  await db.runSql(`
    UPDATE cartobio_operators
    SET audit_date = (
        SELECT NULLIF(SUBSTR(event->>'date', 0, 11), '')::date
        FROM jsonb_array_elements(audit_history) AS event
        WHERE (event->>'type' = 'CertificationStateChange' OR event->>'type' IS NULL)
         AND event->>'state' = 'AUDITED'
        ORDER BY event->>'date' DESC
        LIMIT 1
    )
    WHERE audit_date IS NULL
  `);

  // Create unique index on numerobio + audit_date
  await db.addIndex(
    "cartobio_operators",
    "cartobio_operators_numerobio_audit_date_idx",
    ["numerobio", "audit_date"],
    true
  );
};

exports.down = async function (db) {
  // Remove unique index on numerobio + audit_date
  await db.removeIndex("cartobio_operators", "cartobio_operators_numerobio_audit_date_idx");

  // Remove column audit_date
  await db.removeColumn("cartobio_operators", "audit_date");

  // Remove non unique index on numerobio
  await db.removeIndex("cartobio_operators", "cartobio_operators_numerobio_idx");

  // Create numerobio unique index and legacy index
  await db.addIndex("cartobio_operators", "cartobio_operators_numerobio_idx", ["numerobio"], true);
  await db.addIndex("cartobio_operators", "numerobio", ["numerobio"], true);
};

exports._meta = {
  version: 1,
};
