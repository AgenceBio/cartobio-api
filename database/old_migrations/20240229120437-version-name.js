'use strict';

var dbm;
var type;
var seed;

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
  await db.addColumn(
    "cartobio_operators",
    "version_name",
    {
      type: "text",
    }
  )
  await db.addColumn(
    "cartobio_operators",
    "deleted_at",
    {
      type: "timestamp",
    }
  )

  await db.runSql(
    /*sql*/`
    UPDATE cartobio_operators
    SET version_name = 'Version créée le ' || to_char(created_at, 'DD/MM/YYYY')
  `)

  await db.changeColumn(
    "cartobio_operators",
    "version_name",
    {
      type: "text",
      notNull: true
    }
  )
};

exports.down = async function(db) {
  await db.removeColumn("cartobio_operators", "version_name");
  await db.removeColumn("cartobio_operators", "deleted_at");
};

exports._meta = {
  "version": 1
};
