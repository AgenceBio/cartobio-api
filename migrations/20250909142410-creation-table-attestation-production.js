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
  await db.runSql(
    `CREATE TABLE attestations_productions (
      record_id uuid PRIMARY KEY,
      path varchar(100),
      status varchar(10)
    )`
  )

  await db.runSql('ALTER TABLE attestations_productions ADD CONSTRAINT record_id_foreign FOREIGN KEY (record_id) REFERENCES cartobio_operators(record_id) ON UPDATE CASCADE ON DELETE CASCADE;')

  await db.addColumn('attestations_productions', 'created_at', {
    type: 'datetime',
    timezone: true,
    defaultValue: {
      special: 'CURRENT_TIMESTAMP'
    }
  })
  await db.addColumn('attestations_productions', 'updated_at', {
    type: 'datetime',
    timezone: true,
    defaultValue: {
      special: 'CURRENT_TIMESTAMP'
    }
  })
};

exports.down = function (db) {
  db.dropTable('attestations_productions')
};

exports._meta = {
  "version": 1
};
