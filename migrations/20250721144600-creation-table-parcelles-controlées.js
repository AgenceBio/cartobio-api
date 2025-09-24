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
    `CREATE TABLE parcelles_controlees (
      record_id uuid NOT NULL,
    	id varchar NOT NULL,
      user_id integer NOT NULL,
      PRIMARY KEY(record_id, id, user_id)
    )`
  )
  await db.addColumn('parcelles_controlees', 'created_at', {
    type: 'datetime',
    notNull: true,
    timezone: true,
    defaultValue: {
      special: 'CURRENT_TIMESTAMP'
    }
  })
};

exports.down = function (db) {
  db.dropTable('parcelles_controlees')
};

exports._meta = {
  "version": 1
};
