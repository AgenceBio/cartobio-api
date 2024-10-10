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
  await db.removeColumn("cartobio_operators", "events");
  await db.addColumn("cartobio_operators", "audit_history", {
    type: "jsonb",
    /* eslint-disable-next-line no-new-wrappers,quotes */
    defaultValue: new String(`'[]'::jsonb`),
  });
  await db.addColumn("cartobio_operators", "audit_notes", {
    type: "text",
    defaultValue: "",
  });
  await db.addColumn("cartobio_operators", "audit_demandes", {
    type: "text",
    defaultValue: "",
  });

  await db.runSql(
    "UPDATE \"cartobio_operators\" SET audit_history = audit_history || audit_history || jsonb_build_object('state', certification_state, 'date', created_at);"
  );
};

exports.down = async function (db) {
  await db.addColumn("cartobio_operators", "events", {
    type: "jsonb",
    /* eslint-disable-next-line no-new-wrappers,quotes */
    defaultValue: new String(`'[]'::jsonb`),
  });
  await db.removeColumn("cartobio_operators", "audit_history");
  await db.removeColumn("cartobio_operators", "audit_notes");
  await db.removeColumn("cartobio_operators", "audit_demandes");
};

exports._meta = {
  version: 1,
};
